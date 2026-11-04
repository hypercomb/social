// presentation/tiles/tile-action-icons.ts
//
// Where the action icons sit on a tile. A dependency atom shared by the tile
// actions bee and the tile overlay (atomic-modules-plan.md).

// ── Position computation ──────────────────────────────────────────

// Icons sit INSIDE the tile's label band, which grows on hover
// (hex-sdf.shader.ts) to hold the NAME in its top row and the icons under it.
// ICON_Y is the CENTRE of the icon block: the overlay centres one row on it and
// straddles it with two (ICON_ROW_PITCH in tile-overlay.drone.ts). The band is
// centred on the hex and the name takes exactly the top row, so the icon block
// always centres one half-row BELOW the hex centre — half of ICON_ROW_PITCH,
// whether the icons take one row or two. HINT_Y_OFFSET and POOL_Y_OFFSET there
// are absolute and do not follow; the arrange hit-test derives from this
// constant and does.
export const ICON_Y = 5
export const ICON_SPACING = 11       // plates (9.4 wide) keep a 1.6 margin between them
export const ICON_SIZE = 7           // matches DEFAULT_ICON_SIZE in tile-overlay
export const HEX_INRADIUS = 27.7     // √3/2 × 32 — safe horizontal bound
export const EDGE_MARGIN = 5.2       // icon CENTRES stay this far from the hex edge, so a plate clears the border

/** Centre-to-centre between icon rows (tile-overlay's ICON_ROW_PITCH). */
const ROW_PITCH = 12
/** Half the height of a raised name's plate, and the air between it and the
 *  icons' top plates — overlay-local units, hex radius 32. */
const NAME_PLATE_HALF = 6.6
const NAME_PLATE_GAP = 1.6

/** Where the hovered tile's NAME rides: just above the top icon row (the icon
 *  plates are 9.4 tall), measured up from the hex centre in overlay-local units
 *  (hex radius 32). The name drone and the overlay's pinned icons both read it,
 *  so they cannot disagree. */
export function raisedNameY(iconRows: number): number {
  const topRowY = ICON_Y - (Math.max(1, iconRows) - 1) * ROW_PITCH / 2
  return topRowY - 4.7 - NAME_PLATE_GAP - NAME_PLATE_HALF
}

export function computeIconPositions(activeNames: string[]): { x: number; y: number }[] {
  const count = activeNames.length
  if (count === 0) return []

  let spacing = ICON_SPACING

  // Compress spacing when the row would overflow the hex
  const available = (HEX_INRADIUS - EDGE_MARGIN) * 2
  const idealWidth = (count - 1) * spacing
  if (idealWidth > available && count > 1) {
    spacing = available / (count - 1)
  }

  // Return CENTER positions — evenly spaced, symmetric about x=0, rounded to integers
  const startX = Math.round(-(count - 1) * spacing / 2)
  return activeNames.map((_, i) => ({ x: Math.round(startX + i * spacing), y: ICON_Y }))
}
