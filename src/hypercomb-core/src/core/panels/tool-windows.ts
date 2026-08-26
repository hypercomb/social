// hypercomb-core/src/core/panels/tool-windows.ts
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
// So there is one rule, and it is a question about FOCUS:
//
//     Escape acts on the window the focus is in. Nothing else.
//
// Focus on the canvas means no window is involved — the press belongs to the
// cascade's own rungs (cancel the editor, clear the selection, unstick the
// InputGate), exactly as it did before any panel opened. Focus inside a window
// means that window unwinds one level, and only that window.
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

import { focusedWindow } from './window-session.js'

// INVERSION (the move to core): the popover dismisser used to be imported
// from the Angular docked-panel directive — a policy file reaching into
// chrome. Now every live docked-panel implementation (the Angular directive
// serving un-converted panels, the custom-element kit as panels convert)
// REGISTERS its dismisser here; Escape's popover rung asks each in turn.
const popoverDismissers = new Set<() => boolean>()
export function addPopoverDismisser(fn: () => boolean): () => void {
  popoverDismissers.add(fn)
  return () => { popoverDismissers.delete(fn) }
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

/** Transient EffectBus announce: a settings popover opened in SOME docked-
 *  panel implementation ({ owner: panel id }). Every implementation closes
 *  its own popovers on hearing another owner — one popover at a time across
 *  the whole docked column, whichever kit drew it. */
export const PANEL_SETTINGS_OPENED = 'panel:settings-opened'

const api: ToolWindowsApi = {
  dismissFocused(): boolean {
    // Innermost first — a popover belongs to a window, so it backs out before
    // the window does. It is checked without consulting focus because it IS the
    // focused thing whenever it is open (the popover takes focus on open).
    for (const dismiss of popoverDismissers) if (dismiss()) return true
    return focusedWindow()?.session.dismiss?.() === true
  },

  closeFocused(): boolean {
    const hit = focusedWindow()
    if (!hit?.session.close) return false
    hit.session.close()
    return true
  },
}

/** Register into the live IoC map when one exists (core also runs in node). */
export const ensureToolWindowsRegistered = (): void => {
  const ioc = (globalThis as unknown as {
    ioc?: { has?: (k: string) => boolean; register?: (k: string, v: unknown) => void }
  }).ioc
  if (!ioc?.has?.(TOOL_WINDOWS_IOC_KEY)) {
    ioc?.register?.(TOOL_WINDOWS_IOC_KEY, api)
  }
}
ensureToolWindowsRegistered()

export { api as toolWindows }
