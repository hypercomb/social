// assistant/agent-registry-brand.spec.ts
//
// WHAT A BEE IS WEARING, and when it may change.
//
// A model agent's colour family and belly name are derived from its model —
// vendor, then tier, then the name (presentation/avatars/agent-model.ts). The
// registry settles that at spawn, and every surface reads the one answer, so
// it must never disagree with the model the agent is actually carrying.
//
// One case genuinely changes tier under a live agent: a chat question is
// branded for the tier that is ABOUT to take it (chat-window's
// #answeringModel reads bridgeUp() before sending), and if the shallow host
// DECLINES, the durable bridge queue answers instead with a different model.
// The window re-raises; without a re-brand the bee would keep the colour and
// belly of a tier that never touched the question — a wrong answer wearing a
// confident face.

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

describe('agent registry — a bee wears the model it is actually carrying', () => {
  let registry: InstanceType<typeof AgentRegistry>
  let id: string
  let seq = 0

  /** Each test gets its own registry AND its own agent id: the lanes are
   *  EffectBus-global, so every registry built here hears every emit. */
  beforeEach(() => {
    registry = new AgentRegistry()
    id = `chat:test-${++seq}`
  })

  const raise = (model: string): void => {
    EffectBus.emit('agent:start', {
      id, behavior: model, kind: 'model', model,
      request: 'what is this', targets: ['diagrams'], segments: [],
    })
  }

  it('brands a model agent from its model at spawn', () => {
    raise('opus')
    const agent = registry.get(id)
    expect(agent?.kind).toBe('model')
    expect(agent?.vendor).toBe('anthropic')
    expect(agent?.tier).toBe('deep')
  })

  it('the shallow tier brands as its OWN model, not the composer’s', () => {
    // What chat-window sends when bridgeUp() is false: the host relays to
    // Anthropic Haiku, so the bee is fast-tier from the start rather than
    // claiming the deep tier the composer happens to be showing.
    raise('haiku')
    expect(registry.get(id)?.vendor).toBe('anthropic')
    expect(registry.get(id)?.tier).toBe('fast')
  })

  it('RE-BRANDS when a re-raise names a different model', () => {
    raise('haiku')
    expect(registry.get(id)?.tier).toBe('fast')

    // The host declined; the durable queue takes it with the composer's model.
    raise('opus')
    const agent = registry.get(id)
    expect(agent?.model).toBe('opus')
    expect(agent?.tier).toBe('deep')
    expect(agent?.vendor).toBe('anthropic')
  })

  it('crosses vendors when the model does', () => {
    raise('haiku')
    expect(registry.get(id)?.vendor).toBe('anthropic')
    raise('gemini-2.5-flash')
    expect(registry.get(id)?.vendor).toBe('google')
    expect(registry.get(id)?.tier).toBe('fast')
  })

  it('a re-raise with the SAME model changes nothing but the clock', () => {
    raise('opus')
    const before = registry.get(id)
    const brand = { vendor: before?.vendor, tier: before?.tier, startedAt: before?.startedAt }

    raise('opus')
    const after = registry.get(id)
    expect({ vendor: after?.vendor, tier: after?.tier, startedAt: after?.startedAt }).toEqual(brand)
  })

  it('ending the question retires the bee', () => {
    raise('opus')
    expect(registry.get(id)?.status).toBe('working')
    EffectBus.emit('agent:end', { id, ok: true })
    expect(registry.get(id)?.status).toBe('done')
  })

  it('the bee sits on the tile the conversation is about', () => {
    raise('opus')
    expect(registry.get(id)?.targets).toEqual(['diagrams'])
  })

  it('a chat about no tile is hive-wide — no targets, which is how the drone spells it', () => {
    EffectBus.emit('agent:start', {
      id, behavior: 'opus', kind: 'model', model: 'opus',
      request: 'about the whole hive', targets: [], segments: [],
    })
    expect(registry.get(id)?.targets).toEqual([])
  })
})
