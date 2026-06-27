// scripts/backgrounds/gen-tile-themes.mjs
//
// Generates themed PER-TILE background image sets (the "tile backgrounds with
// themes" feature). Each theme is a curated collection of distinct 512×512
// images; a wall of tiles drawing from one set reads as varied-but-coherent.
// Output: public/substrate/theme-<id>/<n>.png + manifest.json (3 public dirs),
// SVG sources under the background textures tree. Register each set as a
// built-in substrate source so /substrate set <theme> switches the tiles.
//
// Run from the monorepo root (src/):  node scripts/backgrounds/gen-tile-themes.mjs

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const W = 512, H = 512, C = 256
const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`
const bg = (f) => `<rect width="${W}" height="${H}" fill="${f}"/>`
const vlin = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient>`
const rad = (id, cx, cy, r, c, a0, a1 = 0) => `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%"><stop offset="0%" stop-color="${c}" stop-opacity="${a0}"/><stop offset="70%" stop-color="${c}" stop-opacity="${a1}"/></radialGradient>`
const vig = (id, c, a) => `<radialGradient id="${id}" cx="50%" cy="44%" r="80%"><stop offset="52%" stop-color="${c}" stop-opacity="0"/><stop offset="100%" stop-color="${c}" stop-opacity="${a}"/></radialGradient>`
const hexPts = (cx, cy, s) => [[cx + s, cy], [cx + s / 2, cy + s * 0.866], [cx - s / 2, cy + s * 0.866], [cx - s, cy], [cx - s / 2, cy - s * 0.866], [cx + s / 2, cy - s * 0.866]].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

// ── Minimal: refined solid tones + one quiet treatment ───────────────
const MIN_TONES = [
  ['#2b3640', '#9fb4c4'], ['#1b1f27', '#7c8794'], ['#2e3a33', '#9ec0ab'],
  ['#3a2c28', '#c79c84'], ['#222a33', '#8ea4b6'], ['#33302b', '#bcae97'],
]
const minimal = (i) => {
  const [base, accent] = MIN_TONES[i]
  const t = i % 6
  const defs = []
  const layers = [bg(base)]
  if (t === 0) { defs.push(rad('g', 50, 8, 80, accent, 0.16)); layers.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`) }
  else if (t === 1) { defs.push(rad('g', 50, 50, 60, accent, 0.14)); layers.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`) }
  else if (t === 2) { defs.push(vlin('g', base, accent + '22')); layers.push(`<rect width="${W}" height="${H}" fill="url(#g)" opacity="0.5"/>`) }
  else if (t === 3) { layers.push(`<rect x="0" y="${C + 70}" width="${W}" height="3" fill="${accent}" opacity="0.55"/>`, `<rect width="${W}" height="${H}" fill="url(#g)"/>`); defs.push(rad('g', 50, 60, 70, accent, 0.10)) }
  else if (t === 4) { defs.push(rad('g', 50, 44, 70, accent, 0.10)); layers.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`, `<circle cx="${C}" cy="${C}" r="34" fill="none" stroke="${accent}" stroke-width="2.5" stroke-opacity="0.5"/>`) }
  else { layers.push() }
  defs.push(vig('v', '#04060a', 0.4))
  layers.push(`<rect width="${W}" height="${H}" fill="url(#v)"/>`)
  return svg(`<defs>${defs.join('')}</defs>${layers.join('')}`)
}

// ── Geometric: bold two-colour patterns ──────────────────────────────
const GEO = [
  ['#10243a', '#4f9fd6'], ['#241033', '#a877e0'], ['#0e2a24', '#3fc7a0'],
  ['#2a1410', '#e0894a'], ['#171a1f', '#c2c8d0'], ['#2a1022', '#e0689a'],
]
const geometric = (i) => {
  const [base, accent] = GEO[i]
  const k = i % 6
  let art = ''
  if (k === 0) { // concentric hexagons
    let h = ''; for (let r = 36; r <= 360; r += 40) h += `<polygon points="${hexPts(C, C, r)}"/>`
    art = `<g fill="none" stroke="${accent}" stroke-width="4" stroke-opacity="0.5">${h}</g>`
  } else if (k === 1) { // sunburst wedges
    let g = ''; const n = 24; for (let j = 0; j < n; j++) { if (j % 2) continue; const a0 = (j / n) * 2 * Math.PI, a1 = ((j + 1) / n) * 2 * Math.PI; const R = 460; g += `<polygon points="${C},${C} ${(C + Math.cos(a0) * R).toFixed(1)},${(C + Math.sin(a0) * R).toFixed(1)} ${(C + Math.cos(a1) * R).toFixed(1)},${(C + Math.sin(a1) * R).toFixed(1)}" fill="${accent}" fill-opacity="0.3"/>` }
    art = g
  } else if (k === 2) { // concentric circles
    let c = ''; for (let r = 30; r <= 360; r += 34) c += `<circle cx="${C}" cy="${C}" r="${r}"/>`
    art = `<g fill="none" stroke="${accent}" stroke-width="3.5" stroke-opacity="0.45">${c}</g>`
  } else if (k === 3) { // diamond grid
    art = `<defs><pattern id="d" width="58" height="58" patternUnits="userSpaceOnUse"><path d="M29 0 L58 29 L29 58 L0 29 Z" fill="none" stroke="${accent}" stroke-width="2.5" stroke-opacity="0.4"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#d)"/>`
  } else if (k === 4) { // chevron rows
    art = `<defs><pattern id="c" width="72" height="36" patternUnits="userSpaceOnUse"><polyline points="0,36 36,4 72,36" fill="none" stroke="${accent}" stroke-width="3" stroke-opacity="0.4"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#c)"/>`
  } else { // triangle/grid lattice
    art = `<defs><pattern id="t" width="52" height="52" patternUnits="userSpaceOnUse"><path d="M52 0H0V52" fill="none" stroke="${accent}" stroke-width="2" stroke-opacity="0.35"/><circle cx="0" cy="0" r="2.4" fill="${accent}" fill-opacity="0.5"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#t)"/>`
  }
  return svg(`<defs>${rad('cg', 50, 44, 70, accent, 0.14)}${vig('v', '#03040799', 0.45)}</defs>${bg(base)}${art}<rect width="${W}" height="${H}" fill="url(#cg)"/><rect width="${W}" height="${H}" fill="url(#v)"/>`)
}

