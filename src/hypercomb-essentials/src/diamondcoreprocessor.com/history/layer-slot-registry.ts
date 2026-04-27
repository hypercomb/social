// diamondcoreprocessor.com/history/layer-slot-registry.ts
//
// LayerSlotRegistry — the canonical "stateful subsystems plug into the
// layer here" primitive.
//
// ── The contract ──────────────────────────────────────────────────────
//
// A "layer" is the canonical state snapshot at a location. Today its
// shape is `{ name, children?, ...registered slots }`. `name` and
// `children` are intrinsic — name is the location's segment label,
// children is the cascade-computed array of child layer sigs. Every
// other field on the layer is a SLOT contributed by a subsystem.
//
// To add a stateful concern that participates in undo / sync /
// signature / cross-browser portability, register a slot at module
// load time:
//
//     LayerSlotRegistry.register({
//       slot: 'notesByCell',                      // field name on the layer JSON
//       triggers: ['notes:changed'],              // re-commit on these EffectBus events
//       read: async (locationSig, segments) => { // current value at this location
//         const v = ...                          //   undefined → omit slot from layer
//         return v
//       },
//     })
//
// LayerCommitter consumes the registry in two places:
//
//   1. CONSTRUCTION: subscribes EffectBus to every slot's `triggers`,
//      so any registered subsystem firing its trigger event auto-queues
//      a commit. No edits to LayerCommitter when a new slot is added.
//
//   2. ASSEMBLY: after computing children (the cascade-special path),
//      walks every registered slot and folds its `read()` result into
//      the layer JSON. Slots returning `undefined` are omitted (sparse
//      layer shape — empty fields cost nothing).
//
// Result: every registered slot rides the existing snapshot pipeline.
// Layer signature changes when ANY slot's value changes → new marker
// → undoable for free. The layer JSON IS the cross-browser truth (no
// localStorage caches needed for portability — they're just hot
// caches).
//
// ── Reserved slot names ───────────────────────────────────────────────
//
// `name` and `children` are reserved — `name` is the location label,
// `children` is computed by the merkle cascade (LayerCommitter handles
// it specially because the delta path preserves sibling sigs verbatim).
// Registering either throws.
//
// ── Slot value contract ───────────────────────────────────────────────
//
// - JSON-serializable. Goes into the layer file's bytes.
// - Deterministic by location. Same lineage = same slot value (no
//   `Date.now()` snuck in or the signature drifts every commit).
// - Canonical. The committer canonicalizes the layer with sorted keys
//   and stable nested ordering before signing — your slot value should
//   already be in canonical form (e.g., sort arrays, sort object keys
//   lexicographically) so byte-equal content yields byte-equal sigs.
//
// ── Trigger payload ───────────────────────────────────────────────────
//
// The committer's existing handlers read `payload.segments` to know
// where the change happened. When emitting a trigger, include
// `segments` to commit at a non-current location, or omit it to
// default to the user's current explorer location:
//
//     EffectBus.emit('notes:changed', { cellLabel, segments: [...] })
//
// ── CRITICAL: how to obtain the registry at runtime ──────────────────
//
// ALWAYS use the IoC singleton:
//
//     const registry = get<LayerSlotRegistry>(
//       '@diamondcoreprocessor.com/LayerSlotRegistry'
//     )
//     registry?.register({ slot: '...', triggers: [...], read: ... })
//
// You may import the TYPE relatively for typing only — type imports
// are stripped at compile time and don't get bundled:
//
//     import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
//
// NEVER instantiate LayerSlotRegistry yourself or reach for the class
// constructor — there is exactly one instance, registered by the
// `@diamondcoreprocessor.com/history` namespace dep at module load.
// Importing the class symbol relatively (not type-only) bundles the
// definition into your bee, gives you a different identity from the
// shared instance, and silently breaks the singleton — registrations
// on the bundled-in copy don't reach listeners on the shared copy.
//
// ── Why not just edit LayerContent every time a feature lands ────────
//
// Two reasons:
//
// 1. Symmetry. Cells aren't special; they're the first registered
//    concern. A new feature follows the same pattern — no architectural
//    surgery, no LayerCommitter edits. The difference between "core
//    feature" and "third-party plugin" is just whether you bundle the
//    register() call.
//
// 2. Locality. The subsystem owns its slot end-to-end: shape, read
//    logic, trigger events, all in one file. Reading a feature's
//    history wiring is one grep, not an archaeology dig across
//    history.service.ts + layer-committer.drone.ts + layer-diff.ts +
//    the subsystem itself.

export interface LayerSlot<T = unknown> {
  /**
   * The field name on the layer JSON. Must be a non-empty string,
   * lowercase, no whitespace. Cannot be `name` or `children`.
   */
  readonly slot: string

  /**
   * EffectBus event names that should trigger a re-commit at the
   * location carried in the payload (or the user's current location
   * if no `segments` field is in the payload).
   *
   * Empty array means the slot only contributes to layers committed
   * for OTHER reasons (passive participation — the slot's value gets
   * folded in when something else triggers a snapshot, but the slot
   * itself never causes one).
   */
  readonly triggers: readonly string[]

