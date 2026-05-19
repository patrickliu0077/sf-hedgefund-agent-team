import { describe, expect, it } from 'vitest'
import { buildDecisions } from '../src/risk.js'
import type { LoopConfig, LoopState, MarketCandidate } from '../src/types.js'

describe('risk manager', () => {
  it('blocks Polymarket live execution in blocked jurisdictions', () => {
    const decisions = buildDecisions('run_1', [candidate({ venue: 'polymarket' })], config({ mode: 'live' }), state())
    expect(decisions[0]?.status).toBe('blocked')
    expect(decisions[0]?.risk?.reasons.join(' ')).toContain('polymarket live execution blocked')
  })

  it('clips order size to per-trade budget', () => {
    const decisions = buildDecisions('run_1', [candidate({ priceCents: 70 })], config({ maxPerTradeCents: 120 }), state())
    expect(decisions[0]?.risk?.allowed).toBe(true)
    expect(decisions[0]?.expectedCostCents).toBeLessThanOrEqual(120)
  })

  it('blocks low-score candidates before execution', () => {
    const decisions = buildDecisions('run_1', [candidate({ edgeScore: 40 })], config({}), state())
    expect(decisions[0]?.status).toBe('blocked')
    expect(decisions[0]?.risk?.reasons.join(' ')).toContain('below minScore')
  })

  it('chooses one execution style per candidate when maker and taker are both enabled', () => {
    const decisions = buildDecisions(
      'run_1',
      [candidate({ id: 'cand_1' }), candidate({ id: 'cand_2', ticker: 'KXTEST2' })],
      config({ styles: ['maker', 'taker'], maxOrdersPerTick: 2 }),
      state(),
    )
    expect(decisions).toHaveLength(2)
    expect(new Set(decisions.map(decision => decision.candidateId)).size).toBe(2)
  })
})

function candidate(overrides: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    id: 'cand_1',
    ts: new Date().toISOString(),
    strategy: 'quant',
    source: 'test',
    venue: 'kalshi',
    ticker: 'KXTEST',
    title: 'Test market',
    priceCents: 50,
    edgeScore: 70,
    confidence: 60,
    reasons: ['test'],
    ...overrides,
  }
}

function config(overrides: Partial<LoopConfig> & { maxPerTradeCents?: number } = {}): LoopConfig {
  return {
    strategy: 'hybrid',
    mode: overrides.mode || 'paper',
    intervalMs: 60_000,
    venues: ['kalshi', 'polymarket'],
    styles: ['taker'],
    maxCandidates: 4,
    maxOrdersPerTick: 2,
    keywords: ['fed'],
    risk: {
      maxGrossCents: 1_000,
      maxPerTradeCents: overrides.maxPerTradeCents || 250,
      maxQuantity: 10,
      maxOpenPositions: 5,
      maxDailyLossCents: 500,
      minScore: 58,
      allowedVenues: ['kalshi', 'polymarket'],
      blockedJurisdictions: ['US'],
      jurisdiction: 'US',
      requireLimitPrice: true,
      allowRuntimeStart: false,
      allowAutoExecute: false,
    },
    ...overrides,
  }
}

function state(): LoopState {
  return {
    running: false,
    tickCount: 0,
    grossExposureCents: 0,
    openPositions: 0,
    paperPnlCents: 0,
  }
}
