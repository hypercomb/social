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

    // Primary path: layer slot.
    const layerProps = await readTilePropertiesAt(parentSegments, cellName)
    let value = this.parse(layerProps[this.attribute])

    // Fallback: legacy 0000 file. Only consulted when the layer slot
    // didn't carry the value AND we have a dir handle to read from.
    if (value === undefined && cellDir) {
      const fileProps = await readCellProperties(cellDir)
      value = this.parse(fileProps[this.attribute])
    }

    this.#cache.set(key, { value, layerSig: '' })
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

  /** Drop one cell's entry. */
  invalidate(cacheKey: string): void {
    this.#cache.delete(cacheKey)
  }

  /** Drop all entries whose key starts with the given prefix. Used by
   *  inheriting nurses when an ancestor write should invalidate every
   *  descendant's composition. */
  invalidatePrefix(prefix: string): void {
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
   *  (folder-tree wipes, install reset). */
  clear(): void {
    this.#cache.clear()
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
