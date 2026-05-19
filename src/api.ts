import express, { type NextFunction, type Request, type Response } from 'express'
import { pinoHttp } from 'pino-http'
import type { Logger } from 'pino'
import { loopRequestSchema } from './config.js'
import { runAgentCommand } from './commands.js'
import type { HedgeFundOrchestrator } from './orchestrator.js'
import type { JsonlStore } from './store.js'
import type { RuntimeConfig } from './types.js'

export function createApp(args: {
  config: RuntimeConfig
  orchestrator: HedgeFundOrchestrator
  store: JsonlStore
  logger: Logger
}) {
  const { config, orchestrator, store, logger } = args
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use(pinoHttp({ logger }))

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'sf-hedgefund-agent-team',
      sdk: '@spfunctions/sdk@1.0.0',
      agent: '@spfunctions/agent@1.0.0',
      state: orchestrator.getState(),
    })
  })

  app.get('/v1/status', (_req, res) => {
    res.json({
      state: orchestrator.getState(),
      config: summarizeConfig(orchestrator.getConfig()),
    })
  })

  app.get('/v1/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const listener = (event: unknown) => {
      res.write(`event: message\n`)
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    orchestrator.events.on('event', listener)
    req.on('close', () => orchestrator.events.off('event', listener))
  })

  app.post('/v1/control/start', requireControlToken(config), asyncRoute(async (req, res) => {
    const input = loopRequestSchema.parse(req.body || {})
    const state = await orchestrator.start(input)
    res.json({ ok: true, state })
  }))

  app.post('/v1/control/stop', requireControlToken(config), asyncRoute(async (_req, res) => {
    const state = await orchestrator.stop()
    res.json({ ok: true, state })
  }))

  app.post('/v1/control/tick', requireControlToken(config), asyncRoute(async (req, res) => {
    const input = loopRequestSchema.parse(req.body || {})
    const run = await orchestrator.tick(input)
    res.json({ ok: true, run: maybeSummarizeRun(req, run) })
  }))

  app.post('/v1/agent/command', requireControlToken(config), asyncRoute(async (req, res) => {
    const command = typeof req.body?.command === 'string' ? req.body.command : ''
    if (!command.trim()) {
      res.status(400).json({ ok: false, error: 'command is required' })
      return
    }
    const result = await runAgentCommand(command, {
      start: input => orchestrator.start(input),
      stop: () => orchestrator.stop(),
      tick: input => orchestrator.tick(input),
      status: () => orchestrator.getState(),
    })
    res.json({ ok: true, result: maybeSummarizeCommandResult(req, result) })
  }))

  app.get('/v1/runs', asyncRoute(async (req, res) => {
    const limit = readLimit(req.query.limit, 50)
    const runs = await store.listRuns(limit)
    res.json({ ok: true, runs: wantsFullDetail(req) ? runs : runs.map(summarizeRun) })
  }))

  app.get('/v1/decisions', asyncRoute(async (req, res) => {
    const limit = readLimit(req.query.limit, 100)
    res.json({ ok: true, decisions: await store.listDecisions(limit) })
  }))

  app.get('/v1/receipts', asyncRoute(async (req, res) => {
    const limit = readLimit(req.query.limit, 100)
    res.json({ ok: true, receipts: await store.listReceipts(limit) })
  }))

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = isZodError(error) || isClientError(error) ? 400 : 500
    res.status(status).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      details: isZodError(error) ? error.issues : undefined,
    })
  })

  return app
}

function requireControlToken(config: RuntimeConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.controlToken) {
      next()
      return
    }
    const auth = req.header('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : req.header('x-control-token')
    if (token !== config.controlToken) {
      res.status(401).json({ ok: false, error: 'invalid control token' })
      return
    }
    next()
  }
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next)
  }
}

function readLimit(value: unknown, fallback: number): number {
  const first = Array.isArray(value) ? value[0] : value
  const parsed = Number(first)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(500, Math.trunc(parsed))) : fallback
}

function isZodError(error: unknown): error is { issues: unknown[] } {
  return Boolean(error && typeof error === 'object' && 'issues' in error)
}

function isClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return [
    'live mode requires',
    'invalid control token',
  ].some(prefix => error.message.startsWith(prefix))
}

function wantsFullDetail(req: Request): boolean {
  return req.query.detail === 'full' || req.query.full === 'true'
}

function maybeSummarizeRun(req: Request, run: unknown): unknown {
  return wantsFullDetail(req) ? run : summarizeRun(run)
}

function maybeSummarizeCommandResult(req: Request, result: unknown): unknown {
  if (wantsFullDetail(req) || !result || typeof result !== 'object') return result
  const record = result as Record<string, unknown>
  return {
    ...record,
    ...(record.run ? { run: summarizeRun(record.run) } : {}),
  }
}

function summarizeRun(run: unknown): unknown {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return run
  const record = run as Record<string, unknown>
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  const decisions = Array.isArray(record.decisions) ? record.decisions : []
  const receipts = Array.isArray(record.receipts) ? record.receipts : []
  const errors = Array.isArray(record.errors) ? record.errors : []
  const roles = Array.isArray(record.roles) ? record.roles : []
  return {
    id: record.id,
    ts: record.ts,
    completedAt: record.completedAt,
    config: record.config ? summarizeConfig(record.config) : undefined,
    counts: {
      candidates: candidates.length,
      decisions: decisions.length,
      receipts: receipts.length,
      errors: errors.length,
    },
    roles: roles.map(role => {
      if (!role || typeof role !== 'object' || Array.isArray(role)) return role
      const r = role as Record<string, unknown>
      return {
        role: r.role,
        ok: r.ok,
        summary: r.summary,
        metrics: r.metrics,
        warnings: r.warnings,
      }
    }),
    topCandidates: candidates.slice(0, 5).map(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate
      const c = candidate as Record<string, unknown>
      return {
        venue: c.venue,
        ticker: c.ticker,
        title: c.title,
        source: c.source,
        strategy: c.strategy,
        priceCents: c.priceCents,
        volume24h: c.volume24h,
        edgeScore: c.edgeScore,
        reasons: c.reasons,
      }
    }),
    decisions: decisions.map(decision => {
      if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return decision
      const d = decision as Record<string, unknown>
      const risk = d.risk && typeof d.risk === 'object' && !Array.isArray(d.risk) ? d.risk as Record<string, unknown> : undefined
      const execution = d.execution && typeof d.execution === 'object' && !Array.isArray(d.execution) ? d.execution as Record<string, unknown> : undefined
      return {
        id: d.id,
        venue: d.venue,
        ticker: d.ticker,
        title: d.title,
        strategy: d.strategy,
        style: d.style,
        mode: d.mode,
        action: d.action,
        direction: d.direction,
        quantity: d.quantity,
        limitPrice: d.limitPrice,
        expectedCostCents: d.expectedCostCents,
        score: d.score,
        status: d.status,
        risk: risk ? { allowed: risk.allowed, reasons: risk.reasons } : undefined,
        execution: execution ? { status: execution.status, mode: execution.mode } : undefined,
      }
    }),
    errors,
  }
}

function summarizeConfig(config: unknown): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const record = config as Record<string, unknown>
  return {
    strategy: record.strategy,
    mode: record.mode,
    intervalMs: record.intervalMs,
    venues: record.venues,
    styles: record.styles,
    maxCandidates: record.maxCandidates,
    maxOrdersPerTick: record.maxOrdersPerTick,
    keywords: record.keywords,
    risk: record.risk,
  }
}
