import { loadConfig } from './config.js'
import { runAgentCommand } from './commands.js'
import { HedgeFundOrchestrator } from './orchestrator.js'
import { JsonlStore } from './store.js'
import type { AgentCommandResult, RunRecord } from './types.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const command = args.filter(arg => arg !== '--json').join(' ') || 'tick hybrid paper once'
const config = loadConfig()
const store = new JsonlStore(config.dataDir)
await store.init()
const orchestrator = new HedgeFundOrchestrator(config, store)

try {
  const result = await runAgentCommand(command, {
    start: input => orchestrator.start(input),
    stop: () => orchestrator.stop(),
    tick: input => orchestrator.tick(input),
    status: () => orchestrator.getState(),
  })

  console.log(json ? JSON.stringify(result, null, 2) : formatResult(result))
  if (result.action === 'start') {
    await orchestrator.tick()
    await orchestrator.stop()
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (json) console.error(JSON.stringify({ accepted: false, error: message }, null, 2))
  else console.error(`ERROR: ${message}`)
  process.exitCode = 1
}

function formatResult(result: AgentCommandResult): string {
  const lines: string[] = []
  lines.push(`${result.action.toUpperCase()} ${result.accepted ? 'accepted' : 'rejected'}: ${result.message}`)
  if (result.state) {
    lines.push(`state: running=${result.state.running} ticks=${result.state.tickCount} exposure=${result.state.grossExposureCents}c open=${result.state.openPositions}`)
  }
  if (result.run) lines.push(...formatRun(result.run))
  return lines.join('\n')
}

function formatRun(run: RunRecord): string[] {
  const lines: string[] = []
  lines.push(`run: ${run.id}`)
  lines.push(`roles: ${run.roles.map(role => `${role.role}:${role.ok ? 'ok' : 'fail'}`).join(' ')}`)
  lines.push(`candidates: ${run.candidates.length} decisions: ${run.decisions.length} receipts: ${run.receipts.length} errors: ${run.errors.length}`)
  for (const decision of run.decisions.slice(0, 5)) {
    lines.push(`- ${decision.mode}/${decision.style} ${decision.venue} ${decision.ticker} ${decision.action.toUpperCase()} ${decision.direction.toUpperCase()} qty=${decision.quantity} limit=${decision.limitPrice}c status=${decision.status} score=${decision.score.toFixed(1)}`)
    if (decision.risk?.reasons.length) lines.push(`  risk: ${decision.risk.reasons.join('; ')}`)
    if (decision.execution?.details?.wouldCall) lines.push(`  wouldCall: ${decision.execution.details.wouldCall}`)
  }
  if (run.errors.length) {
    for (const error of run.errors) lines.push(`error[${error.role}]: ${error.message}`)
  }
  return lines
}
