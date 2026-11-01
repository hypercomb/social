// quickmenu/quick-menu.tile-menu.ts
//
// Where a quick menu sits when its subject is a tile, and when the selection
// menu should be the thing on screen.
//
// The six directions are the options, each on a neighbouring cell of the hive's
// own grid. The tile is not one of them: nothing is written on it, and a click
// there is still a click on the tile.

import { DIRECTION_UNIT, QUICK_MENU_RING, type QuickMenuDirection } from './quick-menu.types.js'

export type MenuMetrics = {
  /** The hive's tile size: its centre-to-flat distance (see show-cell). */
  readonly tileRadius: number
  /** Centre-to-point of a drawn tile. */
  readonly radius: number
  /** Centre-to-centre of two neighbouring cells. */
  readonly reach: number
  readonly flat: boolean
}

/** The hive's own grid, so every option lands exactly on a neighbouring cell
 *  at exactly a tile's size. The shader draws `circumRadiusPx` as the apothem,
 *  and axial neighbours sit √3 × spacing apart. */
export function menuMetrics(tileRadius: number, spacing: number, flat = false): MenuMetrics {
  return { tileRadius, radius: tileRadius / (Math.sqrt(3) / 2), reach: Math.sqrt(3) * spacing, flat }
}

/** Direction of a neighbouring cell. Flat-top cells sit 30° round from the
 *  point-top angles the directions are named for. */
export function cellUnit(direction: QuickMenuDirection, flat: boolean): { x: number; y: number } {
  const unit = DIRECTION_UNIT[direction]
  if (!flat) return unit
  const cos = Math.sqrt(3) / 2
  return { x: unit.x * cos - unit.y * 0.5, y: unit.x * 0.5 + unit.y * cos }
}

/**
 * Which of the six options contains a point measured from the tile centre.
 * The tile body is never an option, in either mode: a ctrl+click there still
 * selects, and a gesture that stays on the tile does not fire a centre verb.
 */
export function slotUnder(
  dx: number,
  dy: number,
  metrics: MenuMetrics,
  _mode: 'gesture' | 'pick',
): QuickMenuDirection | null {
  let best: QuickMenuDirection | null = null
  let bestDist = metrics.reach / Math.sqrt(3)
  for (const direction of QUICK_MENU_RING) {
    const unit = cellUnit(direction, metrics.flat)
    const d = Math.hypot(dx - unit.x * metrics.reach, dy - unit.y * metrics.reach)
    if (d <= bestDist) {
      best = direction
      bestDist = d
    }
  }
  return best
}

/** Alt held over a tile raises the selection menu. A drag, the wand, the
 *  clipboard, a ctrl-icon, or a quick-menu gesture already in progress all
 *  mean something else. */
export function selectionMenuWanted(input: {
  alt: boolean
  overTile: boolean
  buttonDown: boolean
  wand: boolean
  clipboard: boolean
  gesture: boolean
  onCtrlIcon: boolean
  latchedOff: boolean
}): boolean {
  return input.alt
    && input.overTile
    && !input.buttonDown
    && !input.wand
    && !input.clipboard
    && !input.gesture
    && !input.onCtrlIcon
    && !input.latchedOff
}

/** Click-select, and a menu already drawn around a tile, do not also raise
 *  the hover action icons. */
export function hoverActionsSuppressed(hasSelection: boolean, menuOnTile: boolean): boolean {
  return hasSelection || menuOnTile
}
