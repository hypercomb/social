// presentation/avatars/bee-drag.ts
//
// PULLING A BEE OUT OF THE WAY.
//
// An agent bee dances over the tile it is working on, which is exactly where
// the participant sometimes wants to read. So a bee can be taken hold of and
// put somewhere else. The press decides what it is by TRAVELLING: a still
// press opens the request, a moving one carries the bee.
//
// What is remembered is a NUDGE — a displacement in WORLD units from the
// anchor the work gives the bee, never an absolute position. The bee therefore
// keeps the place it was put through a pan, a zoom and a repaint, and it stays
// with the tile it belongs to: it has been moved off the hexagon, not off the
// hive.
//
// Nothing here is minted. Where a bee has been put is session theatre, like
// the perch — the work is the truth, the seating is not.

export interface Nudge { x: number; y: number }

/** How far a press must travel, in CSS px, before it is a drag rather than a
 *  click. Small enough that a deliberate pull is taken up at once, large
 *  enough that a click which wobbles by a pixel still opens the request. */
export const DRAG_PX = 4

/** Released this close (CSS px) to where the work puts it, a bee simply goes
 *  home. Putting it back is how a nudge is undone — there is no command for
 *  it, and none is wanted. */
export const SNAP_HOME_PX = 18

/** Has this press become a drag? Distances are CSS px: the threshold is about
 *  the hand, so it must not change with zoom. */
export const isDrag = (dx: number, dy: number): boolean =>
  dx * dx + dy * dy >= DRAG_PX * DRAG_PX

/** The displacement to hold: where the pointer is now, less where inside the
 *  dance the bee was grabbed, less the home its work gives it. All three in
 *  world units, so the result survives a pan and a zoom. */
export const nudgeFrom = (pointer: Nudge, grab: Nudge, home: Nudge): Nudge => ({
  x: pointer.x - grab.x - home.x,
  y: pointer.y - grab.y - home.y,
})

/** Is this nudge small enough ON SCREEN to be no nudge at all? On screen, not
 *  in the world: the same drop must read as "back where it was" at any zoom. */
export const snapsHome = (nudge: Nudge, worldScale: number): boolean =>
  Math.hypot(nudge.x, nudge.y) * (worldScale || 1) < SNAP_HOME_PX
