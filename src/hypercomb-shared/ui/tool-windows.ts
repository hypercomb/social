// hypercomb-shared/ui/tool-windows.ts
//
// ESCAPE HAS ONE OWNER: the cascade. This is the door it knocks on.
//
// Every tool window used to claim Escape for itself. Most bound it to their own
// root, so it only fired when the focus was already inside — which, for a window
// opened by slash command or by a tile action, it never was. Two windows went
// the other way and registered WINDOW-CAPTURE listeners that called
// `stopImmediatePropagation()`, so while either was open Escape stopped
// cancelling the tile editor, stopped clearing the selection, and stopped the
// InputGate's force-clear — the shell's last recovery. Both halves of that are
// the same mistake: a window deciding what a global key means.
//
// The dock lane made it sharper. An edge holds more than one window now, so the
// capture listeners were not just outranking the cascade, they were swallowing a
// SIBLING's presses.
//
// So there is one rule, and it has two halves:
//
//     ESCAPE MEANS "SHOW ME THE HEXAGONS AGAIN".
//     Focus decides WHICH window it takes away; the newest decides when
//     focus decides nothing.
//
// Focus inside a window means that window unwinds one level, and only that
// window — a press inside a panel belongs to that panel, never to a sibling.
// That half has not changed and is the whole reason this file exists.
//
// The second half is what the focus rule alone got wrong. A window opened by
// a SLASH COMMAND leaves the focus on `<body>` (measured: `activeElement` is
// BODY right after `/tutorial`), so "the window the focus is in" was null for
// exactly the windows most likely to be open. You pressed Escape over a panel
// covering the hive and nothing happened — not the cascade's own rungs
// either, because there was no editor and no selection to clear. The key did
// nothing at all, which is the one thing Escape may never do.
//
// So when the focus is in no window, the press is not about any ONE of them:
// it takes away EVERYTHING that is up. One press, the whole screen back to the
// tiles — not a ladder you climb down a rung per press. What is up is rarely
// just one thing (the one-window rule leaves a companion palette beside it, a
// pinned card floats over both, the notes reader is its own surface), and
// making the participant press four times to see their hive again is the same
// complaint as the key doing nothing.
//
// Two verbs:
//   dismissFocused() — unwind ONE level of the window the focus is INSIDE: its
//                      open settings popover, else its own `dismiss()` (a
//                      naming field, an armed mode, a drill-down). Focus only.
//                      A press inside a field belongs to that field; a press
//                      anywhere else does not, and falls to the sweep.
//   putAwayAll()     — put away EVERY surface that is showing, and hand back
//                      the way to bring them all back.
//
// ── WHY IT PARKS AND DOES NOT CLOSE ────────────────────────────────────────
//
// Escape is no longer a one-way door. The cascade REMEMBERS what the press
// took away and puts it back if the very next press follows immediately — so
// what Escape does has to be reversible, and parking is exactly that verb,
// already built and already used by the installer: "stop showing, keep
// everything; show again from exactly the state park() left"
// (window-session.ts). Closing is a decision the participant made, and it keeps
// the button they made it with: the ×.
//
// Parking is also why the sweep can be indiscriminate. It costs nothing: the
// naming field you were half way through, the drill level, the armed brush,
// the tile the reader was on — all of it is still there, and the press after
// brings the whole screen back exactly as it was. A `close()` sweep would have
// to be careful about what it took; this one does not.
//
// Why a facade and not direct imports: `escape-cascade.ts` lives in essentials,
// and modules must never import from shared. It resolves this through IoC the
// same way it already resolves the tile editor drone. And why not put the
// registration in window-session.ts: that file declares itself framework-free
// and IoC-free, and it stays that way — it owns the FACTS (who is showing, who
// has the focus); this owns the POLICY.

import { focusedWindow, isWindowShowing, showingWindows } from './window-session'

