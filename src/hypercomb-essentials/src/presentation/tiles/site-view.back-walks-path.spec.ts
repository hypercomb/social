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

  it('leaves the website only from the page it was entered on', async () => {
    walkTo(['presentation'])
    setMode('website')
    walkTo(['presentation', 'simple'])
    await back()
    expect(mode).toBe('website')
    await back()
    expect(mode).toBe('hexagons')
    expect(segments).toEqual(['presentation'])
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
