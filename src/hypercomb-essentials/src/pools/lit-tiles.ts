// pools/lit-tiles.ts
//
// WHAT IS LIT. A lit tile is a public tile (presentation/tiles/tile-public.ts):
// marked on its own, or covered by a lit branch rooted at it or above it. In
// pools mode a lit tile is a row its owner offers
// (documentation/pools-as-relational-database.md, "Where the write happens").
//
// The marks are membership, never truth (P6): each individually lit tile is one
// record `{ kind: 'public:tile', path }` in the `public:tiles` pool, and each
// lit branch one path in the branch list tile-public keeps. This file only
// READS them. The pool is opened without creating it and nothing is written,
// so asking what is lit changes nothing. A route is a path of names, never an
// address (N1): what a lit tile carries is resolved by whoever asks, from its
// layer. Nothing registers here.

import { get, normalizeCell } from '@hypercomb/core'
import { childNamesOf, resolveLayerAt, type PlacementHistory } from '../history/layer-placement.js'
import { PUBLIC_TILES_MEANING, isCellPublic, readPublicBranches } from '../presentation/tiles/tile-public.js'

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
/** The record tile-public writes for one individually public tile. */
const LIT_RECORD_KIND = 'public:tile'

/** One lit mark: a tile on its own, or the root of a branch lit whole. */
export interface LitTile {
  readonly segments: readonly string[]
  readonly branch: boolean
}

/** The store, as far as reading the marks goes. Every method optional: none is an answer. */
export interface LitTilesStore {
  /** Waits for the store's root to open; a pool asked for before that reads as nothing. */
  initialize?(): Promise<void>
  /** Opens a pool and never creates it. */
  openPool?(meaning: string): Promise<object | null>
}

export interface LitTilesDeps {
  store?: LitTilesStore
  /** The lit branch roots, as canonical paths. */
  branches?: () => readonly string[]
}

type PoolEntries = { entries?(): AsyncIterable<[string, { kind?: string; getFile?(): Promise<{ text(): Promise<string> }> }]> }

const segmentsOf = (path: string): string[] => path.split('/').map(part => part.trim()).filter(Boolean)
/** One route, however its names were spelled: every segment folded as a tile path folds it. */
const routeKey = (segments: readonly string[]): string => segments.map(part => normalizeCell(part) || part).join('/')

/** The paths of the individually lit tiles, read from the pool's records. Empty where there is no store or no pool. */
const litRecordPaths = async (store: LitTilesStore | undefined): Promise<string[]> => {
  const paths: string[] = []
  try {
    if (!store?.openPool) return paths
    await store.initialize?.()
    const pool = await store.openPool(PUBLIC_TILES_MEANING) as PoolEntries | null
    if (!pool?.entries) return paths
    for await (const [, handle] of pool.entries()) {
      if (handle?.kind !== 'file' || !handle.getFile) continue
      try {
        const record = JSON.parse(await (await handle.getFile()).text()) as { kind?: unknown; path?: unknown }
        if (record?.kind === LIT_RECORD_KIND && typeof record.path === 'string' && record.path.startsWith('/')) paths.push(record.path)
      } catch { /* not a record: it lights nothing */ }
    }
  } catch { /* an unreadable pool lights nothing more */ }
  return paths
}

/**
 * Every lit mark of this hive: each individually lit tile and each lit branch
 * root, once per route (a route lit both ways is a branch), sorted by route.
 * Reads only. Never throws.
 */
export async function litTiles(deps: LitTilesDeps = {}): Promise<LitTile[]> {
  const found = new Map<string, LitTile>()
  const note = (path: string, branch: boolean): void => {
    const segments = segmentsOf(path)
    if (!segments.length) return
    const key = routeKey(segments)
    if (branch || !found.has(key)) found.set(key, { segments, branch })
  }
  for (const path of await litRecordPaths(deps.store ?? get<LitTilesStore>(STORE_KEY))) note(path, false)
  let branches: readonly string[] = []
  try { branches = (deps.branches ?? readPublicBranches)() } catch { branches = [] }
  for (const path of branches) if (typeof path === 'string') note(path, true)
  return [...found.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, tile]) => tile)
}

/** The child names of the tile at a route, read from its current layer as the hive reads them. Empty when it cannot be read. */
export const liveChildrenOf = (): ((segments: readonly string[]) => Promise<readonly string[]>) => async segments => {
  try {
    const history = get<PlacementHistory>(HISTORY_KEY)
    if (!history) return []
    const domain = get<{ domain?: unknown }>(LINEAGE_KEY)?.domain
    return await childNamesOf(history, await resolveLayerAt(history, domain, [...segments]))
  } catch { return [] }
}

/**
 * Every lit route: a tile lit on its own is itself, a lit branch is its root
 * and everything under it, breadth first. Once per route, at most `limit`, and
 * a branch already walked is never walked again.
 */
export async function litTileRoutes(
  tiles: readonly LitTile[],
  childrenOf: (segments: readonly string[]) => Promise<readonly string[]>,
  limit = 500,
): Promise<string[][]> {
  const routes: string[][] = []
  const taken = new Set<string>()
  const walked = new Set<string>()
  const take = (segments: readonly string[]): void => {
    const key = routeKey(segments)
    if (!segments.length || taken.has(key) || routes.length >= limit) return
    taken.add(key)
    routes.push([...segments])
  }
  for (const tile of tiles) {
    if (!tile.branch) { take(tile.segments); continue }
    const queue: string[][] = [[...tile.segments]]
    while (queue.length && routes.length < limit) {
      const at = queue.shift() as string[]
      const key = routeKey(at)
      if (!at.length || walked.has(key)) continue
      walked.add(key)
      take(at)
      let names: readonly string[] = []
      try { names = await childrenOf(at) } catch { names = [] }
      for (const name of names) if (typeof name === 'string' && name.trim()) queue.push([...at, name])
    }
  }
  return routes
}

/** How many of the tiles named on one page are lit, on their own or by a branch. */
export function litCountHere(location: string | readonly string[], labels: readonly string[]): number {
  const at = typeof location === 'string' ? location : `/${location.join('/')}`
  return labels.filter(label => isCellPublic(at, label)).length
}
