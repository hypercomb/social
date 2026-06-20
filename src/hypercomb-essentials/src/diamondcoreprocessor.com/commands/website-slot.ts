// diamondcoreprocessor.com/commands/website-slot.ts
//
// `website` layer slot — the explicit, first-class home for a cell's
// rendered website page(s).
//
// ── Why its own slot (not the `decorations` bucket) ───────────────────
//
// A website page is the cell's PRIMARY artifact, not a generic
// decoration. Riding the polymorphic `decorations` slot (records of
// `{ kind, appliesTo, payload }` discriminated at read time by a `kind`
// string) buries the page behind a mini type-system. The explicit
// `website` slot holds the page's HTML resource signature DIRECTLY — no
// envelope, no kind discriminator. The value is a flat array of 64-hex
// sigs into `__resources__`; the newest entry is the current page. This
// is the "explicit named array per concern" rule: every stateful concern
// gets its own named slot, never a shared catch-all. (No `Artifact`
// suffix — every slot's value is already a signature artifact.)
//
// ── Read / write ──────────────────────────────────────────────────────
//
// READ: the renderer (site-view.drone.ts) reads `layer.website` FIRST,
// falling back to the legacy `decorations` / `context` scans so
// already-built sites keep rendering during migration.
//
// WRITE: append the page HTML's signature with the existing generic
// slot-write op — no bespoke op needed:
//
//     { op: 'bag-set', segments, slot: 'website', cells: [htmlSig] }
//
// `bag-set` replaces the slot's sig array atomically and leaves every
// other slot on the cell layer untouched (one cascade to root).
//
// ── Registration ──────────────────────────────────────────────────────
//
// Registered PASSIVE (`triggers: []`): the slot is committed via
// `committer.update` directly (through `bag-set`), so no trigger event
// drives its commit. Registration declares the slot so the preloader
// warms it and history diff / introspection see it as a first-class
// field. The slot's VALUE is already safe without registration —
// `canonicalizeLayer` is slot-agnostic and the 2-arg `committer.update`
// merges — so timing is non-critical. Module-load-order independent via
// `whenReady`. Kept alive against tree-shaking by the renderer's import
// of `WEBSITE_SLOT` (site-view.drone.ts).

import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'

/**
 * Slot name on the layer JSON. Constant so writers and the renderer
 * share one string and cross-references stay greppable.
 */
export const WEBSITE_SLOT = 'website'

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: WEBSITE_SLOT,
      triggers: [],
    })
  },
)
