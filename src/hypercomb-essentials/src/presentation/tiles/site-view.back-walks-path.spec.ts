// site-view.back-walks-path.spec.ts — back walks the pages the reader took
// through a site, and leaves the site only from the page it was entered on.
//
// jwize 2026-11-03: "the back button needs to walk the path you took it
// doesn't just open to the hexagon start like it does now. Each new render is
// the same as visiting tiles and when going back it doesn't exit the website
// except for the root."
//
// Back reaches the site view through the back gesture (the right button, the
// browser's back, a phone's back), so this drives the entry the view
// registers there.

import { beforeEach, describe, expect, it, vi } from 'vitest'

let mode = 'hexagons'
let segments: string[] = []

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

type Entry = { owner: string; back: () => void; active?: () => boolean }
const entries = new Map<string, Entry>()
const backGesture = { register: (entry: Entry) => { entries.set(entry.owner, entry); return () => entries.delete(entry.owner) } }

const registered = new Map<string, unknown>()
const services = new Map<string, unknown>([
  ['@hypercomb.social/ViewMode', viewMode],
  ['@hypercomb.social/Lineage', lineage],
  // No hypercombRoot: #reconcile stands down and no page reads as page-less,
  // which isolates the walk.
  ['@hypercomb.social/Store', {}],
  ['@diamondcoreprocessor.com/ViewBee', { releasingArrival: false }],
  ['@diamondcoreprocessor.com/BackGesture', backGesture],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => services.get(key) ?? registered.get(key),
  whenReady: () => {},
}

const { EffectBus } = await import('@hypercomb/core')
const { VIEW_SPAWN_EFFECT } = await import('./view-spawn.js')
await import('./site-view.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/SiteViewDrone') as { pulse(g: string): Promise<void> }
await drone.pulse('')

/** The explorer moves (a `go`, a link, the menu) — the lineage says so. */
const walkTo = (next: string[]): void => { segments = [...next]; lineage.dispatchEvent(new CustomEvent('change')) }
/** Back, the way every back press reaches the site view. The walk back is a
 *  navigation, which awaits its page check before it moves. */
const back = async (): Promise<void> => {
  const entry = entries.get('site-view')
  if (!entry) throw new Error('the site view registered no way back')
  entry.back()
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  if (mode !== 'hexagons') setMode('hexagons')
  walkTo([])
  setMode.mockClear()
  explorerReplace.mockClear()
})

