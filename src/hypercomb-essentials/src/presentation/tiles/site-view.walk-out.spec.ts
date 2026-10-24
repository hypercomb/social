// site-view.walk-out.spec.ts — who drops a website decides where the reader
// lands, never where they happen to stand.
//
//   · An EXIT (the exit button, Escape, `h`, the back gesture) goes back the
//     way in — even after the site's own link took the reader somewhere else.
//   · A WALK-OUT (the reader moved and the ARRIVAL there released the surface,
//     view.bee `releasingArrival`) ends where they now stand.
//
// 2026-10-23: `go /colony` from /hyperdex — a site opened from the root —
// landed the hive on the root, and the next word found "the hive root".

import { beforeEach, describe, expect, it, vi } from 'vitest'

let mode = 'hexagons'
let segments: string[] = []
const viewBee = { releasingArrival: false }

const setMode = vi.fn((next: string) => {
  if (next === mode) return
  mode = next
  viewMode.dispatchEvent(new CustomEvent('change'))
})
class FakeViewMode extends EventTarget {
  get mode(): string { return mode }
  previous = 'hexagons'
  setMode = setMode
}
const viewMode = new FakeViewMode()
const explorerReplace = vi.fn((next: string[]) => { segments = [...next]; lineage.dispatchEvent(new CustomEvent('change')) })
class FakeLineage extends EventTarget {
  explorerSegments = (): string[] => segments
  explorerReplace = explorerReplace
}
const lineage = new FakeLineage()

const registered = new Map<string, unknown>()
const services = new Map<string, unknown>([
  ['@hypercomb.social/ViewMode', viewMode],
  ['@hypercomb.social/Lineage', lineage],
  // No hypercombRoot: #reconcile stands down, which isolates the flip.
  ['@hypercomb.social/Store', {}],
  ['@diamondcoreprocessor.com/ViewBee', viewBee],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => services.get(key) ?? registered.get(key),
  whenReady: () => {},
}

const { EffectBus } = await import('@hypercomb/core')
await import('./site-view.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/SiteViewDrone') as { pulse(g: string): Promise<void> }
await drone.pulse('')

/** The explorer moves (a `go`, a link) — the lineage says so, as the real one does. */
const walkTo = (next: string[]): void => { segments = [...next]; lineage.dispatchEvent(new CustomEvent('change')) }
/** The arrival machinery drops the surface behind a reader who walked out. */
const arrivalReleases = (): void => {
  viewBee.releasingArrival = true
  try { setMode('hexagons') } finally { viewBee.releasingArrival = false }
}
/** The site OPENS as the reader arrives on `at` from wherever they stood. */
const arriveIntoSite = (at: string[]): void => {
  walkTo(at)
  setMode('website')
  EffectBus.emit('view:arrival', { segments: [...at], view: 'website' })
}

beforeEach(() => {
  if (mode !== 'hexagons') setMode('hexagons')
  walkTo([])
  setMode.mockClear()
  explorerReplace.mockClear()
})

describe('leaving a website', () => {
  it('a WALK-OUT ends where the reader walked: go /colony from /hyperdex (opened from the root) stays on /colony', () => {
    arriveIntoSite(['hyperdex'])
    walkTo(['colony'])
    arrivalReleases()
    expect(mode).toBe('hexagons')
    expect(explorerReplace).not.toHaveBeenCalled()
    expect(segments).toEqual(['colony'])
  })

  it('an EXIT from the site still goes back to where it was opened — the root', () => {
    arriveIntoSite(['hyperdex'])
    setMode('hexagons')
    expect(explorerReplace).toHaveBeenCalledWith([])
    expect(segments).toEqual([])
  })

  it('an EXIT after the site\'s own link left it still goes back the way in', () => {
    walkTo(['dolphin'])
    setMode('website')                 // toggled on standing on /dolphin
    explorerReplace(['whales'])        // an in-site link replaced the place
    explorerReplace.mockClear()
    setMode('hexagons')                // Escape
    expect(explorerReplace).toHaveBeenCalledWith(['dolphin'])
    expect(segments).toEqual(['dolphin'])
  })
})
