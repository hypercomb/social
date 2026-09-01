// publish-lights.spec.ts — THE DRESSING CENSUS.
//
// A publication's `publish:lights` mark carries the behaviours the creation
// was DRESSED IN — never the publisher's whole roster. wornKindsWithin walks
// the branch and answers which kinds it wears: decoration records, slot-backed
// bees, the website slot's special, and the kind behind a `view:default` mark
// (a pinned view must be able to mount even when no tile carries its record).
// The publish routine stamps `worn ∩ lit`; these worlds guard the census half.

import { beforeEach, describe, expect, it } from 'vitest'

const sig = (c: string): string => c.repeat(64)

type Layer = Record<string, unknown>

let layers: Map<string, Layer>
let resources: Map<string, unknown>

const history = {
  sign: async (l: { explorerSegments?: () => readonly string[] }) =>
    'loc:' + (l.explorerSegments?.() ?? []).join('/'),
  currentLayerAt: async (loc: string) => layers.get(loc) ?? null,
  getLayerBySig: async (s: string) =>
    s === sig('d') ? { name: 'signed-child' } : null,
}
const store = {
  getResource: async (s: string) => {
    const rec = resources.get(s)
    return rec ? { text: async () => JSON.stringify(rec) } : null
  },
}
const registry = {
  all: () => [
    { view: 'postit', decorationKind: 'visual:postit:note' },
    { view: 'publications', decorationKind: 'visual:publications:ledger' },
    { view: 'tutor', decorationKind: 'visual:tutor:deck', slot: 'tutor' },
  ],
}

;(window as unknown as { ioc: unknown }).ioc = {
  register: () => void 0,
  get: (key: string) => ({
    '@diamondcoreprocessor.com/HistoryService': history,
    '@hypercomb.social/Store': store,
    '@diamondcoreprocessor.com/VisualBeeRegistry': registry,
  } as Record<string, unknown>)[key],
}

const { wornKindsWithin } = await import('./publish-lights.js')

beforeEach(() => {
  resources = new Map<string, unknown>([
    [sig('a'), { kind: 'visual:postit:note', payload: {} }],
    [sig('b'), { kind: 'view:default', payload: { view: 'publications' } }],
    [sig('c'), { kind: 'tag', payload: { name: 'family' } }],
  ])
  layers = new Map<string, Layer>([
    ['loc:garden', { name: 'garden', children: ['notes', 'press', sig('d')] }],
    ['loc:garden/notes', { name: 'notes', decorations: [sig('a'), sig('c')] }],
    // A pinned view whose kind no tile in the branch wears as a record.
    ['loc:garden/press', { name: 'press', decorations: [sig('b')] }],
    // A sig-named child entry resolves to its layer name before descending.
    ['loc:garden/signed-child', { name: 'signed-child', tutor: [sig('e')] }],
  ])
})

describe('wornKindsWithin — the branch answers what it wears', () => {
  it('collects decoration kinds from every layer in the branch', async () => {
    const worn = await wornKindsWithin(['garden'])
    expect(worn?.has('visual:postit:note')).toBe(true)
    expect(worn?.has('tag')).toBe(true)
  })

  it('maps a view:default mark to the view\'s own kind, so a pinned view can mount', async () => {
    const worn = await wornKindsWithin(['garden'])
    expect(worn?.has('view:default')).toBe(true)
    expect(worn?.has('visual:publications:ledger')).toBe(true)
  })

  it('sees slot-backed bees and the website slot, which carry no decoration record', async () => {
    layers.set('loc:garden/press', { name: 'press', website: [sig('f')] })
    const worn = await wornKindsWithin(['garden'])
    expect(worn?.has('visual:website:page')).toBe(true)
    expect(worn?.has('visual:tutor:deck')).toBe(true)   // the signed child's tutor slot
  })

  it('never invents a kind the branch does not wear', async () => {
    const worn = await wornKindsWithin(['garden'])
    expect(worn?.has('visual:lightbox:gallery')).toBe(false)
  })

  it('answers null for an unreadable branch — the caller falls back, never stamps empty', async () => {
    expect(await wornKindsWithin(['nowhere'])).toBe(null)
  })
})
