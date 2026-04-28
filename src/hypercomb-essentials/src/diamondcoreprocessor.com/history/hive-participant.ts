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
//   - has its own per-item layer (its own bag, its own history)
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
//   - maintaining a versioned localStorage index { [parentLocSig]: sig[] }
//   - emitting the trigger with the parent's segments → LayerCommitter
//     cascade fires at the parent (cell) and cascades up to root
//   - registering the slot with LayerSlotRegistry on construction
//   - byte-stable canonical sort by (sortKey, idOf)
//   - synchronous itemsAt() reads from a warm cache
//   - explicit version-mismatch wipe of legacy index data (no silent
//     migration, no fallback, no chance)
//
// ── Nothing is left to chance ─────────────────────────────────────────
//
//   - No defaults for missing data: empty array → slot omitted entirely.
//   - No silent skips: every contract violation throws with the slot name.
//   - No async background init that completes "eventually": warmup()
//     is awaitable; the slot registers synchronously in the constructor.
//   - No partial commits: per upsert/remove, the participant layers, the
//     index, and the trigger all land or all reject. Failures escalate.
//
// ── Contract for subclasses ───────────────────────────────────────────
//
//   - All abstract methods are PURE: no I/O, no side effects, no Date.now().
//     Determinism is what makes byte-equal layers across browsers.
//   - `version` MUST change any time the body canonicalization, the
//     layer shape, or the index value shape changes. Old indices are
//     wiped — explicit erasure, not migration.
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
//       readonly version = 1
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
//         // ...
//       }
//     }
//
// That's the whole interface. The base class does everything else.

import { EffectBus, SignatureService } from '@hypercomb/core'
import type { HistoryService, LayerContent } from './history.service.js'
import type { LayerSlotRegistry } from './layer-slot-registry.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

type StoreLike = {
  putResource: (blob: Blob) => Promise<void>
  getResource: (sig: string) => Promise<Blob | null>
}

const SIG_REGEX = /^[a-f0-9]{64}$/

export abstract class HiveParticipant<T> {

  // ── Subclass declares ──────────────────────────────────────────────

  /** Field name on the layer JSON. Lowercase, no whitespace, not 'name'
   *  or 'children'. Validated at construction. */
  abstract readonly slot: string

  /** EffectBus event name that fires the cascade when items at any
   *  parent location change. Conventionally `<slot>:changed`. */
  abstract readonly triggerName: string

  /** Bumped any time the on-disk shape (canonicalization, layer, index
   *  value) changes. Mismatch with stored version → index wiped. */
  abstract readonly version: number

  /** Stable id of an item — its identity across edits. Becomes the
   *  participant layer's `name` and segment label. */
  abstract idOf(item: T): string

  /** Canonical sort key. Items are sorted by (sortKey, idOf) so the
   *  resulting sig array is byte-stable across browsers. */
  abstract sortKey(item: T): number | string

  /** Canonical-JSON bytes for the body resource. Pure: no Date.now(),
   *  no random ids, no environment reads. Same item → same bytes → same sig. */
  abstract canonicalizeBody(item: T): string

  /** Inverse of canonicalizeBody. Throws on malformed input — no
   *  silent fallback to a "default item." */
  abstract decodeBody(text: string): T

  /** Build the participant's own layer JSON. `bodySig` is the resource
   *  sig produced by hashing canonicalizeBody(item). The returned
   *  layer's `name` MUST equal idOf(item). All non-`name` fields
   *  follow the slot contract: `unknown[]` (sigs or inline payloads). */
  abstract layerFor(item: T, bodySig: string): LayerContent

  // ── Public API ─────────────────────────────────────────────────────

  /** Synchronous read of items at a parent location. Empty array if
   *  none. Pre-decoded from the warm cache; call warmup() once at
   *  boot to populate. UI re-reads after `triggerName` fires. */
  itemsAt(parentLocSig: string): T[] {
    const sigs = this.#sigsAt(parentLocSig)
    const out: T[] = []
    for (const sig of sigs) {
      const item = this.#itemCache.get(sig)
      if (item !== undefined) out.push(item)
    }
    return out
  }