// ── Abstract: organic gradient compositions ──────────────────────────
const ABS = [
  { base: '#141026', c1: '#7d5cff', c2: '#ff7eb6', c3: '#41c7ff' },
  { base: '#06121a', c1: '#27d0c0', c2: '#3f7bd8', c3: '#9be59a' },
  { base: '#1a0e12', c1: '#ff8a5b', c2: '#ffd166', c3: '#ef476f' },
  { base: '#0c1622', c1: '#4f9fd6', c2: '#8a7bff', c3: '#36d1a8' },
  { base: '#1c1430', c1: '#c77dff', c2: '#ff9ec7', c3: '#7ab8ff' },
  { base: '#08160f', c1: '#52d68b', c2: '#bfe35a', c3: '#39b3c7' },
]
const abstract = (i) => {
  const p = ABS[i]; const k = i % 6
  let art = '', defs = ''
  if (k === 0 || k === 3) { defs = rad('a', 24, 22, 60, p.c1, 0.55) + rad('b', 80, 78, 64, p.c2, 0.5) + rad('d', 64, 30, 50, p.c3, 0.4); art = `<rect width="${W}" height="${H}" fill="url(#a)"/><rect width="${W}" height="${H}" fill="url(#b)"/><rect width="${W}" height="${H}" fill="url(#d)"/>` }
  else if (k === 1 || k === 4) { defs = `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${p.c1}" stop-opacity="0.7"/><stop offset="45%" stop-color="${p.c2}" stop-opacity="0.55"/><stop offset="100%" stop-color="${p.c3}" stop-opacity="0.6"/></linearGradient>`; art = `<rect width="${W}" height="${H}" fill="url(#a)"/>` }
  else { defs = rad('a', 50, 50, 65, p.c1, 0.7); art = `<rect width="${W}" height="${H}" fill="url(#a)"/><circle cx="170" cy="190" r="150" fill="${p.c2}" opacity="0.35"/><circle cx="340" cy="320" r="170" fill="${p.c3}" opacity="0.3"/>` }
  return svg(`<defs>${defs}${vig('v', '#02030699', 0.4)}</defs>${bg(p.base)}${art}<rect width="${W}" height="${H}" fill="url(#v)"/>`)
}

