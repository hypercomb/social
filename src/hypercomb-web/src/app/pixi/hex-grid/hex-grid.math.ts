// src/app/pixi/hex-grid/hex-grid.math.ts

export interface HexPoint {
  x: number
  y: number
}

export const buildHexGrid = (
  radius: number,
  cols: number,
  rows: number
): HexPoint[] => {

  const points: HexPoint[] = []

  const w = radius * 2
  const h = Math.sqrt(3) * radius
  const xStep = w * 0.75
  const yStep = h

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = col * xStep
      const y = row * yStep + (col % 2 === 1 ? h / 2 : 0)
      points.push({ x, y })
    }
  }

  return points
}
