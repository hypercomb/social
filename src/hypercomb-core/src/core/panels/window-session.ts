// hypercomb-core/src/core/panels/window-session.ts
//
// The tool-window SESSION — what is showing, so it can be put away and brought
// back exactly as it was.
//
// The installer covers the whole hive (an iframe overlay), but the tool windows
// dock ABOVE it (z-index 100002 vs the portal's 90000): open the installer with
// the features panel and the notes strip up and they go on floating over
// somebody else's page. The windows have to go away while we are in there — and
// they have to COME BACK when we return to the hive, because a window you put
// up is a thing you were doing, not chrome the shell may quietly discard.
//
// So this is PARKING, never closing:
//
//   park()   — stop showing, keep everything. The window announces itself shut
//              (so the Escape cascade and the control-bar lights agree with the
//              screen) but keeps its content, its scroll, its scope, its drill
//              level. A `close()` is a decision the participant made; parking
//              is one the shell made for them, and it must cost them nothing.
//   unpark() — show again, from exactly the state park() left.
//
// Windows register while OPEN and drop out when closed, so the registry is
// always "what is showing right now". Parking snapshots that set, calls park()
// on each, and holds the sessions itself — a parked window's own registration
// is gone (its DOM went with it) but the component, and therefore its state,
// lives on, so unparking has something to talk to.
//
// Shell UI: no essentials import, no IoC. Docked windows join through
// `hcDockedPanel`'s `hcSession` input; floating ones (the pinnable hover stack,
// the notes reader, the rewind window) call `holdWindow` themselves.

/** What a window has to be able to do to take part in the session.
 *
 *  `park`/`unpark` are the shell putting a window away and bringing it back.
 *  `dismiss`/`close` are ESCAPE — the participant backing out — and they are
 *  optional because a window that offers neither simply is not something Escape
 *  can act on (the pinnable hover stack registers no dismiss, and that is how it
 *  keeps its own cascade rung). */
export interface WindowSession {
  /** Stop showing, WITHOUT forgetting anything. */
  park(): void
  /** Show again, exactly as park() left it. */
  unpark(): void
  /** Unwind ONE level of my own state — a naming field, an armed mode, a drill
   *  down. Return true if the press was CONSUMED; false means "nothing of mine
   *  was open" and Escape carries on down the cascade. One level per press: a
   *  window that unwound everything at once would make Escape unpredictable. */
  dismiss?(): boolean
  /** The participant's own close verb — the same thing the × does, including
   *  whatever state that window considers itself finished with. */
  close?(): void
  /** True for the ONE surface that may share the screen with a window: the
   *  pheromone palette. It is not a view of its own — it is the paint, and
   *  marking a note means dragging from it onto the window that holds the
   *  note, which cannot happen with one of them put away. Declared here, in
   *  the same breath as park/close, so the rule (window-rule.ts) names no ids
   *  and a future palette inherits the exception by saying so. */
  companion?: boolean
}

/** A held window: its session, and how to find its element. The root is a
 *  THUNK because the element is remounted freely (parking takes the DOM with
 *  it) and a captured reference would go stale on the first park. */
interface HeldWindow {
  session: WindowSession
  root?: () => HTMLElement | null
}

/** Currently-showing windows, by id. One entry per window — a re-registration
 *  under the same id replaces the old one (a window remounting is the same
 *  window, not a second one).
 *
 *  Insertion order matters and is subtler than it looks: `Map.set` on an
 *  EXISTING key keeps the original index, so a park→unpark round trip returns a
 *  window to the rank it held before, rather than to the end. That is the
 *  wanted behaviour — say so here rather than let someone rediscover it. */
const showing = new Map<string, HeldWindow>()

/** The parked set, in the order it was parked. Empty = we are in the hive. */
let parked: { id: string; session: WindowSession }[] = []

/** Register a window as SHOWING. Call when it opens; call the returned release
 *  when it closes (or is parked — parking takes its DOM with it, and the parked
 *  list holds what it needs from then on). */
