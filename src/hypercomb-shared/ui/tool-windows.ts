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
// So when the focus is in NO window, the press acts on the newest showing
// tool window (window-rule.ts owns that list, in open order). Only once
// there is no window left does it fall through to the cascade's own rungs —
// cancel the editor, clear the selection, unstick the InputGate — exactly as
// it did before any panel opened.
//
// Two verbs, innermost first:
//   dismissFocused() — unwind ONE level: the open settings popover if there is
//                      one, otherwise the window's own `dismiss()` (a naming
//                      field, an armed mode, a drill-down).
//   closeFocused()   — the window's own close verb, once nothing is left inside
//                      it to unwind.
//
// They are separate rungs in the cascade with the SELECTION CLEAR between them,
// which is the whole reason this is two calls and not one: backing out of a
// panel's inner state should never cost you a selection, and closing a window
// should never happen while you still have one to clear.
//
// Why a facade and not direct imports: `escape-cascade.ts` lives in essentials,
// and modules must never import from shared. It resolves this through IoC the
// same way it already resolves the tile editor drone. And why not put the
// registration in window-session.ts: that file declares itself framework-free
// and IoC-free, and it stays that way — it owns the FACTS (who is showing, who
// has the focus); this owns the POLICY.

import { newestToolWindow } from './window-rule'
import { focusedWindow, type WindowSession } from './window-session'

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
  /** Unwind one level of whatever the focus is in. True = press consumed. */
  dismissFocused(): boolean
  /** Close the window the focus is in. True = press consumed. */
  closeFocused(): boolean
}

export const TOOL_WINDOWS_IOC_KEY = '@hypercomb.social/ToolWindows'

/** The window this press is about: the one the focus is in, or — when the
 *  focus is in none of them — the last one opened. */
const target = (): { id: string; session: WindowSession } | null =>
  focusedWindow() ?? newestToolWindow()

const api: ToolWindowsApi = {
  dismissFocused(): boolean {
    // Innermost first — a popover belongs to a window, so it backs out before
    // the window does. It is checked without consulting focus because it IS the
    // focused thing whenever it is open (the popover takes focus on open).
    if (popoverDismisser?.() === true) return true
    return target()?.session.dismiss?.() === true
  },

  closeFocused(): boolean {
    const hit = target()
    if (!hit?.session.close) return false
    hit.session.close()
    return true
  },
}

// Self-registering side effect, imported from the shell bootstrap — the same
// shape every other shell service uses. Guarded because both shells run the
// bootstrap and a double import must not mint a second object.
const ioc = (globalThis as { ioc?: { register(key: string, value: unknown): void; get(key: string): unknown } }).ioc
if (ioc && !ioc.get(TOOL_WINDOWS_IOC_KEY)) ioc.register(TOOL_WINDOWS_IOC_KEY, api)

export { api as toolWindows }