/** How the popover half arrives — INVERTED, so this file stays framework-free.
 *
 *  It used to `import { dismissOpenPopover }` from the Angular docked-panel
 *  directive, which dragged @angular/core into every importer of this module.
 *  That is fine inside an Angular shell and fatal outside one: the shim boots
 *  the same runtime-initializer, and Angular's field decorators throw
 *  "not supported in JIT mode" the moment the directive module evaluates.
 *
 *  So the panel kit REGISTERS its dismisser instead of being imported for it.
 *  Ordering is safe by construction — the only thing that can open a popover
 *  is the kit itself, so no popover can exist before its module has evaluated
 *  and registered. No registration means no popovers, and `false` is the
 *  correct answer. The element kit registers here too when it lands. */
let popoverDismisser: (() => boolean) | null = null

/** Called at module scope by whichever panel kit owns popovers. */
export const setPopoverDismisser = (dismiss: () => boolean): void => {
  popoverDismisser = dismiss
}

/** The IoC contract. Kept structural so essentials can type it without
 *  importing shared. */
export interface ToolWindowsApi {
  /** Unwind one level of the window the focus is INSIDE. True = press
   *  consumed. */
  dismissFocused(): boolean
  /** Put away EVERY showing surface, and hand back the way to bring them all
   *  back exactly as they were. Null = nothing was showing. */
  putAwayAll(): (() => boolean) | null
  /** The door the cascade knocked on before Escape could be taken back. Kept
   *  because essentials is loaded at RUNTIME from a signed bundle that may be
   *  older than the shell it lands in, and an Escape that throws is worse than
   *  an Escape that does not remember. */
  closeFocused(): boolean
}

export const TOOL_WINDOWS_IOC_KEY = '@hypercomb.social/ToolWindows'

const putAwayAll = (): (() => boolean) | null => {
  // Snapshotted BEFORE the first park, because parking drops each surface out
  // of the very registry being walked.
  const up = showingWindows()
  if (!up.length) return null
  for (const { session } of up) {
    try { session.park() }
    catch (err) { console.error('[tool-windows] park failed:', err) }
  }
  return () => {
    // Only what is still away. A surface the participant opened again by hand
    // is already back, and bringing it back would replay a decision they have
    // already made — the same question the lane's undo asks. The whole
    // put-back counts as landed if ANY of them returned.
    let landed = false
    for (const { id, session } of up) {
      if (isWindowShowing(id)) continue
      try { session.unpark(); landed = true }
      catch (err) { console.error('[tool-windows] unpark failed:', err) }
    }
    return landed
  }
}

const api: ToolWindowsApi = {
  dismissFocused(): boolean {
    // Innermost first — a popover belongs to a window, so it backs out before
    // the window does. It is checked without consulting focus because it IS the
    // focused thing whenever it is open (the popover takes focus on open).
    if (popoverDismisser?.() === true) return true
    // FOCUS ONLY. A press inside a window's own field belongs to that field;
    // a press anywhere else is not about one window at all, and falls through
    // to the sweep, which takes the lot.
    return focusedWindow()?.session.dismiss?.() === true
  },

  putAwayAll,

  closeFocused(): boolean {
    return putAwayAll() !== null
  },
}

// Self-registering side effect, imported from the shell bootstrap — the same
// shape every other shell service uses. Guarded because both shells run the
// bootstrap and a double import must not mint a second object.
//
// AND RETRIED, because module evaluation order is not something this file can
// see. `window.ioc` is installed by `ioc.web` at ITS evaluation, so a shell
// that imports this line above that one evaluates this with no ioc to register
// into — and the registration was skipped in silence. That is not a small
// miss: with no door on the wall, every window rung of the Escape cascade is
// dead, and the key does nothing at all over a panel covering the hive, which
// is the one thing it may never do (it happened, in hypercomb-dev). Module
// evaluation is synchronous and drains before microtasks, so by the time this
// one runs every shell import has had its say.
const register = (): boolean => {
  const ioc = (globalThis as { ioc?: { register(key: string, value: unknown): void; get(key: string): unknown } }).ioc
  if (!ioc) return false
  if (!ioc.get(TOOL_WINDOWS_IOC_KEY)) ioc.register(TOOL_WINDOWS_IOC_KEY, api)
  return true
}
if (!register()) queueMicrotask(register)

export { api as toolWindows }
