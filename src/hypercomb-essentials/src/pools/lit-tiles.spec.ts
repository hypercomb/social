// pools/lit-tiles.spec.ts : what is lit, read from a fake pool of marks and a
// fake tree of child names. The store is never written.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PUBLIC_TILES_MEANING, setBranchPublic, setCellPublic } from '../presentation/tiles/tile-public.js'
import { litCountHere, litTileRoutes, litTiles, liveChildrenOf, type LitTile, type LitTilesStore } from './lit-tiles.js'

/** A pool directory as the store hands it out: named file entries, each read as text. */
const poolOf = (files: Record<string, string>) => ({
  async *entries() {
    for (const [name, text] of Object.entries(files)) {
      yield [name, { kind: 'file', getFile: async () => ({ text: async () => text }) }] as [string, { kind: string; getFile(): Promise<{ text(): Promise<string> }> }]
    }
  },
})

/** A store that only opens pools, and says which it was asked for. */
const storeOf = (files: Record<string, string> | null): { store: LitTilesStore; opened: string[] } => {
  const opened: string[] = []
  return { opened, store: { openPool: async meaning => { opened.push(meaning); return files ? poolOf(files) : null } } }
}

const record = (path: string, kind = 'public:tile'): string => JSON.stringify({ kind, path })

/** Child names by route, for the walk. */
const treeOf = (tree: Record<string, string[]>) => {
  const asked: string[] = []
  return { asked, childrenOf: async (segments: readonly string[]) => { asked.push(segments.join('/')); return tree[segments.join('/')] ?? [] } }
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { delete (globalThis as { ioc?: unknown }).ioc })

describe('litTiles', () => {
  it('reads every individually lit tile and every lit branch root, sorted by route', async () => {
    const { store, opened } = storeOf({ a: record('/recipes/soup'), b: record('/notes') })
    const lit = await litTiles({ store, branches: () => ['/recipes/family'] })
    expect(lit).toEqual([
      { segments: ['notes'], branch: false },
      { segments: ['recipes', 'family'], branch: true },
      { segments: ['recipes', 'soup'], branch: false },
    ])
    expect(opened).toEqual([PUBLIC_TILES_MEANING])
  })

  it('keeps one mark per route, and a route lit both ways is a branch', async () => {
    const { store } = storeOf({ a: record('/recipes'), b: record('/recipes'), c: record('/soup') })
    expect(await litTiles({ store, branches: () => ['/recipes', '/recipes'] })).toEqual([
      { segments: ['recipes'], branch: true },
      { segments: ['soup'], branch: false },
    ])
  })

  it('skips anything in the pool that is not a tile record', async () => {
    const { store } = storeOf({
      a: 'not json',
      b: record('/branch', 'public:branch'),
      c: record('no-leading-slash'),
      d: record('/'),
      e: record('/kept'),
    })
    expect(await litTiles({ store, branches: () => [] })).toEqual([{ segments: ['kept'], branch: false }])
  })

  it('falls back to the branches alone with no store, no pool, or a pool that will not read', async () => {
    const branches = (): string[] => ['/shared']
    const onlyBranch = [{ segments: ['shared'], branch: true }]
    expect(await litTiles({ store: {}, branches })).toEqual(onlyBranch)
    expect(await litTiles({ store: storeOf(null).store, branches })).toEqual(onlyBranch)
    expect(await litTiles({ store: { openPool: async () => { throw new Error('closed') } }, branches })).toEqual(onlyBranch)
    expect(await litTiles({ branches: () => { throw new Error('no storage') } })).toEqual([])
  })

  it('reads the branch list tile-public keeps when none is handed in', async () => {
    setBranchPublic('/', 'Family Recipes', true)
    expect(await litTiles({ store: {} })).toEqual([{ segments: ['family-recipes'], branch: true }])
  })
})

