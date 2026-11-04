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
const viewBee = { releasingArrival: false, arriveAsHexagons: vi.fn(), holdSurfaceOnce: vi.fn() }
const backs = new Map<string, () => void>()

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
  ['@diamondcoreprocessor.com/BackGesture', { register: (entry: { owner: string; back: () => void }) => { backs.set(entry.owner, entry.back); return () => backs.delete(entry.owner) } }],
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
  viewBee.arriveAsHexagons.mockClear()
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

  // jwize 2026-11-03: "the close website button is going to a website refresh".
  // The way back lands on a place whose own (or cascading) default is a
  // website; leaving must land on the tiles, so the exit arms the one-shot
  // hexagons for exactly the arrival it causes.
  it('an EXIT back to the hexagons lands on tiles even where a default would re-open the site', () => {
    arriveIntoSite(['presentation', 'simple'])   // spawned from /presentation's hexagons
    walkTo(['presentation', 'simple', 'primitive'])
    explorerReplace.mockClear()
    const order: string[] = []
    viewBee.arriveAsHexagons.mockImplementation(() => { order.push('arm') })
    explorerReplace.mockImplementationOnce((next: string[]) => { order.push('move'); segments = [...next]; lineage.dispatchEvent(new CustomEvent('change')) })
    setMode('hexagons')
    expect(viewBee.arriveAsHexagons).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['arm', 'move'])
  })

  it('an EXIT that stays where it stands arms nothing (no arrival would consume it)', () => {
    walkTo(['dolphin'])
    setMode('website')                 // opened standing here: the spawn is right here
    setMode('hexagons')
    expect(explorerReplace).not.toHaveBeenCalled()
    expect(viewBee.arriveAsHexagons).not.toHaveBeenCalled()
  })

  it('the BACK gesture at the site\'s entry turns the website off and returns to where it was opened', () => {
    walkTo([])                                   // the root's hexagons, where the reader stood
    walkTo(['presentation'])
    setMode('website')                           // opened standing on /presentation
    explorerReplace.mockClear()
    backs.get('site-view')?.()
    expect(mode).toBe('hexagons')
    expect(segments).toEqual(['presentation'])
  })

  it('a HELD arrival (the site stepping between its own pages) never rewrites where the site was opened', () => {
    walkTo(['dolphin'])
    setMode('website')                           // opened standing on /dolphin
    walkTo(['dolphin', 'pod'])
    walkTo(['dolphin'])
    EffectBus.emit('view:arrival', { segments: ['dolphin'], view: 'website', held: true })
    setMode('hexagons')                          // the exit
    expect(segments).toEqual(['dolphin'])
  })
})
