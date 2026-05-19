import { nanoid } from 'nanoid'
import type { MarketCandidate, Venue } from '../types.js'
import {
  clamp,
  compactReasons,
  inferVenue,
  normalizePriceCents,
  readNumber,
  readRecord,
  readString,
  scoreFromSignals,
} from '../market-utils.js'

export function candidateFromMarket(
  market: Record<string, unknown>,
  args: {
    strategy: 'quant' | 'fundamental'
    source: string
    defaultVenue?: Venue
    fallbackReason: string
    scoreBoost?: number
  },
): MarketCandidate | null {
  const venue = inferVenue(market) || args.defaultVenue
  const ticker = readString(market, ['ticker', 'marketId', 'id', 'tokenId'])
  if (!venue || !ticker) return null

  const indicators = readRecord(market, 'indicators') || {}
  const priceCents = normalizePriceCents(readNumber(market, ['price', 'yesPrice', 'probability', 'lastPrice']))
  const volume24h = readNumber(market, ['volume24h', 'vol24h', 'volume', 'liquidity'])
  const iy = readNumber(indicators, ['iy', 'impliedYield', 'adjIy'])
  const cri = readNumber(indicators, ['cri'])
  const las = readNumber(indicators, ['las'])
  const rv = readNumber(indicators, ['rv'])
  const vr = readNumber(indicators, ['vr'])
  const ee = readNumber(indicators, ['ee'])

  const liquidityScore = volume24h === undefined ? undefined : clamp(Math.log10(Math.max(volume24h, 1)) * 16, 0, 100)
  const volatilityScore = scoreFromSignals([
    cri === undefined ? undefined : Math.abs(cri),
    rv,
    vr,
  ], 45)
  const quantScore = scoreFromSignals([
    iy === undefined ? undefined : clamp(iy / 3, 0, 100),
    ee === undefined ? undefined : clamp(ee, 0, 100),
    volatilityScore,
    liquidityScore,
  ], 50)
  const fundamentalScore = scoreFromSignals([
    volume24h === undefined ? undefined : liquidityScore,
    priceCents === undefined ? undefined : 100 - Math.abs(priceCents - 50),
    args.scoreBoost,
  ], 50)
  const edgeScore = args.strategy === 'quant'
    ? scoreFromSignals([quantScore, args.scoreBoost], quantScore)
    : scoreFromSignals([fundamentalScore, args.scoreBoost], fundamentalScore)

  return {
    id: nanoid(),
    ts: new Date().toISOString(),
    strategy: args.strategy,
    source: args.source,
    venue,
    ticker,
    title: readString(market, ['title', 'question', 'name']) || ticker,
    category: readString(market, ['category', 'eventType']),
    priceCents,
    volume24h,
    liquidityScore,
    volatilityScore,
    fundamentalScore,
    quantScore,
    edgeScore: clamp(edgeScore, 0, 100),
    confidence: clamp(scoreFromSignals([liquidityScore, volume24h ? 60 : undefined, priceCents ? 55 : undefined], 45), 0, 100),
    reasons: compactReasons([
      args.fallbackReason,
      iy !== undefined && `iy=${round(iy)}`,
      cri !== undefined && `cri=${round(cri)}`,
      volume24h !== undefined && `volume24h=${Math.round(volume24h)}`,
    ]),
    raw: market,
  }
}

export function dedupeCandidates(candidates: MarketCandidate[], limit: number): MarketCandidate[] {
  const seen = new Set<string>()
  const out: MarketCandidate[] = []
  for (const candidate of candidates.sort((a, b) => b.edgeScore - a.edgeScore)) {
    const key = `${candidate.venue}:${candidate.ticker}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
    if (out.length >= limit) break
  }
  return out
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
