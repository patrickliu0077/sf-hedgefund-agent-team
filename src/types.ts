export type Venue = 'kalshi' | 'polymarket'
export type StrategyKind = 'quant' | 'fundamental' | 'hybrid'
export type ExecutionMode = 'paper' | 'shadow' | 'live'
export type ExecutionStyle = 'maker' | 'taker'
export type AgentRole = 'research' | 'monitoring' | 'risk' | 'execution'

export type RiskConfig = {
  maxGrossCents: number
  maxPerTradeCents: number
  maxQuantity: number
  maxOpenPositions: number
  maxDailyLossCents: number
  minScore: number
  allowedVenues: Venue[]
  blockedJurisdictions: string[]
  jurisdiction?: string
  requireLimitPrice: boolean
  allowRuntimeStart: boolean
  allowAutoExecute: boolean
}

export type LoopConfig = {
  strategy: StrategyKind
  mode: ExecutionMode
  intervalMs: number
  venues: Venue[]
  styles: ExecutionStyle[]
  maxCandidates: number
  maxOrdersPerTick: number
  keywords: string[]
  risk: RiskConfig
  confirmLiveTrading?: string
  dryRunReason?: string
}

export type RuntimeConfig = {
  port: number
  logLevel: string
  dataDir: string
  sfApiUrl: string
  sfApiKey?: string
  sfCloudKey?: string
  controlToken?: string
  enableLiveTrading: boolean
  liveConfirmToken: string
  defaultLoop: LoopConfig
}

export type MarketCandidate = {
  id: string
  ts: string
  strategy: Exclude<StrategyKind, 'hybrid'>
  source: string
  venue: Venue
  ticker: string
  title: string
  category?: string
  priceCents?: number
  volume24h?: number
  liquidityScore?: number
  volatilityScore?: number
  fundamentalScore?: number
  quantScore?: number
  edgeScore: number
  confidence: number
  reasons: string[]
  raw?: Record<string, unknown>
}

export type TradeDecision = {
  id: string
  runId: string
  ts: string
  candidateId: string
  venue: Venue
  ticker: string
  title: string
  strategy: Exclude<StrategyKind, 'hybrid'>
  style: ExecutionStyle
  mode: ExecutionMode
  action: 'buy' | 'sell'
  direction: 'yes' | 'no'
  quantity: number
  limitPrice: number
  expectedCostCents: number
  score: number
  rationale: string
  status: 'proposed' | 'approved' | 'blocked' | 'submitted' | 'paper_filled' | 'shadow_recorded' | 'failed'
  risk?: RiskVerdict
  execution?: ExecutionReceipt
}

export type RiskVerdict = {
  allowed: boolean
  reasons: string[]
  adjustedQuantity?: number
  adjustedLimitPrice?: number
  grossExposureAfterCents?: number
}

export type ExecutionReceipt = {
  id: string
  ts: string
  mode: ExecutionMode
  status: 'paper_recorded' | 'shadow_recorded' | 'live_submitted' | 'blocked' | 'failed'
  venue: Venue
  ticker: string
  details: Record<string, unknown>
}

export type RoleReport = {
  role: AgentRole
  ok: boolean
  ts: string
  summary: string
  metrics?: Record<string, number | string | boolean>
  warnings?: string[]
}

export type RunRecord = {
  id: string
  ts: string
  completedAt?: string
  config: LoopConfig
  roles: RoleReport[]
  candidates: MarketCandidate[]
  decisions: TradeDecision[]
  receipts: ExecutionReceipt[]
  errors: Array<{ role: AgentRole; message: string }>
}

export type LoopState = {
  running: boolean
  activeRunId?: string
  startedAt?: string
  lastRun?: RunRecord
  nextTickAt?: string
  tickCount: number
  grossExposureCents: number
  openPositions: number
  paperPnlCents: number
}

export type AgentCommandResult = {
  accepted: boolean
  command: string
  action: 'start' | 'stop' | 'tick' | 'status'
  config?: Partial<LoopConfig>
  run?: RunRecord
  state?: LoopState
  message: string
}
