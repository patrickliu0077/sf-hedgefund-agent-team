import { EventEmitter } from 'node:events'
import { nanoid } from 'nanoid'
import { mergeLoopConfig, type LoopRequest } from './config.js'
import { executeDecision } from './execution.js'
import { runMonitoring } from './monitoring.js'
import { buildDecisions } from './risk.js'
import { createSfTeam } from './sf.js'
import { runFundamentalResearch } from './strategies/fundamental.js'
import { runQuantResearch } from './strategies/quant.js'
import type { ExecutionReceipt, LoopConfig, LoopState, RoleReport, RunRecord, RuntimeConfig } from './types.js'
import type { JsonlStore } from './store.js'

export class HedgeFundOrchestrator {
  readonly events = new EventEmitter()
  private timer?: NodeJS.Timeout
  private config: LoopConfig
  private state: LoopState = {
    running: false,
    tickCount: 0,
    grossExposureCents: 0,
    openPositions: 0,
    paperPnlCents: 0,
  }

  constructor(
    private readonly runtime: RuntimeConfig,
    private readonly store: JsonlStore,
  ) {
    this.config = runtime.defaultLoop
  }

  getState(): LoopState {
    return { ...this.state }
  }

  getConfig(): LoopConfig {
    return JSON.parse(JSON.stringify(this.config)) as LoopConfig
  }

  async start(request: LoopRequest = {}): Promise<LoopState> {
    this.config = mergeLoopConfig(this.runtime.defaultLoop, request)
    this.validateLiveMode(this.config)
    this.stopTimer()
    this.state = {
      ...this.state,
      running: true,
      startedAt: new Date().toISOString(),
      nextTickAt: new Date(Date.now() + this.config.intervalMs).toISOString(),
    }
    this.scheduleNext()
    this.emit('loop.started', { config: this.config, state: this.getState() })
    return this.getState()
  }

  async stop(): Promise<LoopState> {
    this.stopTimer()
    this.state = {
      ...this.state,
      running: false,
      activeRunId: undefined,
      nextTickAt: undefined,
    }
    this.emit('loop.stopped', { state: this.getState() })
    return this.getState()
  }

  async tick(request: LoopRequest = {}): Promise<RunRecord> {
    const config = Object.keys(request).length
      ? mergeLoopConfig(this.config, request)
      : this.config
    this.validateLiveMode(config)

    const run: RunRecord = {
      id: nanoid(),
      ts: new Date().toISOString(),
      config,
      roles: [],
      candidates: [],
      decisions: [],
      receipts: [],
      errors: [],
    }
    this.state = { ...this.state, activeRunId: run.id, tickCount: this.state.tickCount + 1 }
    this.emit('run.started', { runId: run.id })

    try {
      const team = await createSfTeam(this.runtime, config)
      const researchTasks = []
      if (config.strategy === 'quant' || config.strategy === 'hybrid') researchTasks.push(runQuantResearch(team, config))
      if (config.strategy === 'fundamental' || config.strategy === 'hybrid') researchTasks.push(runFundamentalResearch(team, config))

      const [monitoring, ...researchResults] = await Promise.allSettled([
        runMonitoring(team, config),
        ...researchTasks,
      ])

      if (monitoring.status === 'fulfilled') run.roles.push(monitoring.value)
      else run.errors.push({ role: 'monitoring', message: messageOf(monitoring.reason) })

      for (const result of researchResults) {
        if (result.status === 'fulfilled') {
          run.roles.push(result.value.report)
          run.candidates.push(...result.value.candidates)
        } else {
          run.errors.push({ role: 'research', message: messageOf(result.reason) })
        }
      }

      run.candidates = run.candidates
        .sort((a, b) => b.edgeScore - a.edgeScore)
        .slice(0, config.maxCandidates)
      run.decisions = buildDecisions(run.id, run.candidates, config, this.state)
      run.roles.push(riskReport(run.decisions))

      const receipts: ExecutionReceipt[] = []
      for (const decision of run.decisions) {
        const receipt = await executeDecision(team, this.runtime, config, decision)
        decision.execution = receipt
        receipts.push(receipt)
        await this.store.appendDecision(decision)
        await this.store.appendReceipt(receipt)
      }
      run.receipts = receipts
      run.roles.push(executionReport(receipts))
      this.applyReceipts(receipts)
    } catch (error) {
      run.errors.push({ role: 'research', message: messageOf(error) })
    } finally {
      run.completedAt = new Date().toISOString()
      this.state = {
        ...this.state,
        activeRunId: undefined,
        lastRun: run,
        nextTickAt: this.state.running ? new Date(Date.now() + config.intervalMs).toISOString() : undefined,
      }
      await this.store.appendRun(run)
      this.emit('run.completed', { run })
      if (this.state.running) this.scheduleNext()
    }

    return run
  }

  private scheduleNext(): void {
    this.stopTimer()
    if (!this.state.running) return
    this.timer = setTimeout(() => {
      void this.tick().catch(error => {
        this.emit('run.failed', { error: messageOf(error) })
        this.scheduleNext()
      })
    }, this.config.intervalMs)
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  private validateLiveMode(config: LoopConfig): void {
    if (config.mode !== 'live') return
    if (!this.runtime.sfApiKey) throw new Error('live mode requires SF_API_KEY')
    if (!this.runtime.enableLiveTrading) throw new Error('live mode requires ENABLE_LIVE_TRADING=true')
    if (config.confirmLiveTrading !== this.runtime.liveConfirmToken) {
      throw new Error(`live mode requires confirmLiveTrading="${this.runtime.liveConfirmToken}"`)
    }
  }

  private applyReceipts(receipts: ExecutionReceipt[]): void {
    const accepted = receipts.filter(r => r.status === 'paper_recorded' || r.status === 'live_submitted')
    this.state = {
      ...this.state,
      grossExposureCents: this.state.grossExposureCents + accepted.reduce((sum, receipt) => {
        const fill = receipt.details.fill
        if (fill && typeof fill === 'object' && !Array.isArray(fill)) {
          const record = fill as Record<string, unknown>
          const qty = typeof record.quantity === 'number' ? record.quantity : 0
          const price = typeof record.priceCents === 'number' ? record.priceCents : 0
          return sum + qty * price
        }
        return sum
      }, 0),
      openPositions: this.state.openPositions + accepted.length,
    }
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    this.events.emit('event', { type, ts: new Date().toISOString(), ...payload })
  }
}

function riskReport(decisions: RunRecord['decisions']): RoleReport {
  const approved = decisions.filter(decision => decision.risk?.allowed).length
  return {
    role: 'risk',
    ok: decisions.every(decision => decision.risk !== undefined),
    ts: new Date().toISOString(),
    summary: `risk approved ${approved}/${decisions.length} proposed orders`,
    metrics: {
      proposed: decisions.length,
      approved,
      blocked: decisions.length - approved,
    },
  }
}

function executionReport(receipts: ExecutionReceipt[]): RoleReport {
  return {
    role: 'execution',
    ok: receipts.every(receipt => receipt.status !== 'failed'),
    ts: new Date().toISOString(),
    summary: `execution produced ${receipts.length} receipts`,
    metrics: {
      paper: receipts.filter(r => r.status === 'paper_recorded').length,
      shadow: receipts.filter(r => r.status === 'shadow_recorded').length,
      live: receipts.filter(r => r.status === 'live_submitted').length,
      blocked: receipts.filter(r => r.status === 'blocked').length,
      failed: receipts.filter(r => r.status === 'failed').length,
    },
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
