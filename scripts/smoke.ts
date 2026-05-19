import { loadConfig, mergeLoopConfig } from '../src/config.js'
import { createSfTeam } from '../src/sf.js'

const runtime = loadConfig()
const loop = mergeLoopConfig(runtime.defaultLoop, {
  mode: 'paper',
  strategy: 'hybrid',
  maxCandidates: 4,
  maxOrdersPerTick: 1,
})

const team = await createSfTeam(runtime, loop)
const execution = await team.research.describe('execution.place')
const world = runtime.sfApiKey ? await team.client.world.get({ path: 'global' }) : null

console.log(JSON.stringify({
  ok: true,
  sdk: '@spfunctions/sdk@1.0.0',
  agent: '@spfunctions/agent@1.0.0',
  manifest: team.manifest.schemaVersion,
  toolCount: team.manifest.tools.length,
  executionVenue: execution?.docs?.venue,
  worldKeys: world ? Object.keys(world).slice(0, 8) : [],
  liveRead: Boolean(world),
}, null, 2))

if (execution?.docs?.venue !== 'kalshi-or-polymarket-runtime') {
  throw new Error(`unexpected execution venue docs: ${String(execution?.docs?.venue)}`)
}
