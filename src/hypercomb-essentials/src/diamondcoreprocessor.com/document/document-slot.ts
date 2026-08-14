// diamondcoreprocessor.com/document/document-slot.ts
//
// `document` layer slot — the explicit, first-class home for a cell's
// long-form BODY.
//
// ── Why source-agnostic ───────────────────────────────────────────────
//
// The slot holds a document, not "a Google Doc". Where the body CAME from
// is recorded separately (a `visual:google:doc` decoration marks the tile,
// and the sync record in the sign('google:docs') pool remembers which
// remote it mirrors). That split is deliberate: the editor works on any
// document, and Google is one adapter behind it rather than a branch
// inside it. A second source later adds a mark and a record — never a
// change to this slot or to the view that reads it.
//
// Same rule as `tutor` / `website`: an explicit named array per concern,
// never the polymorphic `decorations` bucket, never a `{ kind, ... }` bag.
// The value is a flat array of 64-hex sigs into the resource pool; the
// NEWEST entry is the current body.
//
// ── Why the history comes free ────────────────────────────────────────
//
// A save writes new bytes, which mints a new signature, which is a new
// slot value, which is a new layer — so every edit is already a history
// entry. Undo, time-travel and version history need no document-specific
// machinery; they are the ordinary lineage behaviours applied to ordinary
// hive content. This is the whole reason the body lives in a slot instead
// of being fetched from Google on open.
//
// ── Read / write ──────────────────────────────────────────────────────
//
// READ: document-view.drone.ts reads `layer.document`, newest sig last.
//
// WRITE: replace the slot atomically with the generic slot-write op —
//
//     { op: 'bag-set', segments, slot: 'document', cells: [bodySig] }
//
// which leaves every other slot on the cell layer untouched.
//
// ── What is NOT here ──────────────────────────────────────────────────
//
// SYNC STATE (which remote this mirrors, the version last pulled, the sig
// Google's copy corresponds to) is participant-local and lives in the
// sign('google:docs') pool — NEVER the layer. Same rule that keeps tutor
// progress and clipboard out of layers: layer state must be identical
// across peers or the lineage signature skews, and a peer who receives
// this document shares the text but emphatically not your Google account.
//
// ── Registration ──────────────────────────────────────────────────────
//
// Registered PASSIVE (`triggers: []`): committed directly through
// `bag-set`, so no trigger event drives its commit. Registration declares
// the slot so the preloader warms it and history diff sees it as
// first-class. Module-load-order independent via `whenReady`; kept alive
// against tree-shaking by the view's import of `DOCUMENT_SLOT`.

import type { LayerSlotRegistry } from '../history/layer-slot-registry.js'

/**
 * Slot name on the layer JSON. Constant so writers and the view share one
 * string and cross-references stay greppable.
 */
export const DOCUMENT_SLOT = 'document'

;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<LayerSlotRegistry>(
  '@diamondcoreprocessor.com/LayerSlotRegistry',
  (slotRegistry) => {
    slotRegistry.register({
      slot: DOCUMENT_SLOT,
      triggers: [],
    })
  },
)
