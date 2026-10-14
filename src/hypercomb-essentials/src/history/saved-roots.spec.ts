// history/saved-roots.spec.ts — SAVE AS / USE: one root at a time, every other
// one filed under a name, nothing ever lost.
//
// jwize, 2026-10-10: "no new hive functionality just save as then you are on an
// empty slate". 2026-10-13: "turn it on as your current root at any time" —
// `use <name>`; the root you leave goes back under its name, and an unnamed
// root with tiles is refused ("make save as a requirement for use").
//
// The queens run for real against an in-memory history (bags of layer sigs)
// and an in-memory Store for the record.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EffectBus, get, list, register } from '@hypercomb/core'
import {
  SAVED_ROOTS_KEY, SavedRoots, afterSaveAs, afterUse, parseSavedRoots, savedRootTileNames, slateFrom, withLiveSnapshots,
  type RootHistory,
} from './saved-roots.js'
import type { LayerContent } from './history.service.js'
import type { DocumentStoreLike } from '../preferences/participant-document.js'

// The shell's window.ioc is core's container; the queens register through it at import.
;(window as unknown as { ioc: unknown }).ioc ??= { register, get, list, whenReady: (key: string, cb: (v: unknown) => void) => { const v = get(key); if (v) cb(v) } }
const { SaveQueenBee } = await import('../commands/save.queen.js')
const { UseQueenBee } = await import('../commands/use.queen.js')

const settle = async (): Promise<void> => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }

/** Bags of layer sigs, and the layers by sig — a sig is the layer's canonical JSON. */
const fakeHistory = () => {
  const layers = new Map<string, LayerContent>()
  const bags = new Map<string, string[]>()
  const sigOf = (layer: LayerContent): string => JSON.stringify(Object.keys(layer).sort().reduce((o, k) => ({ ...o, [k]: layer[k] }), {}))
  const leaf = (name: string): string => { const l = { name }; const s = sigOf(l); layers.set(s, l); return s }
  const history: RootHistory & { bags: typeof bags; layers: typeof layers; head(loc: string): LayerContent | null; previewActive: boolean } = {
    bags, layers, previewActive: false,
    sign: async lineage => { const segs = lineage.explorerSegments(); return segs.length ? `bag:${segs.join('/')}` : 'bag:/' },
    latestMarkerSigFor: async loc => bags.get(loc)?.at(-1) ?? '',
    getLayerBySig: async sig => layers.get(sig) ?? null,
    commitLayer: async (loc, layer) => {
      const sig = sigOf(layer)
      layers.set(sig, layer)
      const bag = bags.get(loc) ?? []
      if (bag.at(-1) !== sig) bag.push(sig)
      bags.set(loc, bag)
      return sig
    },
    headMarkerOf: loc => { const n = bags.get(loc)?.length ?? 0; return n ? String(n - 1).padStart(8, '0') : null },
    listLayers: async loc => (bags.get(loc) ?? []).map(layerSig => ({ layerSig })),
    head(loc) { const s = bags.get(loc)?.at(-1); return s ? layers.get(s) ?? null : null },
  }
  return { history, leaf }
}

const fakeStore = (): DocumentStoreLike => {
  const docs = new Map<string, ArrayBuffer>()
  const handle = (m: string) => ({ name: m } as unknown as FileSystemDirectoryHandle)
  return {
    initialize: async () => {},
    openPool: async m => handle(m),
    getPool: async m => handle(m),
    getPoolDoc: async pool => docs.get(pool!.name) ?? null,
    putPoolDoc: async (pool, bytes) => { docs.set(pool.name, bytes); return 'f'.repeat(64) },
  }
}

const ioc = { register }
let toasts: { type: string; message: string }[] = []
let off: (() => void) | null = null
let h: ReturnType<typeof fakeHistory>
let roots: SavedRoots

const run = async (queen: { invoke: (args: string) => unknown }, args: string): Promise<{ type: string; message: string }> => {
  toasts = []
  await queen.invoke(args)
  await settle()
  return toasts.at(-1) ?? { type: '', message: '' }
}
const rootChildren = (): string[] => ((h.history.head('bag:/')?.children ?? []) as string[]).map(sig => h.history.layers.get(sig)!.name)

// The container keeps a key's FIRST registration, so each test's fakes are
// reached through stable proxies registered once.
const through = <T extends object>(current: () => T): T => new Proxy({} as T, {
  get: (_, prop) => { const target = current() as Record<PropertyKey, unknown>; const v = target[prop]; return typeof v === 'function' ? (v as Function).bind(target) : v },
})
ioc.register('@diamondcoreprocessor.com/HistoryService', through(() => h.history))
ioc.register(SAVED_ROOTS_KEY, through(() => roots))

beforeEach(async () => {
  h = fakeHistory()
  const store = fakeStore()
  roots = new SavedRoots({ whenStore: ready => ready(store) })
  await roots.ready()
  off = EffectBus.on('toast:show', (t: { type: string; message: string }) => { toasts.push(t) })
  // A root with two tiles and a restore-point index.
  await h.history.commitLayer('bag:/', { name: '/', children: [h.leaf('apples'), h.leaf('pears')], snapshots: ['s1'] })
})

afterEach(() => { off?.(); off = null })

