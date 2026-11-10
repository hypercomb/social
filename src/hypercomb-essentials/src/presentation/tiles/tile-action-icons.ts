// presentation/tiles/tile-action-icons.ts
//
// Where the action icons sit on a tile. A dependency atom shared by the tile
// actions bee and the tile overlay (atomic-modules-plan.md).

// ── Position computation ──────────────────────────────────────────

// The FIRST icon row is centred on the tile: its middle sits on the hex's
// centre line (ICON_Y = 0), the name rides just above it (raisedNameY), and any
// wrapped row grows downward from it. The icon the pointer is on says what it
// does on a plate hung right below its own row (hintTopY).
export const ICON_Y = 0
export const ICON_SPACING = 11       // plates (9.4 wide) keep a 1.6 margin between them
export const ICON_SIZE = 7           // matches DEFAULT_ICON_SIZE in tile-overlay
/** Half-extent of a painted plate: the glyph's half plus the plate pad
 *  (hex-icon-button PLATE_PAD). The hover pad is wider and is not part of
 *  this — a click lands on the plate. */
export const PLATE_REACH = ICON_SIZE / 2 + 1.2
export const HEX_INRADIUS = 27.7     // √3/2 × 32 — safe horizontal bound
export const EDGE_MARGIN = 5.2       // icon CENTRES stay this far from the hex edge, so a plate clears the border

/** Centre-to-centre between icon rows (tile-overlay's ICON_ROW_PITCH). */
const ROW_PITCH = 12
/** The raised name's em (overlay-local units, hex radius 32) and its plate's
 *  vertical padding in that em. The name drone sets the label from these, and
 *  the plate's height below is derived from them, so the label can be resized
 *  in ONE place and still sit the same air above the icons. It was 8.4 — a
 *  half-size caption that read louder than the icons it names (Jaime,
 *  2026-11-04: "bring the size on the label down"). */
export const RAISED_NAME_EM = 6.6
export const RAISED_NAME_PAD_EM = 0.28
/** Half the height of a raised name's plate (one 1-em line plus its padding),
 *  and the air between it and the icons' top plates — overlay-local units. */
const NAME_PLATE_HALF = RAISED_NAME_EM * (1 + RAISED_NAME_PAD_EM * 2) / 2
const NAME_PLATE_GAP = 1.6

/** Y of icon row `row` (0-based): the first row on the tile's centre line, each
 *  wrapped row ROW_PITCH below the one before — wherever the block wraps, the
 *  first row stays where it is. */
export function iconRowY(row: number): number {
  return Math.round(ICON_Y + row * ROW_PITCH)
}

/** Where the hovered tile's NAME rides: just above the top icon row (the icon
 *  plates are 9.4 tall), measured up from the hex centre in overlay-local units
 *  (hex radius 32). The name drone and the overlay's pinned icons both read it,
 *  so they cannot disagree. */
export function raisedNameY(): number {
  return iconRowY(0) - PLATE_REACH - NAME_PLATE_GAP - NAME_PLATE_HALF
}

/** Where the icon hint's TOP edge hangs: right below the row the hovered icon
 *  is on, with the same air under that row's plates (NAME_PLATE_GAP) that the
 *  name keeps above the top row's — the name's padding, mirrored to the bottom.
 *  `row` is the icon's 0-based row (-1 = pinned beside the name, so the hint
 *  hangs under the name's plate); absent, the last row. Overlay-local units,
 *  measured down from the hex centre. */
export function hintTopY(iconRows: number, row?: number): number {
  const rows = Math.max(1, iconRows)
  const at = row === undefined ? rows - 1 : Math.min(Math.trunc(row), rows - 1)
  if (at < 0) return raisedNameY() + NAME_PLATE_HALF + NAME_PLATE_GAP
  return iconRowY(at) + PLATE_REACH + NAME_PLATE_GAP
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
