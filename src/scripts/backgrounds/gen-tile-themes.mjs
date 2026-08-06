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
// TWENTY scenes — Nature is the ship default tile set, so a wall of tiles
// drawing from it should go a long way before a picture repeats. Each entry
// is one scene, indexed positionally: adding one here is adding a picture.
const stars = (pts) => pts.map(([x, y], n) => `<circle cx="${x}" cy="${y}" r="${1.5 + (n % 3) * 0.8}" fill="#ffffff" fill-opacity="0.85"/>`).join('')
/** A soft cloud: overlapping lobes riding a flat base, one tone throughout. */
const cloud = (x, y, s, o) =>
  `<g fill="#ffffff" fill-opacity="${o}">`
  + [[-0.95, 0.06, 0.5], [-0.34, -0.28, 0.66], [0.34, -0.16, 0.58], [0.95, 0.1, 0.44]]
    .map(([dx, dy, r]) => `<ellipse cx="${(x + dx * s).toFixed(1)}" cy="${(y + dy * s).toFixed(1)}" rx="${(r * s).toFixed(1)}" ry="${(r * s * 0.72).toFixed(1)}"/>`).join('')
  + `<rect x="${(x - s * 1.4).toFixed(1)}" y="${y.toFixed(1)}" width="${(s * 2.8).toFixed(1)}" height="${(s * 0.46).toFixed(1)}" rx="${(s * 0.23).toFixed(1)}"/></g>`

/** A river stone: a flattened pebble, bedded on its own shadow and lit along
 *  the upper rim — the light rides the edge, not the middle, or it reads as a
 *  bubble rather than a stone. */
const stone = (x, y, r, c) =>
  `<ellipse cx="${x}" cy="${(y + r * 0.1).toFixed(1)}" rx="${(r * 1.02).toFixed(1)}" ry="${(r * 0.62).toFixed(1)}" fill="#8ba07f" fill-opacity="0.26"/>`
  + `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(r * 0.62).toFixed(1)}" fill="${c}"/>`
  + `<ellipse cx="${x}" cy="${(y - r * 0.2).toFixed(1)}" rx="${(r * 0.72).toFixed(1)}" ry="${(r * 0.24).toFixed(1)}" fill="#ffffff" fill-opacity="0.16"/>`

/** Falling snow: pale flakes, softer and rounder than `stars`. */
const flakes = (pts) => pts.map(([x, y], n) => `<circle cx="${x}" cy="${y}" r="${2 + (n % 3) * 1.4}" fill="#ffffff" fill-opacity="${0.55 + (n % 2) * 0.25}"/>`).join('')

