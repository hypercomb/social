import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  EffectBus, AGENT_FOLD, AGENT_HANDOVER, AGENT_RECEIPT, AGENT_ROUND, AGENT_ROUTE,
} from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const { AgentRegistry } = await import('./agent-registry.service.js')
type Registry = InstanceType<typeof AgentRegistry>

const base = (over: Record<string, unknown> = {}) => ({
  id: 'chat:solomon', convoId: 'chat:solomon', leg: 1, at: Date.now(), ...over,
})

describe('agent registry — the loop\'s stages land as facts on the bee', () => {
  let registry: Registry

  beforeEach(() => {
    registry = new AgentRegistry()
    EffectBus.emit('agent:start', { id: 'chat:solomon', behavior: 'chat', request: 'why do levels not open' })
  })

  const lines = (): string[] => (registry.get('chat:solomon')?.activity ?? []).map(entry => entry.text)

  it('a route says who took the round; a round says what it asked and what it cost', () => {
    EffectBus.emit(AGENT_ROUTE, base({ round: 1, providerId: 'openrouter:deepseek', model: 'deepseek/deepseek-v4-flash', tier: 'deep', handoffs: 0 }))
    EffectBus.emit(AGENT_ROUND, base({ round: 1, request: 'read', handoff: false, spent: { rounds: 1, tokens: 12_400 } }))
    expect(lines()).toEqual([
      'started',
      'leg 1 · round 1 · deepseek/deepseek-v4-flash',
      'round 1: asked to read · 1 rounds, 12k tokens so far',
    ])
  })

  it('a fold, a handover and a receipt each say what happened', () => {
    EffectBus.emit(AGENT_FOLD, base({ round: 9, folded: 6, kept: 4 }))
    EffectBus.emit(AGENT_HANDOVER, base({ round: 12, left: 'read chamber-view.ts', budgetSpent: false, spent: { rounds: 12, tokens: 210_000 } }))
    EffectBus.emit(AGENT_RECEIPT, base({ path: 'judged', rounds: 12, weight: 'deep', ms: 84_200, outcome: 'answered', spent: { rounds: 12, tokens: 210_000 } }))
    expect(lines().slice(1)).toEqual([
      'folded 6 older rounds into the ledger, kept the newest 4',
      'handing over to leg 2: read chamber-view.ts',
      'answered after 12 rounds in 84.2 s',
    ])
  })

  it('a spent budget reads as a pause, and a stage for a bee nobody started is ignored', () => {
    EffectBus.emit(AGENT_HANDOVER, base({ round: 3, left: 'the rest', budgetSpent: true, spent: { rounds: 400, tokens: 1_000 } }))
    EffectBus.emit(AGENT_ROUND, base({ id: 'chat:nobody', round: 1, request: 'none', handoff: false, spent: { rounds: 1, tokens: 1 } }))
    expect(lines().slice(1)).toEqual(["paused after 400 rounds: the request's budget is spent"])
    expect(registry.get('chat:nobody')).toBeUndefined()
  })
})
