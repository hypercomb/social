// diamondcoreprocessor.com/pixi/simplex-noise.ts
// Minimal 2D simplex noise — no dependencies, deterministic.

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6

// 12 gradient directions (mod 12 index)
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
]

// permutation table (seeded via simple LCG)
const perm = new Uint8Array(512)
const grad = new Uint8Array(512)
;(() => {
  let s = 0
  for (let i = 0; i < 256; i++) {
    s = (s * 1664525 + 1013904223 + i) >>> 0
    perm[i] = perm[i + 256] = (s >>> 16) & 255
    grad[i] = grad[i + 256] = perm[i] % 12
  }
})()

function dot2(gi: number, x: number, y: number): number {
  const g = grad2[gi]
  return g[0] * x + g[1] * y
}

/**
 * 2D simplex noise. Returns value in [-1, 1].
 */
export function noise2D(xin: number, yin: number): number {
  const s = (xin + yin) * F2
  const i = Math.floor(xin + s)
  const j = Math.floor(yin + s)
  const t = (i + j) * G2
  const x0 = xin - (i - t)
  const y0 = yin - (j - t)

  const i1 = x0 > y0 ? 1 : 0
  const j1 = x0 > y0 ? 0 : 1

  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2
  const y2 = y0 - 1 + 2 * G2

  const ii = i & 255
  const jj = j & 255

  let n0 = 0, n1 = 0, n2 = 0

  let t0 = 0.5 - x0 * x0 - y0 * y0
  if (t0 > 0) { t0 *= t0; n0 = t0 * t0 * dot2(grad[ii + perm[jj]], x0, y0) }

  let t1 = 0.5 - x1 * x1 - y1 * y1
  if (t1 > 0) { t1 *= t1; n1 = t1 * t1 * dot2(grad[ii + i1 + perm[jj + j1]], x1, y1) }

  let t2 = 0.5 - x2 * x2 - y2 * y2
  if (t2 > 0) { t2 *= t2; n2 = t2 * t2 * dot2(grad[ii + 1 + perm[jj + 1]], x2, y2) }

  return 70 * (n0 + n1 + n2)
}
