export interface HexGeometry {
  circumRadiusPx: number
  gapPx: number
  padPx: number
  spacing: number
}

export function createHexGeometry(circumRadiusPx: number, gapPx: number, padPx = 10): HexGeometry {
  return { circumRadiusPx, gapPx, padPx, spacing: circumRadiusPx + gapPx }
}

export const DEFAULT_HEX_GEOMETRY: HexGeometry = createHexGeometry(32, 6)
