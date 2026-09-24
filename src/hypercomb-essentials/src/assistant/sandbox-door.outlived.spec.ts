// sandbox-door.outlived.spec.ts — a request the panel's load outlived is said
// once more (sandbox-door.drone.ts). The panel takes no request older than its
// four-second stamp window; on a slow first fetch of its code the replay is
// already too old when the element upgrades, so the door says it again,
// freshly stamped, and the panel opens anyway.

import { describe, expect, it, vi } from 'vitest'
import { EffectBus } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: () => undefined,
    whenReady: (key: string, callback: (registry: unknown) => void) => {
      if (key === '@hypercomb.social/ShellSurfaceRegistry') callback({ add: () => { /* the shell's concern */ } })
    },
  }
})

const TAG = 'hc-sandbox-change'
const EFFECT = 'module:changes'
const site = {
  sandbox: true as const, title: 'try-zoom', package: 'e'.repeat(64), pubkey: 'b'.repeat(64), publisher: 'Jaime',
  change: 'a'.repeat(64), assessments: [],
}

describe('a request the load outlived', () => {
  it('is said again, freshly stamped, and the panel opens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nothing', { status: 404 })))
    await import('./sandbox-door.drone.js')
    const element = document.createElement(TAG)
    document.body.appendChild(element)
    const heard: Array<{ at: number }> = []
    EffectBus.on<{ at: number }>(EFFECT, payload => { heard.push(payload) })
    const at = Date.now()
    EffectBus.emit(EFFECT, { name: 'try-zoom', door: 'https://try-zoom.hypercomb.com', site, at })
    // The load takes five seconds, as a slow first fetch of the panel's code can.
    const real = Date.now.bind(Date)
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => real() + 5_000)
    await vi.waitFor(() => expect(element.querySelector('.hc-trial')).not.toBeNull(), { timeout: 10_000 })
    expect(heard).toHaveLength(2)
    expect(heard[1]!.at - at).toBeGreaterThan(4_000)
    clock.mockRestore()
    vi.unstubAllGlobals()
  })
})
