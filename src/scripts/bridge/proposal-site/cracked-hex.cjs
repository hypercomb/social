// One cracked hexagon, drawn from scratch. A plaster slab in the shape of a
// large hexagon has broken open: inside the break the brick shows, chips of
// plaster flake at the rim, and the cracks run out of the break along and
// across the hexagon's own edges into the page. One composition per page,
// seeded, so the same page is always the same bytes — nothing repeats and
// nothing is tiled. Colours are CSS variables so the slab reads in both
// themes.

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

/** Six corners of a flat-topped hexagon. */
const hexCorners = (cx, cy, R) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  })

/** A closed outline whose every edge is broken into jittered segments, so
 *  the hexagon's own edge reads as a crack line. */
const jagged = (pts, rnd, amp, per = 7) => {
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
    const nx = -(y2 - y1), ny = x2 - x1
    const len = Math.hypot(nx, ny) || 1
    out.push([x1, y1])
    for (let s = 1; s < per; s++) {
      const t = s / per
      const off = (rnd() - 0.5) * 2 * amp * Math.sin(Math.PI * t)
      out.push([x1 + (x2 - x1) * t + (nx / len) * off, y1 + (y2 - y1) * t + (ny / len) * off])
    }
  }
  return out
}

const pathOf = (pts, close = true) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (close ? 'Z' : '')

/** A crack: a polyline that drifts as it goes and thins to nothing, drawn as
 *  segments of falling width. `branch` grows one side crack off it. */
const crack = (x, y, angle, length, width, rnd, depth = 0) => {
  const segs = 4 + Math.floor(rnd() * 4)
  const out = []
  let px = x, py = y, a = angle
  for (let s = 0; s < segs; s++) {
    const t = s / segs
    a += (rnd() - 0.5) * 0.9
    const l = (length / segs) * (0.6 + rnd() * 0.8)
    const nx = px + Math.cos(a) * l, ny = py + Math.sin(a) * l
    const w = width * (1 - t) + 0.25
    out.push(`<path d="M${f(px)} ${f(py)}L${f(nx)} ${f(ny)}" stroke-width="${f(w)}"/>`)
    if (depth < 2 && rnd() < 0.2) out.push(...crack(nx, ny, a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.8), length * 0.4, w * 0.7, rnd, depth + 1))
    px = nx; py = ny
  }
  return out
}

/** A single brick course laid by hand inside a region: offset rows, three
 *  tones, a few bricks missing or chipped — a wall, not a pattern. */
const bricks = (clipId, box, rnd) => {
  const h = 30, gap = 4
  const tones = ['var(--brick)', 'var(--brick-2)', 'var(--brick-3)']
  const out = []
  let row = 0
  for (let y = box.y; y < box.y + box.h; y += h + gap, row++) {
    let x = box.x - (row % 2 ? 44 : 0) - rnd() * 20
    while (x < box.x + box.w) {
      const w = 64 + rnd() * 40
      if (rnd() > 0.06) {
        const tone = tones[Math.floor(rnd() * tones.length)]
        out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${h}" rx="2.5" fill="${tone}"/>`)
        // a highlight along the top face and a shadow at the foot
        out.push(`<path d="M${f(x + 3)} ${f(y + 2)}H${f(x + w - 3)}" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"/>`)
        out.push(`<path d="M${f(x + 3)} ${f(y + h - 2)}H${f(x + w - 3)}" stroke="#000" stroke-opacity=".22" stroke-width="2"/>`)
      }
      x += w + gap
    }
  }
  return `<g clip-path="url(#${clipId})"><rect x="${f(box.x)}" y="${f(box.y)}" width="${f(box.w)}" height="${f(box.h)}" fill="var(--mortar)"/>${out.join('')}</g>`
}

/**
 * The slab. `cx, cy, R` place the hexagon in a 1440×900 frame; `hole` is
 * where it broke open, relative to the centre; `seed` decides the break.
 */
