// hypercomb-essentials/.../presentation/tiles/tile-source-registry.ts
//
// TileSourceRegistry — central join point for "what tiles exist at
// this location". Phase 1 of the show-cell decomposition.
//
// Pattern mirrors LayerSlotRegistry: one mechanical interface every
// contributor plugs into. Adding a new tile flavour (ephemeral
// previews, clipboard overlay, future AI-suggested tiles) is a single
// registration call from the contributor's drone.
//
// Concurrency: sources run in parallel via Promise.allSettled. A
// failing source contributes [] and is logged; it does not poison
// other sources or the resolution.
//
// Identity: tiles are unioned by (kind, name). The same name appearing
// in two sources with different kinds is two distinct entries — the
// renderer is responsible for any kind-aware precedence (typically
// opfs > ephemeral, since an adopted tile shouldn't double as its own
// preview). Same name + same kind = first wins.

import type {
  LocationContext,
  TileEntry,
  TileSource,
  UnregisterTileSource,
} from './tile-source.types.js'

const IOC_KEY = '@hypercomb.social/TileSourceRegistry'

export class TileSourceRegistry {
  readonly #sources = new Set<TileSource>()

  /** Register a tile source. Returns an unregister callback. */
  public readonly register = (source: TileSource): UnregisterTileSource => {
    this.#sources.add(source)
    return () => { this.#sources.delete(source) }
  }

  /** Resolve all sources for the given location. The result is the
   *  union of every source's contributions, deduplicated by (kind, name).
   *  Errors in individual sources are caught and logged — they don't
   *  cause resolution to fail. */
  public readonly resolve = async (loc: LocationContext): Promise<readonly TileEntry[]> => {
    if (this.#sources.size === 0) return []
    const results = await Promise.allSettled(
      [...this.#sources].map(s => s(loc))
    )
    const seen = new Set<string>()
    const out: TileEntry[] = []
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[tile-source-registry] source threw', r.reason)
        continue
      }
      for (const entry of r.value) {
        const dedupKey = `${entry.kind}:${entry.name}`
        if (seen.has(dedupKey)) continue
        seen.add(dedupKey)
        out.push(entry)
      }
    }
    return out
  }

  /** Convenience: just the names, in source-arrival order. For callers
   *  upgrading from `listCellFolders` semantics — accepts a final
   *  `precedence` filter to keep only one kind when both exist for the
   *  same name (e.g. `'opfs'` to hide ephemerals that have been
   *  adopted but haven't cleared from the cache yet). */
  public readonly resolveNames = async (
    loc: LocationContext,
    precedence?: TileEntry['kind'],
  ): Promise<readonly string[]> => {
    const entries = await this.resolve(loc)
    if (!precedence) return entries.map(e => e.name)
    const byName = new Map<string, TileEntry>()
    for (const e of entries) {
      const existing = byName.get(e.name)
      if (!existing) { byName.set(e.name, e); continue }
      if (existing.kind === precedence) continue
      if (e.kind === precedence) byName.set(e.name, e)
    }
    return [...byName.values()].map(e => e.name)
  }

  /** Find the entry for a given name + optional kind. Used by the
   *  layout service and renderer to recover the source ref. */
  public readonly findEntry = async (
    loc: LocationContext,
    name: string,
    kind?: TileEntry['kind'],
  ): Promise<TileEntry | null> => {
    const entries = await this.resolve(loc)
    return entries.find(e => e.name === name && (!kind || e.kind === kind)) ?? null
  }
}

// IoC registration — the singleton instance any contributor or
// consumer can resolve.
//
// MUST start the line with `window.ioc.register(` (no leading `;`, no
// optional-chaining, no cast) so scripts/prepare.ts at prepare.ts:86
// picks this file up as a side-effect module and adds an import to
// side-effects.ts. Without this exact shape, the regex misses the
// file → side-effects barrel skips it → the module never loads →
// the registry is never registered in IoC → show-cell silently
// no-ops its peer-pull at show-cell.drone.ts:1921 → peer tiles arrive
// in the swarm cache but never reach the renderer. That was the
// "incognito sees nothing" bug.
const _registry = new TileSourceRegistry()
window.ioc.register(IOC_KEY, _registry)

export const TILE_SOURCE_REGISTRY_KEY = IOC_KEY
