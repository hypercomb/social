// diamondcoreprocessor.com/history/layer-machine.ts
//
// LayerMachine — the in-memory state machine whose output IS the layer.
//
// ── The primitive ────────────────────────────────────────────────────
//
// A LayerMachine is the runtime working representation of one layer at
// one location. It has exactly three operations:
//
//   fromLayer(prev)  → load state from a committed layer (or empty)
//   apply(delta)     → mutate one slot by appending / removing / swapping a sig
//   output()         → serialise current state back to LayerContent JSON
//
// The layer is the SOURCE OF TRUTH; the machine is its working
// representation. Nothing else stores state. There is no localStorage
// sidecar, no slot-owned read closure, no parallel index. Hydrate from
// a layer → produce a layer. Round-trip identity holds for any pair of
// untouched bytes (apply nothing → output identical bytes).
//
// ── Slot vocabulary ──────────────────────────────────────────────────
//
// `children` is just a slot. `name` is the layer's intrinsic identity
// (the location's segment label). All other fields on the layer JSON
// are slots — every one of them is an array of either 64-hex sigs
// (pointers to `__resources__/` or `__history__/` content) or inline
// JSON payloads (treated opaquely; matched by `===`).
//
// Sparse-layer invariant: empty arrays never appear in the output —
// they are dropped from the slot map entirely. The output layer carries
// only `name` plus non-empty slots, in the canonical order produced by
// HistoryService.canonicalizeLayer.
//
// ── Operations ───────────────────────────────────────────────────────
//
//   { slot, op: 'append',    sig }       — append if not already present
//   { slot, op: 'removeSig', sig }       — remove if present; drop slot
//                                           if it becomes empty
//   { slot, op: 'swap',      from, to }  — strict sig-match swap; no-op if
//                                           `from` is not present
//   { slot, op: 'set',       sigs }      — full-replace (rare; use only
//                                           when the entire slot value is
//                                           known atomically, e.g. on a
//                                           full re-hydrate)
//
// Each `apply` returns `{ changed: boolean }` so callers can chain
// fallback logic (e.g. swap-by-sig misses → resolve-by-name → retry).
// The machine itself does NO async work and NO sig-to-name resolution
// — that lives in the committer where the async context exists.
//
// ── Why this exists ──────────────────────────────────────────────────
//
// Every stateful concern (children, notes, tags, future participants)
// rides the same machinery. Children is no longer special: its delta is
// `{ slot: 'children', op: 'append', sig: cellSig }`. Notes is no longer
// special: its delta is `{ slot: 'notes', op: 'append', sig: noteLayerSig }`.
// Both undergo the same hydrate→mutate→output cycle, both produce a new
// layer-byte signature, both ride the same marker pipeline → both get
// undo / redo / time-travel / cross-browser sync for free.

import type { HistoryService, LayerContent } from './history.service.js'

type LineageLike = { domain?: () => string; explorerSegments?: () => readonly string[] }

export type SlotDelta =
  | { slot: string; op: 'append';    sig: string }
  | { slot: string; op: 'removeSig'; sig: string }
  | { slot: string; op: 'swap';      from: string; to: string }
  | { slot: string; op: 'set';       sigs: readonly unknown[] }

const SIG_REGEX = /^[a-f0-9]{64}$/

export class LayerMachine {

  // Intrinsic identity. Set on hydrate; preserved through output. The
  // ONLY thing the layer knows about itself — every other field is a
  // slot bag contributed by drones (Children, Notes, Tags, ...).
  #name: string = ''

  // Lineage segments — the path from root that locates this layer's
  // bag in `__history__/{sign(segments)}/`. Optional: if set, the
  // machine can self-commit (`commit(history)`); if absent, the caller
  // must compute the locationSig and use `output()` + `history.commitLayer`
  // directly. Stored verbatim and treated as immutable.
  #segments: readonly string[] | null = null