const slab = (id, { cx, cy, R, hole, seed }) => {
  const rnd = rng(seed)
  const corners = hexCorners(cx, cy, R)
  const outline = jagged(corners, rnd, 2.2, 9)

  // The break: a spiky polygon, radii swinging in and out like torn plaster.
  const hx = cx + hole.dx, hy = cy + hole.dy
  const n = 16
  const breakPts = Array.from({ length: n }, (_, k) => {
    const a = (Math.PI * 2 * k) / n + (rnd() - 0.5) * 0.25
    const r = hole.r * (k % 2 ? 0.55 + rnd() * 0.25 : 0.85 + rnd() * 0.35)
    return [hx + Math.cos(a) * r, hy + Math.sin(a) * r]
  })
  const breakPath = pathOf(jagged(breakPts, rnd, 3, 3))

  // Cracks leave the break at its spikes, run to the hexagon's edge, and on
  // past it into the page.
  const cracks = []
  for (let k = 0; k < n; k += 4) {
    const [x, y] = breakPts[k]
    const a = Math.atan2(y - hy, x - hx)
    cracks.push(...crack(x, y, a, R * (0.8 + rnd() * 0.7), 3.2, rnd))
  }
  // And a few start from the hexagon's own corners, so the edge is where the
  // break meets the shape.
  for (const [x, y] of corners) {
    if (rnd() < 0.4) cracks.push(...crack(x, y, Math.atan2(y - cy, x - cx) + (rnd() - 0.5), R * 0.35, 2, rnd))
  }

  // Flakes: chips of plaster lifting at the rim of the break.
  const chips = []
  for (let k = 1; k < n; k += 3) {
    const [x, y] = breakPts[k]
    const a = Math.atan2(y - hy, x - hx)
    const s = 10 + rnd() * 16
    const p = [[x, y], [x + Math.cos(a + 0.5) * s, y + Math.sin(a + 0.5) * s], [x + Math.cos(a - 0.4) * s * 1.3, y + Math.sin(a - 0.4) * s * 1.3]]
    chips.push(`<path d="${pathOf(p)}" fill="var(--plaster-deep)" stroke="var(--crack)" stroke-width=".8"/>`)
  }

  const box = { x: hx - hole.r * 1.3, y: hy - hole.r * 1.3, w: hole.r * 2.6, h: hole.r * 2.6 }
  return `
<clipPath id="${id}-hex"><path d="${pathOf(outline)}"/></clipPath>
<clipPath id="${id}-break"><path d="${breakPath}"/></clipPath>
<g filter="url(#slab-shadow)"><path d="${pathOf(outline)}" fill="var(--plaster)"/></g>
${bricks(`${id}-break`, box, rnd)}
<path d="${breakPath}" fill="none" stroke="var(--crack)" stroke-width="5" stroke-linejoin="round" stroke-opacity=".75"/>
<path d="${breakPath}" fill="none" stroke="#000" stroke-width="14" stroke-opacity=".18" stroke-linejoin="round" clip-path="url(#${id}-break)"/>
<g stroke="var(--crack)" stroke-linecap="round" fill="none" opacity=".8">${cracks.join('')}</g>
<path d="${pathOf(outline)}" fill="none" stroke="var(--crack)" stroke-width="1.6" stroke-linejoin="round"/>
<g>${chips.join('')}</g>`
}

/** The page's art: one large slab, top right, and a small one low left. */
function crackedHexArt(seed) {
  return `<svg class="art" viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMin slice" aria-hidden="true" focusable="false">
<defs>
<filter id="slab-shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".28"/></filter>
</defs>
${slab('a', { cx: 1290, cy: 250, R: 310, hole: { dx: 105, dy: -20, r: 118 }, seed })}
${slab('b', { cx: 100, cy: 930, R: 175, hole: { dx: 30, dy: -70, r: 56 }, seed: seed * 7 + 3 })}
</svg>`
}

module.exports = { crackedHexArt }
