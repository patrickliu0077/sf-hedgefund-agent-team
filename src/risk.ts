import { nanoid } from 'nanoid'
import type { ExecutionStyle, LoopConfig, LoopState, MarketCandidate, RiskVerdict, TradeDecision } from './types.js'
import { clamp } from './market-utils.js'

export function buildDecisions(
  runId: string,
  candidates: MarketCandidate[],
  config: LoopConfig,
  state: LoopState,
): TradeDecision[] {
  const decisions: TradeDecision[] = []
  const styles: ExecutionStyle[] = config.styles.length ? config.styles : ['taker']

  for (const candidate of candidates) {
    for (const style of styles) {
      if (decisions.length >= config.maxOrdersPerTick) return decisions
      const decision = decisionFromCandidate(runId, candidate, style, config)
      const risk = evaluateRisk(decision, config, state, decisions)
      decision.risk = risk
      decision.status = risk.allowed ? 'approved' : 'blocked'
      if (risk.adjustedQuantity) decision.quantity = risk.adjustedQuantity
      if (risk.adjustedLimitPrice) decision.limitPrice = risk.adjustedLimitPrice
      decision.expectedCostCents = decision.quantity * decision.limitPrice
      decisions.push(decision)
    }
  }

  return decisions
}

export function evaluateRisk(
  decision: TradeDecision,
  config: LoopConfig,
  state: LoopState,
  pending: TradeDecision[] = [],
): RiskVerdict {
  const reasons: string[] = []
  let allowed = true
  let quantity = Math.min(decision.quantity, config.risk.maxQuantity)
  let limitPrice = clamp(decision.limitPrice, 1, 99)
  const pendingGross = pending
    .filter(item => item.status === 'approved' || item.status === 'submitted' || item.status === 'paper_filled')
    .reduce((sum, item) => sum + item.expectedCostCents, 0)
  const grossAfter = state.grossExposureCents + pendingGross + quantity * limitPrice

  if (!config.risk.allowedVenues.includes(decision.venue)) {
    allowed = false
    reasons.push(`venue ${decision.venue} not allowed`)
  }
  if (decision.venue === 'polymarket' && config.mode === 'live' && isBlockedJurisdiction(config.risk.jurisdiction, config.risk.blockedJurisdictions)) {
    allowed = false
    reasons.push(`polymarket live execution blocked in jurisdiction ${config.risk.jurisdiction || 'unknown'}`)
  }
  if (decision.score < config.risk.minScore) {
    allowed = false
    reasons.push(`score ${decision.score.toFixed(1)} below minScore ${config.risk.minScore}`)
  }
  if (quantity < decision.quantity) {
    reasons.push(`quantity clipped ${decision.quantity} -> ${quantity}`)
  }
  if (quantity * limitPrice > config.risk.maxPerTradeCents) {
    quantity = Math.max(0, Math.floor(config.risk.maxPerTradeCents / Math.max(limitPrice, 1)))
    reasons.push(`order clipped to maxPerTradeCents=${config.risk.maxPerTradeCents}`)
  }
  if (quantity <= 0) {
    allowed = false
    reasons.push('quantity clipped to zero')
  }
  if (grossAfter > config.risk.maxGrossCents) {
    allowed = false
    reasons.push(`gross exposure ${grossAfter}c exceeds ${config.risk.maxGrossCents}c`)
  }
  if (state.openPositions + pending.length >= config.risk.maxOpenPositions) {
    allowed = false
    reasons.push(`open positions would exceed ${config.risk.maxOpenPositions}`)
  }
  if (state.paperPnlCents <= -config.risk.maxDailyLossCents) {
    allowed = false
    reasons.push(`daily loss stop reached ${state.paperPnlCents}c`)
  }
  if (config.risk.requireLimitPrice && !Number.isFinite(limitPrice)) {
    allowed = false
    reasons.push('limit price required')
  }

  if (allowed && reasons.length === 0) reasons.push('risk checks passed')
  return {
    allowed,
    reasons,
    adjustedQuantity: quantity,
    adjustedLimitPrice: limitPrice,
    grossExposureAfterCents: grossAfter,
  }
}

function decisionFromCandidate(
  runId: string,
  candidate: MarketCandidate,
  style: ExecutionStyle,
  config: LoopConfig,
): TradeDecision {
  const price = candidate.priceCents ?? 50
  const edge = candidate.edgeScore
  const action: 'buy' | 'sell' = edge >= 50 ? 'buy' : 'sell'
  const direction: 'yes' | 'no' = action === 'buy' ? 'yes' : 'no'
  const priceOffset = style === 'maker' ? -1 : 1
  const limitPrice = clamp(Math.round(price + priceOffset), 1, 99)
  const quantity = Math.max(1, Math.min(config.risk.maxQuantity, Math.floor(config.risk.maxPerTradeCents / Math.max(limitPrice, 1))))

  return {
    id: nanoid(),
    runId,
    ts: new Date().toISOString(),
    candidateId: candidate.id,
    venue: candidate.venue,
    ticker: candidate.ticker,
    title: candidate.title,
    strategy: candidate.strategy,
    style,
    mode: config.mode,
    action,
    direction,
    quantity,
    limitPrice,
    expectedCostCents: quantity * limitPrice,
    score: candidate.edgeScore,
    rationale: `${candidate.strategy}/${style}: ${candidate.reasons.join('; ')}`,
    status: 'proposed',
  }
}

function isBlockedJurisdiction(jurisdiction: string | undefined, blocked: string[]): boolean {
  if (!jurisdiction) return false
  return blocked.map(item => item.toUpperCase()).includes(jurisdiction.toUpperCase())
}
