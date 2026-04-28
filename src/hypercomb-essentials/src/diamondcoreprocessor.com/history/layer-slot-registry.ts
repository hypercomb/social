// diamondcoreprocessor.com/history/layer-slot-registry.ts
//
// LayerSlotRegistry — the canonical "stateful subsystems plug into the
// layer here" primitive.
//
// ── The contract ──────────────────────────────────────────────────────
//
// A "layer" is the canonical state snapshot at a location. Its shape is
// `{ name, children?, ...registered slots }`. `name` is intrinsic (the
// location's segment label). Every other field — including `children` —
// is a SLOT. Each slot is an array of either 64-hex signature pointers
// or inline JSON payloads.
//
// To add a stateful concern that participates in the merkle tree (and
// therefore in undo / time-travel / cross-browser sync / signature-as-
// expandable-AI-payload), register a slot at module load:
//
//     LayerSlotRegistry.register({
//       slot: 'notes',                                // field name on the layer JSON
//       triggers: ['notes:changed'],                  // events that fire a leaf delta
//     })
//
// THE LAYER IS THE SOURCE OF TRUTH. The registry knows two things about
// a slot — its field name and its trigger events. It does NOT host a
// `read()` callback that closes over subsystem-private state. There is
// no parallel index, no localStorage cache, no sidecar — slot values
// live in the layer JSON, period. Hydrate from the layer to read; emit
// a slot-delta trigger event to write. LayerMachine handles
// hydrate/mutate/output mechanically.
//
// ── How a slot's value reaches the layer ──────────────────────────────
//
// 1. The subsystem produces or removes a sig (e.g. NotesService commits
//    a participant layer for a new note → has noteLayerSig in hand).
// 2. It emits its trigger event with `{ segments, op, sig }`:
//        EffectBus.emit('notes:changed', {
//          segments: [...parentSegments],
//          op: 'append',                       // or 'removeSig'
//          sig: noteLayerSig,
//        })
// 3. LayerCommitter has subscribed to every registered trigger via
//    `onTrigger`. It receives the event, queues a commit at `segments`,
//    hydrates a LayerMachine from the prev layer, applies the delta to
//    the named slot, outputs the new layer, commits, cascades up to root
//    swapping the prevSig→newSig at each ancestor.
// 4. The layer at the leaf now carries `slot: [..., sig]`. The marker
//    chain at the leaf has one new entry — undoable, time-travelable,
//    shareable as a single root-sig payload to an AI walker.
//
// Bare re-snapshot triggers (no `op/sig` on the payload) are also
// supported: the leaf re-hydrates and re-outputs, producing identical
// bytes if nothing actually changed → commitLayer dedup → no-op.
//
// ── Reserved slot names ───────────────────────────────────────────────
//
// `name` is reserved (intrinsic to the layer). `children` is registrable
// only by the cascade itself — third parties cannot claim it.
// Registering either name as a third-party slot throws.
//
// ── Trigger payload contract ──────────────────────────────────────────
//
// All trigger events carry `{ segments, op?, sig? }`:
//
//   - `segments` — lineage path of the LEAF where the slot value lives
//     (the cell that owns the change). Required.
//   - `op` — `'append' | 'removeSig'`. Optional. When omitted, the
//     committer performs a bare re-snapshot at `segments` (idempotent).
//   - `sig` — the value to append or remove. Required when `op` is set.
//
// Future ops can be added to LayerMachine; the registry stays unchanged.
//
// ── CRITICAL: how to obtain the registry at runtime ──────────────────
//
//     const registry = get<LayerSlotRegistry>(
//       '@diamondcoreprocessor.com/LayerSlotRegistry'
//     )
//     registry?.register({ slot: '...', triggers: [...] })
//
// You may import the TYPE relatively for typing only — type imports
// are stripped at compile time:
//
//     import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'
//
// NEVER instantiate LayerSlotRegistry yourself or import the class
// symbol non-type-only — that bundles the definition into your bee,
// gives you a different identity from the shared singleton, and
// silently breaks the registration plumbing.

export interface LayerSlot {
  /**
   * The field name on the layer JSON. Must be a non-empty string,
   * lowercase, no whitespace. Cannot be `name` or `children`.
   */
  readonly slot: string

  /**
   * EffectBus event names that should trigger a leaf-level commit at
   * the location carried in the payload.
   *
   * Empty array means the slot only contributes when something else
   * triggers a commit at the same leaf — passive participation.
   */
  readonly triggers: readonly string[]
}

