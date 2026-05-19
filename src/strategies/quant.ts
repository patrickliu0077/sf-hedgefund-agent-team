import type { SfTeam } from '../sf.js'
import type { LoopConfig, MarketCandidate, RoleReport } from '../types.js'
import { readRecord, readString, toRecordArray } from '../market-utils.js'
import { candidateFromMarket, dedupeCandidates } from './common.js'

export async function runQuantResearch(team: SfTeam, config: LoopConfig): Promise<{
  report: RoleReport
  candidates: MarketCandidate[]
}> {
  const warnings: string[] = []
  const candidates: MarketCandidate[] = []
  const limit = Math.max(config.maxCandidates * 2, 10)

  const [screen, regime, pairs, curves] = await Promise.allSettled([
    team.client.intelligence.screen({
      venue: config.venues.length === 1 ? config.venues[0] : undefined,
      excludeSports: true,
      excludeNoise: true,
      hasOrderbook: true,
      sort: 'adj_iy',
      order: 'desc',
      limit,
      nextActions: false,
    }),
    team.client.intelligence.regime({
      venue: config.venues.length === 1 ? config.venues[0] : undefined,
      hasEdge: true,
      sort: 'as',
      order: 'desc',
      limit: Math.ceil(limit / 2),
    }),
    team.client.intelligence.crossVenuePairs({
      preset: 'arb',
      minConf: 0.55,
      limit: Math.ceil(limit / 2),
      nextActions: false,
    }),
    team.client.intelligence.yieldCurves({
      limit: Math.ceil(limit / 2),
      minPoints: 3,
      sort: 'volume_desc',
      nextActions: false,
    }),
  ])

  if (screen.status === 'fulfilled') {
    for (const market of screen.value.markets || []) {
      const candidate = candidateFromMarket(market, {
        strategy: 'quant',
        source: 'markets.screen',
        fallbackReason: 'screened by implied-yield/liquidity/volatility filters',
        scoreBoost: 8,
      })
      if (candidate && config.venues.includes(candidate.venue)) candidates.push(candidate)
    }
  } else {
    warnings.push(`markets.screen failed: ${messageOf(screen.reason)}`)
  }

  if (regime.status === 'fulfilled') {
    for (const market of regime.value.markets || []) {
      const candidate = candidateFromMarket(market, {
        strategy: 'quant',
        source: 'regime.scan',
        fallbackReason: 'regime scan marked edge or abnormal state',
        scoreBoost: 10,
      })
      if (candidate && config.venues.includes(candidate.venue)) candidates.push(candidate)
    }
  } else {
    warnings.push(`regime.scan failed: ${messageOf(regime.reason)}`)
  }

  if (pairs.status === 'fulfilled') {
    for (const pair of pairs.value.pairs || []) {
      for (const market of pairMarkets(pair)) {
        const candidate = candidateFromMarket(market, {
          strategy: 'quant',
          source: 'crossvenue.pairs',
          fallbackReason: 'cross-venue pair has confidence-qualified spread',
          scoreBoost: 12,
        })
        if (candidate && config.venues.includes(candidate.venue)) candidates.push(candidate)
      }
    }
  } else {
    warnings.push(`crossvenue.pairs failed: ${messageOf(pairs.reason)}`)
  }

  if (curves.status === 'fulfilled') {
    for (const curve of curveMarkets(curves.value)) {
      const candidate = candidateFromMarket(curve, {
        strategy: 'quant',
        source: 'yieldcurves.list',
        fallbackReason: 'yield curve has enough neighboring contracts to compare shape',
        scoreBoost: 5,
      })
      if (candidate && config.venues.includes(candidate.venue)) candidates.push(candidate)
    }
  } else {
    warnings.push(`yieldcurves.list failed: ${messageOf(curves.reason)}`)
  }

  const selected = dedupeCandidates(candidates, config.maxCandidates)
  return {
    candidates: selected,
    report: {
      role: 'research',
      ok: true,
      ts: new Date().toISOString(),
      summary: `quant research selected ${selected.length} candidates from ${candidates.length} raw signals`,
      metrics: {
        rawSignals: candidates.length,
        selected: selected.length,
        avgScore: selected.length ? Number((selected.reduce((sum, c) => sum + c.edgeScore, 0) / selected.length).toFixed(2)) : 0,
      },
      warnings,
    },
  }
}

function pairMarkets(pair: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = toRecordArray(pair.markets)
  if (direct.length) return direct

  const out: Array<Record<string, unknown>> = []
  for (const key of ['kalshi', 'kalshiMarket', 'polymarket', 'polyMarket']) {
    const market = readRecord(pair, key)
    if (market) out.push({ ...market, venue: key.startsWith('kalshi') ? 'kalshi' : 'polymarket' })
  }

  const kalshiTicker = readString(pair, ['kalshiTicker', 'kalshi_ticker'])
  const polymarketTicker = readString(pair, ['polymarketTicker', 'polyTicker', 'polymarket_ticker'])
  if (kalshiTicker) out.push({ ticker: kalshiTicker, venue: 'kalshi', title: readString(pair, ['title', 'question']) || kalshiTicker })
  if (polymarketTicker) out.push({ ticker: polymarketTicker, venue: 'polymarket', title: readString(pair, ['title', 'question']) || polymarketTicker })
  return out
}

function curveMarkets(value: Record<string, unknown>): Array<Record<string, unknown>> {
  const direct = toRecordArray(value.curves)
  if (direct.length) return direct.flatMap(curve => toRecordArray(curve.markets).length ? toRecordArray(curve.markets) : [curve])
  return toRecordArray(value.markets)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