// ── Nature: stylized vector scenes ───────────────────────────────────
const nature = (i) => {
  const k = i % 6
  if (k === 0) // rolling hills
    return svg(`<defs>${vlin('sky', '#bfe3f0', '#eaf6e6')}</defs>${'<rect width="512" height="512" fill="url(#sky)"/>'}<circle cx="380" cy="120" r="46" fill="#ffe9a8"/><path d="M0 360 Q128 300 256 350 T512 340 V512 H0 Z" fill="#8fce8a"/><path d="M0 410 Q160 360 320 400 T512 395 V512 H0 Z" fill="#5fae74"/><path d="M0 460 Q140 430 300 455 T512 450 V512 H0 Z" fill="#3c8159"/>`)
  if (k === 1) // ocean waves
    return svg(`<defs>${vlin('sea', '#7fd4e0', '#0f5d80')}</defs><rect width="512" height="512" fill="url(#sea)"/><g fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="5">${[120, 200, 280, 360, 440].map(y => `<path d="M0 ${y} Q128 ${y - 26} 256 ${y} T512 ${y}"/>`).join('')}</g>`)
  if (k === 2) // sunset
    return svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2a2350"/><stop offset="45%" stop-color="#e0617a"/><stop offset="80%" stop-color="#ffb36b"/><stop offset="100%" stop-color="#ffd9a0"/></linearGradient></defs><rect width="512" height="512" fill="url(#s)"/><circle cx="256" cy="300" r="80" fill="#fff1c9" opacity="0.95"/><path d="M0 380 H512 V512 H0 Z" fill="#3a2740" opacity="0.55"/>`)
  if (k === 3) // mountains
    return svg(`<defs>${vlin('sky', '#9ec9e8', '#dfeef5')}</defs><rect width="512" height="512" fill="url(#sky)"/><polygon points="-20,420 150,180 320,420" fill="#5b6f86"/><polygon points="150,180 200,250 110,260" fill="#eef4f8"/><polygon points="200,430 360,210 540,430" fill="#43566b"/><polygon points="360,210 405,275 312,282" fill="#eef4f8"/><rect x="0" y="420" width="512" height="92" fill="#34465a"/>`)
  if (k === 4) // desert dunes
    return svg(`<defs>${vlin('sky', '#fbe6c2', '#f6cfa0')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="150" cy="140" r="40" fill="#fff3da" opacity="0.9"/><path d="M0 300 Q170 250 360 300 T560 300 V512 H0 Z" fill="#e7b378"/><path d="M0 380 Q200 330 400 380 T620 380 V512 H0 Z" fill="#cf9558"/><path d="M0 450 Q180 415 380 450 T640 450 V512 H0 Z" fill="#a9743f"/>`)
  // night sky
  return svg(`<defs>${vlin('n', '#0b1230', '#243a6b')}</defs><rect width="512" height="512" fill="url(#n)"/><circle cx="350" cy="140" r="54" fill="#eef0ff"/><circle cx="332" cy="128" r="54" fill="#243a6b"/>${[[80, 90], [160, 200], [230, 70], [120, 320], [300, 380], [420, 260], [70, 440], [400, 440], [260, 250]].map(([x, y], n2) => `<circle cx="${x}" cy="${y}" r="${1.5 + (n2 % 3) * 0.8}" fill="#ffffff" fill-opacity="0.85"/>`).join('')}`)
}

const THEMES = [
  { id: 'theme-minimal', label: 'Minimal', build: minimal },
  { id: 'theme-geometric', label: 'Geometric', build: geometric },
  { id: 'theme-abstract', label: 'Abstract', build: abstract },
  { id: 'theme-nature', label: 'Nature', build: nature },
]
const COUNT = 6

const PUBLIC_DIRS = [
  'hypercomb-web/public/substrate',
  'hypercomb-dev/public/substrate',
  'shared-public/substrate',
].filter(d => existsSync(d.split('/substrate')[0]))
const SRC_DIR = 'hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/textures/tile-themes'

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  for (const t of THEMES) {
    await mkdir(`${SRC_DIR}/${t.id}`, { recursive: true })
    for (const dir of PUBLIC_DIRS) await mkdir(`${dir}/${t.id}`, { recursive: true })
    const names = []
    for (let i = 0; i < COUNT; i++) {
      const name = `${i + 1}`
      const s = t.build(i)
      await writeFile(`${SRC_DIR}/${t.id}/${name}.svg`, s)
      await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}svg{display:block}</style><body>${s}</body>`, { waitUntil: 'load' })
      const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } })
      for (const dir of PUBLIC_DIRS) await writeFile(`${dir}/${t.id}/${name}.png`, png)
      names.push(`${name}.png`)
    }
    const manifest = JSON.stringify({ images: names }, null, 2)
    for (const dir of PUBLIC_DIRS) await writeFile(`${dir}/${t.id}/manifest.json`, manifest)
    console.log(`✓ ${t.label.padEnd(10)} → ${COUNT} png × ${PUBLIC_DIRS.length} dirs`)
  }
  await browser.close()
}
run().catch(e => { console.error(e); process.exit(1) })
