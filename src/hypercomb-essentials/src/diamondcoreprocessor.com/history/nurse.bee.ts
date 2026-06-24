// diamondcoreprocessor.com/history/nurse.bee.ts
//
// NurseBee — the standard interface for any subsystem that tends an
// EPHEMERAL render attribute carried in each cell's `0000` properties
// file. Nurses are the counterpart to HiveParticipants:
//
//   HiveParticipant : a slot in the SIGNED layer (notes, tags, ...).
//                     Writes cascade through LayerCommitter and mint
//                     new layer markers. The merkle backbone moves.
//
//   NurseBee        : a primary attribute on the cell's `0000`
//                     (index, background, border, image, ...). Writes
//                     are local to the cell (or root, when shared);
//                     they DO NOT cascade through LayerCommitter and
//                     the layer's signed bytes don't change.
//
// Why two paths exist: not every observable property of a cell is
// part of its identity. Position on the grid, the colour of its
// border, the image atlas pointer — these are ephemeral render
// concerns. Promoting them to layer slots would mint a new layer
// marker for every drag, recolour, reskin — and the merkle backbone
// would churn against changes nobody else cares about. The 0000
// surface keeps render attributes local; the layer stays merkle-
// stable for the things that ARE identity (children, slots).
//
// ── Cache contract ────────────────────────────────────────────────────
//
// Each nurse keeps a Map<cacheKey, { value, layerSig }>. The
// `layerSig` annotation lets a consumer detect "different layer, same
// composed value" — the renderJson stays valid as long as the cell's
// own properties (and any inherited ancestor properties) haven't
// changed. Writes invalidate via the `cell:0000-changed` event
// broadcast by both `writeTilePropertiesAt` (the canonical layer-slot
// path) and `writeCellProperties` (the legacy 0000-file path during
// migration).
//
// ── Subclass contract ─────────────────────────────────────────────────
//
//   readonly attribute: string                — the property key (e.g. 'index')
//   parse(raw: unknown): T | undefined        — coerce stored value to T
//
// Reads:   await nurse.read(parentSegments, cellName, cellDir?, cacheKey?)
//          — layer-slot first via readTilePropertiesAt; falls back to
//            readCellProperties(cellDir) only when the layer slot is
//            empty AND cellDir is provided.
// Writes:  writeTilePropertiesAt(parentSegments, cellName, { ... })
//          — the canonical writer. Layer slot, cascade, broadcast.
//          writeCellProperties(cellDir, ...) is the legacy writer kept
//          callable during caller-by-caller migration; both emit the
//          same broadcast so cache invalidation works uniformly.

import { Bee, EffectBus } from '@hypercomb/core'
import { readCellProperties, readTilePropertiesAt, cellLocationSig } from '../editor/tile-properties.js'

type CacheEntry<T> = { value: T | undefined; layerSig: string }

export abstract class NurseBee<T = unknown> extends Bee {

  /** The 0000 property key this nurse tends. */
  abstract readonly attribute: string

  /** Coerce the raw 0000 value (`unknown`) to the typed value. Return
   *  `undefined` when the value is absent or malformed. */
  protected abstract parse(raw: unknown): T | undefined

  // ── cache ──────────────────────────────────────────────────────────

  readonly #cache = new Map<string, CacheEntry<T>>()

  // ── invalidation epochs (in-flight-read guard) ─────────────────────
  //
  // A read is async: it snapshots the cell's layer, awaits the resource
  // blob, parses the attribute, THEN writes the cache. If a write to
  // this cell COMMITS while that read is in flight — a move persisting a
  // new `index` is the canonical case — the write's `cell:0000-changed`
  // broadcast calls `invalidate()` and clears the entry. But the
  // in-flight read still holds the PRE-write value and, on completion,
  // writes it straight back over the invalidation. The cache is now
  // poisoned with the stale value until the next explicit invalidation;
  // the renderer reads the cell's OLD slot and the tile snaps back to
  // where it started. (Repeating the move works because the second
  // commit has no overlapping in-flight read.)
  //
  // The per-tile WRITE lock in tile-properties.ts can't see this: it
  // serialises writers, but this is a READER racing a writer. The fix is
  // an epoch stamped at read-start: `invalidate` bumps the key's epoch,
  // and a read only publishes its result if the epoch is unchanged when
  // it finishes. A read that straddled an invalidation drops its result
  // (returning it to its own caller, which is re-rendering anyway) and
  // leaves the cache empty so the NEXT read re-fetches the committed
  // head. `#globalEpoch` does the same for the whole-cache wipes
  // (`clear` / `invalidatePrefix`) where per-key bumps can't reach a key
  // that isn't in the cache yet.
  readonly #keyEpoch = new Map<string, number>()
  #globalEpoch = 0

