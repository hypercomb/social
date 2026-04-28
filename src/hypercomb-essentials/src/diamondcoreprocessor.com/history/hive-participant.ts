// diamondcoreprocessor.com/history/hive-participant.ts
//
// HiveParticipant — the standard interface for any subsystem that
// participates in the merkle layer tree. A participant declares ITS
// shape; the base class handles ALL the mechanics, identically for
// every participant.
//
// ── What a participant is ─────────────────────────────────────────────
//
// A participant is a kind of stateful data that:
//   - lives at a parent location (the cell that owns it)
//   - has its own per-item layer (its own bag, its own immutable history)
//   - shows up in the parent layer's bytes as `slot: [participantLayerSig...]`
//
// Notes, tags, and any future stateful concern follow this pattern.
// The participant author writes ONE class that declares:
//   - which slot field on the parent layer holds the sig array
//   - which EffectBus event fires when items at any parent change
//   - how each item canonicalizes to bytes (for resource hashing)
//   - how to build the participant's own layer from an item
//   - the item's stable id and canonical sort key
//   - how to decode body bytes back to an item
//
// The base class then provides:
//   - hashing items → putResource → bodyResourceSig
//   - committing the participant's layer at sign([...parent, '__<slot>__', id])
//     → participantLayerSig
//   - emitting the trigger with `{ segments, op: 'set', sigs }` so
//     LayerCommitter applies the full canonical list to the parent's
//     slot in ONE leaf delta and cascades to root
//   - registering the slot with LayerSlotRegistry on construction
//   - byte-stable canonical sort by (sortKey, idOf)
//   - synchronous itemsAt() reads from the LAYER, not from a sidecar
//
// ── Source of truth: the layer ────────────────────────────────────────
//
// There is NO localStorage index, NO version key, NO parallel state.
// Every read flows through the parent layer's slot field; every write
// flows through commitLayer. The layer is the truth. Wipe localStorage
// → notes still load. Hand someone the root sig → they walk the merkle
// tree and resolve every note via `__resources__/<bodySig>`. Single
// signature = full expandable AI-payload context, by construction.
//
// ── Contract for subclasses ───────────────────────────────────────────
//
//   - All abstract methods are PURE: no I/O, no side effects, no
//     Date.now(). Determinism is what makes byte-equal layers across
//     browsers.
//   - `idOf(item)` MUST be stable across edits of the same logical item
//     (it's the item's identity in the merkle tree).
//   - `layerFor(item, bodySig)` MUST return a layer whose `name` equals
//     `idOf(item)`. The base class enforces this.
//
// ── How a subclass plugs in ───────────────────────────────────────────
//
//     class NotesService extends HiveParticipant<Note> {
//       readonly slot = 'notes'
//       readonly triggerName = 'notes:changed'
//       idOf(n: Note) { return n.id }
//       sortKey(n: Note) { return n.createdAt }
//       canonicalizeBody(n: Note) { return canonicalJSON(n) }
//       decodeBody(text: string): Note { return JSON.parse(text) as Note }
//       layerFor(n: Note, bodySig: string): LayerContent {
//         return { name: n.id, body: [bodySig] }
//       }
//
//       constructor() {
//         super()
//         EffectBus.on('note:commit', p => this.upsert([...lineage, p.cell], [n]))
//       }
//     }

import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HistoryService, LayerContent } from './history.service.js'
import type { LayerSlotRegistry } from './layer-slot-registry.js'

type LayerCommitterLike = {
  commitSlotSet: (segments: readonly string[], slot: string, sigs: readonly string[]) => Promise<void>
}

type LineageLike = { explorerSegments?: () => readonly string[] }

type StoreLike = {
  putResource: (blob: Blob) => Promise<void>
  getResource: (sig: string) => Promise<Blob | null>
}

const SIG_REGEX = /^[a-f0-9]{64}$/

export abstract class HiveParticipant<T> {

  // ── Subclass declares ──────────────────────────────────────────────

  /** Field name on the layer JSON. Lowercase, no whitespace, not
   *  `name` or `children`. Validated at construction. */
  abstract readonly slot: string

  /** EffectBus event name that fires the cascade when items at any
   *  parent location change. Conventionally `<slot>:changed`. */
  abstract readonly triggerName: string

