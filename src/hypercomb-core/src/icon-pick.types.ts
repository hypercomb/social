// hypercomb-core/src/icon-pick.types.ts
//
// THE ICON-PICK CONTRACT — how any surface asks the shell for an icon.
//
// The chooser itself is a shell component (hypercomb-shared/ui/icon-picker),
// but the protocol is a first-class EffectBus contract so ANY window can plug
// into it: Angular panels, framework-free custom elements, and drone modules
// alike (a module can't import from shared, but it can emit these events and
// import these types from core).
//
// The exchange is one request, exactly one result:
//
//   emit  ICON_PICK_REQUEST  { id, store?, filter?, title? }
//   →     ICON_PICK_RESULT   { id, name }        name = null ⇒ cancelled
//
// A request is ALWAYS settled — choosing, closing the chooser, and being
// superseded by another request all emit the result event exactly once, so a
// caller never has to watch `icon:picker-open` to guess whether the user
// walked away. (That workaround is what this contract replaces.)
//
// The result is emitted TRANSIENTLY (EffectBus.emitTransient), never stored
// as a last value: a completion signal that replays to late subscribers would
// settle the NEXT request before the chooser even opened. Subscribe before
// you emit the request.
//
// TWO MODES, chosen by `store`:
//   store !== false (default) — write-through. The pick is saved as that
//     element's icon override (IconOverrideStore) and every surface
//     re-resolves live. This is the universal icon protocol: the `id` is a
//     real element id.
//   store === false — borrow. Nothing is written; the name comes back on the
//     result event and the CALLER decides what it means. The `id` is just a
//     correlation token. Used by surfaces that keep icons in their own
//     content (the notes mark palette, docked-panel group icons).
//
// Shared/Angular callers should prefer the `requestIconPick()` promise helper
// in hypercomb-shared/core/icon-pick.ts over wiring these events by hand.

export const ICON_PICK_REQUEST = 'icon:pick-request'
export const ICON_PICK_RESULT = 'icon:pick-result'

/** Broadcast whenever the chooser opens or closes. Surfaces use it to get
 *  out of the way (z-index, focus, suppressing their own Escape handling) —
 *  it is NOT a completion signal; use ICON_PICK_RESULT for that. */
export const ICON_PICKER_OPEN = 'icon:picker-open'

export type IconPickRequest = {
  /** Correlation token, echoed on the result. In write-through mode this IS
   *  the element id whose override gets written. */
  id: string
  /** Per-CALL correlation, echoed on the result. `id` alone is not enough:
   *  a window that reuses one id (a palette's "add an icon" button) can have
   *  a second request supersede the first, and both awaiters would otherwise
   *  match the same result. Awaiting callers must send one; the helper does
   *  it for you. Fire-and-forget emitters can omit it. */
  token?: string
  /** false = borrow mode: don't write an override, just report the pick. */
  store?: boolean
  /** Pre-seed the chooser's search box (e.g. 'arrow' for a direction icon). */
  filter?: string
  /** Chooser heading, shown verbatim in place of the default. Already-
   *  localized text — the chooser does not translate it. */
  title?: string
}

export type IconPickResult = {
  /** The `id` from the request this settles. */
  id: string
  /** The `token` from the request this settles, when it carried one. */
  token?: string
  /** Material symbol name, or null when the user cancelled. */
  name: string | null
}

export type IconPickerOpen = { open: boolean }
