// presentation/avatars/bee-drag.ts
//
// PUTTING A BEE OUT OF THE WAY — by hand, or with a broom.
//
// An agent bee dances over the tile it is working on, which is exactly where
// the participant sometimes wants to read. So a bee can be taken hold of and
// put somewhere else. The press decides what it is by TRAVELLING: a still
// press opens the request, a moving one carries the bee.
//
// A BEE NEVER RUNS FROM THE CURSOR. It was tried — bees stepped aside from the
// tile under the pointer — and it took the bees away with it: a target that
// flinches as you reach for it cannot be pressed, and pressing a bee is how
// its log is opened (Jaime, 2026-09-09: "when you click them you can't open
// log anymore … they can't go away so they can avoid the mouse"). So moving a
// bee is always something the participant DID, never something the bee decided.
//
// There are two ways to do it, and they are the same act at two sizes:
//   • DRAG one bee, precisely, to a place you choose.
//   • SCRUB — scribble back and forth, or in circles, over a patch of hive
//     with no button down — and every bee in that patch sweeps out to the
//     wall. Scrub over them again and they come back to their work. It is a
//     broom, and a broom is honest: nothing moves until you sweep.
//
// The sweep is deliberately slow enough to follow (the dance centre eases),
// so a bee on its way out is still a bee you can catch and press.
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
 *  click. It is a CLICK'S SLOP, not a hair trigger: you press a bee that is
 *  dancing, so the hand is usually still moving when the button goes down, and
 *  four pixels turned ordinary clicks into drags that went nowhere (Jaime,
 *  2026-09-09: "the click is not doing anything anymore"). Twelve is a
 *  deliberate pull; anything under it never stops being a click. */
export const DRAG_PX = 12

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

// ── the broom ─────────────────────────────────────────────────────────────

/** A pointer position in CSS px, with the moment it was seen. */
export interface ScrubSample { x: number; y: number; t: number }

/** A step shorter than this is hand tremor, not a stroke: it carries no
 *  direction worth measuring, so it is folded into the next one. */
export const SCRUB_STEP_PX = 7
/** HOW MUCH TURNING MAKES IT A SCRUB. Measured as accumulated absolute turn,
 *  which is the one number that reads both gestures the same way: a
 *  back-and-forth reverses ~180° per stroke, a circle comes round through
 *  360°. Just under a full turn, so three short strokes or one loop is enough
 *  and an ordinary curved approach to a tile — a quarter turn, if that — never
 *  is. */
export const SCRUB_TURN_RADIANS = Math.PI * 1.75
/** The turning has to happen in one continuous act. Older strokes fall out of
 *  the reckoning, so a slow hour of mousing can never add up to a sweep. */
export const SCRUB_WINDOW_MS = 1100
/** ...and in one PLACE. A scribble is small; a long travel across the hive
 *  that happens to curve is not a broom, so strokes are dropped once the
 *  gesture's own footprint outgrows this box (CSS px). */
export const SCRUB_SPAN_PX = 260
/** WHAT ENDS A SCRIBBLE: the hand holding still this long. It is the whole of
 *  the gesture's grammar, and it does two jobs with one rule.
 *
 *  It makes the turning CONTINUOUS. Without it, ordinary mousing sweeps the
 *  hive by accident: go to a tile, stop, come back — that is two reversals,
 *  which is as much turning as a scribble has, just spread over a second and a
 *  half. Measured, 2026-09-09, and it fired. A hand that is scribbling emits a
 *  move every ten to twenty milliseconds; a hand that has stopped emits none.
 *
 *  And it makes ONE SCRIBBLE ONE ACT: after a sweep the broom stays up until
 *  the same stillness, so a participant who keeps scribbling does not flap the
 *  bees out, back and out again. */
export const SCRUB_PAUSE_MS = 260
/** How far from the scribble a bee has to be to be left alone (CSS px). The
 *  broom takes the patch you scrubbed, not the whole hive. */
export const SWEEP_REACH_PX = 190