  /** Stable id of an item — its identity across edits. Becomes the
   *  participant layer's `name` and segment label. */
  abstract idOf(item: T): string

  /** Canonical sort key. Items are sorted by (sortKey, idOf) so the
   *  resulting sig array is byte-stable across browsers. */
  abstract sortKey(item: T): number | string

  /** Canonical-JSON bytes for the body resource. Pure: no Date.now(),
   *  no random ids, no environment reads. Same item → same bytes →
   *  same sig. */
  abstract canonicalizeBody(item: T): string

  /** Inverse of canonicalizeBody. Throws on malformed input — no
   *  silent fallback to a "default item." */
  abstract decodeBody(text: string): T

  /** Build the participant's own layer JSON. `bodySig` is the resource
   *  sig produced by hashing canonicalizeBody(item). The returned
   *  layer's `name` MUST equal idOf(item). */
  abstract layerFor(item: T, bodySig: string): LayerContent

  // ── Public read API ────────────────────────────────────────────────

  /**
   * Synchronous read of items at a parent location. Reads the parent's
   * current layer from HistoryService's preloader cache, takes its slot
   * field, resolves each sig through the local item cache. Empty array
   * if no parent layer is cached or the slot is absent.
   *
   * For first-time-touched parents (no commits yet) and uncached items,
   * call `warmup()` once at boot — after that every itemsAt() resolves
   * synchronously.
   */
  itemsAt(parentLocSig: string): T[] {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return []
    const parent = history.peekCurrentLayer(parentLocSig)
    if (!parent) return []
    const slotValue = (parent as Record<string, unknown>)[this.slot]
    if (!Array.isArray(slotValue)) return []
    const out: T[] = []
    for (const sig of slotValue) {
      if (typeof sig !== 'string') continue
      const item = this.#itemCache.get(sig)
      if (item !== undefined) out.push(item)
    }
    return out
  }

