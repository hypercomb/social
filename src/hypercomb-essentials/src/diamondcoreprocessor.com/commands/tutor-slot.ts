// diamondcoreprocessor.com/commands/tutor-slot.ts
//
// `tutor` layer slot — the explicit, first-class home for a cell's
// generated STUDY DECK.
//
// ── Why its own slot (not the `decorations` bucket) ───────────────────
//
// A study deck is the cell's PRIMARY tutor artifact, the exact analogue
// of the `website` slot for the website behaviour. Riding the polymorphic
// `decorations` slot would bury the deck behind a `kind` discriminator;
// the explicit `tutor` slot holds the deck JSON resource signature
// DIRECTLY — no envelope, no kind. The value is a flat array of 64-hex
// sigs into the resource pool; the newest entry is the current deck. This
// is the "explicit named array per concern" rule — never a shared
// catch-all, never a `{ kind, ... }` polymorphic bag.
//
// ── Read / write ──────────────────────────────────────────────────────
//
// READ: the renderer (tutor-view.drone.ts) reads `layer.tutor` FIRST,
// falling back to a `visual:tutor:deck` decoration scan so the ViewBee
// toggle-presence gate (which reads `decorations`) still lights up.
//
// WRITE: append the deck JSON's signature with the generic slot-write op
// (the generation pass does this over the bridge):
//
//     { op: 'bag-set', segments, slot: 'tutor', cells: [deckSig] }
//
// `bag-set` replaces the slot's sig array atomically and leaves every
// other slot on the cell layer untouched (one cascade to root).
//
// ── What is NOT here ──────────────────────────────────────────────────
//
// Spaced-repetition PROGRESS / session results / which-game-next are
// participant-local (localStorage), NEVER the layer — same rule as
// clipboard and viewport. Layer-state must stay identical across peers so
// the lineage signature doesn't skew; a learner's own progress is private
// and must not change the deck's identity.
//
// ── Registration ──────────────────────────────────────────────────────
//
// Registered PASSIVE (`triggers: []`): committed via `committer.update`
// directly (through `bag-set`), so no trigger event drives its commit.
// Registration declares the slot so the preloader warms it and history
// diff / introspection see it as first-class. Module-load-order
// independent via `whenReady`. Kept alive against tree-shaking by the
// renderer's import of `TUTOR_SLOT` (tutor-view.drone.ts).

import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'

/**
 * Slot name on the layer JSON. Constant so writers and the renderer
 * share one string and cross-references stay greppable.
 */
export const TUTOR_SLOT = 'tutor'

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: TUTOR_SLOT,
      triggers: [],
    })
  },
)
