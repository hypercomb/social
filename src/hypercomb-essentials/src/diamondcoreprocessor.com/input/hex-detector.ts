// hypercomb-essentials/src/diamondcoreprocessor.com/input/hex-detector.ts
// O(1) pixel-to-axial coordinate detection via cube rounding.

export type Axial = { q: number; r: number }

const SQRT3_OVER_3 = Math.sqrt(3) / 3

export class HexDetector {
  constructor(private readonly spacing: number) {

  }

  /**
   * O(1) pixel-to-axial conversion using cube rounding.
   * point-top inverse of: x = √3 * s * (q + r/2), y = s * 1.5 * r
   * flat-top inverse of:   x = 1.5 * s * q,        y = √3 * s * (r + q/2)
   */
  public pixelToAxial(px: number, py: number, flat = false): Axial {
    const s = this.spacing
    if (flat) {
      const qf = (2 / 3 * px) / s
      const rf = (py * SQRT3_OVER_3 - px / 3) / s
      return HexDetector.cubeRound(qf, rf)
    }
    const qf = (px * SQRT3_OVER_3 - py / 3) / s
    const rf = (2 / 3 * py) / s
    return HexDetector.cubeRound(qf, rf)
  }

  /**
   * Snap fractional axial to nearest integer hex.
   * Derives sf = -qf - rf, rounds all three, then fixes
   * the q + r + s = 0 constraint by adjusting the component
   * with the largest rounding error.
   */
  public static cubeRound(qf: number, rf: number): Axial {
    const sf = -qf - rf

    let rq = Math.round(qf)
    let rr = Math.round(rf)
    const rs = Math.round(sf)

    const dq = Math.abs(rq - qf)
    const dr = Math.abs(rr - rf)
    const ds = Math.abs(rs - sf)

    if (dq > dr && dq > ds) {
      rq = -rr - rs
    } else if (dr > ds) {
      rr = -rq - rs
    }

    return { q: rq, r: rr }
  }
}

console.log('[HexDetector] registering @diamondcoreprocessor.com/HexDetector in ioc')
window.ioc.register(
  '@diamondcoreprocessor.com/HexDetector',
  new HexDetector(38)
)
