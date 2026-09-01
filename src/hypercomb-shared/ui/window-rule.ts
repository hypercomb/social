// hypercomb-shared/ui/window-rule.ts
//
// ONE WINDOW AT A TIME.
//
// A tool window is a VIEW — it is the thing you are doing. Two of them side by
// side means neither is, and the shell had no rule about it: the dock lane
// held two per EDGE and the two edges never spoke, so four windows could stack
// up, and the ones that opt out of the lane (the notes DESK in fullscreen, and
// every panel on a phone, where it is a full-bleed sheet) were not counted at
// all. Opening notes over a hive that already had history, sequence and the
// palette up left all four showing.
//
// So opening a window puts the others away. It PARKS them rather than closing
// them — the shell is making this decision, not the participant, so it must
// cost nothing (window-session.ts draws exactly that line, and the pheromone
// palette's staged scenting is precisely what a close would throw away).
//
// ONE surface is allowed to stay, and it is not a window: the PHEROMONE
// PALETTE. It is not a view of its own — it is the PAINT, the source you drag
// marks from onto whatever is open, and marking a note needs both on screen at
// once. It says so itself with `companion: true` on its session, so the rule
// names no ids and a future palette inherits the exception by declaring it.
//
// The exception is spent when there is no room for two: on a phone every panel
// is a full-bleed sheet, so a companion would be a second slab laid over the
// first. There the newest arrival owns the screen alone — the same question
// the dock lane already answers for positioning, asked once, in one place.
//
// This registry holds TOOL WINDOWS only — the surfaces `hcDockedPanel` mounts.
// The window SESSION registry is deliberately wider (a pinned hover card joins
// it so Escape and the installer treat it properly), and a pinned card is not
// a view competing for the screen. Widening the rule to everything the session
// knows about would close cards nobody asked to close.

import { laneCapacity } from './docked-panel/dock-lanes'
import type { WindowSession } from './window-session'

/** Showing tool windows, in the order they opened. A re-registration under the
 *  same id replaces the entry and keeps its rank (`Map.set` on an existing key
 *  does not reorder) — a window remounting is the same window. */
const windows = new Map<string, WindowSession>()

/** Join the rule as a showing tool window, and enforce it. Returns the release
 *  to call when the window goes (closed OR parked — either way it has stopped
 *  showing). Mirrors `holdWindow`'s shape, and is called beside it. */
export function holdToolWindow(id: string, session: WindowSession): () => void {
  windows.set(id, session)
  enforce(id)
  return () => { if (windows.get(id) === session) windows.delete(id) }
}

/** Who may stay on screen now that `openedId` has opened. Exported for the
 *  spec, and because the answer is worth being able to ask. */
export function windowsToKeep(openedId: string): Set<string> {
  const keep = new Set<string>()
  if (!windows.has(openedId)) return keep
  keep.add(openedId)
  if (laneCapacity() <= 1) return keep

  // The arriving window keeps the palette; the arriving PALETTE keeps the
  // window it is there to paint on. `.pop()` takes the most recent of its
  // kind, which after this rule has been in force is the only one.
  const arrivingIsPalette = windows.get(openedId)?.companion === true
  const spared = [...windows]
    .filter(([id, session]) =>
      id !== openedId && (session.companion === true) !== arrivingIsPalette)
    .pop()
  if (spared) keep.add(spared[0])
  return keep
}

/** Put away everyone the rule does not keep.
 *
 *  DEFERRED to a microtask: the registration happens inside the opening
 *  window's own `ngOnInit`, and parking a sibling writes that sibling's
 *  visibility signal — a component's state changing under a change-detection
 *  pass it is not part of. The same reason `#scheduleLaneClaim` defers, and
 *  still before paint, so nothing is seen doubled up.
 *
 *  COALESCED: several windows can register in one turn (a restore bringing
 *  back what the installer parked, a window arriving with its pair), and a
 *  sweep per registration would park the losers once each and announce it
 *  every time. One sweep, on the LATEST arrival — which is also the right
 *  answer, since the newest arrival is the one that owns the screen.
 *
 *  Re-read inside the microtask rather than captured outside it: the opening
 *  window may already be gone by then, and a window that closed in between
 *  must not be parked from under its own teardown. */
let pending: string | null = null
let sweeping = false

function enforce(openedId: string): void {
  pending = openedId
  if (sweeping) return
  sweeping = true
  queueMicrotask(() => {
    sweeping = false
    const arrived = pending
    pending = null
    if (!arrived || !windows.has(arrived)) return
    const keep = windowsToKeep(arrived)
    for (const [id, session] of [...windows]) {
      if (keep.has(id)) continue
      try { session.park() }
      catch (err) { console.error('[window-rule] park failed:', err) }
    }
  })
}

/** Test seam: forget every window without touching one. */
export function resetWindowRule(): void { windows.clear() }

/** The showing tool windows, in open order — for tests and for anything that
 *  wants to say what is up. */
export function toolWindowIds(): readonly string[] { return [...windows.keys()] }

/** The showing tool window Escape acts on when the focus is in none of them —
 *  the last one opened, because the last thing you opened is the first thing
 *  Escape should take away.
 *
 *  This exists because ESCAPE MEANS "SHOW ME THE HEXAGONS AGAIN". A window
 *  opened by a slash command leaves the focus on `<body>`, so a focus-only
 *  rule answered "no window is involved" for exactly the windows most likely
 *  to be open — you pressed Escape over a panel covering the hive and nothing
 *  happened. Focus still WINS when there is any (a press inside a window
 *  belongs to that window, never to a sibling); this is the fallback for when
 *  there is none. */
export function newestToolWindow(): { id: string; session: WindowSession } | null {
  let last: { id: string; session: WindowSession } | null = null
  for (const [id, session] of windows) last = { id, session }
  return last
}
