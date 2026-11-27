// site-view.post-code.spec.ts — the site view's two fragment strips leave an
// entry pool's code alone (documentation/open-entry-pools.md, "The page a
// phone sees", step 1). A published page opens in website mode, where the
// view strips every fragment as a stale tile selection; the code must stay,
// so a phone that reloads the tab comes back to the form. Any other fragment
// is still stripped, which is what shows each strip ran.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const CODE = `#post=${'3f'.repeat(32)}~${'0a'.repeat(16)}`

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

type Entry = { owner: string; back: () => void }
const entries = new Map<string, Entry>()
const registered = new Map<string, unknown>()
const services = new Map<string, unknown>([
  ['@hypercomb.social/ViewMode', viewMode],
  ['@hypercomb.social/Lineage', lineage],
  ['@hypercomb.social/Store', {}],
  ['@diamondcoreprocessor.com/ViewBee', { releasingArrival: false }],
  ['@diamondcoreprocessor.com/BackGesture', { register: (entry: Entry) => { entries.set(entry.owner, entry); return () => entries.delete(entry.owner) } }],
])
;(window as unknown as { ioc: unknown }).ioc = {
  register: (key: string, value: unknown) => { registered.set(key, value) },
  get: (key: string): unknown => services.get(key) ?? registered.get(key),
  whenReady: () => {},
}

await import('./site-view.drone.js')
const drone = registered.get('@diamondcoreprocessor.com/SiteViewDrone') as { pulse(g: string): Promise<void> }
await drone.pulse('')

const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)) }
const walkTo = (next: string[]): void => { segments = [...next]; lineage.dispatchEvent(new CustomEvent('change')) }
/** Put a fragment in the address bar without a navigation event. */
const fragment = (hash: string): void => { window.history.replaceState(window.history.state, '', `${window.location.pathname}${hash}`) }

beforeEach(() => {
  services.set('@hypercomb.social/Store', {})
  if (mode !== 'hexagons') setMode('hexagons')
  walkTo([])
  fragment('')
})

describe('the strip as the website reconciles', () => {
  // With a store the view reconciles in website mode, and the strip is the
  // first thing it does to the address bar.
  const reconcileWith = async (hash: string): Promise<string> => {
    services.set('@hypercomb.social/Store', { hypercombRoot: {}, getResource: async () => null })
    fragment(hash)
    walkTo(['site'])
    setMode('website')
    await settle()
    return window.location.hash
  }

  it('keeps a pool\'s code', async () => {
    expect(await reconcileWith(CODE)).toBe(CODE)
  })

  it('still strips any other fragment', async () => {
    expect(await reconcileWith('#cheese')).toBe('')
  })
})

describe('the strip before a page-to-page navigation', () => {
  // Without a store the reconcile stands down, so only the navigation's own
  // strip touches the address bar. Back inside a site is such a navigation.
  const backWith = async (hash: string): Promise<string> => {
    walkTo(['site'])
    setMode('website')
    walkTo(['site', 'page'])
    fragment(hash)
    const entry = entries.get('site-view')
    if (!entry) throw new Error('the site view registered no way back')
    entry.back()
    await settle()
    expect(segments).toEqual(['site'])
    return window.location.hash
  }

  it('keeps a pool\'s code', async () => {
    expect(await backWith(CODE)).toBe(CODE)
  })

  it('still strips any other fragment', async () => {
    expect(await backWith('#cheese')).toBe('')
  })
})
