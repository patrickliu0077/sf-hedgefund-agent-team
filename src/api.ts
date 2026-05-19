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
      config: redactConfig(orchestrator.getConfig()),
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
    res.json({ ok: true, run })
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
    res.json({ ok: true, result })
  }))

  app.get('/v1/runs', asyncRoute(async (req, res) => {
    const limit = readLimit(req.query.limit, 50)
    res.json({ ok: true, runs: await store.listRuns(limit) })
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
    const status = isZodError(error) ? 400 : 500
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

function redactConfig(config: unknown): unknown {
  return config
}

function isZodError(error: unknown): error is { issues: unknown[] } {
  return Boolean(error && typeof error === 'object' && 'issues' in error)
}
