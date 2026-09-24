// sharing/offers.queen.spec.ts — the offers window's code arrives with its
// open or with a host's offer, not at boot (atomic-modules-plan.md, "adopt
// the proper load"). A burst of offers heard before the code is here still
// names each host once, and /offers stamps its request after the load, so a
// slow first load cannot outlive it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wired = vi.hoisted(() => {
  let open = (): void => { /* no gate held */ }
  const state = {
    loads: 0,
    fail: false,
    gate: Promise.resolve(),
    hold(): void { state.gate = new Promise<void>(resolve => { open = resolve }) },
    release(): void { open() },
    ready: new Map<string, (value: unknown) => void>(),
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: (key: string, callback: (value: unknown) => void) => { state.ready.set(key, callback) },
    onRegister: () => () => { /* noop */ },
  }
  return state
})

// The real view, counted and held at the door: what is measured is WHEN the
// bee fetches it.
vi.mock('./offers.view.js', async (importOriginal) => {
  wired.loads++
  await wired.gate
  if (wired.fail) throw new Error('offline')
  return await importOriginal<typeof import('./offers.view.js')>()
})

import { EffectBus } from '@hypercomb/core'
import { OffersQueenBee } from './offers.queen.js'

const TAG = 'hc-offers'
const here = dirname(fileURLToPath(import.meta.url))
const QUEEN = readFileSync(join(here, 'offers.queen.ts'), 'utf8')
const define = vi.spyOn(customElements, 'define')
const definedHere = (): number => define.mock.calls.filter(([tag]) => tag === TAG).length

const toasts: { title?: string }[] = []
EffectBus.on<{ title?: string }>('toast:show', p => { toasts.push(p) })
const opens: { at?: number }[] = []
EffectBus.on<{ at?: number }>('offers:open', p => { opens.push(p) })
const said: string[] = []
EffectBus.on<{ message?: string }>('activity:log', p => { if (p?.message) said.push(p.message) })

describe('the offers bee loads the window with its open', () => {
  afterEach(() => { vi.useRealTimers() })

  it('fetches nothing at boot: the surface is its tag', () => {
    expect(wired.loads).toBe(0)
    expect(customElements.get(TAG)).toBeUndefined()
    const surfaces: unknown[] = []
    wired.ready.get('@hypercomb.social/ShellSurfaceRegistry')!({ add: (surface: unknown) => surfaces.push(surface) })
    expect(surfaces).toEqual([{ name: TAG, owner: '@diamondcoreprocessor.com/OffersView', element: TAG, order: 142 }])
    expect(QUEEN).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'\.\/offers\.view\.js'/m)
  })

  it('/offers says so when the window cannot load, and asks for nothing', async () => {
    wired.fail = true
    await new OffersQueenBee().invoke('')
    wired.fail = false
    expect(said.some(line => line.startsWith('Could not load the offers window'))).toBe(true)
    expect(opens).toHaveLength(0)
    expect(customElements.get(TAG)).toBeUndefined()
  })

  it('a burst of offers fetches the view once and names every host; /offers during a slow load still opens', async () => {
    const before = wired.loads
    // The shell's host made the element before its code was here.
    const element = document.createElement(TAG) as HTMLElement & { open$?: boolean }
    document.body.append(element)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    wired.hold()

    EffectBus.emit('published-pools:offered', { origin: 'a.example', meaning: 'llm:providers', count: 1 })
    EffectBus.emit('published-pools:offered', { origin: 'b.example', meaning: 'comfy:workflows', count: 2 })
    EffectBus.emit('published-pools:offered', { origin: 'a.example', meaning: 'llm:providers', count: 1 })
    const asking = new OffersQueenBee().invoke('')
    await Promise.resolve()
    expect(opens).toHaveLength(0)

    // The code takes a minute to arrive — far past the window's open stamp.
    vi.setSystemTime(1_060_000)
    wired.release()
    await asking

    expect(wired.loads - before).toBe(1)
    expect(definedHere()).toBe(1)
    expect(toasts.map(toast => toast.title)).toEqual(['a.example is offering something', 'b.example is offering something'])
    expect(opens).toEqual([{ at: 1_060_000 }])
    expect(element.open$).toBe(true)
  })

  it('a second ask fetches and defines nothing more, and a new offer goes straight to the window', async () => {
    const loads = wired.loads
    await new OffersQueenBee().invoke('')
    expect(wired.loads).toBe(loads)
    expect(definedHere()).toBe(1)
    expect(opens).toHaveLength(2)

    const element = document.querySelector(TAG) as HTMLElement & { close(): void }
    element.close()
    EffectBus.emit('published-pools:offered', { origin: 'c.example', meaning: 'llm:providers', count: 1 })
    expect(toasts.map(toast => toast.title)).toContain('c.example is offering something')
    expect(wired.loads).toBe(loads)
  })
})
