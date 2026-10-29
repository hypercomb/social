// quickmenu/quick-menu.tile-menu.ts
//
// Where a quick menu sits when its subject is a tile, and when the selection
// menu should be the thing on screen.
//
// The ring is drawn in the tile's own layer, just outside the hex. The six
// directions are the options. The tile is not one of them: nothing is written
// on it, and a click there is still a click on the tile.

import { DIRECTION_UNIT, QUICK_MENU_RING, type QuickMenuDirection } from './quick-menu.types.js'

/** Menu hex circumradius, as a fraction of the hive tile's. */
export const MENU_RADIUS_RATIO = 0.56

/** Centre-to-centre distance from the tile to an option, as a fraction of
 *  the hive tile's circumradius. The inner edge of an option lands just
 *  outside the tile, so the two do not share a click. */
export const MENU_REACH_RATIO = 1.62

export type MenuMetrics = {
  readonly tileRadius: number
  readonly radius: number
  readonly reach: number
}

export function menuMetrics(tileRadius: number): MenuMetrics {
  return {
    tileRadius,
    radius: tileRadius * MENU_RADIUS_RATIO,
    reach: tileRadius * MENU_REACH_RATIO,
  }
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
  let bestDist = metrics.radius
  for (const direction of QUICK_MENU_RING) {
    const unit = DIRECTION_UNIT[direction]
    const d = Math.hypot(dx - unit.x * metrics.reach, dy - unit.y * metrics.reach)
    if (d <= bestDist) {
      best = direction
      bestDist = d
    }
  }
  return best
}

/** Ctrl held over a tile raises the selection menu. A drag, a text field,
 *  the wand, the clipboard, a ctrl-icon, or a quick-menu gesture already
 *  in progress all mean something else. */
export function selectionMenuWanted(input: {
  ctrl: boolean
  overTile: boolean
  buttonDown: boolean
  typing: boolean
  wand: boolean
  clipboard: boolean
  gesture: boolean
  onCtrlIcon: boolean
  latchedOff: boolean
}): boolean {
  return input.ctrl
    && input.overTile
    && !input.buttonDown
    && !input.typing
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

export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null
  if (!node?.tagName) return false
  const tag = node.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // isContentEditable is true for a child of an editable region once it is in
  // the document. contentEditable is the attribute on the region itself, and
  // it is set even before the node is inserted.
  return node.isContentEditable === true || node.contentEditable === 'true'
}