describe('back inside a website', () => {
  it('walks back the pages the reader opened, one per press, staying in the website', async () => {
    walkTo(['presentation'])
    setMode('website')
    walkTo(['presentation', 'simple'])
    walkTo(['presentation', 'simple', 'primitive'])
    walkTo(['presentation', 'simple', 'primitive', 'word'])

    await back()
    expect(segments).toEqual(['presentation', 'simple', 'primitive'])
    expect(mode).toBe('website')
    await back()
    expect(segments).toEqual(['presentation', 'simple'])
    await back()
    expect(segments).toEqual(['presentation'])
    expect(mode).toBe('website')
  })

  it('leaves the website only from the page it was entered on, back to where the reader came from', async () => {
    // jwize 2026-11-04: "when you click back on a webpage you just entered you
    // don't go to the same page, you go to the parent of the page you entered".
    // Walking into /presentation from the root opened it (the arrival verdict
    // names the page the reader came FROM), so back out of the entry is the root.
    walkTo(['presentation'])
    setMode('website')
    EffectBus.emit('view:arrival', { segments: ['presentation'], view: 'website' })
    walkTo(['presentation', 'simple'])
    await back()
    expect(mode).toBe('website')
    await back()
    expect(mode).toBe('hexagons')
    expect(segments).toEqual([])
  })

  it('a site toggled on while standing on a node deeper in its tree leaves back to that node, not the root', async () => {
    // jwize 2026-11-08: "You are still sending me back to the root of the
    // website if I entered from a node elsewhere in its tree. Always where
    // you entered from." Toggled on at /deep/tile — a node with no page of its
    // own, the site showed the root's — back from the entry used to land on
    // /deep. With a store the renderer reconciles, finds no page on the
    // node (every page slot empty) and remembers it as confirmed page-less —
    // not a page the reader entered.
    services.set('@hypercomb.social/Store', { hypercombRoot: {}, getResource: async () => null })
    try {
      walkTo(['deep', 'tile'])
      setMode('website')
      await new Promise(r => setTimeout(r, 0))       // the reconcile that finds no page
      walkTo(['deep'])                             // the site's own link to its home page
      await back()
      expect(mode).toBe('website')
      expect(segments).toEqual(['deep', 'tile'])
      await back()
      expect(mode).toBe('hexagons')
      expect(segments).toEqual(['deep', 'tile'])
    } finally {
      services.set('@hypercomb.social/Store', {})
    }
  })

  it('walks the path, not the tree: a page visited twice comes back twice', async () => {
    walkTo(['site'])
    setMode('website')
    walkTo(['site', 'a'])
    walkTo(['site', 'b'])
    walkTo(['site', 'a'])
    await back()
    expect(segments).toEqual(['site', 'b'])
    await back()
    expect(segments).toEqual(['site', 'a'])
    await back()
    expect(segments).toEqual(['site'])
    expect(mode).toBe('website')
  })

  it('a page reached by walking back is not a new visit: back keeps going back', async () => {
    walkTo(['site'])
    setMode('website')
    walkTo(['site', 'a'])
    walkTo(['site', 'a', 'b'])
    await back()                       // to a
    walkTo(['site', 'c'])              // a link from a
    await back()                       // back to a
    expect(segments).toEqual(['site', 'a'])
    await back()                       // back to the entry
    expect(segments).toEqual(['site'])
    await back()                       // and out
    expect(mode).toBe('hexagons')
  })

  it('back onto an entry page that opens as a website still leaves from there, the way it came in', async () => {
    // /presentation opens as a website by its own mark: arriving there from
    // the root opens the site, and the way out is the root.
    walkTo(['presentation'])
    setMode('website')
    EffectBus.emit('view:arrival', { segments: ['presentation'], view: 'website' })
    walkTo(['presentation', 'simple'])
    await back()
    // Landing back on /presentation is an arrival on a page that opens as a
    // website too; it is the walk, not the site opening again.
    EffectBus.emit('view:arrival', { segments: ['presentation'], view: 'website' })
    expect(segments).toEqual(['presentation'])
    await back()
    expect(mode).toBe('hexagons')
    expect(segments).toEqual([])
  })

  it('a site stepped into from a node deeper in its tree leaves back to that node, not the root', async () => {
    // jwize 2026-11-08: "You are still sending me back to the root of the
    // website if I entered from a node elsewhere in its tree. Always where
    // you entered from." The icon dispatcher announces the place BEFORE it
    // walks the explorer to the site root and flips the surface.
    walkTo(['presentation', 'simple', 'deep'])
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'website', mode: 'hexagons', segments: ['presentation', 'simple', 'deep'] })
    walkTo(['presentation'])                       // the dispatcher's walk to the root
    setMode('website')
    walkTo(['presentation', 'about'])
    await back()
    expect(mode).toBe('website')
    await back()                                   // back from the entry page
    expect(mode).toBe('hexagons')
    expect(segments).toEqual(['presentation', 'simple', 'deep'])
  })

  it('the exit button from a stepped-into site also lands where the icon was clicked', async () => {
    walkTo(['presentation', 'simple', 'deep'])
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'website', mode: 'hexagons', segments: ['presentation', 'simple', 'deep'] })
    walkTo(['presentation'])
    setMode('website')
    // An arrival verdict on the root (its own default mark) must not rewrite
    // a step-in spawn to the page before the walk.
    EffectBus.emit('view:arrival', { segments: ['presentation'], view: 'website' })
    walkTo(['presentation', 'about'])
    setMode('hexagons')                            // the exit button / Escape
    expect(segments).toEqual(['presentation', 'simple', 'deep'])
  })

  it('a spawn record for another view does not touch the site', async () => {
    walkTo(['elsewhere'])
    EffectBus.emit(VIEW_SPAWN_EFFECT, { view: 'tree', mode: 'hexagons', segments: ['elsewhere'] })
    walkTo(['presentation'])
    setMode('website')
    walkTo(['presentation', 'simple'])
    await back()
    await back()
    expect(mode).toBe('hexagons')
    expect(segments).toEqual([])                   // opened on its own page (cold read): the parent, as on 2026-11-04
  })

  it('a new site session starts with nothing to walk back to', async () => {
    walkTo(['one'])
    setMode('website')
    walkTo(['one', 'page'])
    setMode('hexagons')                // the exit button
    walkTo(['two'])
    setMode('website')
    await back()
    expect(mode).toBe('hexagons')
  })
})
