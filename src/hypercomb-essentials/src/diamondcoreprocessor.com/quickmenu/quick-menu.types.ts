// diamondcoreprocessor.com/quickmenu/quick-menu.types.ts
//
// The vocabulary of the seven-hexagon quick menu: one centre and six
// neighbours, addressed by DIRECTION rather than by index.
//
// ── Why direction and not position ────────────────────────────────────
//
// The pointer is HIDDEN while the menu is up. That is the whole point of
// the gesture: once the cursor is gone, motion stops meaning "where" and
// starts meaning "which way". A slot is therefore chosen by the angle of
// travel from the summon origin, at ANY distance past the dead zone — the
// menu works the same at the edge of the screen as it does in the middle,
// and the hand learns `hold → flick east → release` as one motion.
//
// Because the choice is angular, the drawn ring is a HINT, not the control
// surface. Flick faster than the bloom delay and the ring is never painted;
// the same gesture still lands. Novice and expert share one motion.
//
// ── Point-top hexagons ────────────────────────────────────────────────
//
// The hive renders point-top (vertex up) by default — HexDetector's `flat`
// argument defaults to false — and the quick menu matches it. Point-top
// puts a flat vertical edge on the left and right of every hexagon, so the
// six neighbours sit at 0°, 60°, 120°, 180°, 240°, 300°:
//
//        northwest   northeast
//              \       /
//       west ——  centre  —— east
//              /       \
//        southwest   southeast
//
// EAST and WEST are true horizontal flicks — the two easiest directions a
// hand produces — which is exactly why point-top is the right orientation
// for a gesture menu. (Flat-top would trade them for up/down.)

/** The seven addressable slots of a quick menu. */
export type QuickMenuDirection =
  | 'centre'
  | 'east'
  | 'southeast'
  | 'southwest'
  | 'west'
  | 'northwest'
  | 'northeast'

/** The six ring directions in screen-angle order, starting due east and
 *  running clockwise (screen y grows downward). Index i sits at i × 60°. */
export const QUICK_MENU_RING: readonly QuickMenuDirection[] = [
  'east',
  'southeast',
  'southwest',
  'west',
  'northwest',
  'northeast',
]

/** Reverse of each ring direction — the way BACK to the ring you came from. */
export const OPPOSITE_DIRECTION: Readonly<Record<QuickMenuDirection, QuickMenuDirection>> = {
  centre: 'centre',
  east: 'west',
  southeast: 'northwest',
  southwest: 'northeast',
  west: 'east',
  northwest: 'southeast',
  northeast: 'southwest',
}

const SIN_60 = Math.sqrt(3) / 2

/** Unit vector per direction, in SCREEN space (y grows downward). */
export const DIRECTION_UNIT: Readonly<Record<QuickMenuDirection, { readonly x: number; readonly y: number }>> = {
  centre: { x: 0, y: 0 },
  east: { x: 1, y: 0 },
  southeast: { x: 0.5, y: SIN_60 },
  southwest: { x: -0.5, y: SIN_60 },
  west: { x: -1, y: 0 },
  northwest: { x: -0.5, y: -SIN_60 },
  northeast: { x: 0.5, y: -SIN_60 },
}

// ── geometry ──────────────────────────────────────────────────────────

/** Circumradius of one menu hexagon, in CSS pixels. Sized so a thumb can
 *  land a slot on touch without aiming. */
export const HEX_RADIUS = 46

/** Centre-to-centre distance between neighbouring point-top hexagons —
 *  twice the apothem, i.e. √3 × R. */
export const RING_DISTANCE = Math.sqrt(3) * HEX_RADIUS

/** Travel below this radius means "no direction chosen yet". Releasing here
 *  without ever having left fires the CENTRE slot; returning here after
 *  leaving cancels. Those two are distinguishable because we remember
 *  whether the pointer ever crossed out. */
export const DEAD_ZONE = 20

/** Travel past this radius on a slot that opens another menu descends into
 *  it, mid-gesture, without releasing. Just past the far edge of the ring. */
export const DESCEND_DISTANCE = RING_DISTANCE + HEX_RADIUS * 0.75

/** Which slot a displacement from the origin selects. Returns `centre`
 *  inside the dead zone, otherwise the nearest of the six ring directions
 *  — at any distance, because direction is the whole signal. */
export function directionAt(dx: number, dy: number): QuickMenuDirection {
  if (Math.hypot(dx, dy) <= DEAD_ZONE) return 'centre'
  const degrees = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  return QUICK_MENU_RING[Math.round(degrees / 60) % 6]
}

/** Pixel offset of a slot's hexagon centre from the ring centre. */
export function slotOffset(direction: QuickMenuDirection): { x: number; y: number } {
  const unit = DIRECTION_UNIT[direction]
  return { x: unit.x * RING_DISTANCE, y: unit.y * RING_DISTANCE }
}

// ── what a slot does ──────────────────────────────────────────────────

/** Run one of the hive's slash behaviours. The workhorse: every queen a
 *  module ships is reachable from a menu with no code here. */
export type QuickMenuCommandAction = {
  readonly kind: 'command'
  readonly command: string
  readonly args?: string
}

/** Broadcast an effect — for surfaces that listen rather than command. */
export type QuickMenuEffectAction = {
  readonly kind: 'effect'
  readonly effect: string
  readonly payload?: unknown
}

/** Open another ring. Crossing the descend radius opens it mid-gesture;
 *  releasing on it opens it sticky, with the pointer free. */
export type QuickMenuMenuAction = {
  readonly kind: 'menu'
  readonly menu: string
}

/**
 * Press a key. The escape hatch for surfaces whose verbs exist only as
 * keyboard handlers — the slide deck steps on ArrowRight and nothing else,
 * so a menu slot has no command and no effect to name.
 *
 * Deliberately last-resort: a surface that gains a real effect should move
 * its slots onto it, because a synthesized key is only as reliable as the
 * listener's assumptions. Never use this where a command exists.
 */
export type QuickMenuKeyAction = {
  readonly kind: 'key'
  readonly key: string
}

export type QuickMenuAction =
  | QuickMenuCommandAction
  | QuickMenuEffectAction
  | QuickMenuMenuAction
  | QuickMenuKeyAction

export interface QuickMenuSlot {
  readonly direction: QuickMenuDirection
  /** English label, used verbatim when no catalog entry resolves. */
  readonly label: string
  /** i18n key; falls back to `label`. */
  readonly labelKey?: string
  readonly action: QuickMenuAction
}

export interface QuickMenuDefinition {
  /** Stable identifier — referenced by `menu` actions and by `/menu <name>`. */
  readonly name: string
  readonly title: string
  readonly titleKey?: string
  /**
   * ViewMode surfaces this menu claims (e.g. `workflow`). The registry picks
   * the menu whose contexts include the active surface, falling back to the
   * menu that claims `*`. A menu with no contexts is reachable only by name.
   */
  readonly contexts: readonly string[]
  readonly slots: readonly QuickMenuSlot[]
}

/** Index a definition's slots by direction. */
export function slotsByDirection(
  definition: QuickMenuDefinition,
): Map<QuickMenuDirection, QuickMenuSlot> {
  const map = new Map<QuickMenuDirection, QuickMenuSlot>()
  for (const slot of definition.slots) map.set(slot.direction, slot)
  return map
}