describe('litTileRoutes', () => {
  it('keeps a lit tile as itself and walks a lit branch breadth first', async () => {
    const tiles: LitTile[] = [
      { segments: ['notes'], branch: false },
      { segments: ['recipes'], branch: true },
    ]
    const tree = treeOf({ recipes: ['soup', 'bread'], 'recipes/soup': ['stock'], 'recipes/bread': ['rye'] })
    expect(await litTileRoutes(tiles, tree.childrenOf)).toEqual([
      ['notes'],
      ['recipes'],
      ['recipes', 'soup'],
      ['recipes', 'bread'],
      ['recipes', 'soup', 'stock'],
      ['recipes', 'bread', 'rye'],
    ])
    // A tile lit on its own is never walked.
    expect(tree.asked).not.toContain('notes')
  })

  it('names a route once, however it was reached, and walks a branch once', async () => {
    const tiles: LitTile[] = [
      { segments: ['recipes', 'soup'], branch: false },
      { segments: ['recipes'], branch: true },
      { segments: ['recipes', 'soup'], branch: true },
      { segments: ['Recipes'], branch: true },
    ]
    const tree = treeOf({ recipes: ['Soup'], 'recipes/Soup': ['stock'], 'recipes/soup': ['stock'] })
    const routes = await litTileRoutes(tiles, tree.childrenOf)
    expect(routes).toEqual([['recipes', 'soup'], ['recipes'], ['recipes', 'Soup', 'stock']])
    expect(tree.asked.filter(route => route === 'recipes')).toHaveLength(1)
  })

  it('stops at the limit, even under a tree that never ends', async () => {
    const endless = async (segments: readonly string[]): Promise<string[]> => [segments[segments.length - 1] ?? 'x']
    const routes = await litTileRoutes([{ segments: ['loop'], branch: true }], endless, 7)
    expect(routes).toHaveLength(7)
    expect(routes[6]).toEqual(Array.from({ length: 7 }, () => 'loop'))
  })

  it('treats a branch whose children cannot be read as its root alone', async () => {
    const broken = async (): Promise<string[]> => { throw new Error('cold') }
    expect(await litTileRoutes([{ segments: ['recipes'], branch: true }], broken)).toEqual([['recipes']])
  })
})

describe('liveChildrenOf', () => {
  it('reads the child names of a tile from its current layer, as the hive reads them', async () => {
    const layers: Record<string, { name?: string; children?: string[] }> = {
      'at:recipes': { name: 'recipes', children: ['sig-soup', 'sig-bread', 'sig-gone'] },
      'sig-soup': { name: 'soup' },
      'sig-bread': { name: 'bread' },
    }
    const services: Record<string, unknown> = {
      '@diamondcoreprocessor.com/HistoryService': {
        sign: async (lineage: { explorerSegments(): readonly string[] }) => `at:${lineage.explorerSegments().join('/')}`,
        currentLayerAt: async (at: string) => layers[at] ?? null,
        getLayerBySig: async (sig: string) => layers[sig] ?? null,
      },
    }
    ;(globalThis as { ioc?: unknown }).ioc = { get: (key: string) => services[key] }

    const childrenOf = liveChildrenOf()
    expect(await childrenOf(['recipes'])).toEqual(['soup', 'bread'])
    expect(await childrenOf(['recipes', 'soup'])).toEqual([])
  })

  it('answers no children where there is no hive to read', async () => {
    expect(await liveChildrenOf()(['recipes'])).toEqual([])
  })
})

describe('litCountHere', () => {
  it('counts the tiles on a page that are lit on their own or by a branch', () => {
    setCellPublic('/recipes', 'Soup', true)
    setBranchPublic('/recipes', 'family', true)
    expect(litCountHere('/recipes', ['Soup', 'bread', 'family'])).toBe(2)
    expect(litCountHere(['recipes'], ['Soup', 'bread', 'family'])).toBe(2)
    expect(litCountHere(['recipes', 'family'], ['nonna', 'zia'])).toBe(2)
    expect(litCountHere([], ['recipes'])).toBe(0)
  })
})
