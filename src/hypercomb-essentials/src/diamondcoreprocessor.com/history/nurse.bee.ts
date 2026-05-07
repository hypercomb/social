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
// own 0000 (and any inherited ancestor 0000s) haven't changed. Writes
// invalidate via the `cell:0000-changed` event broadcast by
// `writeCellProperties`. Layer cascades do NOT invalidate the cache —
// the value is independent of the layer.
//
// ── Subclass contract ─────────────────────────────────────────────────
//
//   readonly attribute: string                — the 0000 key (e.g. 'index')
//   parse(raw: unknown): T | undefined        — coerce stored value to T
//
// Reads:   await nurse.read(cellDir, cacheKey)
// Writes:  writeCellProperties(cell, { ... })  — the only writer; nurses
//                                                react to the broadcast.

import { Bee, EffectBus } from '@hypercomb/core'
import { readCellProperties } from '../editor/tile-properties.js'

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
   * `cacheKey` should uniquely identify the cell across renders — the
   * cell's lineage path (e.g. `'instructions/section'`) or its
   * locationSig. The caller chooses; the nurse just keys by it.
   *
   * Hot path: cache hit returns without touching disk. Cold path:
   * read 0000, parse, cache.
   */
  async read(
    cellDir: FileSystemDirectoryHandle,
    cacheKey: string,
  ): Promise<T | undefined> {
    const cached = this.#cache.get(cacheKey)
    if (cached) return cached.value
    const props = await readCellProperties(cellDir)
    const value = this.parse(props[this.attribute])
    this.#cache.set(cacheKey, { value, layerSig: '' })
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
