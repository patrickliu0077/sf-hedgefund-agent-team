import { nanoid } from 'nanoid'
import type { ExecutionPlaceInput } from '@spfunctions/sdk'
import type { SfTeam } from './sf.js'
import type { ExecutionReceipt, LoopConfig, RuntimeConfig, TradeDecision } from './types.js'

export async function executeDecision(
  team: SfTeam,
  runtime: RuntimeConfig,
  config: LoopConfig,
  decision: TradeDecision,
): Promise<ExecutionReceipt> {
  const now = new Date().toISOString()

  if (decision.status === 'blocked' || decision.risk?.allowed === false) {
    return receipt(decision, 'blocked', {
      reason: decision.risk?.reasons.join('; ') || 'blocked before execution',
    })
  }

  if (config.mode === 'paper') {
    decision.status = 'paper_filled'
    return receipt(decision, 'paper_recorded', {
      fill: {
        ts: now,
        quantity: decision.quantity,
        priceCents: decision.limitPrice,
      },
    })
  }

  const executionInput = buildExecutionInput(runtime, config, decision)

  if (config.mode === 'shadow') {
    decision.status = 'shadow_recorded'
    return receipt(decision, 'shadow_recorded', {
      wouldCall: 'execution.place',
      input: executionInput,
    })
  }

  if (!runtime.enableLiveTrading || config.confirmLiveTrading !== runtime.liveConfirmToken) {
    decision.status = 'blocked'
    return receipt(decision, 'blocked', {
      reason: 'live trading requires ENABLE_LIVE_TRADING=true and confirmLiveTrading token',
    })
  }

  try {
    const result = await team.execution.call('execution.place', executionInput)
    decision.status = 'submitted'
    return receipt(decision, 'live_submitted', {
      runId: result.runId,
      callId: result.callId,
      durationMs: result.durationMs,
      output: result.output as Record<string, unknown>,
    })
  } catch (error) {
    decision.status = 'failed'
    return receipt(decision, 'failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function buildExecutionInput(runtime: RuntimeConfig, config: LoopConfig, decision: TradeDecision): ExecutionPlaceInput {
  const isMaker = decision.style === 'maker'
  const triggerType = isMaker
    ? decision.action === 'buy' ? 'price_below' as const : 'price_above' as const
    : 'immediate' as const
  const base = {
    title: decision.title,
    action: decision.action,
    direction: decision.direction,
    quantity: decision.quantity,
    limitPrice: decision.limitPrice,
    triggerType,
    triggerPrice: isMaker ? decision.limitPrice : undefined,
    rationale: decision.rationale,
    autoExecute: config.risk.allowAutoExecute,
    source: 'sf-hedgefund-agent-team',
    sourceId: decision.id,
    confirm: runtime.liveConfirmToken,
    jurisdiction: config.risk.jurisdiction,
    compliance: {
      mode: config.mode,
      style: decision.style,
      blockedJurisdictions: config.risk.blockedJurisdictions,
    },
    runtime: {
      mode: 'auto' as const,
      startIfNeeded: config.risk.allowRuntimeStart,
      waitForTerminal: false,
    },
  }
  if (decision.venue === 'kalshi') {
    return {
      ...base,
      venue: 'kalshi',
      ticker: decision.ticker,
    }
  }
  return {
    ...base,
    venue: 'polymarket',
    marketId: decision.ticker,
  }
}

function receipt(
  decision: TradeDecision,
  status: ExecutionReceipt['status'],
  details: Record<string, unknown>,
): ExecutionReceipt {
  return {
    id: nanoid(),
    ts: new Date().toISOString(),
    mode: decision.mode,
    status,
    venue: decision.venue,
    ticker: decision.ticker,
    details,
  }
}
