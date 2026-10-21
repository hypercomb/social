// One cracked hexagon, drawn from scratch for each page.
//
// Cracked is the idea, not a picture of a wall. A large flat hexagon has
// fractured from one point: crack lines run from the impact to the edges and
// divide it into shards, and each shard has shifted a few pixels outward, so
// the gaps between them show the warm ground beneath. A few hairlines run on
// past the hexagon's edge into the page. Flat shapes, two tones, crisp
// edges. Seeded by the page, so the same page is always the same bytes;
// nothing tiles and nothing repeats. Every colour is a token, so it reads in
// both themes.

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

/** Six corners of a flat-topped hexagon, clockwise from the right. */
const hexCorners = (cx, cy, R) =>
  Array.from({ length: 6 }, (_, k) => [cx + R * Math.cos((Math.PI / 3) * k), cy + R * Math.sin((Math.PI / 3) * k)])

/** Where a ray from (x, y) at `angle` leaves a convex polygon, and on which edge. */
const exitOf = (x, y, angle, poly) => {
  const dx = Math.cos(angle), dy = Math.sin(angle)
  let best = null
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length]
    const ex = bx - ax, ey = by - ay
    const den = dx * ey - dy * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((ax - x) * ey - (ay - y) * ex) / den
    const u = ((ax - x) * dy - (ay - y) * dx) / den
    if (t > 0 && u >= 0 && u <= 1 && (!best || t < best.t)) best = { t, edge: i, x: x + dx * t, y: y + dy * t }
  }
  return best
}

/** A hairline as a filled shape, widest at its start and tapering to a point. */
const taper = (pts, w0) => {
  const n = pts.length
  const left = [], right = []
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i]
    const [px, py] = pts[Math.max(0, i - 1)], [nx, ny] = pts[Math.min(n - 1, i + 1)]
    const dx = nx - px, dy = ny - py
    const len = Math.hypot(dx, dy) || 1
    const w = (w0 * (1 - i / (n - 1))) / 2 + 0.12
    left.push([x - (dy / len) * w, y + (dx / len) * w])
    right.push([x + (dy / len) * w, y - (dx / len) * w])
  }
  return `<path d="${P([...left, ...right.reverse()])}"/>`
}

/**
 * The hexagon. `cx, cy, R` place it in a 1440×900 frame; `impact` is where
 * it broke, relative to the centre; `seed` decides the fracture.
 */
function crackedHexArt(seed, { cx = 1205, cy = 350, R = 240, impact = { dx: 60, dy: -35 } } = {}) {
  const rnd = rng(seed)
  const hex = hexCorners(cx, cy, R)
  const ox = cx + impact.dx, oy = cy + impact.dy

  // THE CRACKS. Six to eight rays leave the impact on uneven angles. Each is
  // a polyline with one or two kinks and runs until it leaves the hexagon.
  const count = 6 + Math.floor(rnd() * 3)
  const base = rnd() * Math.PI * 2
  const rays = []
  for (let k = 0; k < count; k++) {
    const angle = base + (Math.PI * 2 * k) / count + (rnd() - 0.5) * 0.5
    const pts = [[ox, oy]]
    let a = angle
    const kinks = 1 + Math.floor(rnd() * 2)
    for (let i = 0; i < kinks; i++) {
      const [px, py] = pts[pts.length - 1]
      const l = R * (0.22 + rnd() * 0.25)
      a += (rnd() - 0.5) * 0.5
      pts.push([px + Math.cos(a) * l, py + Math.sin(a) * l])
    }
    const [px, py] = pts[pts.length - 1]
    const exit = exitOf(px, py, a, hex)
    if (!exit) continue
    pts.push([exit.x, exit.y])
    rays.push({ angle: Math.atan2(exit.y - oy, exit.x - ox), pts, edge: exit.edge, a })
  }
  rays.sort((p, q) => p.angle - q.angle)

  // THE SHARDS. Each lies between two neighbouring cracks and the run of
  // the hexagon's edge between their exits.
  const shards = rays.map((ray, k) => {
    const next = rays[(k + 1) % rays.length]
    const rim = []
    let e = ray.edge
    const steps = ((next.edge - ray.edge) % 6 + 6) % 6
    const same = steps === 0 && k < rays.length - 1
    for (let s = 0; s < (same ? 0 : steps || (k === rays.length - 1 && steps === 0 ? 6 : 0)); s++) {
      e = (e + 1) % 6
      rim.push(hex[e])
    }
    const poly = [...ray.pts, ...rim, ...[...next.pts].reverse()]
    // Pushed outward from the impact, by its own small distance.
    const mx = poly.reduce((s, p) => s + p[0], 0) / poly.length, my = poly.reduce((s, p) => s + p[1], 0) / poly.length
    const d = 3 + rnd() * 9
    const len = Math.hypot(mx - ox, my - oy) || 1
    return { poly, dx: ((mx - ox) / len) * d, dy: ((my - oy) / len) * d, tone: rnd() }
  })

  // Hairlines: two or three cracks carry on past the edge into the page, and
  // one shard carries a fine crack of its own that goes nowhere.
  const lines = []
  for (const ray of rays.filter(() => rnd() < 0.4).slice(0, 3)) {
    const [x, y] = ray.pts[ray.pts.length - 1]
    const a = ray.a + (rnd() - 0.5) * 0.3
    const l = 60 + rnd() * 110
    const mid = [x + Math.cos(a) * l * 0.55, y + Math.sin(a) * l * 0.55]
    lines.push(taper([[x, y], mid, [mid[0] + Math.cos(a + (rnd() - 0.5) * 0.5) * l * 0.45, mid[1] + Math.sin(a + (rnd() - 0.5) * 0.5) * l * 0.45]], 1.4))
  }
  for (const ray of rays.filter(() => rnd() < 0.35).slice(0, 2)) {
    const [x, y] = ray.pts[1]
    const a = ray.a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.4)
    const l = R * (0.12 + rnd() * 0.14)
    lines.push(taper([[x, y], [x + Math.cos(a) * l * 0.6, y + Math.sin(a) * l * 0.6], [x + Math.cos(a + 0.2) * l, y + Math.sin(a + 0.2) * l]], 1.2))
  }

  return `<svg class="art" viewBox="0 0 1440 900" preserveAspectRatio="xMaxYMin slice" aria-hidden="true" focusable="false">
<defs>
<filter id="shard-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".22"/></filter>
<linearGradient id="ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--brick-3)"/><stop offset="1" stop-color="var(--brick-2)"/></linearGradient>
</defs>
<path d="${P(hex)}" fill="url(#ground)"/>
<g filter="url(#shard-shadow)">${shards.map(s =>
    `<path d="${P(s.poly)}" transform="translate(${f(s.dx)} ${f(s.dy)})" fill="${s.tone < 0.3 ? 'var(--plaster-deep)' : 'var(--plaster)'}"/>`).join('')}</g>
<g fill="var(--crack)" fill-opacity=".8">${lines.join('')}</g>
<path d="M${f(ox)} ${f(oy - 9)}L${f(ox + 8)} ${f(oy - 4.5)}L${f(ox + 8)} ${f(oy + 4.5)}L${f(ox)} ${f(oy + 9)}L${f(ox - 8)} ${f(oy + 4.5)}L${f(ox - 8)} ${f(oy - 4.5)}Z" fill="var(--brick)"/>
</svg>`
}

module.exports = { crackedHexArt }
