// hypercomb-shared/ui/window-session.ts
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

/** What a window has to be able to do to take part in the session. */
export interface WindowSession {
  /** Stop showing, WITHOUT forgetting anything. */
  park(): void
  /** Show again, exactly as park() left it. */
  unpark(): void
}

/** Currently-showing windows, by id. One entry per window — a re-registration
 *  under the same id replaces the old one (a window remounting is the same
 *  window, not a second one). */
const showing = new Map<string, WindowSession>()

/** The parked set, in the order it was parked. Empty = we are in the hive. */
let parked: { id: string; session: WindowSession }[] = []

/** Register a window as SHOWING. Call when it opens; call the returned release
 *  when it closes (or is parked — parking takes its DOM with it, and the parked
 *  list holds what it needs from then on). */
export function holdWindow(id: string, session: WindowSession): () => void {
  showing.set(id, session)
  return () => { if (showing.get(id) === session) showing.delete(id) }
}

/** Put every showing window away. Idempotent while parked — a second call (a
 *  queued install opening behind the first, a headless portal promoting to
 *  visible) must never overwrite the remembered set with the empty one that is
 *  on screen by then. Returns how many were parked. */
export function parkWindows(): number {
  if (parked.length) return 0
  parked = [...showing].map(([id, session]) => ({ id, session }))
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
): WindowSession {
  return {
    park: () => { visible.set(false); announce?.(false) },
    unpark: () => { visible.set(true); announce?.(true) },
  }
}
