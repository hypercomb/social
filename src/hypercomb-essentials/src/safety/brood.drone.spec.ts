// safety/brood.drone.spec.ts — the brood's bee wires its surface. The view
// only exports; without this bee the brood never mounts and `brood:open`
// opens nothing. The view arrives with the first open, not at boot
// (atomic-modules-plan.md, "adopt the proper load").

import { afterAll, describe, expect, it, vi } from 'vitest'

const wired = vi.hoisted(() => {
  const state = { registered: [] as string[], ready: new Map<string, (value: unknown) => void>() }
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: (key: string) => { state.registered.push(key) },
    get: () => undefined,
    has: () => false,
    list: () => [],
    whenReady: (key: string, callback: (value: unknown) => void) => { state.ready.set(key, callback) },
  }
  return state
})

const { EffectBus } = await import('@hypercomb/core')
const { BROOD_OWNER, BROOD_SURFACE, BroodElement } = await import('./brood.view.js')
// What importing the view ALONE wired, before its bee loads.
const afterView = { ready: [...wired.ready.keys()], registered: [...wired.registered] }
const define = vi.spyOn(customElements, 'define')
await import('./brood.drone.js')

const defines = (): number => define.mock.calls.filter(([name]) => name === BROOD_SURFACE).length
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// What the shell's surface host does: create the tag, defined or not.
const host = document.createElement(BROOD_SURFACE)
document.body.appendChild(host)
afterAll(() => { vi.restoreAllMocks(); host.remove() })

describe('the brood bee', () => {
  it('registers itself, and adds the brood surface once the registry is ready — undefined until the first open', () => {
    expect(wired.registered).toContain('@diamondcoreprocessor.com/BroodDrone')
    const surfaces: unknown[] = []
    wired.ready.get('@hypercomb.social/ShellSurfaceRegistry')!({ add: (surface: unknown) => surfaces.push(surface) })
    expect(surfaces).toEqual([{ name: BROOD_SURFACE, owner: BROOD_OWNER, element: BROOD_SURFACE, order: 150 }])
    expect(customElements.get(BROOD_SURFACE)).toBeUndefined()
  })

  it('leaves registration to the bee: importing the view alone wires nothing', () => {
    // (Core registers its own services as it loads; the view adds nothing.)
    expect(afterView.ready).toEqual([])
    expect(afterView.registered.filter(key => /brood/i.test(key))).toEqual([])
  })

  it('a replayed open, older than its stamp, loads nothing', async () => {
    EffectBus.emit('brood:open', { at: Date.now() - 60_000 })
    await settle()
    expect(customElements.get(BROOD_SURFACE)).toBeUndefined()
  })

  it('opens on the first open even when the load outlives the stamp, and defines the element once', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    EffectBus.emit('brood:open', { at: now })
    // The load takes longer than the stamp allows: the element's own replay of
    // the open, when it upgrades, finds it stale — the bee opens it anyway.
    clock.mockReturnValue(now + 10_000)
    await vi.waitFor(() => expect((host as InstanceType<typeof BroodElement>).open$).toBe(true))
    expect(customElements.get(BROOD_SURFACE)).toBe(BroodElement)
    expect(host).toBeInstanceOf(BroodElement)
    expect(defines()).toBe(1)
    clock.mockRestore()
  })

  it('a second open defines nothing again', async () => {
    ;(host as InstanceType<typeof BroodElement>).close()
    EffectBus.emit('brood:open', { at: Date.now() })
    await vi.waitFor(() => expect((host as InstanceType<typeof BroodElement>).open$).toBe(true))
    expect(defines()).toBe(1)
  })
})
