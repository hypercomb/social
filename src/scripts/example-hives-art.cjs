// example-hives-art — generate the example hives' tile images as PNGs.
//
//   node scripts/example-hives-art.cjs [outDir]
//
// Pure Node (node:zlib deflate + hand-written PNG chunks) — no native image
// libraries, no network fetches, no licensing questions. Every image is
// deterministic generative art keyed by (hive, tile) so re-running the script
// reproduces byte-identical files → identical signatures.

'use strict'

const { deflateSync } = require('node:zlib')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// ── PNG encoder ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (bytes) => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

/** rgb: Float64Array(w*h*3), values 0..1 → 8-bit RGB PNG buffer. */
const encodePng = (rgb, w, h) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: truecolor
  const raw = Buffer.alloc(h * (1 + w * 3))
  let p = 0
  for (let y = 0; y < h; y++) {
    raw[p++] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      raw[p++] = Math.max(0, Math.min(255, Math.round(rgb[i] * 255)))
      raw[p++] = Math.max(0, Math.min(255, Math.round(rgb[i + 1] * 255)))
      raw[p++] = Math.max(0, Math.min(255, Math.round(rgb[i + 2] * 255)))
    }
  }
  // Fixed deflate settings so output bytes are deterministic across runs.
  const idat = deflateSync(raw, { level: 9, memLevel: 9, strategy: 0 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── tiny deterministic noise ─────────────────────────────────────────

const hashNoise = (seed) => {
  // mulberry32
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 1D value noise with cosine interpolation. */
const valueNoise1d = (seed, cells) => {
  const rand = hashNoise(seed)
  const knots = Array.from({ length: cells + 1 }, () => rand())
  return (t) => {
    const x = Math.max(0, Math.min(0.99999, t)) * cells
    const i = Math.floor(x)
    const f = x - i
    const s = (1 - Math.cos(f * Math.PI)) / 2
    return knots[i] * (1 - s) + knots[i + 1] * s
  }
}

// ── palette helpers ──────────────────────────────────────────────────

const hex = (s) => [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

const put = (rgb, w, x, y, c, alpha = 1) => {
  const i = (y * w + x) * 3
  rgb[i] = rgb[i] + (c[0] - rgb[i]) * alpha
  rgb[i + 1] = rgb[i + 1] + (c[1] - rgb[i + 1]) * alpha
  rgb[i + 2] = rgb[i + 2] + (c[2] - rgb[i + 2]) * alpha
}

// distance to nearest hexagon edge in a pointy-top hex lattice, 0..1-ish
const hexEdge = (x, y, size) => {
  const q = ((x * Math.sqrt(3)) / 3 - y / 3) / size
  const r = (y * 2) / 3 / size
  let rx = Math.round(q), ry = Math.round(-q - r), rz = Math.round(r)
  const dx = Math.abs(rx - q), dy = Math.abs(ry - (-q - r)), dz = Math.abs(rz - r)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  const cx = size * Math.sqrt(3) * (rx + rz / 2)
  const cy = size * (3 / 2) * rz
  const lx = x - cx, ly = y - cy
  // distance from center normalized by apothem, folded to hex symmetry
  const ang = Math.atan2(ly, lx)
  const d = Math.hypot(lx, ly)
  const a = Math.abs(((ang * 3) / Math.PI + 1.5) % 1 - 0.5)
  const apothem = (size * Math.sqrt(3)) / 2 / Math.cos((a - 0.5) * (Math.PI / 3) * 0)
  return d / ((size * Math.sqrt(3)) / 2 / Math.cos(Math.abs(((((ang + Math.PI / 2) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6)))
}

// ── scene painters ───────────────────────────────────────────────────

const SIZE = 768

/** Vertical gradient + soft vignette base. */
const base = (rgb, w, h, top, bottom) => {
  for (let y = 0; y < h; y++) {
    const c = mix(top, bottom, y / (h - 1))
    for (let x = 0; x < w; x++) {
      const dx = x / w - 0.5, dy = y / h - 0.5
      const vig = 1 - 0.35 * (dx * dx + dy * dy) * 4
      put(rgb, w, x, y, [c[0] * vig, c[1] * vig, c[2] * vig])
    }
  }
}

/** Honeycomb lattice lines. */
const honeycomb = (rgb, w, h, size, line, color, strength) => {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = hexEdge(x, y, size)
      if (e > 1 - line) put(rgb, w, x, y, color, strength * Math.min(1, (e - (1 - line)) / line))
    }
  }
}

/** Radial flower with `petals` petals. */
const flower = (rgb, w, h, cx, cy, radius, petals, color, core) => {
  const r2 = radius * 1.15
  for (let y = Math.max(0, Math.floor(cy - r2)); y < Math.min(h, cy + r2); y++) {
    for (let x = Math.max(0, Math.floor(cx - r2)); x < Math.min(w, cx + r2); x++) {
      const dx = x - cx, dy = y - cy
      const d = Math.hypot(dx, dy)
      const ang = Math.atan2(dy, dx)
      const petal = radius * (0.55 + 0.45 * Math.pow(Math.abs(Math.cos((petals * ang) / 2)), 1.5))
      if (d < petal) {
        const t = d / petal
        put(rgb, w, x, y, mix(color, [1, 1, 1], 0.25 * (1 - t)), 0.9 * (1 - t * t * 0.4))
      }
      if (d < radius * 0.22) put(rgb, w, x, y, core, 0.95)
    }
  }
}

/** Layered mountain ridges using 1D noise. */
const ridges = (rgb, w, h, seed, layers, near, far) => {
  for (let l = 0; l < layers; l++) {
    const n = valueNoise1d(seed + l * 97, 6 + l * 3)
    const baseY = h * (0.45 + (0.5 * (l + 1)) / (layers + 1))
    const amp = h * 0.22 * (1 - l / (layers + 1))
    const c = mix(far, near, l / Math.max(1, layers - 1))
    for (let x = 0; x < w; x++) {
      const yTop = baseY - n(x / w) * amp
      for (let y = Math.max(0, Math.floor(yTop)); y < h; y++) put(rgb, w, x, y, c, 0.92)
    }
  }
}

/** Sine-layer waves. */
const waves = (rgb, w, h, seed, color, deep) => {
  const rand = hashNoise(seed)
  for (let l = 0; l < 7; l++) {
    const baseY = h * (0.42 + l * 0.085)
    const amp = 8 + rand() * 14
    const freq = 2 + rand() * 3
    const phase = rand() * Math.PI * 2
    const c = mix(color, deep, l / 6)
    for (let x = 0; x < w; x++) {
      const yTop = baseY + Math.sin((x / w) * Math.PI * 2 * freq + phase) * amp
      for (let y = Math.max(0, Math.floor(yTop)); y < h; y++) put(rgb, w, x, y, c, 0.85)
      // foam line
      const fy = Math.floor(yTop)
      if (fy >= 0 && fy < h) put(rgb, w, x, fy, [1, 1, 1], 0.5)
    }
  }
}

/** Conifer silhouettes. */
const forest = (rgb, w, h, seed, color, count) => {
  const rand = hashNoise(seed)
  for (let t = 0; t < count; t++) {
    const cx = Math.floor(rand() * w)
    const baseY = h * (0.62 + rand() * 0.33)
    const height = h * (0.18 + rand() * 0.22)
    const half = height * 0.28
    for (let y = Math.floor(baseY - height); y < baseY; y++) {
      if (y < 0 || y >= h) continue
      const f = (y - (baseY - height)) / height
      const span = Math.floor(half * f)
      for (let x = Math.max(0, cx - span); x < Math.min(w, cx + span); x++) put(rgb, w, x, y, color, 0.95)
    }
  }
}

/** Big centered hexagon badge. */
const hexBadge = (rgb, w, h, radius, fill, rim) => {
  const cx = w / 2, cy = h / 2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy
      const ang = Math.atan2(dy, dx) + Math.PI / 2
      const fold = Math.abs(((((ang % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3))) - Math.PI / 6)
      const edge = radius / Math.cos(fold)
      const d = Math.hypot(dx, dy)
      if (d < edge * 0.96) put(rgb, w, x, y, fill, 0.92)
      else if (d < edge * 1.04) put(rgb, w, x, y, rim, 0.9)
    }
  }
}

/** Scatter of soft glowing dots (pollen / stars). */
const pollen = (rgb, w, h, seed, count, color) => {
  const rand = hashNoise(seed)
  for (let i = 0; i < count; i++) {
    const cx = rand() * w, cy = rand() * h, r = 1.5 + rand() * 4
    for (let y = Math.max(0, Math.floor(cy - r * 2)); y < Math.min(h, cy + r * 2); y++) {
      for (let x = Math.max(0, Math.floor(cx - r * 2)); x < Math.min(w, cx + r * 2); x++) {
        const d = Math.hypot(x - cx, y - cy) / r
        if (d < 2) put(rgb, w, x, y, color, Math.max(0, 0.8 * (1 - d / 2)) ** 2)
      }
    }
  }
}

// ── palettes ─────────────────────────────────────────────────────────

const AMBER = hex('e8a13d')
const HONEY = hex('d8842a')
const CREAM = hex('f6e3bf')
const DUSK = hex('2b2036')
const NIGHT = hex('141019')
const CHARCOAL = hex('1c1a17')
const GOLD = hex('f0b64a')
const SKYA = hex('8fb8d8')
const SKYB = hex('e8c8a0')
const SEA = hex('2e6f8e')
const SEADEEP = hex('173d52')
const PINE = hex('16281c')
const MEADOW = hex('7ba05b')

// ── the images ───────────────────────────────────────────────────────

const scene = (painter) => {
  const rgb = new Float64Array(SIZE * SIZE * 3)
  painter(rgb, SIZE, SIZE)
  return encodePng(rgb, SIZE, SIZE)
}

const IMAGES = {
  // the examples branch tile itself
  'examples-cover': (r, w, h) => { base(r, w, h, DUSK, NIGHT); honeycomb(r, w, h, 96, 0.07, GOLD, 0.7); hexBadge(r, w, h, 150, AMBER, CREAM); pollen(r, w, h, 7, 40, CREAM) },

  // honey garden — warm gallery art
  'honey-garden-cover': (r, w, h) => { base(r, w, h, AMBER, HONEY); honeycomb(r, w, h, 64, 0.06, CREAM, 0.5); flower(r, w, h, w * 0.5, h * 0.52, 190, 6, GOLD, DUSK) },
  'honey-garden-sunrise': (r, w, h) => { base(r, w, h, SKYB, HONEY); pollen(r, w, h, 11, 60, CREAM); flower(r, w, h, w * 0.3, h * 0.62, 130, 8, GOLD, HONEY); flower(r, w, h, w * 0.72, h * 0.4, 100, 5, CREAM, HONEY) },
  'honey-garden-meadow': (r, w, h) => { base(r, w, h, SKYA, MEADOW); ridges(r, w, h, 21, 2, PINE, MEADOW); flower(r, w, h, w * 0.62, h * 0.55, 110, 7, GOLD, DUSK) },
  'honey-garden-comb': (r, w, h) => { base(r, w, h, HONEY, DUSK); honeycomb(r, w, h, 88, 0.08, GOLD, 0.85); pollen(r, w, h, 31, 40, CREAM) },
  'honey-garden-bloom': (r, w, h) => { base(r, w, h, DUSK, NIGHT); flower(r, w, h, w * 0.5, h * 0.5, 210, 12, hex('c05a7a'), GOLD); pollen(r, w, h, 41, 80, CREAM) },
  'honey-garden-dusk': (r, w, h) => { base(r, w, h, hex('533a63'), NIGHT); pollen(r, w, h, 51, 120, GOLD); honeycomb(r, w, h, 120, 0.05, hex('533a63'), 0.6) },
  'honey-garden-pollen': (r, w, h) => { base(r, w, h, CREAM, AMBER); pollen(r, w, h, 61, 160, HONEY); flower(r, w, h, w * 0.24, h * 0.3, 80, 6, GOLD, DUSK) },

  // bee facts — bold badge art on charcoal
  'bee-facts-cover': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 220, AMBER, GOLD); honeycomb(r, w, h, 54, 0.05, GOLD, 0.25) },
  'bee-facts-dance': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 210, DUSK, GOLD); flower(r, w, h, w * 0.5, h * 0.5, 150, 2, GOLD, AMBER) },
  'bee-facts-eyes': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 210, SEADEEP, GOLD); honeycomb(r, w, h, 30, 0.1, SKYA, 0.5) },
  'bee-facts-queen': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 210, hex('6b2d43'), GOLD); flower(r, w, h, w * 0.5, h * 0.44, 90, 5, GOLD, CREAM) },
  'bee-facts-honey': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 210, HONEY, CREAM); pollen(r, w, h, 71, 50, CREAM) },
  'bee-facts-flight': (r, w, h) => { base(r, w, h, CHARCOAL, NIGHT); hexBadge(r, w, h, 210, hex('35506b'), GOLD); waves(r, w, h, 81, SKYA, SEADEEP) },

  // postcards — landscapes, nested navigation demo
  'postcards-cover': (r, w, h) => { base(r, w, h, SKYB, AMBER); ridges(r, w, h, 91, 3, DUSK, hex('8a5a74')); pollen(r, w, h, 92, 30, CREAM) },
  'postcards-mountains': (r, w, h) => { base(r, w, h, SKYA, SKYB); ridges(r, w, h, 101, 4, NIGHT, hex('6f7d9c')) },
  'postcards-mountains-dawn': (r, w, h) => { base(r, w, h, SKYB, hex('c76b4a')); ridges(r, w, h, 111, 3, DUSK, hex('9c5a5a')) },
  'postcards-mountains-peak': (r, w, h) => { base(r, w, h, hex('bcd2e8'), SKYA); ridges(r, w, h, 121, 5, NIGHT, hex('54617d')) },
  'postcards-sea': (r, w, h) => { base(r, w, h, SKYA, SEA); waves(r, w, h, 131, SEA, SEADEEP) },
  'postcards-sea-storm': (r, w, h) => { base(r, w, h, hex('5a6672'), SEADEEP); waves(r, w, h, 141, hex('46687d'), NIGHT) },
  'postcards-sea-calm': (r, w, h) => { base(r, w, h, SKYB, SEA); waves(r, w, h, 151, hex('4d8aa8'), SEA); pollen(r, w, h, 152, 20, CREAM) },
  'postcards-forest': (r, w, h) => { base(r, w, h, SKYB, MEADOW); forest(r, w, h, 161, PINE, 26) },
  'postcards-forest-night': (r, w, h) => { base(r, w, h, DUSK, NIGHT); pollen(r, w, h, 171, 90, CREAM); forest(r, w, h, 172, NIGHT, 22) },
  'postcards-forest-spring': (r, w, h) => { base(r, w, h, SKYA, MEADOW); forest(r, w, h, 181, hex('2d4a33'), 18); flower(r, w, h, w * 0.78, h * 0.78, 70, 6, GOLD, DUSK) },
}

const main = () => {
  const outDir = process.argv[2] || join(__dirname, 'example-hives-assets')
  mkdirSync(outDir, { recursive: true })
  for (const [name, painter] of Object.entries(IMAGES)) {
    const png = scene(painter)
    writeFileSync(join(outDir, `${name}.png`), png)
    console.log(`${name}.png  ${(png.length / 1024).toFixed(0)} KB`)
  }
  console.log(`\n${Object.keys(IMAGES).length} images → ${outDir}`)
}

main()
