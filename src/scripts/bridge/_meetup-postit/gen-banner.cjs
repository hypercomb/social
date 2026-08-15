// Meetup post-it hero banner — 1600x760 PNG, NO text.
// The concept IS the product: a hive of hexagonal tiles holding real things —
// pictures, notes, collections, links — dense and lit at the edges, thinning
// into bare lattice so the headline sits on quiet ground.
const { chromium } = require('C:/Projects/hypercomb/social/src/node_modules/playwright')
const path = require('path')

const OUT = path.join(__dirname, 'meetup-banner.png')
const W = 1600, H = 760

function mulberry(a) {           // deterministic — same banner every run
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry(20260814)
const pick = arr => arr[Math.floor(rnd() * arr.length)]

const R = 58                      // hex circumradius (pointy-top)
const dx = R * Math.sqrt(3)
const dy = R * 1.5
const hexPath = (cx, cy, r) => {
  const p = []
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90)
    p.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return 'M' + p.join(' L') + ' Z'
}

// ── tile contents: what a hive actually holds ─────────────────────────
const SKIES = [['#2e6f9e', '#8fc7e8'], ['#7a3f6d', '#e0925f'], ['#1f6b5e', '#8fd3a8'],
               ['#3a4d8f', '#9aa8e0'], ['#8a4b28', '#e8b56a'], ['#245d75', '#7fbfd4']]

function picture(id, cx, cy, r) {   // a photo tile — sky, horizon, a hill, a sun
  const [a, b] = pick(SKIES)
  const h = cy + r * (0.10 + rnd() * 0.22)
  const sun = rnd() > 0.45
  return `<g clip-path="url(#c${id})">
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="url(#sky${id})"/>
    ${sun ? `<circle cx="${(cx + (rnd() - 0.5) * r).toFixed(1)}" cy="${(h - r * 0.42).toFixed(1)}" r="${(r * 0.17).toFixed(1)}" fill="#ffe9a8" opacity="0.9"/>` : ''}
    <path d="M${cx - r} ${h + r * 0.30} Q ${cx - r * 0.35} ${h - r * 0.26} ${cx + r * 0.10} ${h + r * 0.16} Q ${cx + r * 0.55} ${h - r * 0.12} ${cx + r} ${h + r * 0.34} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z" fill="#15202b" opacity="0.82"/>
    <path d="M${cx - r} ${h + r * 0.62} Q ${cx - r * 0.2} ${h + r * 0.20} ${cx + r} ${h + r * 0.70} L${cx + r} ${cy + r} L${cx - r} ${cy + r} Z" fill="#0d151d" opacity="0.9"/>
  </g>
  <defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
}

function note(id, cx, cy, r) {      // a note tile — cream paper, ruled lines
  const lines = []
  for (let i = 0; i < 4; i++) {
    const y = cy - r * 0.34 + i * r * 0.24
    const w = r * (0.72 - rnd() * 0.28)
    lines.push(`<rect x="${(cx - r * 0.46).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${(r * 0.075).toFixed(1)}" rx="${(r * 0.037).toFixed(1)}" fill="#8a6a0a" opacity="${i ? 0.45 : 0.75}"/>`)
  }
  return `<g clip-path="url(#c${id})">
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="url(#paper)"/>
    ${lines.join('')}
  </g>`
}

function collection(id, cx, cy, r) { // a collection tile — a little comb inside
  const s = r * 0.27, kids = [[0, -s * 1.1], [-s * 0.95, s * 0.45], [s * 0.95, s * 0.45]]
  return `<g clip-path="url(#c${id})">
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#1c2733"/>
    ${kids.map((k, i) => `<path d="${hexPath(cx + k[0], cy + k[1], s * 0.82)}" fill="#d9a514" opacity="${0.9 - i * 0.18}"/>`).join('')}
  </g>`
}

function seed(id, cx, cy, r) {       // an empty tile, waiting — just a mark
  return `<g clip-path="url(#c${id})">
    <rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" fill="#18222d"/>
    <circle cx="${cx}" cy="${cy}" r="${(r * 0.14).toFixed(1)}" fill="#d9a514" opacity="0.55"/>
  </g>`
}

const KINDS = [picture, picture, picture, note, note, collection, seed]

// ── layout: fill the field, density falls off toward the headline ─────
const clips = [], tiles = [], lattice = []
let id = 0
for (let row = -1; (row - 1) * dy < H + dy; row++) {
  for (let col = -1; (col - 1) * dx < W + dx; col++) {
    const cx = col * dx + (row % 2 ? dx / 2 : 0)
    const cy = row * dy
    lattice.push(hexPath(cx, cy, R))
    const nx = (cx - W / 2) / (W / 2)
    const ny = (cy - H * 0.46) / (H / 2)
    const d = Math.sqrt(nx * nx * 0.62 + ny * ny)          // 0 at the headline
    if (rnd() > Math.min(0.9, Math.max(0, (d - 0.42) * 1.15))) continue
    const i = id++
    const op = Math.min(1, 0.34 + (d - 0.42) * 1.45)
    clips.push(`<clipPath id="c${i}"><path d="${hexPath(cx, cy, R * 0.9)}"/></clipPath>`)
    tiles.push(`<g opacity="${op.toFixed(2)}">${pick(KINDS)(i, cx, cy, R * 0.9)}
      <path d="${hexPath(cx, cy, R * 0.9)}" fill="none" stroke="#f2d488" stroke-width="1.8" opacity="0.35"/></g>`)
  }
}

const HTML = `<!doctype html><html><head><style>
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#0b0f14}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="ground" cx="0.5" cy="0.44" r="0.9">
      <stop offset="0" stop-color="#1a2430"/><stop offset="0.55" stop-color="#121a23"/><stop offset="1" stop-color="#0a0e13"/>
    </radialGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="#fef3b2"/><stop offset="1" stop-color="#f2cf6a"/>
    </linearGradient>
    <radialGradient id="scrim" cx="0.5" cy="0.46" r="0.62">
      <stop offset="0" stop-color="#0d131a" stop-opacity="0.90"/>
      <stop offset="0.5" stop-color="#0d131a" stop-opacity="0.52"/>
      <stop offset="1" stop-color="#0d131a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="warm" cx="0.5" cy="1" r="0.75">
      <stop offset="0" stop-color="#d9a514" stop-opacity="0.22"/><stop offset="1" stop-color="#d9a514" stop-opacity="0"/>
    </radialGradient>
    <filter id="bloom" x="-25%" y="-25%" width="150%" height="150%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
    ${clips.join('')}
  </defs>

  <rect width="${W}" height="${H}" fill="url(#ground)"/>
  <g fill="none" stroke="#26313f" stroke-width="1.6" opacity="0.8">${lattice.map(d => `<path d="${d}"/>`).join('')}</g>
  <g filter="url(#bloom)" opacity="0.35">${tiles.join('')}</g>
  <g>${tiles.join('')}</g>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect width="${W}" height="${H}" fill="url(#warm)"/>
</svg>
</body></html>`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H } })
  await page.setContent(HTML, { waitUntil: 'load' })
  await page.screenshot({ path: OUT, type: 'png' })
  await page.screenshot({ path: OUT.replace(/\.png$/, '.jpg'), type: 'jpeg', quality: 82 })
  await browser.close()
  console.log('wrote', OUT, 'tiles:', id)
})()