export function holdWindow(
  id: string,
  session: WindowSession,
  root?: () => HTMLElement | null,
): () => void {
  showing.set(id, { session, root })
  return () => { if (showing.get(id)?.session === session) showing.delete(id) }
}

/** The showing window that CONTAINS the focus, or null.
 *
 *  This is the whole gate behind Escape ownership. Escape used to be claimed by
 *  whichever window happened to have registered a listener, whether or not the
 *  participant was anywhere near it — so an open panel could swallow the press
 *  that was meant to cancel the tile editor or clear the selection out on the
 *  canvas. Asking "is the focus IN this window" turns that into one rule with a
 *  visible answer.
 *
 *  Windows registered without a root can never match, which is correct: a
 *  surface that does not say where it is has not claimed the keyboard. Focus on
 *  <body> (the canvas) matches nothing, so the cascade runs as if no window
 *  were open — which is exactly what the participant means by that press. */
export function focusedWindow(): { id: string; session: WindowSession } | null {
  if (typeof document === 'undefined') return null
  const active = document.activeElement
  if (!active || active === document.body) return null
  for (const [id, held] of showing) {
    const root = held.root?.()
    if (root && root.contains(active)) return { id, session: held.session }
  }
  return null
}

/** Put every showing window away. Idempotent while parked — a second call (a
 *  queued install opening behind the first, a headless portal promoting to
 *  visible) must never overwrite the remembered set with the empty one that is
 *  on screen by then. Returns how many were parked. */
export function parkWindows(): number {
  if (parked.length) return 0
  parked = [...showing].map(([id, held]) => ({ id, session: held.session }))
  for (const { session } of parked) {
    try { session.park() }
    catch (err) { console.error('[window-session] park failed:', err) }
  }
  return parked.length
}

/** Bring the parked windows back and forget the parked set. A window the
 *  participant opened WHILE parked simply stays open — unparking adds, it never
 *  closes anything. Returns how many came back. */
export function unparkWindows(): number {
  const list = parked
  parked = []
  for (const { session } of list) {
    try { session.unpark() }
    catch (err) { console.error('[window-session] unpark failed:', err) }
  }
  return list.length
}

/** Is this window on screen right now? Asked by a lane undo before it restores
 *  something: a window the participant reopened by hand while a menu was up is
 *  already back, and restoring it again would replay a decision they have
 *  already made. */
export function isWindowShowing(id: string): boolean { return showing.has(id) }

/** True while windows are put away (we are not in the hive). */
export function windowsParked(): boolean { return parked.length > 0 }

/** The ids currently parked — for tests and for anything that wants to say what
 *  is coming back. */
export function parkedWindowIds(): readonly string[] { return parked.map(p => p.id) }

/** Test seam: forget everything, park nothing. */
export function resetWindowSession(): void {
  showing.clear()
  parked = []
}

/** The common case — a window whose whole visibility IS one writable boolean
 *  signal, with an optional announcement (the `…:state` effect its control-bar
 *  light and the Escape cascade read) so the rest of the shell agrees with the
 *  screen while it is away.
 *
 *  Typed structurally rather than against Angular's `WritableSignal` so this
 *  module stays framework-free and testable with a two-line fake. */
export interface BooleanSignal { (): boolean; set(value: boolean): void }

export function signalSession(
  visible: BooleanSignal,
  announce?: (open: boolean) => void,
  /** The window's ESCAPE behaviour, when it has any. `dismiss` unwinds one
   *  level of its own state and says whether it consumed the press; `close` is
   *  its own close verb. Supplied here so a window declares its keyboard
   *  behaviour in the same breath as its session, rather than hand-rolling a
   *  listener that competes with the cascade. */
  escape?: { dismiss?: () => boolean; close?: () => void },
): WindowSession {
  return {
    park: () => { visible.set(false); announce?.(false) },
    unpark: () => { visible.set(true); announce?.(true) },
    ...(escape?.dismiss ? { dismiss: escape.dismiss } : {}),
    ...(escape?.close ? { close: escape.close } : {}),
  }
}
