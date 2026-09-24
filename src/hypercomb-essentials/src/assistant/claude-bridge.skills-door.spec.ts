// claude-bridge.skills-door.spec.ts — the skills window arrives with its first
// open (claude-bridge.worker.ts; atomic-modules-plan.md, "adopt the proper
// load"). Boot makes nothing; the first `skills:open` loads it and makes it
// ONCE, and the bus's replay of that press opens it. Every press toggles, so
// two heard while it loads leave it closed; no later press makes a second one.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const KEY = '@diamondcoreprocessor.com/SkillsWindowView'
const services = new Map<string, unknown>()
const registered: string[] = []
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.push(key); services.set(key, value) },
  get: (key: string) => services.get(key),
  whenReady: () => { /* noop */ },
  list: () => [...services.keys()],
}

const windows = (): number => document.querySelectorAll('.hc-skills').length

beforeAll(async () => {
  await import('./claude-bridge.worker.js')
})

describe('the skills window door', () => {
  it('makes nothing at boot', () => {
    expect(services.has(KEY)).toBe(false)
    expect(windows()).toBe(0)
  })

  it('makes the window once for two presses heard while it loads, and leaves it closed', async () => {
    EffectBus.emit('skills:open', {})
    EffectBus.emit('skills:open', {})
    await vi.waitFor(() => expect(services.has(KEY)).toBe(true), { timeout: 10_000 })
    expect(windows()).toBe(0)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })

  it('opens and closes the one window on later presses — never a second one', () => {
    EffectBus.emit('skills:open', {})
    expect(windows()).toBe(1)
    EffectBus.emit('skills:open', {})
    expect(windows()).toBe(0)
    EffectBus.emit('skills:open', {})
    expect(windows()).toBe(1)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })
})