  // Open slot bag. Slot-agnostic — the machine knows zero slot names.
  // Values are kept as `unknown[]` so inline payloads coexist with sig
  // pointers on the same slot if a subsystem wants to mix.
  readonly #slots = new Map<string, unknown[]>()

  /**
   * Hydrate a machine from a committed layer (or `null` when no prior
   * layer exists at this location). `fallbackName` provides the layer's
   * `name` when prev is absent — it's the location's segment label.
   *
   * Slot-agnostic: every field except `name` is treated as a slot,
   * including `children`. The machine does NOT know which slots exist
   * or what they mean — drones (Children, Notes, Tags, ...) own that
   * knowledge. Empty arrays are dropped (sparse-layer invariant).
   *
   * Optional `segments` records the lineage path so the machine can
   * later self-commit via `commit(history)`. Pass when known; omit
   * when the caller will orchestrate commits externally.
   */
  static fromLayer(
    prev: LayerContent | null,
    fallbackName: string,
    segments?: readonly string[],
  ): LayerMachine {
    const m = new LayerMachine()
    m.#name = (prev?.name ?? fallbackName ?? '').toString()
    if (!m.#name) throw new Error('[LayerMachine] cannot hydrate without a name')
    if (segments) m.#segments = segments.slice()
    if (prev) {
      for (const key of Object.keys(prev)) {
        if (key === 'name') continue
        const v = (prev as Record<string, unknown>)[key]
        if (Array.isArray(v) && v.length > 0) m.#slots.set(key, v.slice())
      }
    }
    return m
  }

  /** Empty machine at a name. Used at fresh locations before any layer
   *  exists; equivalent to `fromLayer(null, name, segments)`. */
  static empty(name: string, segments?: readonly string[]): LayerMachine {
    return LayerMachine.fromLayer(null, name, segments)
  }

  /**
   * Hydrate from the current head layer at a lineage. Reads the latest
   * sig at `sign(segments)` from HistoryService and pulls the layer
   * bytes; on a fresh / never-touched location returns an empty
   * machine. Records segments so the resulting machine can self-commit.
   *
   * Use this when you have a lineage and want a machine "for that
   * location, as it currently stands."
   */
  static async atLineage(
    history: HistoryService,
    lineage: LineageLike,
  ): Promise<LayerMachine> {
    const segs = (lineage.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(s => s.length > 0)
    const name = segs.length === 0 ? '/' : segs[segs.length - 1]
    const locationSig = await history.sign({ explorerSegments: () => segs } as LineageLike)
    const prev = await history.currentLayerAt(locationSig)
    return LayerMachine.fromLayer(prev, name, segs)
  }

  /**
   * Apply one slot delta. Pure mutation of internal state; no I/O. The
   * returned `changed` flag reports whether the operation altered the
   * slot (caller chooses whether to skip a downstream commit when
   * nothing changed — though commitLayer's byte dedup covers that case
   * too).
   */
  apply(delta: SlotDelta): { changed: boolean } {
    if (!delta || typeof delta.slot !== 'string' || delta.slot.length === 0) {
      return { changed: false }
    }
    if (delta.slot === 'name') {
      throw new Error('[LayerMachine] cannot mutate reserved slot "name"')
    }

    const arr = this.#slots.get(delta.slot) ?? []

    if (delta.op === 'append') {
      if (typeof delta.sig !== 'string' || delta.sig.length === 0) return { changed: false }
      if (arr.includes(delta.sig)) return { changed: false }
      this.#slots.set(delta.slot, [...arr, delta.sig])
      return { changed: true }
    }

    if (delta.op === 'removeSig') {
      if (typeof delta.sig !== 'string' || delta.sig.length === 0) return { changed: false }
      const idx = arr.indexOf(delta.sig)
      if (idx < 0) return { changed: false }
      const next = arr.slice()
      next.splice(idx, 1)
      if (next.length === 0) this.#slots.delete(delta.slot)
      else this.#slots.set(delta.slot, next)
      return { changed: true }
    }

    if (delta.op === 'swap') {
      if (typeof delta.from !== 'string' || delta.from.length === 0) return { changed: false }
      if (typeof delta.to   !== 'string' || delta.to.length   === 0) return { changed: false }
      if (delta.from === delta.to) return { changed: false }
      const idx = arr.indexOf(delta.from)
      if (idx < 0) return { changed: false }
      const next = arr.slice()
      next[idx] = delta.to
      this.#slots.set(delta.slot, next)
      return { changed: true }
    }

    if (delta.op === 'set') {
      const incoming = Array.isArray(delta.sigs) ? delta.sigs.slice() : []
      const same = arr.length === incoming.length && arr.every((v, i) => v === incoming[i])
      if (same) return { changed: false }
      if (incoming.length === 0) this.#slots.delete(delta.slot)
      else this.#slots.set(delta.slot, incoming)
      return { changed: true }
    }

    return { changed: false }
  }

  /**
   * Replace the value of a slot by name. Caller-side substitution for
   * cases where the natural delta vocabulary doesn't fit. Equivalent to
   * `apply({ slot, op: 'set', sigs })`.
   */
  setSlot(slot: string, sigs: readonly unknown[]): { changed: boolean } {
    return this.apply({ slot, op: 'set', sigs })
  }

  /** Read-only access to a slot's current value. Returns an empty
   *  readonly array for absent slots. */
  getSlot(slot: string): readonly unknown[] {
    return this.#slots.get(slot) ?? []
  }

  /** Iterate every present slot — for diff / debug / write fan-out. */
  slots(): Iterable<readonly [string, readonly unknown[]]> {
    return this.#slots.entries()
  }

  get name(): string { return this.#name }

  /** Lineage segments captured at hydrate time. `null` if the machine
   *  was hydrated without lineage info — `commit()` will throw. */
  get segments(): readonly string[] | null {
    return this.#segments
  }

  /**
   * Self-commit the current state to the bag at this machine's lineage.
   * Computes the location signature via `history.sign(segments)`,
   * hands `output()` to `history.commitLayer`, and returns the new
   * layer signature.
   *
   * `commitLayer` materialises the bag directory and the empty
   * `00000000` marker on first touch — so a fresh location commits
   * cleanly with no extra setup. Identical bytes against the bag's
   * current head are dedup'd to a no-op (no spurious markers).
   *
   * Throws if the machine was not given segments at hydrate time.
   */
  async commit(history: HistoryService): Promise<string> {
    if (!this.#segments) {
      throw new Error('[LayerMachine] commit() requires segments — hydrate via atLineage() or pass segments to fromLayer()')
    }
    const segs = this.#segments
    const locationSig = await history.sign({ explorerSegments: () => segs } as LineageLike)
    return history.commitLayer(locationSig, this.output())
  }

  /**
   * Serialise current state to a LayerContent. The machine knows only
   * its `name`; every other field is a slot bag, written in insertion
   * order. `history.commitLayer()` invokes `canonicalizeLayer` on the
   * way to disk, which imposes the final byte-stable ordering — so
   * the machine does not need to (and must not) carry any per-slot
   * positioning logic. Empty slots are dropped (sparse-layer invariant).
   */
  output(): LayerContent {
    const layer: LayerContent = { name: this.#name }
    for (const [slot, vals] of this.#slots) {
      if (!vals || vals.length === 0) continue
      ;(layer as Record<string, unknown>)[slot] = vals.slice()
    }
    return layer
  }
}

/**
 * Helper for callers that hold a sig string and want to know if it is
 * a 64-hex content signature (vs an inline JSON payload). The
 * LayerMachine itself is content-agnostic, but downstream resolvers
 * (UI strip readers, cascade walkers) discriminate per-element.
 */
export const isLayerSig = (v: unknown): v is string =>
  typeof v === 'string' && SIG_REGEX.test(v)