const NATURE_SCENES = [
  // 1 rolling hills
  () => svg(`<defs>${vlin('sky', '#bfe3f0', '#eaf6e6')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="380" cy="120" r="46" fill="#ffe9a8"/><path d="M0 360 Q128 300 256 350 T512 340 V512 H0 Z" fill="#8fce8a"/><path d="M0 410 Q160 360 320 400 T512 395 V512 H0 Z" fill="#5fae74"/><path d="M0 460 Q140 430 300 455 T512 450 V512 H0 Z" fill="#3c8159"/>`),
  // 2 ocean waves
  () => svg(`<defs>${vlin('sea', '#7fd4e0', '#0f5d80')}</defs><rect width="512" height="512" fill="url(#sea)"/><g fill="none" stroke="#ffffff" stroke-opacity="0.3" stroke-width="5">${[120, 200, 280, 360, 440].map(y => `<path d="M0 ${y} Q128 ${y - 26} 256 ${y} T512 ${y}"/>`).join('')}</g>`),
  // 3 sunset
  () => svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2a2350"/><stop offset="45%" stop-color="#e0617a"/><stop offset="80%" stop-color="#ffb36b"/><stop offset="100%" stop-color="#ffd9a0"/></linearGradient></defs><rect width="512" height="512" fill="url(#s)"/><circle cx="256" cy="300" r="80" fill="#fff1c9" opacity="0.95"/><path d="M0 380 H512 V512 H0 Z" fill="#3a2740" opacity="0.55"/>`),
  // 4 mountains
  () => svg(`<defs>${vlin('sky', '#9ec9e8', '#dfeef5')}</defs><rect width="512" height="512" fill="url(#sky)"/><polygon points="-20,420 150,180 320,420" fill="#5b6f86"/><polygon points="150,180 200,250 110,260" fill="#eef4f8"/><polygon points="200,430 360,210 540,430" fill="#43566b"/><polygon points="360,210 405,275 312,282" fill="#eef4f8"/><rect x="0" y="420" width="512" height="92" fill="#34465a"/>`),
  // 5 desert dunes
  () => svg(`<defs>${vlin('sky', '#fbe6c2', '#f6cfa0')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="150" cy="140" r="40" fill="#fff3da" opacity="0.9"/><path d="M0 300 Q170 250 360 300 T560 300 V512 H0 Z" fill="#e7b378"/><path d="M0 380 Q200 330 400 380 T620 380 V512 H0 Z" fill="#cf9558"/><path d="M0 450 Q180 415 380 450 T640 450 V512 H0 Z" fill="#a9743f"/>`),
  // 6 drifting clouds
  () => svg(`<defs>${vlin('sky', '#cfe6f7', '#f3f9fd')}</defs><rect width="512" height="512" fill="url(#sky)"/>${[[150, 148, 62, 0.85], [372, 250, 46, 0.7], [232, 382, 74, 0.62], [58, 302, 38, 0.5], [438, 92, 34, 0.55]].map(([x, y, s, o]) => cloud(x, y, s, o)).join('')}`),
  // 7 mossy river stones — a bed of overlapping pebbles, drawn top row first so
  // the nearer stones settle over the ones behind them
  () => svg(`<defs>${vlin('bg', '#dfe8d4', '#b1c3a0')}</defs><rect width="512" height="512" fill="url(#bg)"/>${[30, 125, 220, 315, 405, 490].flatMap((y, row) => [0, 1, 2, 3, 4].map(col => {
    const x = -18 + col * 118 + (row % 2 ? 60 : 0) + ((row * 7 + col * 13) % 5) * 6
    const r = 40 + ((row * 5 + col * 11) % 4) * 11
    return stone(x, y + ((row * 3 + col * 7) % 4) * 7, r, ['#c6d0b9', '#adbca4', '#d6dcc9', '#b9c8b1', '#a1b199'][(row * 3 + col) % 5])
  })).join('')}`),
  // 8 birch woods
  () => svg(`<defs>${vlin('sky', '#e8f1e2', '#c9dcc2')}</defs><rect width="512" height="512" fill="url(#sky)"/>${[40, 120, 210, 300, 385, 465].map((x, n) => `<rect x="${x}" y="0" width="${20 + (n % 3) * 6}" height="512" fill="#f4f2ea"/><rect x="${x}" y="0" width="${5 + (n % 2) * 3}" height="512" fill="#d9d6c8"/>` + [70, 180, 290, 400].map(y => `<rect x="${x + 2}" y="${y + n * 13 % 60}" width="${13 + (n % 3) * 4}" height="6" rx="3" fill="#3c4038" fill-opacity="0.7"/>`).join('')).join('')}<path d="M0 470 H512 V512 H0 Z" fill="#6f8a5e"/>`),
  // 9 autumn maples
  () => svg(`<defs>${vlin('sky', '#ffe8c4', '#ffd39a')}</defs><rect width="512" height="512" fill="url(#sky)"/><path d="M0 400 H512 V512 H0 Z" fill="#b5762f"/>${[[120, 230, 96, '#d8552f'], [270, 190, 118, '#e8892c'], [400, 250, 88, '#c9a12e']].map(([x, y, r, c]) => `<rect x="${x - 8}" y="${y}" width="16" height="${400 - y}" fill="#5b3a22"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * 0.5}" cy="${y + r * 0.3}" r="${r * 0.6}" fill="${c}" fill-opacity="0.85"/><circle cx="${x + r * 0.55}" cy="${y + r * 0.2}" r="${r * 0.55}" fill="${c}" fill-opacity="0.9"/>`).join('')}`),
  // 10 waterfall
  () => svg(`<defs>${vlin('w', '#eaf8ff', '#8fc9e8')}</defs><rect width="512" height="512" fill="#2f4a3c"/><polygon points="0,0 150,0 200,512 0,512" fill="#3d5c4a"/><polygon points="512,0 360,0 320,512 512,512" fill="#35513f"/><rect x="180" y="0" width="150" height="430" fill="url(#w)"/><g fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="4">${[200, 235, 270, 305].map(x => `<path d="M${x} 20 Q${x + 10} 200 ${x} 420"/>`).join('')}</g><ellipse cx="255" cy="446" rx="140" ry="40" fill="#bfe6f4"/><ellipse cx="255" cy="446" rx="90" ry="24" fill="#ffffff" fill-opacity="0.7"/><rect x="0" y="470" width="512" height="42" fill="#79b3cc"/>`),
  // 11 lake reflection
  () => svg(`<defs>${vlin('sky', '#ffd9a8', '#ffb0a0')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="256" cy="180" r="52" fill="#fff2d0"/><polygon points="-20,256 140,110 300,256" fill="#6a5a76"/><polygon points="210,256 370,130 540,256" fill="#54465f"/><rect x="0" y="256" width="512" height="256" fill="#8a6f88"/><polygon points="-20,256 140,402 300,256" fill="#7a6a86" fill-opacity="0.8"/><polygon points="210,256 370,382 540,256" fill="#64566f" fill-opacity="0.8"/><circle cx="256" cy="332" r="52" fill="#ffe9c4" fill-opacity="0.5"/><g stroke="#ffffff" stroke-opacity="0.28" stroke-width="4">${[300, 350, 400, 450].map(y => `<path d="M40 ${y} H472" fill="none"/>`).join('')}</g>`),
  // 12 meadow flowers
  () => svg(`<defs>${vlin('sky', '#dff0ff', '#f4fbe8')}</defs><rect width="512" height="512" fill="url(#sky)"/><path d="M0 300 Q256 250 512 300 V512 H0 Z" fill="#8bc36a"/><path d="M0 380 Q256 340 512 380 V512 H0 Z" fill="#66a84f"/>${[[70, 400, '#ffffff'], [150, 450, '#ffd447'], [230, 400, '#ef6f8a'], [300, 470, '#ffffff'], [370, 415, '#c07de0'], [450, 460, '#ffd447'], [110, 350, '#ef6f8a'], [420, 350, '#ffffff']].map(([x, y, c]) => `<rect x="${x - 2}" y="${y}" width="4" height="46" fill="#3f7a3c"/>${[0, 1, 2, 3, 4].map(p => { const a = (p / 5) * 2 * Math.PI; return `<circle cx="${(x + Math.cos(a) * 9).toFixed(1)}" cy="${(y + Math.sin(a) * 9).toFixed(1)}" r="7" fill="${c}"/>` }).join('')}<circle cx="${x}" cy="${y}" r="5" fill="#f7b32b"/>`).join('')}`),
  // 13 aurora
  () => svg(`<defs>${vlin('n', '#050b1c', '#0e2340')}<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4affc0" stop-opacity="0"/><stop offset="45%" stop-color="#4affc0" stop-opacity="0.75"/><stop offset="100%" stop-color="#5a8cff" stop-opacity="0"/></linearGradient></defs><rect width="512" height="512" fill="url(#n)"/>${stars([[60, 60], [180, 40], [300, 90], [430, 50], [470, 160], [90, 180], [250, 150]])}<g fill="url(#a)">${[[60, 120], [150, 90], [250, 130], [340, 100], [420, 140]].map(([x, w]) => `<path d="M${x} 40 Q${x + 50} 200 ${x - 20} 400 L${x - 20 + w} 400 Q${x + 50 + w} 200 ${x + w} 40 Z"/>`).join('')}</g><path d="M0 430 Q128 400 256 425 T512 415 V512 H0 Z" fill="#0a1a2c"/>`),
  // 14 tropical beach
  () => svg(`<defs>${vlin('sky', '#8fdcf0', '#ffeec4')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="410" cy="100" r="44" fill="#fff6cf"/><rect x="0" y="300" width="512" height="80" fill="#39b6c9"/><rect x="0" y="360" width="512" height="152" fill="#f2dfae"/><g fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="5"><path d="M0 350 Q120 336 256 350 T512 344"/></g><rect x="106" y="150" width="16" height="215" fill="#7a5326" transform="rotate(-6 114 260)"/>${[[-70, -30], [-25, -55], [25, -55], [70, -28], [0, -66]].map(([dx, dy]) => `<ellipse cx="${114 + dx}" cy="${168 + dy}" rx="60" ry="18" fill="#2e8b57" transform="rotate(${dx * 0.5} ${114 + dx} ${168 + dy})"/>`).join('')}`),
  // 15 canyon
  () => svg(`<defs>${vlin('sky', '#ffd9a0', '#f4a978')}</defs><rect width="512" height="512" fill="url(#sky)"/><polygon points="0,140 190,180 210,512 0,512" fill="#a4522f"/><polygon points="0,200 150,240 165,512 0,512" fill="#8a3f26"/><polygon points="512,120 320,170 300,512 512,512" fill="#b25c33"/><polygon points="512,190 380,230 365,512 512,512" fill="#93472a"/><path d="M210 512 Q256 380 300 512 Z" fill="#5f7f8c"/><g stroke="#00000022" stroke-width="6" fill="none"><path d="M0 260 H190"/><path d="M0 330 H185"/><path d="M512 250 H320"/><path d="M512 330 H310"/></g>`),
  // 16 snowfall over drifts
  () => svg(`<defs>${vlin('sky', '#dbe8f5', '#f6fafd')}</defs><rect width="512" height="512" fill="url(#sky)"/><path d="M0 300 Q140 266 268 296 T512 282 V512 H0 Z" fill="#e7f0f9"/><path d="M0 372 Q160 338 300 368 T512 356 V512 H0 Z" fill="#f1f7fc"/><path d="M0 442 Q150 416 300 440 T512 430 V512 H0 Z" fill="#fbfdff"/>${flakes([[40, 60], [130, 120], [220, 70], [330, 130], [440, 80], [480, 200], [90, 210], [270, 210], [180, 270], [400, 250], [60, 330], [350, 340], [240, 150], [460, 380]])}`),
  // 17 bamboo grove
  () => svg(`<defs>${vlin('bg', '#dff0d8', '#b7d9b0')}</defs><rect width="512" height="512" fill="url(#bg)"/>${[30, 105, 190, 265, 345, 430].map((x, n) => { const w = 22 + (n % 3) * 8; return `<rect x="${x}" y="0" width="${w}" height="512" fill="${n % 2 ? '#6fa860' : '#84bd6e'}"/><rect x="${x}" y="0" width="${w * 0.28}" height="512" fill="#ffffff" fill-opacity="0.18"/>` + [40, 140, 240, 340, 450].map(y => `<rect x="${x - 3}" y="${y + (n * 17) % 70}" width="${w + 6}" height="7" rx="3" fill="#4d7f45"/>`).join('') }).join('')}${[[80, 120, -25], [230, 300, 20], [400, 190, -15]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="58" ry="12" fill="#3f7a3c" fill-opacity="0.75" transform="rotate(${r} ${x} ${y})"/>`).join('')}`),
  // 18 misty valley
  () => svg(`<defs>${vlin('sky', '#f2e6ea', '#d9e4ec')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="150" cy="120" r="48" fill="#ffe6d2" fill-opacity="0.8"/>${[[220, '#8f9db0', 0.9], [290, '#7a8a9e', 0.85], [360, '#65758c', 0.85], [430, '#4f5f78', 0.9]].map(([y, c, o], n) => `<path d="M0 ${y} Q${90 + n * 40} ${Number(y) - 60} ${190 + n * 30} ${y} T512 ${Number(y) - 20} V512 H0 Z" fill="${c}" fill-opacity="${o}"/>`).join('')}<g fill="#ffffff" fill-opacity="0.5">${[250, 320, 390].map(y => `<ellipse cx="256" cy="${y}" rx="300" ry="16"/>`).join('')}</g>`),
  // 19 wheat field
  () => svg(`<defs>${vlin('sky', '#ffe3a8', '#ffc46b')}</defs><rect width="512" height="512" fill="url(#sky)"/><circle cx="330" cy="130" r="52" fill="#fff3cf"/><path d="M0 300 H512 V512 H0 Z" fill="#e0aa4a"/><path d="M0 360 H512 V512 H0 Z" fill="#c88c33"/><g stroke="#8a5f1f" stroke-width="3" fill="none">${Array.from({ length: 26 }, (_, n) => { const x = 8 + n * 20, y = 300 + (n % 4) * 22; return `<path d="M${x} 512 V${y}"/><ellipse cx="${x}" cy="${y - 10}" rx="6" ry="14" fill="#f0c464" stroke="none"/>` }).join('')}</g>`),
  // 20 cherry blossom
  () => svg(`<defs>${vlin('sky', '#fdeef4', '#e6f0f7')}</defs><rect width="512" height="512" fill="url(#sky)"/><path d="M0 440 H512 V512 H0 Z" fill="#9bbf8a"/><path d="M250 512 V300 L170 200 M250 340 L340 230 M250 400 L190 330 M250 380 L330 320" stroke="#5a4030" stroke-width="14" fill="none" stroke-linecap="round"/>${[[170, 190], [250, 150], [335, 215], [200, 300], [320, 300], [140, 260], [390, 270], [255, 240]].map(([x, y], n) => `<circle cx="${x}" cy="${y}" r="${34 + (n % 3) * 10}" fill="${n % 2 ? '#ffc3d8' : '#ffd7e5'}"/>`).join('')}${[[90, 350], [420, 380], [150, 420], [360, 430], [60, 300], [460, 330]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#ffb8d2"/>`).join('')}`),
]
const nature = (i) => NATURE_SCENES[i % NATURE_SCENES.length]()

// `count` overrides the shared default — Nature ships the full twenty.
const THEMES = [
  { id: 'theme-minimal', label: 'Minimal', build: minimal },
  { id: 'theme-geometric', label: 'Geometric', build: geometric },
  { id: 'theme-abstract', label: 'Abstract', build: abstract },
  { id: 'theme-nature', label: 'Nature', build: nature, count: NATURE_SCENES.length },
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
    const count = t.count ?? COUNT
    for (let i = 0; i < count; i++) {
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
    console.log(`✓ ${t.label.padEnd(10)} → ${count} png × ${PUBLIC_DIRS.length} dirs`)
  }
  await browser.close()
}
run().catch(e => { console.error(e); process.exit(1) })
