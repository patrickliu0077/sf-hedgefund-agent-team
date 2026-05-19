import { inspect } from 'node:util'
import { loadConfig } from './config.js'
import { runAgentCommand } from './commands.js'
import { HedgeFundOrchestrator } from './orchestrator.js'
import { JsonlStore } from './store.js'

const command = process.argv.slice(2).join(' ') || 'tick hybrid paper once'
const config = loadConfig()
const store = new JsonlStore(config.dataDir)
await store.init()
const orchestrator = new HedgeFundOrchestrator(config, store)

const result = await runAgentCommand(command, {
  start: input => orchestrator.start(input),
  stop: () => orchestrator.stop(),
  tick: input => orchestrator.tick(input),
  status: () => orchestrator.getState(),
})

console.log(inspect(result, { depth: 8, colors: process.stdout.isTTY }))
if (result.action === 'start') {
  await orchestrator.tick()
  await orchestrator.stop()
}
