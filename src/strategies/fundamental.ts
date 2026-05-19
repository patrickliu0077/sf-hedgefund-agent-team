import type { SfTeam } from '../sf.js'
import type { LoopConfig, MarketCandidate, RoleReport } from '../types.js'
import { readString } from '../market-utils.js'
import { candidateFromMarket, dedupeCandidates } from './common.js'

export async function runFundamentalResearch(team: SfTeam, config: LoopConfig): Promise<{
  report: RoleReport
  candidates: MarketCandidate[]
}> {
  const warnings: string[] = []
  const candidates: MarketCandidate[] = []
  const limitPerKeyword = Math.max(4, Math.ceil(config.maxCandidates / Math.max(config.keywords.length, 1)))

  const [world, calendar, ...searches] = await Promise.allSettled([
    team.client.world.get({ path: 'global' }),
    team.client.intelligence.calendar({ days: 14 }),
    ...config.keywords.map(keyword => team.client.markets.search({
      query: keyword,
      venue: config.venues.length === 1 ? config.venues[0] : 'all',
      limit: limitPerKeyword,
      vol24hMin: 100,
      includeSubcent: false,
      group: true,
      nextActions: false,
    })),
  ])

  const salientTerms = world.status === 'fulfilled'
    ? extractSalientTerms(world.value as Record<string, unknown>)
    : []
  if (world.status === 'rejected') warnings.push(`world.read failed: ${messageOf(world.reason)}`)

  const calendarTerms = calendar.status === 'fulfilled'
    ? extractCalendarTerms(calendar.value as Record<string, unknown>)
    : []
  if (calendar.status === 'rejected') warnings.push(`calendar.list failed: ${messageOf(calendar.reason)}`)

  const macroTerms = new Set([...salientTerms, ...calendarTerms, ...config.keywords.map(k => k.toLowerCase())])

  searches.forEach((result, index) => {
    const keyword = config.keywords[index] || 'macro'
    if (result.status === 'rejected') {
      warnings.push(`markets.search(${keyword}) failed: ${messageOf(result.reason)}`)
      return
    }
    for (const market of result.value.markets || []) {
      const title = readString(market, ['title', 'question', 'name']) || ''
      const boost = keywordScore(title, macroTerms)
      const candidate = candidateFromMarket(market, {
        strategy: 'fundamental',
        source: `markets.search:${keyword}`,
        fallbackReason: `matched fundamental theme "${keyword}"`,
        scoreBoost: boost,
      })
      if (candidate && config.venues.includes(candidate.venue)) {
        candidate.reasons.unshift(`macroMatch=${boost.toFixed(0)}`)
        candidates.push(candidate)
      }
    }
  })

  const selected = dedupeCandidates(candidates, config.maxCandidates)
  return {
    candidates: selected,
    report: {
      role: 'research',
      ok: true,
      ts: new Date().toISOString(),
      summary: `fundamental research selected ${selected.length} candidates from ${config.keywords.length} themes`,
      metrics: {
        searchedThemes: config.keywords.length,
        rawSignals: candidates.length,
        selected: selected.length,
        worldTerms: salientTerms.length,
        calendarTerms: calendarTerms.length,
      },
      warnings,
    },
  }
}

function extractSalientTerms(world: Record<string, unknown>): string[] {
  const out: string[] = []
  const salient = world.salient
  if (Array.isArray(salient)) {
    for (const item of salient) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const text = readString(record, ['topic', 'title', 'label', 'summary'])
      if (text) out.push(...tokens(text))
    }
  }
  const regime = readString(world, ['regime', 'regimeSummary', 'baselineReason'])
  if (regime) out.push(...tokens(regime))
  return unique(out).slice(0, 30)
}

function extractCalendarTerms(calendar: Record<string, unknown>): string[] {
  const out: string[] = []
  const events = calendar.events
  if (!Array.isArray(events)) return out
  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const record = event as Record<string, unknown>
    const text = readString(record, ['title', 'name', 'category'])
    if (text) out.push(...tokens(text))
  }
  return unique(out).slice(0, 30)
}

function keywordScore(title: string, terms: Set<string>): number {
  const words = tokens(title)
  const matches = words.filter(word => terms.has(word)).length
  return Math.min(90, 45 + matches * 12)
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2)
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
