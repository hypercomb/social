// providers-window.door.spec.ts — the Providers console arrives with its first
// open (llm.drone.ts; atomic-modules-plan.md, "adopt the proper load"). Boot
// makes nothing; the first `providers:open` loads it and makes it ONCE, and the
// bus's replay of that press opens it. Every press toggles, so two heard while
// it loads leave it closed; no later press ever makes a second console.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const KEY = '@diamondcoreprocessor.com/ProvidersWindowView'
const services = new Map<string, unknown>()
const registered: string[] = []
window.ioc ??= {
  register: (key: string, value: unknown) => { registered.push(key); services.set(key, value) },
  get: <T>(key: string) => services.get(key) as T | undefined,
  whenReady: () => {}, list: () => [...services.keys()],
} as typeof window.ioc

const panels = (): number => document.querySelectorAll('.hc-providers').length

beforeAll(async () => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })))
  await import('./llm.drone.js')
})

describe('the Providers console door', () => {
  it('makes nothing at boot', () => {
    expect(services.has(KEY)).toBe(false)
    expect(panels()).toBe(0)
  })

  it('makes the console once for two presses heard while it loads, and leaves it closed', async () => {
    EffectBus.emit('providers:open', {})
    EffectBus.emit('providers:open', {})
    await vi.waitFor(() => expect(services.has(KEY)).toBe(true), { timeout: 10_000 })
    expect(panels()).toBe(0)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })

  it('opens and closes the one console on later presses — never a second one', () => {
    EffectBus.emit('providers:open', {})
    expect(panels()).toBe(1)
    EffectBus.emit('providers:open', {})
    expect(panels()).toBe(0)
    EffectBus.emit('providers:open', {})
    expect(panels()).toBe(1)
    expect(registered.filter(key => key === KEY)).toHaveLength(1)
  })
})
