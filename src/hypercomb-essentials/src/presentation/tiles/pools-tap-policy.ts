// presentation/tiles/pools-tap-policy.ts
//
// WHAT A PRESS LIGHTS IN POOLS MODE. While pools mode is up a tap on one of
// your own tiles turns its light on or off, Shift does it for the whole
// branch, and a finger that stays does the same (tile-overlay.drone.ts,
// #lighting). A light is what a participant offers, so it must turn only when
// the hand meant it: the release of a reorder, the resting finger of a pinch
// and a press under a gesture that owns the input all look like a tap or a
// hold to a handler that only sees its own pointer.
//
// The overlay records what the press did and asks here. Everything is a pure
// function of those facts: no pointer, no canvas, no clock, nothing
// registered. The signals are the ones the hive already has: travel out of
// the overlay's own jitter box, `move:drag` and `touch:dragging` for a drag or
// a pan that began, the pointers that came down, and the InputGate.

/** What a press does to the lights: one tile, the tile and everything under it, or nothing. */
export type PoolsLight = 'light' | 'light-branch' | 'none'

/**
 * THE BRANCH HOLD. How long a finger or a pen must stay for the whole branch.
 * It has to mature before the quick-menu ring's 380 ms
 * (quickmenu/quick-menu.input.ts) and consume the finger when it does, which
 * is what makes the ring stand down: one long press, one owner. It lands
 * after drag-to-move's 300 ms reservation (move/touch-move.input.ts), which
 * is why that reservation is not a holder here (poolsGateHeld).
 */
export const BRANCH_HOLD_MS = 350

/** Drag-to-move's gate source: it claims the gate for a still finger before travel has said whether the press is a drag at all. */
const TOUCH_MOVE_SOURCE = 'touch-move'

/** One press, from its first pointer going down to the moment it is asked about. */
export interface PoolsPress {
  /** Pools mode has the tap: the mode is up and the hexagons are showing. */
  readonly lighting: boolean
  /** The tile under the press is the participant's own. A peer's tile is never theirs to light. */
  readonly own: boolean
  /** 'mouse', 'touch' or 'pen', as the pointer said on the way down. */
  readonly pointerType: string
  /** The pointer travelled out of its jitter box. */
  readonly moved: boolean
  /** A reorder, a tile drag or a pan began under the press. */
  readonly dragged: boolean
  /** The most pointers that were down together during the press. */
  readonly pointers: number
  /** A gesture or a modal holds the input (poolsGateHeld). Asked for the hold only. */
  readonly gateHeld: boolean
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  /** How long the press has been down, in ms. Asked for the hold only. */
  readonly heldMs: number
}

/** The press is pools mode's, and it is one still pointer that nothing took. */
const clean = (press: PoolsPress): boolean =>
  press.lighting && press.own && !press.moved && !press.dragged && press.pointers === 1

/**
 * THE RELEASE. A tap lights only when it was a tap: no travel, no reorder or
 * pan begun under it, and one pointer for its whole life. Shift lights the
 * whole branch. Ctrl and Cmd are selection's click and light nothing. The
 * gate is not asked: a pinned page and a window open beside the hive both
 * hold it, and neither makes a tap anything but a tap.
 */
export const poolsTapLight = (press: PoolsPress): PoolsLight => {
  if (!clean(press) || press.ctrlKey || press.metaKey) return 'none'
  return press.shiftKey ? 'light-branch' : 'light'
}

/**
 * May this press arm the branch hold at all. A mouse has Shift for the branch
 * and arms nothing, and a finger that joins one already down is the second
 * half of a pan or a pinch, never a hold of its own.
 */
export const poolsHoldArms = (press: Pick<PoolsPress, 'lighting' | 'own' | 'pointerType' | 'pointers'>): boolean =>
  press.lighting && press.own && press.pointerType !== 'mouse' && press.pointers === 1

/**
 * THE HOLD, MATURED. The whole branch lights only for one finger or pen that
 * is still down, never travelled, was joined by no other pointer, and stayed
 * the hold's whole length while no gesture or modal held the input. Anything
 * else lights nothing: the resting finger of a pinch is not a hold.
 */
export const poolsHoldLight = (press: PoolsPress): PoolsLight =>
  clean(press) && poolsHoldArms(press) && !press.gateHeld && press.heldMs >= BRANCH_HOLD_MS
    ? 'light-branch'
    : 'none'

/** The InputGate, as far as pools mode asks it (navigation/input-gate.service.ts). */
export interface PoolsGate {
  /** A lock is held: a modal, the quick-menu ring, a pinned page. */
  readonly locked: boolean
  /** The pin's lock is the only thing holding the gate. */
  readonly pinOnly: boolean
  /** The gesture that has claimed the gate, if one has. */
  readonly owner: string | null
}

/**
 * Whether a gesture or a modal owns the input. Two holders are not owners: a
 * pinned page freezes the viewport and nothing else, and drag-to-move's
 * reservation sits on a finger that has not travelled, which is the very
 * press the hold is deciding about. The quick-menu summon makes the same two
 * allowances.
 */
export const poolsGateHeld = (gate: PoolsGate | null | undefined): boolean => {
  if (!gate) return false
  if (gate.locked) return !gate.pinOnly
  return gate.owner !== null && gate.owner !== TOUCH_MOVE_SOURCE
}

/**
 * THE LIGHT, OFF THE HEXAGONS. The band gave the light to the tap, but a
 * surface with no tap on a hexagon (the tile page, the brief, a row of the
 * phone's list face) still has to turn one tile on or off. Such an action is
 * registered off the band: it never joins the band's order, and these
 * surfaces add it to what the band gave. Each once, for its own profile, and
 * never one the band already carries.
 */
export const offBandActions = <T extends { readonly name: string; readonly profile: string }>(
  registered: Iterable<T>,
  profile: string,
  carried: ReadonlySet<string>,
): T[] => {
  const seen = new Set(carried)
  const added: T[] = []
  for (const action of registered) {
    if (action.profile !== profile || seen.has(action.name)) continue
    seen.add(action.name)
    added.push(action)
  }
  return added
}