const RESERVED_NAMES = new Set(['name', 'children'])

/**
 * Listener for new-trigger notifications. Fires once per unique
 * trigger event name as it becomes known to the registry — including
 * triggers belonging to slots that register AFTER the listener
 * subscribed, so module load order doesn't matter. The listener
 * receives the trigger name and the slot that owns it.
 */
export type TriggerListener = (trigger: string, slot: string) => void

/**
 * Singleton registry instance — registered with window.ioc at module
 * load. Consumers obtain it via
 * `get<LayerSlotRegistry>('@diamondcoreprocessor.com/LayerSlotRegistry')`.
 *
 * Load-order independence: LayerCommitter calls `onTrigger()` to
 * subscribe to trigger announcements. The registry replays every
 * already-known trigger to the new listener immediately, then delivers
 * any future triggers as slots register. Slot owners and the committer
 * can load in any order.
 */
export class LayerSlotRegistry {

  readonly #slots = new Map<string, LayerSlot>()
  /** Triggers we've already announced to listeners — for replay. Maps
   *  trigger event name → slot that owns it. */
  readonly #announcedTriggers = new Map<string, string>()
  /** Active listeners. Fired on every NEW trigger as it becomes known. */
  readonly #triggerListeners = new Set<TriggerListener>()

  /**
   * Register a slot. Idempotent for the same slot reference (hot
   * reload-safe); registering a different object under the same name
   * throws (slot-name collisions are programming errors).
   *
   * Side effect: any new trigger names appearing in this slot's
   * `triggers` array are announced to all current listeners. Replay via
   * `onTrigger()` ensures listeners that subscribe later also see
   * triggers that were registered earlier.
   */
  register(slot: LayerSlot): void {
    if (!slot?.slot || typeof slot.slot !== 'string') {
      throw new Error('[LayerSlotRegistry] slot.slot must be a non-empty string')
    }
    if (RESERVED_NAMES.has(slot.slot)) {
      throw new Error(`[LayerSlotRegistry] slot name "${slot.slot}" is reserved (intrinsic to the layer)`)
    }
    if (!Array.isArray(slot.triggers)) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" must define a triggers array (use [] for passive slots)`)
    }
    const existing = this.#slots.get(slot.slot)
    if (existing && existing !== slot) {
      throw new Error(`[LayerSlotRegistry] slot "${slot.slot}" already registered by a different provider`)
    }
    this.#slots.set(slot.slot, slot)

    // Announce any triggers we haven't seen before to active listeners.
    for (const t of slot.triggers) {
      if (this.#announcedTriggers.has(t)) continue
      this.#announcedTriggers.set(t, slot.slot)
      for (const listener of this.#triggerListeners) {
        try { listener(t, slot.slot) } catch { /* listener failure must not break registration */ }
      }
    }
  }

  /**
   * Subscribe to trigger announcements. The listener is fired
   * immediately for every trigger already known to the registry, then
   * for every NEW trigger as future slots register.
   *
   * Returns an unsubscribe function.
   */
  onTrigger(listener: TriggerListener): () => void {
    this.#triggerListeners.add(listener)
    // Replay already-announced triggers.
    for (const [trigger, slotName] of this.#announcedTriggers) {
      try { listener(trigger, slotName) } catch { /* ignore */ }
    }
    return () => { this.#triggerListeners.delete(listener) }
  }

  /**
   * Iterate registered slots in insertion order — for diff / debug /
   * introspection.
   */
  slots(): IterableIterator<LayerSlot> {
    return this.#slots.values()
  }

  /** Look up a single slot by name. */
  get(name: string): LayerSlot | undefined {
    return this.#slots.get(name)
  }

  /** Look up which slot owns a trigger event name. */
  slotForTrigger(trigger: string): string | undefined {
    return this.#announcedTriggers.get(trigger)
  }

  /** Union of every slot's trigger events known so far. */
  allTriggers(): readonly string[] {
    return [...this.#announcedTriggers.keys()]
  }
}

// Singleton: one instance per app, registered with window.ioc so every
// consumer (across bees, namespaces) shares it.
const _layerSlotRegistry = new LayerSlotRegistry()
window.ioc.register('@diamondcoreprocessor.com/LayerSlotRegistry', _layerSlotRegistry)
