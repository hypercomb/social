// sandbox-door.spec.ts — the what-changed panel arrives with its first request
// (sandbox-door.drone.ts; atomic-modules-plan.md, "adopt the proper load").
// Boot adds only the surface's tag; a replayed (stale) request loads nothing;
// the first fresh `module:changes` defines the element ONCE, and the element
// already in the page upgrades and opens on the bus's replay — no second
// request is sent for it. The names the door spells are the view's own.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const added: unknown[] = []
vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: (key: string, callback: (registry: unknown) => void) => {
      if (key !== '@hypercomb.social/ShellSurfaceRegistry') return
      callback({ add: (surface: unknown) => { (globalThis as unknown as { __added: unknown[] }).__added.push(surface) } })
    },
  }
  ;(globalThis as unknown as { __added: unknown[] }).__added = []
})

const TAG = 'hc-sandbox-change'
const EFFECT = 'module:changes'
const site = {
  sandbox: true as const, title: 'try-zoom', package: 'e'.repeat(64), pubkey: 'b'.repeat(64), publisher: 'Jaime',
  change: 'a'.repeat(64), assessments: [],
}
const request = (at: number) => ({ name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at })

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('nothing', { status: 404 })))
  await import('./sandbox-door.drone.js')
  added.push(...(globalThis as unknown as { __added: unknown[] }).__added)
})

describe('the what-changed panel door', () => {
  it('adds only the surface tag at boot, and defines nothing', () => {
    expect(added).toEqual([{ name: TAG, owner: '@diamondcoreprocessor.com/SandboxChangeView', element: TAG, order: 152 }])
    expect(customElements.get(TAG)).toBeUndefined()
  })

  it('loads nothing for a stale request', async () => {
    EffectBus.emit(EFFECT, request(0))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(customElements.get(TAG)).toBeUndefined()
  })

  it('defines the element once on a fresh request, and the one in the page opens on the replay', async () => {
    const element = document.createElement(TAG)
    document.body.appendChild(element)
    const define = vi.spyOn(customElements, 'define')
    const heard: unknown[] = []
    const off = EffectBus.on(EFFECT, payload => { heard.push(payload) })
    heard.length = 0 // the stale request, replayed to this listener
    EffectBus.emit(EFFECT, request(Date.now()))
    await vi.waitFor(() => expect(element.querySelector('.hc-trial')).not.toBeNull(), { timeout: 10_000 })
    expect(heard).toHaveLength(1) // taken from the replay: nothing said twice
    EffectBus.emit(EFFECT, request(Date.now()))
    expect(define.mock.calls.filter(([tag]) => tag === TAG)).toHaveLength(1)
    off()
    define.mockRestore()
  })

  it('spells the view\'s own names', async () => {
    const view = await import('./sandbox-change.view.js')
    expect(added).toEqual([{ name: view.SANDBOX_CHANGE_SURFACE, owner: view.SANDBOX_CHANGE_OWNER, element: view.SANDBOX_CHANGE_SURFACE, order: 152 }])
    expect(view.SANDBOX_CHANGE_EFFECT).toBe(EFFECT)
    expect(customElements.get(TAG)).toBe(view.SandboxChangeElement)
  })
})