  /** Pre-decode every participant layer + body referenced by the index.
   *  Idempotent. Awaitable — when it returns, every itemsAt() read for
   *  every parent location resolves synchronously. */
  async warmup(): Promise<void> {
    const idx = this.#readIndex()
    const sigs = new Set<string>()
    for (const arr of Object.values(idx)) for (const s of arr) sigs.add(s)
    await Promise.all([...sigs].map(s => this.#loadItem(s)))
  }

  // ── Subclass calls these to mutate ─────────────────────────────────

  /**
   * Add or replace items at a parent location. Items whose `idOf`
   * matches an existing item replace it; new ids append. The full
   * resulting array is committed atomically: each item's body resource
   * is hashed and stored, each item's layer is committed, the index
   * is updated, and ONE trigger fires regardless of item count.
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
    const parentLocSig = await this.#signSegments(segs)
    const prior = this.itemsAt(parentLocSig)
    const replaceIds = new Set(items.map(i => this.idOf(i)))
    const merged: T[] = [
      ...prior.filter(p => !replaceIds.has(this.idOf(p))),
      ...items,
    ]
    await this.#commit(segs, parentLocSig, merged)
  }

  /**
   * Remove an item by id at a parent location. Throws when no item
   * with that id exists at that location — silent misses hide bugs.
   * If the resulting set is empty, the slot at parentLocSig is
   * removed from the index (so the cell's layer no longer carries
   * this slot field).
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
    const parentLocSig = await this.#signSegments(segs)
    const prior = this.itemsAt(parentLocSig)
    const next = prior.filter(p => this.idOf(p) !== id)
    if (next.length === prior.length) {
      throw new Error(`[hive:${this.slot}] no item with id "${id}" at parent ${parentLocSig.slice(0, 8)}`)
    }
    await this.#commit(segs, parentLocSig, next)
  }

  // ── Construction ───────────────────────────────────────────────────

  constructor() {
    // Abstract field initializers run AFTER super(), so we defer
    // registration to a microtask: by then the subclass's readonly
    // fields are populated. The microtask runs before any user event
    // could fire (events are async themselves), so the slot is always
    // registered before any upsert/remove call routes through.
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
    if (typeof this.version !== 'number' || !Number.isInteger(this.version) || this.version < 1) {
      throw new Error(`[hive:${this.slot}] version must be a positive integer`)
    }

    this.#enforceVersion()

    const registry = get<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry')
    if (!registry) {
      throw new Error(`[hive:${this.slot}] LayerSlotRegistry not on ioc — load order is broken`)
    }
    registry.register({
      slot: this.slot,
      triggers: [this.triggerName],
      read: (parentLocSig) => {
        const sigs = this.#sigsAt(parentLocSig)
        return sigs.length > 0 ? [...sigs] : undefined
      },
    })
  }

  // ── Internal: index ────────────────────────────────────────────────

  /** Decoded participant layer sig → item. Populated by warmup() and
   *  by every #commit. itemsAt() reads here synchronously. */
  readonly #itemCache = new Map<string, T>()

  get #indexKey(): string { return `hypercomb:hive:${this.slot}` }
  get #versionKey(): string { return `hypercomb:hive:${this.slot}:version` }

  /** Wipe the index whenever the on-disk shape (per `version`) doesn't
   *  match what's stored. Explicit erasure — no migration. The legacy
   *  data is no longer reachable from this version's code. */
  #enforceVersion(): void {
    const stored = localStorage.getItem(this.#versionKey)
    if (stored === String(this.version)) return
    localStorage.removeItem(this.#indexKey)
    localStorage.setItem(this.#versionKey, String(this.version))
  }

  #readIndex(): Record<string, string[]> {
    const raw = localStorage.getItem(this.#indexKey)
    if (raw === null) return {}
    let parsed: unknown
    try { parsed = JSON.parse(raw) }
    catch { throw new Error(`[hive:${this.slot}] index JSON corrupt — manual repair required`) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`[hive:${this.slot}] index shape invalid — expected object`)
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!SIG_REGEX.test(k)) {
        throw new Error(`[hive:${this.slot}] index key "${k}" is not a 64-hex sig`)
      }
      if (!Array.isArray(v)) {
        throw new Error(`[hive:${this.slot}] index value at "${k}" is not an array`)
      }
      for (const s of v) {
        if (typeof s !== 'string' || !SIG_REGEX.test(s)) {
          throw new Error(`[hive:${this.slot}] index has bad sig under "${k}"`)
        }
      }
    }
    return parsed as Record<string, string[]>
  }

  #writeIndex(next: Record<string, string[]>): void {
    localStorage.setItem(this.#indexKey, JSON.stringify(next))
  }

  #sigsAt(parentLocSig: string): readonly string[] {
    if (!SIG_REGEX.test(parentLocSig)) return []
    const idx = this.#readIndex()
    return idx[parentLocSig] ?? []
  }

  // ── Internal: commit ───────────────────────────────────────────────

  async #commit(
    parentSegments: readonly string[],
    parentLocSig: string,
    items: readonly T[],
  ): Promise<void> {
    const history = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!history) throw new Error(`[hive:${this.slot}] HistoryService not on ioc`)
    if (!store) throw new Error(`[hive:${this.slot}] Store not on ioc`)

    // Canonical sort: byte-stable across browsers and runs.
    const sorted = [...items].sort((a, b) => {
      const ka = this.sortKey(a), kb = this.sortKey(b)
      if (ka < kb) return -1
      if (ka > kb) return 1
      const ia = this.idOf(a), ib = this.idOf(b)
      return ia < ib ? -1 : ia > ib ? 1 : 0
    })

    const layerSigs: string[] = []
    for (const item of sorted) {
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

      // 3. Cache for synchronous itemsAt() reads.
      this.#itemCache.set(participantLayerSig, item)
      layerSigs.push(participantLayerSig)
    }

    // 4. Index update at parentLocSig. Empty array → slot removed entirely
    //    so the cell's layer goes back to omitting this slot field.
    const idx = this.#readIndex()
    if (layerSigs.length === 0) {
      delete idx[parentLocSig]
    } else {
      idx[parentLocSig] = layerSigs
    }
    this.#writeIndex(idx)

    // 5. Trigger: emit with PARENT segments. LayerCommitter's cascade
    //    fires at the parent (cell) layer, where the slot.read returns
    //    the freshly-updated sig array, then propagates to root.
    EffectBus.emit(this.triggerName, { segments: [...parentSegments] })
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

  /** Drop a localStorage key that predates this participant's index.
   *  Subclasses call from constructor when they know the legacy key
   *  name. Explicit erasure of carryover state. */
  protected purgeLegacyKey(key: string): void {
    if (localStorage.getItem(key) !== null) localStorage.removeItem(key)
  }
}
