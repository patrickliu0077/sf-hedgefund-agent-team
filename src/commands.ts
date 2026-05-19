import type { AgentCommandResult, LoopConfig, LoopState, RunRecord } from './types.js'
import type { LoopRequest } from './config.js'

export type CommandHandlers = {
  start(input: LoopRequest): Promise<LoopState>
  stop(): Promise<LoopState>
  tick(input: LoopRequest): Promise<RunRecord>
  status(): LoopState
}

export async function runAgentCommand(command: string, handlers: CommandHandlers): Promise<AgentCommandResult> {
  const parsed = parseAgentCommand(command)
  if (parsed.action === 'start') {
    const state = await handlers.start(parsed.config)
    return {
      accepted: true,
      command,
      action: 'start',
      config: parsed.config as Partial<LoopConfig>,
      state,
      message: 'loop started',
    }
  }
  if (parsed.action === 'stop') {
    const state = await handlers.stop()
    return { accepted: true, command, action: 'stop', state, message: 'loop stopped' }
  }
  if (parsed.action === 'tick') {
    const run = await handlers.tick(parsed.config)
    return {
      accepted: true,
      command,
      action: 'tick',
      config: parsed.config as Partial<LoopConfig>,
      run,
      message: `manual tick completed with ${run.decisions.length} decisions`,
    }
  }
  return {
    accepted: true,
    command,
    action: 'status',
    state: handlers.status(),
    message: 'status returned',
  }
}

export function parseAgentCommand(command: string): { action: AgentCommandResult['action']; config: LoopRequest } {
  const lower = command.toLowerCase()
  const config: LoopRequest = {}

  if (lower.includes('quant')) config.strategy = 'quant'
  if (lower.includes('fundamental') || lower.includes('macro')) config.strategy = 'fundamental'
  if (lower.includes('hybrid') || lower.includes('both')) config.strategy = 'hybrid'

  if (lower.includes('paper')) config.mode = 'paper'
  if (lower.includes('shadow')) config.mode = 'shadow'
  if (lower.includes('live')) config.mode = 'live'

  if (lower.includes('maker') && !lower.includes('taker')) config.styles = ['maker']
  if (lower.includes('taker') && !lower.includes('maker')) config.styles = ['taker']
  if (lower.includes('maker') && lower.includes('taker')) config.styles = ['maker', 'taker']

  if (lower.includes('kalshi') && !lower.includes('polymarket')) config.venues = ['kalshi']
  if (lower.includes('polymarket') && !lower.includes('kalshi')) config.venues = ['polymarket']
  if (lower.includes('dual') || lower.includes('both venues')) config.venues = ['kalshi', 'polymarket']

  const maxOrders = lower.match(/(?:max\s*orders|orders)\s*[:=]?\s*(\d+)/)
  if (maxOrders?.[1]) config.maxOrdersPerTick = Number(maxOrders[1])

  const candidates = lower.match(/(?:candidates|markets)\s*[:=]?\s*(\d+)/)
  if (candidates?.[1]) config.maxCandidates = Number(candidates[1])

  const interval = lower.match(/(?:interval|every)\s*[:=]?\s*(\d+)\s*(s|sec|seconds|m|min|minutes)?/)
  if (interval?.[1]) {
    const value = Number(interval[1])
    const unit = interval[2] || 's'
    config.intervalMs = unit.startsWith('m') ? value * 60_000 : value * 1_000
  }

  const minScore = lower.match(/(?:min\s*score|score)\s*[:=]?\s*(\d+(?:\.\d+)?)/)
  if (minScore?.[1]) {
    config.risk = { ...(config.risk || {}), minScore: Number(minScore[1]) }
  }

  const maxCost = lower.match(/(?:max\s*cost|cost)\s*[:=]?\s*(\d+)/)
  if (maxCost?.[1]) {
    config.risk = { ...(config.risk || {}), maxPerTradeCents: Number(maxCost[1]) }
  }

  const maxGross = lower.match(/(?:max\s*gross|gross)\s*[:=]?\s*(\d+)/)
  if (maxGross?.[1]) {
    config.risk = { ...(config.risk || {}), maxGrossCents: Number(maxGross[1]) }
  }

  const quantity = lower.match(/(?:qty|quantity)\s*[:=]?\s*(\d+)/)
  if (quantity?.[1]) {
    config.risk = { ...(config.risk || {}), maxQuantity: Number(quantity[1]) }
  }

  if (lower.includes('stop')) return { action: 'stop', config }
  if (lower.includes('status')) return { action: 'status', config }
  if (lower.includes('tick') || lower.includes('once') || lower.includes('run now')) return { action: 'tick', config }
  return { action: 'start', config }
}
