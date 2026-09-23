// safety/brood.drone.spec.ts — the brood's bee wires its surface. The view
// only exports; without this bee the brood never mounts and `brood:open`
// opens nothing.

import { describe, expect, it, vi } from 'vitest'

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

const { BROOD_OWNER, BROOD_SURFACE, BroodElement } = await import('./brood.view.js')
// What importing the view ALONE wired, before its bee loads.
const afterView = { ready: [...wired.ready.keys()], registered: [...wired.registered] }
await import('./brood.drone.js')

describe('the brood bee', () => {
  it('registers itself, and adds the brood surface once the registry is ready', () => {
    expect(wired.registered).toContain('@diamondcoreprocessor.com/BroodDrone')
    const surfaces: unknown[] = []
    wired.ready.get('@hypercomb.social/ShellSurfaceRegistry')!({ add: (surface: unknown) => surfaces.push(surface) })
    expect(customElements.get(BROOD_SURFACE)).toBe(BroodElement)
    expect(surfaces).toEqual([{ name: BROOD_SURFACE, owner: BROOD_OWNER, element: BROOD_SURFACE, order: 150 }])
  })

  it('leaves registration to the bee: importing the view alone wires nothing', () => {
    // (Core registers its own services as it loads; the view adds nothing.)
    expect(afterView.ready).toEqual([])
    expect(afterView.registered.filter(key => /brood/i.test(key))).toEqual([])
  })
})
