// sharing/qr-code.ts
//
// A QR CODE, FROM NOTHING (jwize 2026-10-25: "a link or QR from the desktop that adds the phone's own key").
// No third-party code is loaded for it (nothing is fetched from anyone), so the encoder is here: byte mode,
// error-correction level L, versions 1–10 (up to 271 bytes) — room for an invite link, which is a host and
// two 64-character keys. It is checked module for module against a reference encoder (qr-code.reference.json
// is that reference's output; qr-code.spec.ts holds this one to it).

type Block = readonly [count: number, data: number]
type Spec = { readonly ec: number; readonly blocks: readonly Block[] }

/** Level L, by version: error-correction codewords per block, and the blocks (count, data codewords each). */
const SPECS: readonly Spec[] = [
  { ec: 7, blocks: [[1, 19]] },
  { ec: 10, blocks: [[1, 34]] },
  { ec: 15, blocks: [[1, 55]] },
  { ec: 20, blocks: [[1, 80]] },
  { ec: 26, blocks: [[1, 108]] },
  { ec: 18, blocks: [[2, 68]] },
  { ec: 20, blocks: [[2, 78]] },
  { ec: 24, blocks: [[2, 97]] },
  { ec: 30, blocks: [[2, 116]] },
  { ec: 18, blocks: [[2, 68], [2, 69]] },
]

const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
/** Bits left over after the codewords, by version. */
const REMAINDER = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0]
const MAX_VERSION = SPECS.length

export const QR_MAX_BYTES = 271

const dataCodewords = (spec: Spec): number => spec.blocks.reduce((sum, [count, data]) => sum + count * data, 0)

// ── Reed–Solomon over GF(256), polynomial 0x11D ──
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!)

const generator = (degree: number): number[] => {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!
      next[j + 1] = next[j + 1]! ^ mul(poly[j]!, EXP[i]!)
    }
    poly = next
  }
  return poly
}

const remainder = (data: readonly number[], degree: number): number[] => {
  const gen = generator(degree)
  const out = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ out.shift()!
    out.push(0)
    for (let i = 0; i < degree; i++) out[i] = out[i]! ^ mul(gen[i + 1]!, factor)
  }
  return out
}

