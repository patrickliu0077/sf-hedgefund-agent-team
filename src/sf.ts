import { SimpleFunctions, type ContractToolManifest } from '@spfunctions/sdk'
import { FileTraceStore, SimpleFunctionsAgent, type AgentPolicy } from '@spfunctions/agent'
import { join } from 'node:path'
import type { LoopConfig, RuntimeConfig } from './types.js'

export type SfTeam = {
  client: SimpleFunctions
  research: SimpleFunctionsAgent
  monitoring: SimpleFunctionsAgent
  execution: SimpleFunctionsAgent
  manifest: ContractToolManifest
}

export async function createSfTeam(config: RuntimeConfig, loop: LoopConfig): Promise<SfTeam> {
  const client = new SimpleFunctions({
    apiKey: config.sfApiKey,
    baseUrl: config.sfApiUrl,
    runtimeCloudKey: config.sfCloudKey,
    userAgent: 'sf-hedgefund-agent-team/0.1.0',
    timeoutMs: 30_000,
  })
  const manifest = await client.manifest.list()
  const trace = new FileTraceStore(join(config.dataDir, 'agent-trace.jsonl'))

  const readPolicy: AgentPolicy = {
    maxSideEffect: 'none',
    maxCostEffect: 'search_cost',
    allow: ['read.public', 'market_data', 'read'],
  }

  const userReadPolicy: AgentPolicy = {
    ...readPolicy,
    maxCostEffect: 'api_cost',
    allow: ['read.public', 'market_data', 'read', 'user_data'],
  }

  const tradePolicy = buildTradePolicy(config, loop)

  return {
    client,
    manifest,
    research: new SimpleFunctionsAgent({
      client,
      manifest,
      trace,
      policy: readPolicy,
      mode: client.hasApiKey() ? 'live' : 'inspectOnly',
    }),
    monitoring: new SimpleFunctionsAgent({
      client,
      manifest,
      trace,
      policy: userReadPolicy,
      mode: client.hasApiKey() ? 'live' : 'inspectOnly',
    }),
    execution: new SimpleFunctionsAgent({
      client,
      manifest,
      trace,
      policy: tradePolicy,
      mode: loop.mode === 'live' ? 'live' : 'inspectOnly',
    }),
  }
}

export function buildTradePolicy(config: RuntimeConfig, loop: LoopConfig): AgentPolicy {
  const liveEnabled = config.enableLiveTrading &&
    loop.mode === 'live' &&
    loop.confirmLiveTrading === config.liveConfirmToken

  return {
    maxSideEffect: liveEnabled ? 'live_trade' : 'none',
    maxCostEffect: liveEnabled ? 'venue_request_cost' : 'api_cost',
    allow: ['read.public', 'market_data', 'read', 'user_data', 'trade', 'execution', 'runtime', 'write'],
    trade: {
      allowedVenues: loop.risk.allowedVenues,
      maxOrderCostCents: loop.risk.maxPerTradeCents,
      maxQuantity: loop.risk.maxQuantity,
      requireLimitPrice: loop.risk.requireLimitPrice,
      allowAutoExecute: loop.risk.allowAutoExecute,
      allowRuntimeStart: loop.risk.allowRuntimeStart,
      dryRunOnly: !liveEnabled,
      requireJurisdiction: true,
      jurisdiction: loop.risk.jurisdiction,
      blockedJurisdictions: loop.risk.blockedJurisdictions,
      confirmToken: config.liveConfirmToken,
    },
  }
}