describe('the record', () => {
  it('parses only a record, drops an active word that was never saved, and moves through save and use', () => {
    expect(parseSavedRoots(null)).toBeNull()
    expect(parseSavedRoots({ saved: ['a', 'a', 'b'], active: 'zzz' })).toEqual({ saved: ['a', 'b'], active: null })
    const saved = afterSaveAs({ saved: [], active: null }, 'summer')
    expect(saved).toEqual({ saved: ['summer'], active: null })
    expect(afterUse(saved, 'summer')).toEqual({ saved: ['summer'], active: 'summer' })
    expect(afterSaveAs({ saved: ['summer'], active: 'summer' }, 'winter')).toEqual({ saved: ['summer', 'winter'], active: null })
  })

  it('an empty root keeps only the restore-point index; a used root takes the live index', () => {
    expect(slateFrom({ name: '/', children: ['x'], snapshots: ['s1'], builds: ['b'] })).toEqual({ name: '/', snapshots: ['s1'] })
    expect(withLiveSnapshots({ name: '/', children: ['x'], snapshots: ['old'] }, { name: '/', snapshots: ['live'] }))
      .toEqual({ name: '/', children: ['x'], snapshots: ['live'] })
  })
})

describe('save as <name>', () => {
  it('files the root under the name — the same layer, by signature — and leaves an empty root', async () => {
    const before = h.history.bags.get('bag:/')!.at(-1)!
    const said = await run(new SaveQueenBee(), 'as Summer')
    expect(said.type).toBe('success')
    expect(h.history.bags.get('bag:summer')!.at(-1)).toBe(before)
    expect(rootChildren()).toEqual([])
    expect(h.history.head('bag:/')).toEqual({ name: '/', snapshots: ['s1'] })
    expect(roots.record).toEqual({ saved: ['summer'], active: null })
    // Nothing is deleted: the root's own history still holds the filed head.
    expect(h.history.bags.get('bag:/')).toContain(before)
  })

  it('refuses, changing nothing: no "as", a reserved word, a tile of this hive, a saved name, an empty root', async () => {
    const root = [...h.history.bags.get('bag:/')!]
    for (const [args, says] of [
      ['summer', 'save as <name>'],
      ['as bees', 'reserved'],
      ['as apples', 'already a tile'],
    ] as const) {
      expect((await run(new SaveQueenBee(), args)).message).toContain(says)
      expect(h.history.bags.get('bag:/')).toEqual(root)
      expect(roots.record.saved).toEqual([])
    }
    await run(new SaveQueenBee(), 'as summer')
    expect((await run(new SaveQueenBee(), 'as summer')).message).toContain('already holds a saved root')
    expect((await run(new SaveQueenBee(), 'as winter')).message).toContain('already empty')
  })
})

describe('use <name>', () => {
  it('turns a saved root back on: its tiles are the root again, with the live restore-point index', async () => {
    await run(new SaveQueenBee(), 'as summer')
    await h.history.commitLayer('bag:/', { name: '/', snapshots: ['s1', 's2'] })
    expect((await run(new UseQueenBee(), 'Summer')).type).toBe('success')
    expect(rootChildren()).toEqual(['apples', 'pears'])
    expect(h.history.head('bag:/')!['snapshots']).toEqual(['s1', 's2'])
    expect(roots.record).toEqual({ saved: ['summer'], active: 'summer' })
  })

  it('the root you leave goes back under its name — edits made while it was on included', async () => {
    await run(new SaveQueenBee(), 'as summer')
    await h.history.commitLayer('bag:/', { name: '/', children: [h.leaf('figs')] })
    await run(new SaveQueenBee(), 'as winter')
    await run(new UseQueenBee(), 'summer')
    // An edit while summer is on…
    await h.history.commitLayer('bag:/', { name: '/', children: [h.leaf('apples'), h.leaf('pears'), h.leaf('plums')] })
    await run(new UseQueenBee(), 'winter')
    expect(rootChildren()).toEqual(['figs'])
    // …is summer's when it comes back.
    await run(new UseQueenBee(), 'summer')
    expect(rootChildren()).toEqual(['apples', 'pears', 'plums'])
    expect(roots.record.active).toBe('summer')
  })

  it('save as is required first: an unnamed root with tiles is refused, and nothing changes', async () => {
    await run(new SaveQueenBee(), 'as summer')
    await h.history.commitLayer('bag:/', { name: '/', children: [h.leaf('figs')] })
    const root = [...h.history.bags.get('bag:/')!]
    expect((await run(new UseQueenBee(), 'summer')).message).toContain('save as <name> first')
    expect(h.history.bags.get('bag:/')).toEqual(root)
    expect(roots.record.active).toBeNull()
  })

  it('says so for nothing saved, an unknown name, and the root already on', async () => {
    expect((await run(new UseQueenBee(), 'summer')).message).toContain('No saved root named')
    expect((await run(new UseQueenBee(), '')).message).toContain('No saved roots yet')
    await run(new SaveQueenBee(), 'as summer')
    await run(new UseQueenBee(), 'summer')
    expect((await run(new UseQueenBee(), 'summer')).message).toContain('already your root')
  })
})

describe('prune never offers a saved root\'s pages', () => {
  it('names every tile a saved root lists', async () => {
    await run(new SaveQueenBee(), 'as summer')
    expect([...await savedRootTileNames(h.history, roots.record.saved)].sort()).toEqual(['apples', 'pears'])
  })
})

describe('a saved name is never a tile name', () => {
  it('the record answers synchronously, folded', async () => {
    await run(new SaveQueenBee(), 'as summer')
    expect(roots.isSaved('Summer')).toBe(true)
    expect(roots.isSaved('winter')).toBe(false)
  })
})
