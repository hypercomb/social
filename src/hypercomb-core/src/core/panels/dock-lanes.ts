// hypercomb-shared/ui/docked-panel/dock-lanes.ts
//
// The dock LANE — how many tool windows a screen edge holds, and where each
// one sits.
//
// A lane used to hold exactly ONE. A window arriving on a side closed whatever
// was already there, and that single rule cost two things:
//
//   • A whole class of gesture became impossible. Dragging a pheromone from
//     the pheromone panel onto a row of the notes window needs BOTH windows on
//     screen at once — and the drop code for it was already written on both
//     ends (tags-viewer resolves `data-pheromone-note` ahead of the hex map;
//     the notes strip and the reader both advertise it). The feature was
//     built and unreachable.
//   • The shell threw away work it never announced. The displaced window was
//     sent through its own `close()` — the participant's "I'm done with this"
//     path — which for the pheromone panel discards staged scenting, since
//     `Done` is the only save.
//
// So: a lane holds LANE_SLOTS windows, stacked inward from the edge in the
// order they were opened. The first sits flush against the edge; the next sits
// just inboard of it. A window arriving at a FULL lane pushes out the OLDEST,
// and pushing out is a PARK, never a close — the shell made that decision, so
// it must cost the participant nothing (see window-session.ts, which already
// draws exactly this distinction).
//
// Offsets are recomputed from LIVE widths, so drag-resizing the outer window
// slides the inner one along with it, and closing the outer one lets the inner
// slide flush to the edge instead of leaving a gap.
//
// Narrow viewports get ONE slot. Two panels side by side need room for both
// plus enough hive to be worth looking at; below that a second window would be
// two slabs and no hive. The lane shrinks on resize, parking the oldest.
//
// Module scope, no service — the directive is already self-contained chrome,
// exactly as panel-groups.ts is for the group text.

import { EffectBus } from '../../effect-bus.js'
import { isPhoneViewport } from './breakpoints.js'

export type LaneSide = 'left' | 'right'

/** Windows per edge on a viewport with room for them. */
export const LANE_SLOTS = 2

/** Below this viewport width an edge holds ONE window. Two minimum-width
 *  panels (260–300px each) plus a usable strip of hive do not fit under it. */
export const TWO_LANE_MIN_WIDTH = 900

/** What a window has to be able to do to take part in a lane. The directive
 *  implements this; nothing else in the shell needs to know the lane exists. */
export interface LaneMember {
  /** Which edge this window docks against. */
  readonly laneSide: LaneSide
  /** Stable window id — so an undo can tell whether this window came back on
   *  its own before the undo was spent. */
  readonly laneId: string
  /** Current outer width in px — what the next window inboard is offset by. */
  laneWidth(): number
  /** Sit this far in from the edge (0 = flush). */
  placeInLane(offset: number): void
  /** Pushed out of a full lane. PARK — keep everything, stop showing. */
  evictFromLane(): void
  /** Come back from a park the shell owes an undo for (`clearLane`). Remounting
   *  is what re-places it — `ngOnInit` claims a place the ordinary way. */
  returnToLane(): void
}

/** Occupants per side, OLDEST FIRST. Position in the array IS the position in
 *  the lane: index 0 sits flush to the edge, each later one further inboard. */
const lanes: Record<LaneSide, LaneMember[]> = { left: [], right: [] }

/** How many windows this edge holds right now.
 *
 *  TWO questions, deliberately not written as one threshold:
 *    • `isPhoneViewport` — is the shell in SHEET mode, where a window takes the
 *      whole screen? A landscape phone (932×430) is wide by any desktop measure
 *      and still has no room: two occupants there are two full-bleed sheets
 *      laid on top of each other, with registration order deciding which one
 *      you can see.
 *    • `TWO_LANE_MIN_WIDTH` — is there horizontal room for two docked panels
 *      AND a strip of hive worth looking at?
 *  A width-only test answers the second and silently gets the first wrong. */
