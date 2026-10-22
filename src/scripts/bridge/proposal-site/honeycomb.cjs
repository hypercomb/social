// A honeycomb in the hive's own style, drawn from scratch for each page.
//
// The hive is a hexagonal grid of tiles: pointy-top cells, laid out from a
// centre in the spiral order the canvas walks (visual-division.ts spiralAxial,
// axial-coordinate.ts getLocation), each tile drawn with a rim, an inner
// glow, a top-left bevel and, when it carries a picture, a name band across
// its foot (grid/tile-look.ts). This is that: two rings of tiles and a
// ragged third, a few of them wearing the landing page's clay, sage, honey
// and steel, the centre tile wearing the mark, and fainter cells fading out
// around them. Seeded by the page, so the same page is always the same
// bytes; nothing tiles and nothing repeats. Every colour is a token.

const rng = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f = (n) => Math.round(n * 10) / 10
const P = (pts, close = true) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (close ? 'Z' : '')
const SQ3 = Math.sqrt(3)

/** The hive's spiral: cell k's axial coordinate. */
const spiralAxial = (index) => {
  if (index === 0) return { q: 0, r: 0 }
  const DIRS = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]]
  let seen = 0
  for (let ring = 1; ; ring++) {
    let q = -ring, r = 0
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        q += DIRS[side][0]; r += DIRS[side][1]
        if (++seen === index) return { q, r }
      }
    }
  }
}

/** The hive's placing: a cell's centre, in units of the side. */
const centre = (q, r) => ({ x: SQ3 * q + (SQ3 / 2) * r, y: 1.5 * r })

/** A pointy-top hexagon of side `s` about (cx, cy), from the top clockwise. */
const hex = (cx, cy, s) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (-90 + 60 * k)
    return [cx + s * Math.cos(a), cy + s * Math.sin(a)]
  })

/** The band across a tile's foot, as the hive lays a name over a picture:
 *  the slice of the hexagon between two heights. */
const band = (cx, cy, s, top, bottom) => {
  const half = (y) => (Math.abs(y) <= s / 2 ? (SQ3 / 2) * s : (s - Math.abs(y)) * SQ3)
  return [[cx - half(top), cy + top], [cx + half(top), cy + top], [cx + half(bottom), cy + bottom], [cx - half(bottom), cy + bottom]]
}

/** One tile, drawn the way the canvas draws it. */
const tile = (cx, cy, s, look) => {
  const outer = hex(cx, cy, s - 2.5)
  const inner = hex(cx, cy, s - 6)
  const out = []
  // the ground
  out.push(`<path d="${P(outer)}" fill="${look.fill}"${look.fillOpacity != null ? ` fill-opacity="${look.fillOpacity}"` : ''}/>`)
  // a picture: a quiet wash and the name band across the foot
  if (look.picture) {
    out.push(`<path d="${P(outer)}" fill="url(#wash)"/>`)
    out.push(`<path d="${P(band(cx, cy, s - 2.5, s * 0.28, s * 0.62))}" fill="var(--ink)" fill-opacity=".55"/>`)
    out.push(`<rect x="${f(cx - s * 0.34)}" y="${f(cy + s * 0.4)}" width="${f(s * 0.68)}" height="${f(s * 0.09)}" rx="1" fill="#fff" fill-opacity=".8"/>`)
  }
  // the mark: the brand's hexagon-in-a-hexagon
  if (look.mark) {
    out.push(`<path d="${P(hex(cx, cy, s * 0.42))}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="2.2" stroke-linejoin="round"/>`)
    out.push(`<path d="${P(hex(cx, cy, s * 0.17))}" fill="#fff" fill-opacity=".9"/>`)
  }
  // the inner glow, the bevel (light from the top left), the rim
  out.push(`<path d="${P(inner)}" fill="none" stroke="var(--line)" stroke-opacity=".55" stroke-width="2"/>`)
  out.push(`<path d="${P([outer[4], outer[5], outer[0], outer[1]], false)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>`)
  out.push(`<path d="${P([outer[1], outer[2], outer[3], outer[4]], false)}" fill="none" stroke="var(--ink)" stroke-opacity=".14" stroke-width="1.6"/>`)
  out.push(`<path d="${P(outer)}" fill="none" stroke="var(--line)" stroke-width="1.2" stroke-linejoin="round"/>`)
  return out.join('')
}

/**
 * The comb. `cx, cy` place its centre in a 1440×900 frame, `side` is a
 * tile's side, `seed` decides which tiles wear colour.
 */
function honeycombArt(seed, { cx = 1262, cy = 300, side = 42 } = {}) {
  const rnd = rng(seed)
  const tones = ['var(--accent)', 'var(--second)', 'var(--honey)', 'var(--steel)']
  const cells = []
  // Two full rings always; the third ring ragged; the fourth only as ghosts.
  const solid = new Set()
  for (let k = 0; k < 19; k++) solid.add(k)
  for (let k = 19; k < 37; k++) if (rnd() < 0.4) solid.add(k)
  // Which solid tiles wear a tone, which carry a picture. Never neighbours
  // all at once: one in four, chosen by the seed.
  const worn = new Map()
  for (const k of solid) {
    if (k === 0) continue
    const roll = rnd()
    if (roll < 0.14) worn.set(k, { fill: tones[Math.floor(rnd() * tones.length)], fillOpacity: 0.85 })
    else if (roll < 0.26) worn.set(k, { fill: 'var(--soft)', picture: true })
  }
  for (let k = 0; k < 61; k++) {
    const { q, r } = spiralAxial(k)
    const c = centre(q, r)
    const x = cx + c.x * side, y = cy + c.y * side
    if (k === 0) cells.push(tile(x, y, side, { fill: 'var(--accent)', mark: true }))
    else if (solid.has(k)) cells.push(tile(x, y, side, worn.get(k) ?? { fill: k % 3 ? 'var(--surface)' : 'var(--soft)' }))
    else {
      // a ghost cell: the grid going on, fainter the further out
      const ring = k < 37 ? 3 : 4
      cells.push(`<path d="${P(hex(x, y, side - 2.5))}" fill="none" stroke="var(--line)" stroke-opacity="${ring === 3 ? 0.4 : 0.16}" stroke-width="1"/>`)
    }
  }
  return `<svg class="art" viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMin slice" aria-hidden="true" focusable="false">
<defs>
<linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--steel)" stop-opacity=".35"/><stop offset="1" stop-color="var(--honey)" stop-opacity=".25"/></linearGradient>
<filter id="comb-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".14"/></filter>
</defs>
<g filter="url(#comb-shadow)">${cells.join('')}</g>
</svg>`
}

module.exports = { honeycombArt }