/** The module grid of `text` (UTF-8 bytes), true = dark; null when it does not fit in version 10. */
export function qrMatrix(text: string, forcedMask?: number): { size: number; version: number; mask: number; modules: boolean[][] } | null {
  const bytes = [...new TextEncoder().encode(text)]
  let version = 0
  for (let v = 1; v <= MAX_VERSION; v++) {
    const countBits = v <= 9 ? 8 : 16
    if (4 + countBits + 8 * bytes.length <= dataCodewords(SPECS[v - 1]!) * 8) { version = v; break }
  }
  if (!version) return null
  const spec = SPECS[version - 1]!
  const capacity = dataCodewords(spec)

  // The bit stream: mode, count, bytes, terminator, padding.
  const bits: number[] = []
  const push = (value: number, length: number): void => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  push(0, Math.min(4, capacity * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const words: number[] = []
  for (let i = 0; i < bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; words.length < capacity; pad ^= 0xec ^ 0x11) words.push(pad)

  // Blocks, their error correction, and the interleave.
  const blocks: number[][] = []
  let at = 0
  for (const [count, data] of spec.blocks) for (let i = 0; i < count; i++) { blocks.push(words.slice(at, at + data)); at += data }
  const checks = blocks.map(block => remainder(block, spec.ec))
  const stream: number[] = []
  for (let i = 0; i < Math.max(...blocks.map(block => block.length)); i++) for (const block of blocks) if (i < block.length) stream.push(block[i]!)
  for (let i = 0; i < spec.ec; i++) for (const check of checks) stream.push(check[i]!)
  const all: number[] = []
  for (const word of stream) for (let i = 7; i >= 0; i--) all.push((word >>> i) & 1)
  for (let i = 0; i < REMAINDER[version - 1]!; i++) all.push(0)

  const size = 17 + 4 * version
  const grid = (): boolean[][] => Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const dark = grid()
  const fixed = grid()
  const set = (x: number, y: number, on: boolean): void => { if (x >= 0 && y >= 0 && x < size && y < size) { dark[y]![x] = on; fixed[y]![x] = true } }

  // Finders with their separators, timing, alignment, the dark module.
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, distance !== 4 && distance !== 2)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  // Re-draw the finders over the timing lines' ends.
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const places = ALIGNMENT[version - 1]!
  for (const cy of places) for (const cx of places) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }

  const formatBits = (mask: number): number => {
    const data = (0b01 << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412
  }
  const drawFormat = (mask: number): void => {
    const bitsOf = formatBits(mask)
    const bit = (i: number): boolean => ((bitsOf >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bitsOf = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const on = ((bitsOf >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, on); set(b, a, on)
    }
  }

  // The data, in the zigzag from the bottom right.
  let next = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical
      if (!fixed[y]![x] && next < all.length) dark[y]![x] = all[next++] === 1
    }
  }

  const masks: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0,
    (_x, y) => y % 2 === 0,
    x => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const masked = (mask: number): boolean[][] => {
    drawFormat(mask)
    return dark.map((row, y) => row.map((on, x) => (fixed[y]![x] ? on : on !== masks[mask]!(x, y))))
  }

  const penalty = (m: boolean[][]): number => {
    let score = 0
    const lines = (get: (a: number, b: number) => boolean): void => {
      for (let a = 0; a < size; a++) {
        let run = 1
        for (let b = 1; b < size; b++) {
          if (get(a, b) === get(a, b - 1)) run++
          else { if (run >= 5) score += 3 + run - 5; run = 1 }
        }
        if (run >= 5) score += 3 + run - 5
        // Finder-like 1:1:3:1:1 with four light modules to one side.
        for (let b = 0; b + 11 <= size; b++) {
          const at = (i: number): boolean => get(a, b + i)
          const core = at(0) && !at(1) && at(2) && at(3) && at(4) && !at(5) && at(6)
          if (!core) continue
          const light = (from: number): boolean => [0, 1, 2, 3].every(i => !at(from + i))
          if (b + 11 <= size && light(7)) score += 40
        }
        for (let b = 0; b + 11 <= size; b++) {
          const at = (i: number): boolean => get(a, b + i)
          const core = at(4) && !at(5) && at(6) && at(7) && at(8) && !at(9) && at(10)
          if (core && [0, 1, 2, 3].every(i => !at(i))) score += 40
        }
      }
    }
    lines((a, b) => m[a]![b]!)
    lines((a, b) => m[b]![a]!)
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = m[y]![x]!
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3
    }
    let count = 0
    for (const row of m) for (const on of row) if (on) count++
    score += 10 * Math.floor(Math.abs((count * 100) / (size * size) - 50) / 5)
    return score
  }

  let best = forcedMask ?? 0
  let result = masked(best)
  if (forcedMask === undefined) {
    let lowest = penalty(result)
    for (let mask = 1; mask < 8; mask++) {
      const candidate = masked(mask)
      const score = penalty(candidate)
      if (score < lowest) { lowest = score; best = mask; result = candidate }
    }
    drawFormat(best)
    result = masked(best)
  }
  return { size, version, mask: best, modules: result }
}

/** An SVG of the code — dark modules on a white quiet zone, one path, scaled by the page. */
export function qrSvg(text: string, label = 'QR code'): string | null {
  const code = qrMatrix(text)
  if (!code) return null
  const quiet = 4
  const span = code.size + quiet * 2
  let path = ''
  for (let y = 0; y < code.size; y++) {
    let x = 0
    while (x < code.size) {
      if (!code.modules[y]![x]) { x++; continue }
      let end = x
      while (end < code.size && code.modules[y]![end]) end++
      path += `M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`
      x = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${span}" height="${span}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