export const laneCapacity = (): number => {
  if (typeof window === 'undefined') return LANE_SLOTS
  if (isPhoneViewport()) return 1
  return window.innerWidth < TWO_LANE_MIN_WIDTH ? 1 : LANE_SLOTS
}

/** Recompute every occupant's distance from the edge. Widths are read live, so
 *  this is also the resize path — the inner window tracks the outer one's grip
 *  as it is dragged. */
export const layoutLane = (side: LaneSide): void => {
  let offset = 0
  for (const member of lanes[side]) {
    member.placeInLane(offset)
    offset += Math.max(0, member.laneWidth())
  }
  // PLACING A WINDOW MOVES IT WITHOUT RESIZING IT.
  //
  // What a window reserves of the screen edge is measured from where it sits,
  // so the inner occupant of a two-window lane is wrong the moment the outer
  // one is dragged wider or closed — it slides, at exactly the same size, and
  // a ResizeObserver has nothing to report. Left alone it went on reserving
  // the edge it held before, which covers the surface when the lane grows and
  // strands a dead strip beside the window when the lane shrinks.
  //
  // We cannot say what the new reservation is; only that everything here has
  // been put somewhere. Asking is the whole message.
  EffectBus.emitTransient('viewport:inset-poll', {})
}

/** Take a place in the lane. Already in it → just re-layout (a width changed).
 *  Lane full → the OLDEST occupant is parked to make room, and the arriving
 *  window takes the innermost place. */
export const claimLane = (member: LaneMember): void => {
  const side = member.laneSide
  const lane = lanes[side]
  if (lane.includes(member)) { layoutLane(side); return }

  lane.push(member)
  const capacity = laneCapacity()
  const pushedOut = lane.length > capacity ? lane.splice(0, lane.length - capacity) : []

  // Place the survivors BEFORE parking anyone: a parked window unmounts, and
  // the survivors should already be sitting where they belong when it goes.
  layoutLane(side)
  for (const evicted of pushedOut) evicted.evictFromLane()
}

/** Leave the lane — closed, parked, or un-docked to float. Whoever is left
 *  slides outward to close the gap. */
export const releaseLane = (member: LaneMember): void => {
  const side = member.laneSide
  const lane = lanes[side]
  const at = lane.indexOf(member)
  if (at < 0) return
  lane.splice(at, 1)
  layoutLane(side)
}

/** The occupants of an edge, outermost first — for tests and for anything that
 *  wants to say what is on screen. */
export const laneOccupants = (side: LaneSide): readonly LaneMember[] => [...lanes[side]]

/** Clear an edge because an INTERFACE is about to open over it — an anchored
 *  rail picker (the recent-portals list, the course picker, the fit flyout) or
 *  any overlay that belongs to that side. Same-side only: the other edge's
 *  windows are not in the way and are not touched.
 *
 *  Every occupant is PARKED, never closed — `evictFromLane` already draws that
 *  line (the shell made this decision, so it must cost the participant
 *  nothing; a window with no session of its own falls back to its close, the
 *  only thing such a window can do). The windows do not auto-return when the
 *  interface goes: reopening one from the rail restores whatever it held. */
export const clearLane = (side: LaneSide): number => {
  const lane = lanes[side]
  if (lane.length === 0) return 0
  const out = lane.splice(0, lane.length)
  for (const member of out) member.evictFromLane()
  return out.length
}

/** Clear an edge and hand back the UNDO.
 *
 *  `clearLane` alone is a borrow with no return: a rail flyout takes the side,
 *  parks whatever was there, and nothing ever brings it back — and because the
 *  park goes through the member directly, `unparkWindows()` cannot reach it
 *  either. A window put away by a menu opening should come back when that menu
 *  closes; anything else is the shell keeping what it borrowed.
 *
 *  The closure is SPENT ONCE and skips any window that is already back (the
 *  participant may have reopened it by hand while the menu was up — restoring
 *  it again would be a second copy of a decision they already made).
 *
 *  Deliberately NOT extended to `claimLane` eviction: there the participant
 *  caused the displacement by opening something, and auto-resurrecting would
 *  mean closing a window opens a window. */
