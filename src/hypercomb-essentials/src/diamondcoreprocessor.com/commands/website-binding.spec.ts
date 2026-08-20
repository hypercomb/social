// website-binding.spec.ts — WEBSITES BELONG TO A TILE.
//
// The rules this file guards (Jaime, 2026-08-20):
//   1. Ensuring a site root binds `visual:website:page` to that root's
//      LOCATION signature — the attachment the panel and the dormancy lens
//      read ("shows within the branch, acts at the parent it belongs to").
//   2. FIRST-BINDING SWEEP: the first attachment of a session that finds no
//      bindings walks the whole tree and binds EVERY existing site root —
//      one site binding must never silently withdraw the others.
//   3. Descent stops at a root: a page deeper inside a site is part of that
//      site, never a second root.
//   4. Idempotent — re-ensuring an attached root writes nothing new.
//   5. The hive root itself is never a site root.
//
// The store leaf is never consulted in these worlds: site roots carry the
// first-class `website` slot (layerHasWebsite checks it before decorations),
// which also keeps the vitest DOM's missing Blob.prototype.text out of play.

import { beforeEach, describe, expect, it } from 'vitest'
import { EffectBus } from '@hypercomb/core'

const SITE_SIG = 'a'.repeat(64)

type Layer = { name?: string; children?: string[]; website?: string[] }

let layers: Map<string, Layer>

const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) =>
    'loc:' + (l.explorerSegments?.() ?? []).join('/'),
  currentLayerAt: async (loc: string) => layers.get(loc) ?? null,
  getLayerBySig: async () => null,
}
const store = { getResource: async () => null }

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => ({
    '@diamondcoreprocessor.com/HistoryService': history,
    '@hypercomb.social/Store': store,
  } as Record<string, unknown>)[key],
}

const { ensureWebsiteBoundAt, _resetWebsiteBindingSweep, WEBSITE_PAGE_KIND } =
  await import('./website-binding.js')
const { bindingsFor, BOUND_KEY, ENABLEMENT_CHANGED } =
  await import('../sharing/behavior-enablement.js')

const boundPaths = (): string[] => bindingsFor(WEBSITE_PAGE_KIND).map(b => b.path)

beforeEach(() => {
  localStorage.clear()
  // The lens caches drop on the change event — clearing storage alone would
  // leave a previous test's bindings readable.
  EffectBus.emit(ENABLEMENT_CHANGED, {})
  _resetWebsiteBindingSweep()
  layers = new Map<string, Layer>([
    ['loc:', { name: 'root', children: ['garden', 'library', 'plain'] }],
    // A site root with a page INSIDE it — the inner page is the site's, not
    // a second root.
    ['loc:garden', { name: 'garden', children: ['inner'], website: [SITE_SIG] }],
    ['loc:garden/inner', { name: 'inner', children: [], website: [SITE_SIG] }],
    // A second, deeper site.
    ['loc:library', { name: 'library', children: ['essays'] }],
    ['loc:library/essays', { name: 'essays', children: [], website: [SITE_SIG] }],
    // An ordinary branch — never bound.
    ['loc:plain', { name: 'plain', children: [] }],
  ])
})

describe('websites belong to a tile', () => {

  it('attaches a site to its root — a binding of the page kind to the root location', async () => {
    await ensureWebsiteBoundAt(['garden'])
    const bindings = bindingsFor(WEBSITE_PAGE_KIND)
    const garden = bindings.find(b => b.path === '/garden')
    expect(garden).toBeTruthy()
    expect(garden!.sig).toBe('loc:garden')
    expect(garden!.name).toBe('garden')
    // The record is the ordinary binding store — the panel, the dormancy
    // lens, and /behavior all read this same map.
    const raw = JSON.parse(localStorage.getItem(BOUND_KEY) ?? '{}')
    expect(raw[WEBSITE_PAGE_KIND]).toBeTruthy()
  })

  it('the FIRST attachment sweeps: every existing site binds together', async () => {
    await ensureWebsiteBoundAt(['garden'])
    // library/essays was never named — the sweep found it, so binding garden
    // did not withdraw it.
    expect(boundPaths().sort()).toEqual(['/garden', '/library/essays'])
  })

  it('descent stops at a root — an inner page is the site\'s, never a second root', async () => {
    await ensureWebsiteBoundAt(['garden'])
    expect(boundPaths()).not.toContain('/garden/inner')
  })

  it('idempotent — re-ensuring an attached root adds nothing', async () => {
    await ensureWebsiteBoundAt(['garden'])
    const before = boundPaths().sort()
    await ensureWebsiteBoundAt(['garden'])
    await ensureWebsiteBoundAt(['library', 'essays'])
    expect(boundPaths().sort()).toEqual(before)
  })

  it('the hive root is never a site root', async () => {
    await ensureWebsiteBoundAt([])
    expect(boundPaths()).toEqual([])
  })

})