  /**
   * Read the value for a cell.
   *
   * Layer-slot first (the canonical storage during the layer-as-primitive
   * migration); falls back to the legacy 0000 file only if the cell's
   * layer carries no `properties` slot yet AND a `cellDir` handle is
   * available. New writes go via `writeTilePropertiesAt`, so reads of
   * newly-written tiles hit the layer; tiles whose properties pre-date
   * the migration still resolve through the 0000 fallback. Once every
   * writer has flipped and every legacy 0000 has been swept, the
   * fallback branch goes dead.
   *
   * `parentSegments` + `cellName` locate the cell's history bag (the
   * single source of truth for the lineage sig). `cellDir` is optional
   * — only consulted when the layer slot is empty. `cacheKey` is the
   * cell's lineage signature; recomputed via `cellLocationSig` when
   * not supplied so the nurse stays callable from contexts that don't
   * have one in hand.
   */
  async read(
    parentSegments: readonly string[],
    cellName: string,
    cellDir?: FileSystemDirectoryHandle,
    cacheKey?: string,
  ): Promise<T | undefined> {
    const key = cacheKey ?? await cellLocationSig(parentSegments, cellName)
    const cached = this.#cache.get(key)
    if (cached) return cached.value

    // Stamp the epochs BEFORE any await. An invalidation that lands while
    // we're reading advances one of these, and we must not cache a value
    // that predates it (see the #keyEpoch doc above).
    const startKeyEpoch = this.#keyEpoch.get(key) ?? 0
    const startGlobalEpoch = this.#globalEpoch

    // Primary path: layer slot.
    const layerProps = await readTilePropertiesAt(parentSegments, cellName)
    let value = this.parse(layerProps[this.attribute])

    // Fallback: legacy 0000 file. Only consulted when the layer slot
    // didn't carry the value AND we have a dir handle to read from.
    if (value === undefined && cellDir) {
      const fileProps = await readCellProperties(cellDir)
      value = this.parse(fileProps[this.attribute])
    }

    // Publish only if no invalidation occurred during the read. A
    // mismatch means a writer committed mid-read (e.g. a move wrote this
    // tile's new index): drop the result so the next read re-fetches the
    // fresh head, but still return what we read to this caller — it is
    // re-rendering and will read again.
    if ((this.#keyEpoch.get(key) ?? 0) === startKeyEpoch && this.#globalEpoch === startGlobalEpoch) {
      this.#cache.set(key, { value, layerSig: '' })
    }
    return value
  }

  /** Synchronous peek — returns whatever the cache currently holds.
   *  Cache misses return `undefined` without triggering a read. */
  peek(cacheKey: string): T | undefined {
    return this.#cache.get(cacheKey)?.value
  }

  /** Annotate an existing entry with the layerSig it was last seen
   *  alongside. Lets a consumer detect "different layer, same value"
   *  when deciding whether to do work. No-op if the entry doesn't
   *  exist or the sig is unchanged. */
  setLayerSig(cacheKey: string, layerSig: string): void {
    const existing = this.#cache.get(cacheKey)
    if (!existing) return
    if (existing.layerSig === layerSig) return
    this.#cache.set(cacheKey, { value: existing.value, layerSig })
  }

  /** Drop one cell's entry. Bumping the key's epoch also voids any read
   *  for this cell that is in flight right now, so it can't write the
   *  pre-invalidation value back over us. */
  invalidate(cacheKey: string): void {
    this.#cache.delete(cacheKey)
    this.#keyEpoch.set(cacheKey, (this.#keyEpoch.get(cacheKey) ?? 0) + 1)
  }

  /** Drop all entries whose key starts with the given prefix. Used by
   *  inheriting nurses when an ancestor write should invalidate every
   *  descendant's composition. */
  invalidatePrefix(prefix: string): void {
    // Bump the global epoch: a prefixed wipe can target a key whose read
    // hasn't reached the cache yet, so a per-key bump can't reach it. The
    // global stamp voids every in-flight read — coarse, but prefix wipes
    // are rare (ancestor writes) so the extra re-reads are negligible.
    this.#globalEpoch++
    if (prefix.length === 0) {
      this.#cache.clear()
      return
    }
    const withSep = prefix.endsWith('/') ? prefix : prefix + '/'
    for (const k of [...this.#cache.keys()]) {
      if (k === prefix || k.startsWith(withSep)) this.#cache.delete(k)
    }
  }

  /** Clear the entire cache. Used on lineage-wide invalidations
   *  (folder-tree wipes, install reset). Bumps the global epoch so any
   *  in-flight read is voided rather than re-seeding the cache it wiped. */
  clear(): void {
    this.#cache.clear()
    this.#globalEpoch++
  }

  // ── construction ───────────────────────────────────────────────────

  constructor() {
    super()
    // Subscribe to the canonical writer's broadcast. Every
    // writeCellProperties call emits `cell:0000-changed` with the
    // cell's cacheKey and the keys it touched; nurses invalidate when
    // their attribute is among them.
    this.onEffect<{ cacheKey: string; keys: readonly string[] }>(
      'cell:0000-changed',
      (payload) => {
        if (!payload?.keys?.includes(this.attribute)) return
        this.invalidate(payload.cacheKey)
      },
    )
  }

  // ── nurses don't run per pulse ─────────────────────────────────────

  public async pulse(_grammar: string): Promise<void> { /* no-op */ }
}