const wrapAngle = (a: number): number => {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

/** SCRIBBLING, RECOGNISED. Fed every pointer move made with no button down,
 *  it answers with the centre of the scribble the moment one has been made,
 *  and otherwise with null.
 *
 *  What it measures is TURNING, not shape: the accumulated absolute change of
 *  direction inside a short window and a small box. Back-and-forth and circles
 *  both pass, a straight travel and a gentle curve both fail, and neither
 *  gesture had to be described to it. */
export class ScrubDetector {
  #last: ScrubSample | null = null
  #heading: number | null = null
  #turns: Array<{ angle: number; x: number; y: number; t: number }> = []
  /** The broom is up, and stays up until the hand holds still. Turning made
   *  while it is up is not counted at all — it is the tail of the scribble
   *  that just swept, not the start of the next one. */
  #awaitingPause = false

  /** The scribble's centre, once there is one. */
  feed(x: number, y: number, t: number): { x: number; y: number } | null {
    const last = this.#last
    this.#last = { x, y, t }
    if (!last) return null
    const dx = x - last.x
    const dy = y - last.y
    // Held still — tremor under the step threshold is stillness — so the last
    // real sample stands and the gap goes on growing. That gap is what ends
    // the gesture and brings the broom back down.
    if (Math.hypot(dx, dy) < SCRUB_STEP_PX) { this.#last = last; return null }
    // A pause ends the gesture, however long it is: the strokes either side of
    // it are two acts. THE BROOM COMES DOWN HERE AND NOWHERE ELSE — a longer
    // pause is a stronger pause, so this must not be short-circuited by some
    // separate "very long gap" case (it was, and the second scribble of a
    // session then swept nothing, ever).
    if (t - last.t >= SCRUB_PAUSE_MS) {
      this.#turns = []
      this.#heading = null
      this.#awaitingPause = false
    }

    const heading = Math.atan2(dy, dx)
    if (this.#heading !== null) {
      this.#turns.push({ angle: Math.abs(wrapAngle(heading - this.#heading)), x, y, t })
    }
    this.#heading = heading
    this.#prune(t)
    if (this.#awaitingPause) { this.#turns = []; return null }

    let total = 0
    for (const turn of this.#turns) total += turn.angle
    if (total < SCRUB_TURN_RADIANS) return null

    let cx = 0
    let cy = 0
    for (const turn of this.#turns) { cx += turn.x; cy += turn.y }
    const centre = { x: cx / this.#turns.length, y: cy / this.#turns.length }
    this.#turns = []
    this.#heading = null
    this.#awaitingPause = true
    return centre
  }

  /** Forget the stroke in progress — a press, a leave, a gesture taken over by
   *  something else. Never forgets that the broom is up: that is what stops
   *  one long scribble from sweeping twice. */
  clear(): void {
    this.#last = null
    this.#heading = null
    this.#turns = []
  }

  #prune(now: number): void {
    while (this.#turns.length && now - this.#turns[0].t > SCRUB_WINDOW_MS) this.#turns.shift()
    // Keep the gesture's footprint small: drop the oldest strokes until what
    // is left fits in the box. A scribble that walks turns into a new scribble.
    for (;;) {
      if (this.#turns.length < 2) return
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const turn of this.#turns) {
        if (turn.x < minX) minX = turn.x
        if (turn.x > maxX) maxX = turn.x
        if (turn.y < minY) minY = turn.y
        if (turn.y > maxY) maxY = turn.y
      }
      if (maxX - minX <= SCRUB_SPAN_PX && maxY - minY <= SCRUB_SPAN_PX) return
      this.#turns.shift()
    }
  }
}

/** The visible band of canvas, in screen px — what `keep in view` calls the
 *  room. `top` is the header's measured bottom edge, not the canvas top. */
export interface Room { left: number; top: number; right: number; bottom: number }

/** WHERE A SWEPT BEE LANDS, in screen px: straight out along the line from the
 *  broom, parked just inside the first wall it meets. Out along that line and
 *  not "to the nearest edge", because the direction you swept in is the answer
 *  you already gave — the bees go the way you pushed them.
 *
 *  A bee directly under the broom has no direction to go, so it goes up. */
export const sweptAsideTo = (
  bee: { x: number; y: number },
  broom: { x: number; y: number },
  room: Room,
  margin: number,
): { x: number; y: number } => {
  const minX = room.left + margin
  const maxX = room.right - margin
  const minY = room.top + margin
  const maxY = room.bottom - margin
  // A room too small to hold the bee: its middle is the only honest answer.
  if (maxX < minX || maxY < minY) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }

  const x = Math.min(Math.max(bee.x, minX), maxX)
  const y = Math.min(Math.max(bee.y, minY), maxY)
  let dx = bee.x - broom.x
  let dy = bee.y - broom.y
  const length = Math.hypot(dx, dy)
  if (length < 1) { dx = 0; dy = -1 } else { dx /= length; dy /= length }

  // How far along the ray each wall is; the nearest one is the wall it meets.
  let travel = Infinity
  if (dx > 1e-6) travel = Math.min(travel, (maxX - x) / dx)
  if (dx < -1e-6) travel = Math.min(travel, (minX - x) / dx)
  if (dy > 1e-6) travel = Math.min(travel, (maxY - y) / dy)
  if (dy < -1e-6) travel = Math.min(travel, (minY - y) / dy)
  if (!Number.isFinite(travel) || travel < 0) travel = 0
  return { x: x + dx * travel, y: y + dy * travel }
}
