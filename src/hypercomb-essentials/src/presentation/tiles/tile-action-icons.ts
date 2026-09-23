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
export const ICON_SPACING = 10       // tighter to match 75 % icon scale
export const ICON_SIZE = 7           // matches DEFAULT_ICON_SIZE in tile-overlay
export const HEX_INRADIUS = 27.7     // √3/2 × 32 — safe horizontal bound
export const EDGE_MARGIN = 3         // keep icons this far from hex edge

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
