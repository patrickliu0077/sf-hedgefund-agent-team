import type { SfTeam } from './sf.js'
import type { LoopConfig, RoleReport } from './types.js'

export async function runMonitoring(team: SfTeam, config: LoopConfig): Promise<RoleReport> {
  const warnings: string[] = []
  const [manifest, runtime, portfolio, intents] = await Promise.allSettled([
    team.client.manifest.list(),
    team.client.runtime.status({ mode: 'auto' }),
    team.client.portfolio.state({ limit: 50 }),
    team.client.intents.list({ active: true, limit: 50 }),
  ])

  if (manifest.status === 'rejected') warnings.push(`manifest failed: ${messageOf(manifest.reason)}`)
  if (runtime.status === 'rejected') warnings.push(`runtime status unavailable: ${messageOf(runtime.reason)}`)
  if (portfolio.status === 'rejected') warnings.push(`portfolio unavailable: ${messageOf(portfolio.reason)}`)
  if (intents.status === 'rejected') warnings.push(`intents unavailable: ${messageOf(intents.reason)}`)

  const activeIntentCount = intents.status === 'fulfilled' ? intents.value.intents.length : 0
  return {
    role: 'monitoring',
    ok: true,
    ts: new Date().toISOString(),
    summary: `monitoring checked manifest/runtime/portfolio/intents for ${config.mode} loop`,
    metrics: {
      toolCount: manifest.status === 'fulfilled' ? manifest.value.tools.length : 0,
      activeIntentCount,
      runtimeCandidates: runtime.status === 'fulfilled' ? runtime.value.candidates.length : 0,
      hasPortfolio: portfolio.status === 'fulfilled' && portfolio.value !== null,
    },
    warnings,
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
