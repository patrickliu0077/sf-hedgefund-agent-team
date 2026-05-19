import { z } from 'zod'
import type { ExecutionMode, ExecutionStyle, LoopConfig, RuntimeConfig, StrategyKind, Venue } from './types.js'

const liveConfirmToken = 'I_UNDERSTAND_THIS_PLACES_REAL_ORDERS'

const venueSchema = z.enum(['kalshi', 'polymarket'])
const styleSchema = z.enum(['maker', 'taker'])
const modeSchema = z.enum(['paper', 'shadow', 'live'])
const strategySchema = z.enum(['quant', 'fundamental', 'hybrid'])

export const loopRequestSchema = z.object({
  strategy: strategySchema.optional(),
  mode: modeSchema.optional(),
  intervalMs: z.number().int().min(5_000).max(3_600_000).optional(),
  venues: z.array(venueSchema).min(1).optional(),
  styles: z.array(styleSchema).min(1).optional(),
  maxCandidates: z.number().int().min(1).max(100).optional(),
  maxOrdersPerTick: z.number().int().min(0).max(20).optional(),
  keywords: z.array(z.string().min(1)).max(20).optional(),
  confirmLiveTrading: z.string().optional(),
  risk: z.object({
    maxGrossCents: z.number().int().min(0).optional(),
    maxPerTradeCents: z.number().int().min(0).optional(),
    maxQuantity: z.number().int().min(1).optional(),
    maxOpenPositions: z.number().int().min(0).optional(),
    maxDailyLossCents: z.number().int().min(0).optional(),
    minScore: z.number().min(0).max(100).optional(),
    allowedVenues: z.array(venueSchema).min(1).optional(),
    blockedJurisdictions: z.array(z.string().min(1)).optional(),
    jurisdiction: z.string().min(1).optional(),
    requireLimitPrice: z.boolean().optional(),
    allowRuntimeStart: z.boolean().optional(),
    allowAutoExecute: z.boolean().optional(),
  }).optional(),
})

export type LoopRequest = z.infer<typeof loopRequestSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const jurisdiction = readString(env.JURISDICTION) || 'US'
  const blockedJurisdictions = readBool(env.BLOCK_POLYMARKET_LIVE, true) ? ['US'] : []
  const mode = readMode(env.EXECUTION_MODE, 'paper')
  const defaultVenues = readVenues(env.DEFAULT_VENUES) || ['kalshi', 'polymarket']
  const allowedVenues = jurisdiction.toUpperCase() === 'US'
    ? defaultVenues
    : defaultVenues

  return {
    port: readInt(env.PORT, 8787),
    logLevel: readString(env.LOG_LEVEL) || 'info',
    dataDir: readString(env.DATA_DIR) || './data',
    sfApiUrl: readString(env.SF_API_URL) || 'https://simplefunctions.dev',
    sfApiKey: readString(env.SF_API_KEY),
    sfCloudKey: readString(env.SF_CLOUD_KEY),
    controlToken: readString(env.CONTROL_TOKEN),
    enableLiveTrading: readBool(env.ENABLE_LIVE_TRADING, false),
    liveConfirmToken,
    defaultLoop: {
      strategy: readStrategy(env.DEFAULT_STRATEGY, 'hybrid'),
      mode,
      intervalMs: readInt(env.DEFAULT_INTERVAL_MS, 60_000),
      venues: defaultVenues,
      styles: readStyles(env.DEFAULT_STYLES) || ['taker', 'maker'],
      maxCandidates: readInt(env.MAX_CANDIDATES, 12),
      maxOrdersPerTick: readInt(env.MAX_ORDERS_PER_TICK, 2),
      keywords: readCsv(env.DEFAULT_KEYWORDS) || [
        'fed',
        'inflation',
        'rates',
        'oil',
        'tariff',
        'recession',
        'supreme court',
        'election',
      ],
      risk: {
        maxGrossCents: readInt(env.MAX_GROSS_CENTS, 10_000),
        maxPerTradeCents: readInt(env.MAX_PER_TRADE_CENTS, 2_500),
        maxQuantity: readInt(env.MAX_QUANTITY, 5),
        maxOpenPositions: readInt(env.MAX_OPEN_POSITIONS, 12),
        maxDailyLossCents: readInt(env.MAX_DAILY_LOSS_CENTS, 2_000),
        minScore: Number(env.MIN_SCORE ?? 58),
        allowedVenues,
        blockedJurisdictions,
        jurisdiction,
        requireLimitPrice: true,
        allowRuntimeStart: readBool(env.ALLOW_RUNTIME_START, true),
        allowAutoExecute: readBool(env.ALLOW_AUTO_EXECUTE, true),
      },
    },
  }
}

export function mergeLoopConfig(base: LoopConfig, request: LoopRequest = {}): LoopConfig {
  const risk = request.risk ? { ...base.risk, ...request.risk } : base.risk
  return {
    ...base,
    ...request,
    risk,
    strategy: request.strategy || base.strategy,
    mode: request.mode || base.mode,
    venues: request.venues || base.venues,
    styles: request.styles || base.styles,
    keywords: request.keywords || base.keywords,
    confirmLiveTrading: request.confirmLiveTrading,
  }
}

function readString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function readCsv(value: string | undefined): string[] | undefined {
  const out = value?.split(',').map(v => v.trim()).filter(Boolean)
  return out?.length ? out : undefined
}

function readVenues(value: string | undefined): Venue[] | undefined {
  const venues = readCsv(value)?.filter((v): v is Venue => v === 'kalshi' || v === 'polymarket')
  return venues?.length ? venues : undefined
}

function readStyles(value: string | undefined): ExecutionStyle[] | undefined {
  const styles = readCsv(value)?.filter((v): v is ExecutionStyle => v === 'maker' || v === 'taker')
  return styles?.length ? styles : undefined
}

function readMode(value: string | undefined, fallback: ExecutionMode): ExecutionMode {
  return value === 'paper' || value === 'shadow' || value === 'live' ? value : fallback
}

function readStrategy(value: string | undefined, fallback: StrategyKind): StrategyKind {
  return value === 'quant' || value === 'fundamental' || value === 'hybrid' ? value : fallback
}