export const clearLaneWithUndo = (side: LaneSide, isShowing?: (id: string) => boolean): (() => void) => {
  const lane = lanes[side]
  if (lane.length === 0) return () => {}
  const out = lane.splice(0, lane.length)
  for (const member of out) member.evictFromLane()
  let spent = false
  return () => {
    if (spent) return
    spent = true
    for (const member of out) {
      if (isShowing?.(member.laneId)) continue
      try { member.returnToLane() }
      catch (err) { console.error('[dock-lanes] returnToLane failed:', err) }
    }
  }
}

/** Is there a free place on this edge? Asked before a window brings its PAIR up
 *  alongside it: a pairing may fill an empty slot, but it must never push a
 *  third window out. The participant opened that one; the pairing is a
 *  convenience, and a convenience does not get to close someone's work. */
export const laneHasRoom = (side: LaneSide): boolean => lanes[side].length < laneCapacity()

/** Test seam: empty both lanes without touching their members. */
export const resetLanes = (): void => { lanes.left = []; lanes.right = [] }

/** Re-check capacity after a viewport change. Crossing below the two-slot
 *  width parks the oldest on each edge rather than leaving two slabs on a
 *  screen with no room for them. */
export const reflowLanes = (): void => {
  const capacity = laneCapacity()
  for (const side of ['left', 'right'] as LaneSide[]) {
    const lane = lanes[side]
    const pushedOut = lane.length > capacity ? lane.splice(0, lane.length - capacity) : []
    layoutLane(side)
    for (const evicted of pushedOut) evicted.evictFromLane()
  }
}

// `typeof window !== 'undefined'` is NOT the browser test, and believing it was
// broke every node-environment spec the moment this file moved into core: core
// is barrel-exported, so importing ANYTHING from '@hypercomb/core' now runs this
// module, and a node test harness that defines a bare `window` global — several
// do — reached `window.addEventListener` and found it was not a function.
//
// Ask for the capability being used, not for the object that usually carries it.
// A module in core is imported by every shell, every module, the shim, and the
// specs; module scope is the one place with no caller to catch what it throws.
if (typeof window !== 'undefined'
  && typeof window.addEventListener === 'function'
  && typeof requestAnimationFrame === 'function') {
  let queued = 0
  window.addEventListener('resize', () => {
    if (queued) return
    queued = requestAnimationFrame(() => { queued = 0; reflowLanes() })
  })
}

// ── THE LANE, FOR WINDOWS THAT ARE NOT ANGULAR ────────────────────────
//
// `hcDockedPanel` is a directive, so only a component in shared/web/dev can
// take a place in a lane by wearing it. Cold chrome — a drone's own DOM
// window, mounted straight onto the body — has no way to say "I am a tool
// window too", and the result was a panel that sat ON TOP of the docked ones
// instead of beside them: the same edge, the same pixels, no stacking, and
// the control bar's own reservation respected by one of them and not the
// other.
//
// So the lane itself is offered over IoC. A window implements LaneMember —
// four small methods, no framework — resolves this, and claims a place the
// same way the directive does. The lane does not care what drew the window.
export const DOCK_LANES_KEY = '@hypercomb.social/DockLanes'

/** What a non-Angular window needs of the lane. Deliberately the whole of it:
 *  claim on open, release on close, and the two questions a window asks before
 *  bringing anything else up beside it. */
export interface DockLanesApi {
  claim(member: LaneMember): void
  release(member: LaneMember): void
  hasRoom(side: LaneSide): boolean
  reflow(): void
}

// Through `window.ioc` rather than the ambient `register`, and guarded: this
// module is imported by a plain unit spec with no shell around it, and a lane
// model that cannot be pinned without booting the app is a lane model nobody
// will pin.
;(globalThis as unknown as { ioc?: { register?: (key: string, value: unknown) => void } })
  .ioc?.register?.(DOCK_LANES_KEY, {
    claim: claimLane,
    release: releaseLane,
    hasRoom: laneHasRoom,
    reflow: reflowLanes,
  } satisfies DockLanesApi)