  /**
   * Walk every layer in HistoryService's preloader cache, decode every
   * item carried in this slot. After this resolves, every itemsAt() at
   * every parent in the universe is synchronous.
   *
   * Idempotent: re-calling skips already-decoded participant layer sigs.
   */
  async warmup(): Promise<void> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) return
    await history.preloadAllBags()
    const sigsToDecode = new Set<string>()
    for (const layerSig of history.allKnownLayerSigs()) {
      const layer = history.peekLayerBySig(layerSig)
      if (!layer) continue
      const v = (layer as Record<string, unknown>)[this.slot]
      if (!Array.isArray(v)) continue
      for (const s of v) {
        if (typeof s === 'string' && SIG_REGEX.test(s) && !this.#itemCache.has(s)) {
          sigsToDecode.add(s)
        }
      }
    }
    await Promise.all([...sigsToDecode].map(s => this.#loadItem(s)))
  }

  // ── Subclass calls these to mutate ─────────────────────────────────

  /**
   * Add or replace items at a parent location. Items whose `idOf`
   * matches an existing item replace it; new ids append. The full
   * resulting array (sorted canonically) is committed atomically: each
   * item's body resource is hashed and stored, each item's layer is
   * committed, and ONE trigger fires with the full canonical sig list.
   *
   * `parentSegments` is the lineage path of the OWNER (the cell). The
   * participant layer for each item is committed at
   * sign([...parentSegments, '__<slot>__', idOf(item)]).
   */
  protected async upsert(
    parentSegments: readonly string[],
    items: readonly T[],
  ): Promise<void> {
    const segs = this.#cleanSegments(parentSegments)
    if (segs.length === 0) {
      throw new Error(`[hive:${this.slot}] upsert requires non-empty parentSegments`)
    }
    if (items.length === 0) {
      throw new Error(`[hive:${this.slot}] upsert requires at least one item; use remove() to delete`)
    }

    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    const committer = get<LayerCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !store || !committer) {
      throw new Error(`[hive:${this.slot}] HistoryService / Store / LayerCommitter missing on ioc`)
    }

    const prior = await this.#priorItemsAt(history, segs)
    const replaceIds = new Set(items.map(i => this.idOf(i)))
    const merged: T[] = [
      ...prior.filter(p => !replaceIds.has(this.idOf(p))),
      ...items,
    ]
    const sorted = this.#sortCanonical(merged)
    const layerSigs: string[] = []
    for (const item of sorted) {
      const sig = await this.#commitParticipant(item, segs, history, store)
      layerSigs.push(sig)
    }

    // Drive the cascade DIRECTLY and await it. Subscribers reading
    // the parent layer back must see the new slot value, so the
    // emit-then-subscribe race that EffectBus would create is
    // unacceptable here. After the cascade lands, fire the trigger
    // event so UI consumers refresh.
    await committer.commitSlotSet(segs, this.slot, layerSigs)

    EffectBus.emit(this.triggerName, {
      segments: [...segs],
      op: 'set' as const,
      sigs: layerSigs,
    })
  }

  /**
   * Remove an item by id at a parent location. Throws when no item
   * with that id exists — silent misses hide bugs. The remaining items
   * (or empty list) become the parent's new slot value; the trigger
   * fires with the remaining canonical sig list.
   */
  protected async remove(
    parentSegments: readonly string[],
    id: string,
  ): Promise<void> {
    const segs = this.#cleanSegments(parentSegments)
    if (segs.length === 0) {
      throw new Error(`[hive:${this.slot}] remove requires non-empty parentSegments`)
    }
    if (!id) throw new Error(`[hive:${this.slot}] remove requires a non-empty id`)

    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    const committer = get<LayerCommitterLike>('@diamondcoreprocessor.com/LayerCommitter')
    if (!history || !store || !committer) {
      throw new Error(`[hive:${this.slot}] HistoryService / Store / LayerCommitter missing on ioc`)
    }

    const prior = await this.#priorItemsAt(history, segs)
    const next = prior.filter(p => this.idOf(p) !== id)
    if (next.length === prior.length) {
      throw new Error(`[hive:${this.slot}] no item with id "${id}" at this parent`)
    }
    const sorted = this.#sortCanonical(next)
    const layerSigs: string[] = []
    for (const item of sorted) {
      const sig = await this.#commitParticipant(item, segs, history, store)
      layerSigs.push(sig)
    }

    await committer.commitSlotSet(segs, this.slot, layerSigs)

    EffectBus.emit(this.triggerName, {
      segments: [...segs],
      op: 'set' as const,
      sigs: layerSigs,
    })
  }

  // ── Construction ───────────────────────────────────────────────────

  constructor() {
    // Defer registration to a microtask so the subclass's readonly
    // fields are populated by the time we read them. whenReady gives
    // us load-order independence vs. layer-slot-registry.ts.
    queueMicrotask(() => this.#register())
  }

  #register(): void {
    if (typeof this.slot !== 'string' || !/^[a-z][a-z0-9-]*$/.test(this.slot)) {
      throw new Error(`[hive] invalid slot name "${this.slot}" (must be lowercase, alphanumeric+hyphen)`)
    }
    if (this.slot === 'name' || this.slot === 'children') {
      throw new Error(`[hive] slot name "${this.slot}" is reserved`)
    }
    if (typeof this.triggerName !== 'string' || !this.triggerName.includes(':')) {
      throw new Error(`[hive:${this.slot}] invalid triggerName "${this.triggerName}" (expected "domain:event")`)
    }
    window.ioc.whenReady<LayerSlotRegistry>(
      '@diamondcoreprocessor.com/LayerSlotRegistry',
      (registry) => {
        // Register with NO triggers — HiveParticipant drives the
        // cascade directly via LayerCommitter's public API and emits
        // its trigger event for UI consumers AFTER the cascade lands.
        // If the slot were registered with triggers, the committer's
        // onTrigger subscription would re-process the same slot set
        // (idempotent via commitLayer dedup, but a wasted cascade).
        registry.register({
          slot: this.slot,
          triggers: [],
        })
      },
    )
  }

  // ── Internal: item cache (decoded items keyed by participant layer sig) ──

  /** Decoded participant layers, keyed by participant layer sig. The
   *  participant layer sig is what appears in parent.<slot>[i], so the
   *  layer IS the source of truth — this map is just a derived
   *  decode-once cache. */
  readonly #itemCache = new Map<string, T>()

  // ── Internal: read prior items via the layer ───────────────────────

  async #priorItemsAt(
    history: HistoryService,
    parentSegments: readonly string[],
  ): Promise<T[]> {
    const parentLocSig = await this.#signSegments(parentSegments)
    const parent = await history.currentLayerAt(parentLocSig)
    if (!parent) return []
    const slotValue = (parent as Record<string, unknown>)[this.slot]
    if (!Array.isArray(slotValue)) return []
    const out: T[] = []
    for (const s of slotValue) {
      if (typeof s !== 'string' || !SIG_REGEX.test(s)) continue
      const item = await this.#loadItem(s)
      if (item) out.push(item)
    }
    return out
  }

  // ── Internal: commit a single participant layer ────────────────────

  async #commitParticipant(
    item: T,
    parentSegments: readonly string[],
    history: HistoryService,
    store: StoreLike,
  ): Promise<string> {
    const id = this.idOf(item)
    if (!id || typeof id !== 'string') {
      throw new Error(`[hive:${this.slot}] idOf returned an invalid id`)
    }

    // 1. Body resource: canonicalize, hash, persist.
    const bodyText = this.canonicalizeBody(item)
    if (typeof bodyText !== 'string') {
      throw new Error(`[hive:${this.slot}] canonicalizeBody must return a string`)
    }
    const bodyBytes = new TextEncoder().encode(bodyText)
    const bodySig = await SignatureService.sign(bodyBytes.buffer as ArrayBuffer)
    await store.putResource(new Blob([bodyText], { type: 'application/json' }))

    // 2. Participant layer: build, validate, commit at synthetic location.
    const layer = this.layerFor(item, bodySig)
    if (!layer || layer.name !== id) {
      throw new Error(`[hive:${this.slot}] layerFor must return { name: idOf(item) === "${id}" } (got "${layer?.name}")`)
    }
    const participantSegments = [...parentSegments, `__${this.slot}__`, id]
    const participantLocSig = await this.#signSegments(participantSegments)
    const participantLayerSig = await history.commitLayer(participantLocSig, layer)

    // 3. Cache decoded item by its participant layer sig.
    this.#itemCache.set(participantLayerSig, item)
    return participantLayerSig
  }

  // ── Internal: helpers ──────────────────────────────────────────────

  #sortCanonical(items: readonly T[]): T[] {
    return [...items].sort((a, b) => {
      const ka = this.sortKey(a), kb = this.sortKey(b)
      if (ka < kb) return -1
      if (ka > kb) return 1
      const ia = this.idOf(a), ib = this.idOf(b)
      return ia < ib ? -1 : ia > ib ? 1 : 0
    })
  }

  async #signSegments(segments: readonly string[]): Promise<string> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    if (!history) throw new Error(`[hive:${this.slot}] HistoryService not on ioc`)
    return history.sign({ explorerSegments: () => [...segments] } as LineageLike)
  }

  #cleanSegments(segments: readonly string[]): string[] {
    return segments.map(s => String(s ?? '').trim()).filter(s => s.length > 0)
  }

  async #loadItem(participantLayerSig: string): Promise<T | null> {
    if (this.#itemCache.has(participantLayerSig)) return this.#itemCache.get(participantLayerSig)!
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!history || !store) return null

    const layer = await history.getLayerBySig(participantLayerSig)
    if (!layer) return null

    const bodyField = (layer as Record<string, unknown>)['body']
    if (!Array.isArray(bodyField) || bodyField.length !== 1) {
      throw new Error(`[hive:${this.slot}] layer ${participantLayerSig.slice(0, 8)} has no canonical body sig`)
    }
    const bodySig = bodyField[0]
    if (typeof bodySig !== 'string' || !SIG_REGEX.test(bodySig)) {
      throw new Error(`[hive:${this.slot}] layer ${participantLayerSig.slice(0, 8)} body[0] is not a sig`)
    }

    const blob = await store.getResource(bodySig)
    if (!blob) return null
    const text = await blob.text()
    const item = this.decodeBody(text)
    this.#itemCache.set(participantLayerSig, item)
    return item
  }

  /** Drop a localStorage key that predates this participant. Subclasses
   *  call from constructor when they know the legacy key name. */
  protected purgeLegacyKey(key: string): void {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key) !== null) {
      localStorage.removeItem(key)
    }
  }
}
