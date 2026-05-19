import { describe, expect, it } from 'vitest'
import { parseAgentCommand } from '../src/commands.js'

describe('agent-native command parser', () => {
  it('turns natural desk commands into loop controls', () => {
    const parsed = parseAgentCommand('run quant paper once with maker and taker dual venues orders 2 markets 8')
    expect(parsed.action).toBe('tick')
    expect(parsed.config).toMatchObject({
      strategy: 'quant',
      mode: 'paper',
      venues: ['kalshi', 'polymarket'],
      styles: ['maker', 'taker'],
      maxOrdersPerTick: 2,
      maxCandidates: 8,
    })
  })

  it('supports stop and status without LLM credits', () => {
    expect(parseAgentCommand('stop the loop').action).toBe('stop')
    expect(parseAgentCommand('status please').action).toBe('status')
  })
})