  /**
   * Return the slot's current value at the given location. Called
   * during layer assembly. Return `undefined` to omit the slot from
   * the layer entirely (keeps the JSON sparse — empty slots cost
   * nothing in bytes or signature surface).
   *
   * Must be deterministic (same location → same value, modulo
   * intervening user mutations) and JSON-serializable (the value goes
   * into the layer file's bytes verbatim after canonicalization).
   *
   * `segments` is the lineage path; `locationSig` is its canonical
   * signature (already computed by HistoryService.sign — passed in so
   * slots that key state by lineage sig don't have to re-sign).
   */
  read: (
    locationSig: string,
    segments: readonly string[],
  ) => Promise<T | undefined> | T | undefined
}

const RESERVED_NAMES = new Set(['name', 'children'])

/**
 * Listener for new-trigger notifications. Fires once per unique
 * trigger event name as it becomes known to the registry — including
 * triggers belonging to slots that register AFTER the listener
 * subscribed, so module load order doesn't matter.
 */
export type TriggerListener = (trigger: string) => void

/**
 * Singleton registry instance — registered with window.ioc at module
 * load (see the bottom of this file). Consumers obtain it via
 * `get<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry')`.
 *
 * Load-order independence: LayerCommitter calls `onTrigger()` to
 * subscribe to trigger announcements. The registry replays every
 * already-known trigger to the new listener immediately, then
 * delivers any future triggers as slots register. Slot owners and
 * the committer can load in any order.
 */
export class LayerSlotRegistry {

  readonly #slots = new Map<string, LayerSlot>()
  /** Triggers we've already announced to listeners — for replay. */
  readonly #announcedTriggers = new Set<string>()
  /** Active listeners. Fired on every NEW trigger as it becomes known. */
  readonly #triggerListeners = new Set<TriggerListener>()

  /**
   * Register a slot. Idempotent for the same slot name + same
   * provider — re-registering with a DIFFERENT provider throws (slot
   * name collisions are a programming error, not a runtime case to
   * recover from). Re-registering the EXACT same object (same
   * reference) is a no-op so module hot-reload during dev doesn't
   * explode.
   *
   * Side effect: any new trigger names appearing in this slot's
   * `triggers` array are announced to all current listeners. Replay
   * via `onTrigger()` ensures listeners that subscribe LATER also
   * see triggers that were registered earlier.
   */
  register<T>(slot: LayerSlot<T>): void {
    if (!slot?.slot || typeof slot.slot !== 'string') {
      throw new Error('[LayerSlotRegistry] slot.slot must be a non-empty string')
    }
    if (RESERVED_NAMES.has(slot.slot)) {
      throw new Error(`[LayerSlotRegistry] slot name "${slot.slot}" is reserved (intrinsic to the layer)`)
    }
    if (typeof slot.read !== 'function') {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" must define a read() function`)
    }
    if (!Array.isArray(slot.triggers)) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" must define a triggers array (use [] for passive slots)`)
    }
    const existing = this.#slots.get(slot.slot)
    if (existing && existing !== slot) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" already registered by a different provider`)
    }
    this.#slots.set(slot.slot, slot as LayerSlot)

    // Announce any triggers we haven't seen before to active listeners.
    for (const t of slot.triggers) {
      if (this.#announcedTriggers.has(t)) continue
      this.#announcedTriggers.add(t)
      for (const listener of this.#triggerListeners) {
        try { listener(t) } catch { /* listener failure must not break registration */ }
      }
    }
  }

  /**
   * Subscribe to trigger announcements. The listener is fired
   * immediately for every trigger already known to the registry,
   * then for every NEW trigger as future slots register.
   *
   * Returns an unsubscribe function.
   */
  onTrigger(listener: TriggerListener): () => void {
    this.#triggerListeners.add(listener)
    // Replay already-announced triggers so subscribe-after-register
    // works the same as subscribe-before-register.
    for (const t of this.#announcedTriggers) {
      try { listener(t) } catch { /* ignore */ }
    }
    return () => { this.#triggerListeners.delete(listener) }
  }

  /**
   * Iterate registered slots in insertion order. LayerCommitter walks
   * this on every commit (to read slot values into the layer).
   */
  slots(): IterableIterator<LayerSlot> {
    return this.#slots.values()
  }

  /** Look up a single slot by name (mostly for diff/debug tools). */
  get(name: string): LayerSlot | undefined {
    return this.#slots.get(name)
  }

  /** Read every slot's value for a location. Omits slots returning undefined. */
  async readAll(
    locationSig: string,
    segments: readonly string[],
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    for (const slot of this.#slots.values()) {
      const value = await slot.read(locationSig, segments)
      if (value !== undefined) out[slot.slot] = value
    }
    return out
  }

  /** Union of every slot's trigger events known so far. */
  allTriggers(): readonly string[] {
    return [...this.#announcedTriggers]
  }
}

// Singleton: one instance per app, registered with window.ioc so
// every consumer (across bees, namespaces) shares it.
const _layerSlotRegistry = new LayerSlotRegistry()
window.ioc.register('@diamondcoreprocessor.com/LayerSlotRegistry', _layerSlotRegistry)
