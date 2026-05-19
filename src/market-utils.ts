import type { MarketCandidate, Venue } from './types.js'

export function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && Number.isFinite(Number(value))) return Number(value)
  }
  return undefined
}

export function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

export function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizePriceCents(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  if (value > 0 && value <= 1) return Math.round(value * 100)
  return Math.round(value)
}

export function inferVenue(record: Record<string, unknown>): Venue | undefined {
  const raw = readString(record, ['venue', 'exchange'])
  if (raw === 'kalshi' || raw === 'polymarket') return raw
  const ticker = readString(record, ['ticker', 'marketId', 'id'])
  if (ticker?.startsWith('KX')) return 'kalshi'
  if (ticker) return 'polymarket'
  return undefined
}

export function candidateKey(candidate: Pick<MarketCandidate, 'venue' | 'ticker'>): string {
  return `${candidate.venue}:${candidate.ticker}`
}

export function compactReasons(reasons: Array<string | undefined | false>, limit = 4): string[] {
  return reasons.filter((reason): reason is string => Boolean(reason)).slice(0, limit)
}

export function scoreFromSignals(signals: Array<number | undefined>, fallback = 50): number {
  const valid = signals.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!valid.length) return fallback
  return clamp(valid.reduce((sum, value) => sum + value, 0) / valid.length, 0, 100)
}

export function safeJson(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
