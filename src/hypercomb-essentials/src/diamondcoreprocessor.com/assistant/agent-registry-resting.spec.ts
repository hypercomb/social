// diamondcoreprocessor.com/assistant/agent-registry-resting.spec.ts
//
// THE RESTING LANE — a tile that has been talked to keeps a bee, and pressing
// it must open something.
//
// Resting bees are not work. They live beside the work lane rather than in
// it, because the watchdog sweeps the work lane for stalls and would report
// furniture silent after four minutes and rogue after forty-five. But they
// ARE agents: a press hands out an id, and every surface holding one has to
// resolve it. Held privately by the bee drone instead, the panel a press
// opened had no record to render and returned in silence — a bee that answers
// a click with nothing at all.
//
// What this pins:
//
//   1. resting never enters `list()` — the sweep's set stays work only
//   2. `find` resolves either lane; `get` stays the work lane's own answer
//   3. WORK SHADOWS REST on a shared id — the moment a question is out, the
//      working record is the truth for the same sprite
//   4. an unchanged re-derivation is SILENT — threads move in bursts, and a
//      repaint per write would shake the hive

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

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
type AnyAgent = Parameters<Registry['rest']>[0] extends ReadonlyMap<string, infer A> ? A : never

let seq = 0

const restingAgent = (id: string, at = 1_000): AnyAgent => ({
  id,
  behavior: 'opus',
  kind: 'model',
  model: 'opus',
  vendor: 'anthropic',
  tier: 'opus',
  request: 'what is this',
  targets: ['site'],
  segments: ['dolphin'],
  status: 'working',
  activity: [],
  context: [],
  origin: 'local',
  startedAt: at,
  updatedAt: at,
} as unknown as AnyAgent)

describe('agent registry — the resting lane', () => {
  let registry: Registry

  beforeEach(() => { registry = new AgentRegistry() })

  it('never enters list() — the stall sweep is about WORK', () => {
    registry.rest(new Map([['chat:a', restingAgent('chat:a')]]))
    expect(registry.list()).toEqual([])
    expect(registry.get('chat:a')).toBeUndefined()
  })

  it('find() resolves it, which is what lets a press open a panel on it', () => {
    registry.rest(new Map([['chat:a', restingAgent('chat:a')]]))
    expect(registry.find('chat:a')?.request).toBe('what is this')
    expect(registry.isResting('chat:a')).toBe(true)
  })

  it('work SHADOWS rest on a shared id — the same sprite, awake', () => {
    const id = `chat:shadow-${++seq}`
    registry.rest(new Map([[id, restingAgent(id)]]))
    EffectBus.emit('agent:start', { id, behavior: 'opus', request: 'a new question' })
    expect(registry.find(id)?.request).toBe('a new question')
    expect(registry.isResting(id)).toBe(false)
    // And it is one bee, not two: the work lane holds it once.
    expect(registry.list().filter(a => a.id === id)).toHaveLength(1)
  })

  it('an unchanged re-derivation says nothing — threads move in bursts', () => {
    let changes = 0
    registry.addEventListener('change', () => { changes++ })
    registry.rest(new Map([['chat:a', restingAgent('chat:a')]]))
    expect(changes).toBe(1)
    registry.rest(new Map([['chat:a', restingAgent('chat:a')]]))
    expect(changes).toBe(1)
    // A newer turn on the same conversation IS a change.
    registry.rest(new Map([['chat:a', restingAgent('chat:a', 2_000)]]))
    expect(changes).toBe(2)
    // So is a tile that stops being talked to.
    registry.rest(new Map())
    expect(changes).toBe(3)
    expect(registry.find('chat:a')).toBeUndefined()
  })
})
