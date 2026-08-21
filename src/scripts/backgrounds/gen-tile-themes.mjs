// scripts/backgrounds/gen-tile-themes.mjs
//
// Generates themed PER-TILE background image sets (the "tile backgrounds with
// themes" feature). Each theme is a curated collection of distinct 512×512
// images; a wall of tiles drawing from one set reads as varied-but-coherent.
// Output: public/substrate/theme-<id>/<n>.png + manifest.json (3 public dirs),
// SVG sources under the background textures tree. Register each set as a
// built-in substrate source so /substrate set <theme> switches the tiles.
//
// ART DIRECTION (the reason this file looks like a small illustration studio):
// tiles crop these squares to a hexagon and draw a WHITE label over a pill in
// the CENTER BAND. So every picture here keeps the middle third calm and
// low-frequency, holds overall luminance mid-to-dark (or gently light with a
// quiet center), and pushes detail toward edges and corners. The shared look
// is built from three devices: film grain (feTurbulence, overlay-blended),
// heavy gaussian blur for atmosphere and glow, and layered silhouettes with
// real atmospheric perspective. Randomness is SEEDED so a re-run reproduces
// the exact same pictures.
//
// Run from the monorepo root (src/):  node scripts/backgrounds/gen-tile-themes.mjs

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const W = 512, H = 512, C = 256

// ── shared toolkit ───────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) — same seed, same picture, forever. */
const rng = (seed) => {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`
const rect = (fill, extra = '') => `<rect width="${W}" height="${H}" fill="${fill}"${extra ? ' ' + extra : ''}/>`

/** Vertical multi-stop gradient. stops: [[offsetPct, color], …] */
const sky = (id, stops) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}%" stop-color="${c}"/>`).join('')}</linearGradient>`

const radial = (id, cx, cy, r, c, a0, a1 = 0) => `<radialGradient id="${id}" cx="${cx}%" cy="${cy}%" r="${r}%"><stop offset="0%" stop-color="${c}" stop-opacity="${a0}"/><stop offset="70%" stop-color="${c}" stop-opacity="${a1}"/></radialGradient>`

const vigDef = (id, c, a) => `<radialGradient id="${id}" cx="50%" cy="46%" r="78%"><stop offset="54%" stop-color="${c}" stop-opacity="0"/><stop offset="100%" stop-color="${c}" stop-opacity="${a}"/></radialGradient>`

const blur = (id, d) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${d}"/></filter>`

// Film grain: desaturated fractal noise, alpha forced solid, overlay-blended
// by the caller at low opacity. The single device that makes flat vector
// fields read as printed artwork instead of screen fills.
const GRAIN_DEF = `<filter id="grain" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>`

/** Wrap a composition with the shared finish: grain + vignette. */
const scene = (defs, body, { grain = 0.09, vig = 0.38, vigColor = '#020407' } = {}) =>
  svg(`<defs>${defs}${GRAIN_DEF}${vigDef('sceneVig', vigColor, vig)}</defs>${body}` +
    `<rect width="${W}" height="${H}" filter="url(#grain)" style="mix-blend-mode:overlay" opacity="${grain}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#sceneVig)"/>`)

/** Smooth rolling silhouette across the frame, closed to the bottom edge. */
const rolling = (r, y, amp, segs = 5) => {
  const pts = []
  for (let i = 0; i <= segs; i++) pts.push([-24 + (i * (W + 48)) / segs, y + (r() - 0.5) * 2 * amp])
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }
  d += ` L ${W + 24} ${H + 24} L -24 ${H + 24} Z`
  return d
}

/** Jagged peak silhouette, closed to the bottom edge. */
const peaks = (r, y, amp, n = 5) => {
  let d = `M -24 ${y + amp * 0.4}`
  for (let i = 0; i <= n; i++) {
    const x = -24 + ((i + 0.5) * (W + 48)) / (n + 1)
    const py = y - amp * (0.5 + r() * 0.9)
    const vx = -24 + ((i + 1) * (W + 48)) / (n + 1)
    const vy = y + amp * (0.1 + r() * 0.5)
    d += ` L ${x.toFixed(1)} ${py.toFixed(1)} L ${vx.toFixed(1)} ${vy.toFixed(1)}`
  }
  d += ` L ${W + 24} ${H + 24} L -24 ${H + 24} Z`
  return d
}

/** Seeded star specks inside a box. */
const stars = (seed, n, [x0, y0, x1, y1] = [10, 10, W - 10, 250], maxR = 1.5) => {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < n; i++) {
    out += `<circle cx="${(x0 + r() * (x1 - x0)).toFixed(1)}" cy="${(y0 + r() * (y1 - y0)).toFixed(1)}" r="${(0.5 + r() * maxR).toFixed(2)}" fill="#ffffff" fill-opacity="${(0.25 + r() * 0.65).toFixed(2)}"/>`
  }
  return out
}

/** Moon/sun glitter lane on water: short horizontal dashes widening downward. */
const glitter = (seed, cx, y0, y1, color, spread = 26) => {
  const r = rng(seed)
  let out = ''
  for (let y = y0; y < y1; y += 7 + r() * 9) {
    const t = (y - y0) / (y1 - y0)
    const w = 5 + r() * 12 + t * 10
    const x = cx + (r() - 0.5) * spread * (1 + t * 2.2)
    out += `<rect x="${(x - w / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="2.2" rx="1.1" fill="${color}" fill-opacity="${(0.55 - t * 0.32).toFixed(2)}"/>`
  }
  return out
}

/** A stylized conifer: stacked soft triangles + trunk. */
const pine = (x, y, h, c, o = 1) => {
  const w = h * 0.42
  let out = `<g fill="${c}" fill-opacity="${o}">`
  for (let k = 0; k < 3; k++) {
    const ty = y - (h * (k + 1)) / 3.4
    const tw = w * (1 - k * 0.26)
    out += `<polygon points="${x},${(ty - h / 3.2).toFixed(1)} ${(x - tw).toFixed(1)},${ty.toFixed(1)} ${(x + tw).toFixed(1)},${ty.toFixed(1)}"/>`
  }
  return out + `<rect x="${(x - h * 0.035).toFixed(1)}" y="${(y - h * 0.1).toFixed(1)}" width="${(h * 0.07).toFixed(1)}" height="${(h * 0.12).toFixed(1)}"/></g>`
}

/** Soft cloud from blurred lobes — caller supplies the blur filter id. */
const cloud = (x, y, s, fill, o, blurId) =>
  `<g fill="${fill}" fill-opacity="${o}" filter="url(#${blurId})">` +
  [[-0.9, 0.05, 0.46], [-0.3, -0.24, 0.6], [0.34, -0.14, 0.54], [0.9, 0.08, 0.4]]
    .map(([dx, dy, rr]) => `<ellipse cx="${(x + dx * s).toFixed(1)}" cy="${(y + dy * s).toFixed(1)}" rx="${(rr * s).toFixed(1)}" ry="${(rr * s * 0.66).toFixed(1)}"/>`).join('') + `</g>`

// ═════════════════════════════════════════════════════════════════════
// NATURE — twenty cinematic scenes, dawn to night. The ship default.
// ═════════════════════════════════════════════════════════════════════

const NATURE_SCENES = [
  // 1 dawn ridgelines — five silhouettes receding into a peach sunrise
  () => {
    const r = rng(11)
    const ridge = [['#efc9a2', 300, 26], ['#d99a78', 336, 30], ['#a96a62', 374, 32], ['#77475a', 414, 34], ['#472e46', 458, 34]]
    return scene(
      sky('s', [[0, '#3b3260'], [42, '#b06a74'], [72, '#eda57e'], [100, '#f9dcb6']]) + blur('b30', 30),
      rect('url(#s)') +
      `<circle cx="256" cy="292" r="52" fill="#ffe9c2" filter="url(#b30)" opacity="0.9"/>` +
      ridge.map(([c, y, a]) => `<path d="${rolling(r, y, a)}" fill="${c}"/>`).join('') +
      `<ellipse cx="200" cy="332" rx="290" ry="17" fill="#ffd9ae" opacity="0.35" filter="url(#b30)"/>` +
      `<ellipse cx="340" cy="404" rx="300" ry="15" fill="#eec2a4" opacity="0.25" filter="url(#b30)"/>`,
      { vig: 0.3 })
  },
  // 2 alpine lake at dusk — peaks doubled in still water
  () => {
    const r = rng(29)
    const p1 = peaks(r, 236, 118, 3), p2 = peaks(r, 296, 84, 4)
    return scene(
      sky('s', [[0, '#1b2947'], [50, '#4a628c'], [84, '#c98f74'], [100, '#eec39a']]) +
      sky('w', [[0, '#c69a86'], [30, '#5d6f92'], [100, '#1a2440']]) + blur('b24', 24),
      rect('url(#s)') +
      `<circle cx="256" cy="318" r="46" fill="#ffdfae" filter="url(#b24)" opacity="0.7"/>` +
      `<path d="${p1}" fill="#35446b"/><path d="${p2}" fill="#202c4a"/>` +
      `<rect x="0" y="332" width="512" height="180" fill="url(#w)"/>` +
      `<g transform="translate(0,664) scale(1,-1)" opacity="0.25"><path d="${p1}" fill="#3d4c74"/><path d="${p2}" fill="#263354"/></g>` +
      `<g fill="#e8d3c2">${[352, 386, 424, 462].map(y => `<rect x="${60 + (y % 90)}" y="${y}" width="${190 - (y % 70)}" height="1.6" rx="0.8" opacity="${(0.24 - (y - 350) * 0.0004).toFixed(2)}"/>`).join('')}</g>`,
      { vig: 0.34 })
  },
  // 3 open ocean — long swells and a low sun lane
  () => scene(
    sky('s', [[0, '#cde9ef'], [58, '#8fc3d4'], [100, '#f2dcb8']]) +
    sky('sea', [[0, '#2a7d97'], [45, '#175e7a'], [100, '#0a3a54']]) + blur('b26', 26),
    rect('url(#s)') +
    `<circle cx="256" cy="286" r="40" fill="#fff3d2" filter="url(#b26)"/>` +
    `<rect x="0" y="298" width="512" height="214" fill="url(#sea)"/>` +
    glitter(31, 256, 306, 430, '#ffe9b8') +
    `<g fill="none" stroke="#bfe6ea" stroke-width="3">${[352, 408, 462].map((y, i) => `<path d="M-10 ${y} Q 128 ${y - 14} 256 ${y} T 522 ${y}" stroke-opacity="${0.3 - i * 0.08}"/>`).join('')}</g>`,
    { vig: 0.32 }),
  // 4 sunset cloudbank — stacked clouds lit from beneath
  () => scene(
    sky('s', [[0, '#33203f'], [44, '#8f3f58'], [72, '#e0745e'], [100, '#ffcf92']]) + blur('b18', 18) + blur('b8', 8),
    rect('url(#s)') +
    `<circle cx="360" cy="416" r="52" fill="#ffe7b8" filter="url(#b18)" opacity="0.9"/>` +
    cloud(96, 118, 54, '#37233f', 0.85, 'b18') + `<ellipse cx="96" cy="142" rx="64" ry="7" fill="#ff9f77" opacity="0.4" filter="url(#b8)"/>` +
    cloud(320, 208, 84, '#41284a', 0.9, 'b18') + `<ellipse cx="320" cy="244" rx="104" ry="10" fill="#ffb987" opacity="0.5" filter="url(#b8)"/>` +
    cloud(150, 360, 108, '#4a2b47', 0.95, 'b18') + `<ellipse cx="150" cy="404" rx="140" ry="13" fill="#ffcf9a" opacity="0.65" filter="url(#b8)"/>` +
    cloud(470, 330, 60, '#3d2745', 0.85, 'b18') + `<ellipse cx="470" cy="356" rx="72" ry="8" fill="#ffc490" opacity="0.5" filter="url(#b8)"/>`,
    { vig: 0.36 }),
  // 5 desert night — moonlit dunes with crest light
  () => {
    const r = rng(47)
    return scene(
      sky('s', [[0, '#0c1030'], [70, '#232a58'], [100, '#3a3a6e']]) + blur('b20', 20),
      rect('url(#s)') + stars(48, 46, [10, 10, 500, 230]) +
      `<circle cx="392" cy="96" r="34" fill="#f1e8d2"/><circle cx="380" cy="88" r="31" fill="#171b3f"/>` +
      `<circle cx="392" cy="96" r="44" fill="#cdd4ff" filter="url(#b20)" opacity="0.3"/>` +
      [['#2c2450', 314, 30], ['#211a3e', 372, 32], ['#151030', 434, 30]].map(([c, y, a], i) => {
        const d = rolling(r, y, a, 4)
        return `<path d="${d}" fill="${c}"/><path d="${d}" fill="none" stroke="#9a8fd8" stroke-width="2" stroke-opacity="${0.28 - i * 0.08}"/>`
      }).join(''),
      { vig: 0.42 })
  },
  // 6 forest light shafts — volumetric light through dark timber
  () => {
    const r = rng(59)
    let motes = ''
    for (let i = 0; i < 16; i++) motes += `<circle cx="${(140 + r() * 240).toFixed(0)}" cy="${(90 + r() * 300).toFixed(0)}" r="${(1 + r() * 2.4).toFixed(1)}" fill="#ffeec2" fill-opacity="${(0.25 + r() * 0.4).toFixed(2)}"/>`
    return scene(
      sky('s', [[0, '#16281c'], [100, '#0a160e']]) +
      `<linearGradient id="shaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ffe9b0" stop-opacity="0.5"/><stop offset="85%" stop-color="#ffe9b0" stop-opacity="0"/></linearGradient>` + blur('b10', 10),
      rect('url(#s)') +
      `<g fill="#08110b">${[-6, 78, 176, 328, 428, 496].map((x, i) => `<rect x="${x}" y="0" width="${26 + (i % 3) * 10}" height="512"/>`).join('')}</g>` +
      `<g transform="rotate(-13 256 0)" filter="url(#b10)">${[150, 235, 320].map((x, i) => `<rect x="${x}" y="-40" width="${34 - i * 6}" height="560" fill="url(#shaft)"/>`).join('')}</g>` +
      motes + `<path d="M0 470 Q 256 452 512 468 L 512 512 L 0 512 Z" fill="#060d08"/>`,
      { grain: 0.11, vig: 0.4 })
  },
  // 7 terraced hills at golden hour — curved paddies stepping down
  () => {
    const r = rng(67)
    const bands = ['#a8bf6a', '#8fae58', '#75984a', '#5d833f', '#487034', '#345c2a', '#254c22']
    return scene(
      sky('s', [[0, '#f6d9a4'], [100, '#eab87e']]) + blur('b22', 22),
      rect('url(#s)') +
      `<circle cx="150" cy="120" r="42" fill="#fff2cf" filter="url(#b22)" opacity="0.85"/>` +
      bands.map((c, i) => {
        const y = 236 + i * 42
        const d = rolling(r, y, 15, 4)
        return `<path d="${d}" fill="${c}"/><path d="${d}" fill="none" stroke="#ffe9ae" stroke-width="1.8" stroke-opacity="0.3"/>`
      }).join(''),
      { vig: 0.3 })
  },
  // 8 storm light — one bright break over a dark sea
  () => scene(
    sky('s', [[0, '#20262f'], [70, '#3a4552'], [100, '#5b6673']]) +
    sky('sea', [[0, '#39434e'], [100, '#141a21']]) + blur('b28', 28) + blur('b6', 6),
    rect('url(#s)') +
    `<ellipse cx="256" cy="300" rx="180" ry="34" fill="#ffe9c2" filter="url(#b28)" opacity="0.75"/>` +
    `<rect x="120" y="297" width="272" height="3" fill="#fff3d6" filter="url(#b6)" opacity="0.85"/>` +
    `<rect x="0" y="300" width="512" height="212" fill="url(#sea)"/>` +
    glitter(83, 256, 308, 380, '#ffe2ae', 40) +
    `<g stroke="#9aa6b2" stroke-width="1.4" stroke-opacity="0.12">${[60, 150, 250, 350, 440].map(x => `<line x1="${x}" y1="40" x2="${x - 36}" y2="270"/>`).join('')}</g>`,
    { vig: 0.44 }),
  // 9 aurora over spruce — green curtains, violet fringe
  () => scene(
    sky('s', [[0, '#03101e'], [100, '#0b2338']]) +
    `<linearGradient id="a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#46ffc0" stop-opacity="0"/><stop offset="40%" stop-color="#46ffc0" stop-opacity="0.55"/><stop offset="100%" stop-color="#5a8cff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="a2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8f7bff" stop-opacity="0"/><stop offset="45%" stop-color="#8f7bff" stop-opacity="0.4"/><stop offset="100%" stop-color="#46ffc0" stop-opacity="0"/></linearGradient>` + blur('b7', 7),
    rect('url(#s)') + stars(97, 54) +
    `<g filter="url(#b7)">` +
    [[40, 90, 'a1'], [160, 70, 'a2'], [268, 100, 'a1'], [396, 76, 'a2']].map(([x, w, g]) =>
      `<path d="M${x} 30 Q ${x + 60} 190 ${x - 24} 380 L ${x - 24 + w} 380 Q ${x + 60 + w} 190 ${x + w} 30 Z" fill="url(#${g})"/>`).join('') + `</g>` +
    [[60, 500, 74], [150, 508, 56], [250, 502, 88], [352, 508, 60], [452, 500, 78]].map(([x, y, h]) => pine(x, y, h, '#04121c')).join('') +
    `<path d="M0 486 Q 256 470 512 484 L 512 512 L 0 512 Z" fill="#03101a"/>`,
    { vig: 0.4 }),
  // 10 misty pines — four fog layers of forest receding
  () => {
    const r = rng(101)
    const layer = (y, c, o, hMin, hMax, seed) => {
      const rr = rng(seed)
      let out = `<g>`
      for (let x = -10; x < 530; x += 34 + rr() * 30) out += pine(x, y, hMin + rr() * (hMax - hMin), c, o)
      return out + `<rect x="0" y="${y - 4}" width="512" height="${512 - y + 4}" fill="${c}" fill-opacity="${o}"/></g>`
    }
    return scene(
      sky('s', [[0, '#e6ecea'], [100, '#c2cfc9']]) + blur('b16', 16),
      rect('url(#s)') +
      layer(300, '#93a89e', 0.35, 60, 100, 1) +
      `<rect x="0" y="270" width="512" height="80" fill="#dde5e2" opacity="0.55" filter="url(#b16)"/>` +
      layer(370, '#6d857a', 0.55, 70, 120, 2) +
      `<rect x="0" y="340" width="512" height="70" fill="#d5dedb" opacity="0.45" filter="url(#b16)"/>` +
      layer(450, '#42584d', 0.85, 90, 150, 3) +
      layer(516, '#2b3f36', 1, 100, 160, 4),
      { grain: 0.07, vig: 0.22, vigColor: '#31413d' })
  },
  // 11 lavender dusk — converging rows into a violet glow
  () => {
    let rows = ''
    for (let i = 0; i < 9; i++) {
      const t = i / 8, xb = -80 + t * 672
      rows += `<path d="M ${xb.toFixed(0)} 512 Q ${(256 + (xb - 256) * 0.4).toFixed(0)} 400 256 316" fill="none" stroke="#4a3370" stroke-width="${(20 - Math.abs(i - 4) * 3).toFixed(0)}" stroke-opacity="0.6" stroke-linecap="round"/>`
    }
    return scene(
      sky('s', [[0, '#f0c9d8'], [55, '#c893c2'], [100, '#9a6bb0']]) +
      sky('f', [[0, '#8a63b0'], [100, '#4a3178']]) + blur('b24', 24),
      rect('url(#s)') +
      `<circle cx="256" cy="300" r="54" fill="#ffe9d8" filter="url(#b24)" opacity="0.9"/>` +
      `<path d="M0 316 Q 256 296 512 316 L 512 512 L 0 512 Z" fill="url(#f)"/>` + rows,
      { vig: 0.34 })
  },
  // 12 moon over water — one bright lane on a dark sea
  () => scene(
    sky('s', [[0, '#0a1424'], [100, '#1d3350']]) +
    sky('sea', [[0, '#152a42'], [100, '#081422']]) + blur('b22', 22) + blur('b9', 9),
    rect('url(#s)') + stars(131, 40, [10, 10, 500, 260]) +
    `<circle cx="330" cy="140" r="58" fill="#f2ead4"/>` +
    `<circle cx="330" cy="140" r="76" fill="#e8e2ff" filter="url(#b22)" opacity="0.35"/>` +
    `<ellipse cx="300" cy="128" rx="90" ry="12" fill="#0e1c30" filter="url(#b9)" opacity="0.7"/>` +
    `<rect x="0" y="296" width="512" height="216" fill="url(#sea)"/>` +
    glitter(137, 330, 304, 470, '#efe6c8', 30),
    { vig: 0.42 }),
  // 13 autumn valley fog — russet ridges through cream mist
  () => {
    const r = rng(149)
    return scene(
      sky('s', [[0, '#f3e2c8'], [100, '#e5cba6']]) + blur('b20', 20),
      rect('url(#s)') +
      `<circle cx="140" cy="110" r="38" fill="#fff4da" filter="url(#b20)" opacity="0.9"/>` +
      `<path d="${rolling(r, 270, 34, 4)}" fill="#c07a44"/>` +
      `<rect x="0" y="252" width="512" height="76" fill="#f3e2c8" opacity="0.6" filter="url(#b20)"/>` +
      `<path d="${rolling(r, 344, 36, 4)}" fill="#9a5731"/>` +
      `<rect x="0" y="330" width="512" height="66" fill="#efdcbe" opacity="0.5" filter="url(#b20)"/>` +
      `<path d="${rolling(r, 424, 34, 5)}" fill="#6f3c22"/>` +
      `<rect x="0" y="410" width="512" height="56" fill="#ead4b2" opacity="0.35" filter="url(#b20)"/>` +
      `<path d="${rolling(r, 486, 24, 4)}" fill="#4c2917"/>`,
      { grain: 0.08, vig: 0.26, vigColor: '#3a2412' })
  },
  // 14 cherry bokeh — a dark bough under drifting pink light
  () => {
    const r = rng(163)
    let bokeh = ''
    for (let i = 0; i < 18; i++) {
      const edge = r() < 0.5
      const x = edge ? (r() < 0.5 ? r() * 130 : 382 + r() * 130) : r() * 512
      const y = edge ? r() * 512 : (r() < 0.5 ? r() * 140 : 372 + r() * 140)
      bokeh += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(10 + r() * 26).toFixed(0)}" fill="${['#ffffff', '#ffd7e5', '#ffb8d0'][i % 3]}" fill-opacity="${(0.14 + r() * 0.22).toFixed(2)}" filter="url(#b12)"/>`
    }
    return scene(
      sky('s', [[0, '#f6dfe8'], [55, '#efc6d6'], [100, '#e0a8c0']]) + blur('b12', 12),
      rect('url(#s)') + bokeh +
      `<path d="M -10 470 Q 120 430 240 452 T 522 430" fill="none" stroke="#5a3a34" stroke-width="14" stroke-linecap="round"/>` +
      [[70, 448], [150, 438], [250, 450], [340, 440], [430, 434]].map(([x, y], n) =>
        [0, 1, 2, 3, 4].map(p => { const a = (p / 5) * 2 * Math.PI; return `<circle cx="${(x + Math.cos(a) * 8).toFixed(1)}" cy="${(y + Math.sin(a) * 8).toFixed(1)}" r="6.4" fill="${n % 2 ? '#ffc9db' : '#ffdde9'}"/>` }).join('') + `<circle cx="${x}" cy="${y}" r="4" fill="#e88aa8"/>`).join(''),
      { grain: 0.06, vig: 0.2, vigColor: '#6b3a50' })
  },
  // 15 canyon beam — light falling into a slot canyon. Depth is the glow:
  // the slot itself is the bright gradient, walls darken as they near the
  // frame, and only the innermost pair catches the bounce light.
  () => scene(
    sky('c', [[0, '#ffd9a0'], [55, '#f0a050'], [100, '#b4571f']]) +
    `<linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff3cf" stop-opacity="0.9"/><stop offset="90%" stop-color="#fff3cf" stop-opacity="0"/></linearGradient>` + blur('b10c', 10),
    rect('url(#c)') +
    `<path d="M-20 0 L238 0 Q 196 120 232 250 Q 252 380 214 512 L -20 512 Z" fill="#b4682e"/>` +
    `<path d="M-20 0 L182 0 Q 142 160 176 320 Q 192 430 162 512 L -20 512 Z" fill="#7c3a1c"/>` +
    `<path d="M-20 0 L112 0 Q 84 180 108 360 Q 118 450 100 512 L -20 512 Z" fill="#4a1f0e"/>` +
    `<path d="M532 0 L286 0 Q 326 130 292 260 Q 272 390 306 512 L 532 512 Z" fill="#9c5624"/>` +
    `<path d="M532 0 L346 0 Q 382 170 352 330 Q 338 440 364 512 L 532 512 Z" fill="#6b2f14"/>` +
    `<path d="M532 0 L420 0 Q 444 190 424 370 Q 416 456 430 512 L 532 512 Z" fill="#421c0c"/>` +
    `<g stroke="#2a0f06" stroke-width="3.4" stroke-opacity="0.4" fill="none"><path d="M-20 150 Q 80 142 172 158"/><path d="M-20 280 Q 70 274 168 292"/><path d="M532 130 Q 440 140 356 152"/><path d="M532 310 Q 448 316 358 300"/></g>` +
    `<g transform="rotate(6 256 0)" filter="url(#b10c)"><rect x="234" y="-30" width="44" height="460" fill="url(#beam)"/></g>` +
    `<ellipse cx="260" cy="466" rx="58" ry="13" fill="#ffe9b8" opacity="0.7" filter="url(#b10c)"/>`,
    { grain: 0.1, vig: 0.36, vigColor: '#1c0a04' }),
  // 16 alpenglow — pink summits over a blue evening valley
  () => scene(
    sky('s', [[0, '#182342'], [60, '#33406b'], [100, '#5c5480']]) + blur('b16', 16),
    rect('url(#s)') + stars(179, 26, [10, 10, 500, 140]) +
    `<polygon points="-20,352 120,138 262,352" fill="#4c5684"/>` +
    `<polygon points="120,138 214,352 262,352" fill="#353e66"/>` +
    `<path d="M120 138 L74 208 L94 198 L108 212 L128 198 L148 210 L166 205 Z" fill="#e8b4ac" opacity="0.9"/>` +
    `<polygon points="196,352 348,110 500,352" fill="#5d6694"/>` +
    `<polygon points="348,110 452,352 500,352" fill="#414a74"/>` +
    `<path d="M348 110 L296 190 L318 180 L334 194 L356 182 L378 192 L398 188 Z" fill="#f0bfb2" opacity="0.9"/>` +
    `<ellipse cx="256" cy="352" rx="300" ry="20" fill="#8a84b0" opacity="0.4" filter="url(#b16)"/>` +
    `<path d="M0 372 Q 256 348 512 370 L 512 512 L 0 512 Z" fill="#131b34"/>`,
    { vig: 0.38 }),
  // 17 firefly meadow — warm sparks low in a blue-green dusk
  () => {
    const r = rng(191)
    let flies = ''
    for (let i = 0; i < 13; i++) {
      const x = 30 + r() * 452, y = 330 + r() * 150, rad = 2 + r() * 2.4
      flies += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(rad * 3).toFixed(1)}" fill="#ffd98a" fill-opacity="0.25" filter="url(#b5)"/><circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rad.toFixed(1)}" fill="#ffe9b0" fill-opacity="0.9"/>`
    }
    let grass = ''
    for (let x = -6; x < 522; x += 9 + r() * 8) grass += `<path d="M ${x} 512 Q ${x + 4} ${450 - r() * 40} ${x + 10} ${430 - r() * 30}" stroke="#0c1d16" stroke-width="3" fill="none"/>`
    return scene(
      sky('s', [[0, '#112531'], [70, '#173932'], [100, '#1d4436']]) + blur('b5', 5) + blur('b20', 20),
      rect('url(#s)') +
      `<circle cx="440" cy="70" r="40" fill="#cfe3d8" filter="url(#b20)" opacity="0.22"/>` +
      `<path d="M0 420 Q 256 396 512 418 L 512 512 L 0 512 Z" fill="#0b1c14"/>` + grass + flies,
      { vig: 0.4 })
  },
  // 18 waterfall mist — a pale fall through dark green walls
  () => scene(
    sky('s', [[0, '#16352a'], [100, '#0c241c']]) +
    `<linearGradient id="fall" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#eaf6f4" stop-opacity="0.95"/><stop offset="100%" stop-color="#bfe0dc" stop-opacity="0.7"/></linearGradient>` + blur('b18', 18) + blur('b4', 4),
    rect('url(#s)') +
    `<path d="M0 0 L200 0 Q 168 200 196 512 L 0 512 Z" fill="#0e2a20"/>` +
    `<path d="M512 0 L316 0 Q 344 220 320 512 L 512 512 Z" fill="#102e23"/>` +
    `<rect x="206" y="0" width="102" height="452" fill="url(#fall)"/>` +
    `<g stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" filter="url(#b4)">${[220, 246, 272, 296].map(x => `<path d="M ${x} 10 Q ${x + 6} 220 ${x - 2} 440" fill="none"/>`).join('')}</g>` +
    `<ellipse cx="256" cy="462" rx="150" ry="34" fill="#dceeeb" opacity="0.8" filter="url(#b18)"/>` +
    `<ellipse cx="256" cy="480" rx="220" ry="30" fill="#a8ccc8" opacity="0.5" filter="url(#b18)"/>`,
    { vig: 0.36 }),
  // 19 prairie thunderhead — one grand cloud over gold flats
  () => scene(
    sky('s', [[0, '#8fb3d9'], [70, '#c9c8b8'], [100, '#e8d9ae']]) +
    sky('f', [[0, '#d8b054'], [100, '#8f6b26']]) + blur('b16b', 16) + blur('b8b', 8),
    rect('url(#s)') +
    cloud(300, 200, 120, '#f6f3ec', 0.95, 'b16b') +
    cloud(250, 120, 80, '#ffffff', 0.9, 'b16b') +
    cloud(330, 260, 130, '#c9bfd0', 0.8, 'b16b') +
    `<ellipse cx="300" cy="292" rx="150" ry="14" fill="#8f84a8" opacity="0.5" filter="url(#b8b)"/>` +
    `<rect x="0" y="340" width="512" height="172" fill="url(#f)"/>` +
    `<path d="M0 342 H512" stroke="#ffe9b0" stroke-width="2" stroke-opacity="0.5"/>`,
    { vig: 0.3, vigColor: '#241a08' }),
  // 20 winter birches — spare trunks in snow fog
  () => {
    const r = rng(223)
    let flakes = ''
    for (let i = 0; i < 22; i++) flakes += `<circle cx="${(r() * 512).toFixed(0)}" cy="${(r() * 512).toFixed(0)}" r="${(1.6 + r() * 2.6).toFixed(1)}" fill="#ffffff" fill-opacity="${(0.4 + r() * 0.4).toFixed(2)}"/>`
    const trunk = (x, w, o) => `<g opacity="${o}"><rect x="${x}" y="0" width="${w}" height="512" fill="#f2efe6"/><rect x="${x}" y="0" width="${(w * 0.24).toFixed(1)}" height="512" fill="#cfcaba"/>` +
      [60, 170, 290, 400].map(y => `<rect x="${x}" y="${y + (x % 53)}" width="${(w * 0.6).toFixed(1)}" height="5" rx="2.5" fill="#3a3d3a" fill-opacity="0.6"/>`).join('') + `</g>`
    return scene(
      sky('s', [[0, '#e9eef3'], [100, '#c9d4dd']]) + blur('b18w', 18),
      rect('url(#s)') +
      `<g opacity="0.3">${trunk(120, 14, 1)}${trunk(300, 12, 1)}${trunk(420, 16, 1)}</g>` +
      `<rect x="0" y="180" width="512" height="150" fill="#e4eaf0" opacity="0.6" filter="url(#b18w)"/>` +
      trunk(48, 26, 1) + trunk(214, 20, 0.92) + trunk(452, 30, 1) +
      `<path d="M0 452 Q 256 434 512 450 L 512 512 L 0 512 Z" fill="#f4f7fa"/>` + flakes,
      { grain: 0.06, vig: 0.18, vigColor: '#42505e' })
  },
]

// ═════════════════════════════════════════════════════════════════════
// MINIMAL — ten quiet tonal fields. Luxury restraint: one glow, one line.
// ═════════════════════════════════════════════════════════════════════

const MINIMAL_SPECS = [
  { base: '#181b21', glows: [[50, 108, 84, '#d9a06b', 0.22]] },
  { base: '#131d33', glows: [[46, -6, 80, '#7d9bd6', 0.24]] },
  { base: '#243329', glows: [[52, 30, 74, '#a8c4ae', 0.18]], line: [356, '#cfe0d0', 0.4] },
  { base: '#e6dac4', light: true, glows: [[30, 0, 80, '#ffffff', 0.6]], vigColor: '#6b5a3e', vig: 0.16 },
  { base: '#1e242d', glows: [[50, 40, 68, '#8fa3b8', 0.13]], arc: [256, 700, 380, '#d4a95c', 0.45] },
  { base: '#261a29', glows: [[86, 92, 74, '#b06a9a', 0.24]] },
  { base: '#121b16', glows: [[44, 48, 68, '#4f7a62', 0.16]], edge: [488, '#6fae8a', 0.4] },
  { base: '#1c1e22', glows: [[24, 20, 70, '#ffffff', 0.12], [80, 86, 70, '#ffffff', 0.09]], band: true },
  { base: '#ece7dd', light: true, glows: [[50, 8, 78, '#ffffff', 0.55]], line: [372, '#b9ad98', 0.4], vigColor: '#6e6250', vig: 0.14 },
  { base: '#0e1226', glows: [[72, 16, 44, '#cfe0ff', 0.22]], spark: [368, 84] },
]
const minimal = (i) => {
  const s = MINIMAL_SPECS[i]
  let defs = '', body = rect(s.base)
  s.glows.forEach(([cx, cy, r, c, a], n) => { defs += radial(`g${n}`, cx, cy, r, c, a); body += rect(`url(#g${n})`) })
  if (s.line) body += `<rect x="26" y="${s.line[0]}" width="460" height="1.6" fill="${s.line[1]}" opacity="${s.line[2]}"/>`
  if (s.edge) body += `<rect x="${s.edge[0]}" y="60" width="2" height="392" fill="${s.edge[1]}" opacity="${s.edge[2]}"/>`
  if (s.arc) body += `<circle cx="${s.arc[0]}" cy="${s.arc[1]}" r="${s.arc[2]}" fill="none" stroke="${s.arc[3]}" stroke-width="2" stroke-opacity="${s.arc[4]}"/>`
  if (s.band) { defs += blur('bb', 24); body += `<g transform="rotate(-24 256 256)" filter="url(#bb)"><rect x="-60" y="330" width="640" height="60" fill="#ffffff" opacity="0.1"/></g>` }
  if (s.spark) { defs += blur('bs', 6); body += `<circle cx="${s.spark[0]}" cy="${s.spark[1]}" r="8" fill="#e8f0ff" opacity="0.5" filter="url(#bs)"/><circle cx="${s.spark[0]}" cy="${s.spark[1]}" r="2.2" fill="#ffffff"/>` }
  return scene(defs, body, { grain: s.light ? 0.05 : 0.08, vig: s.vig ?? 0.32, vigColor: s.vigColor ?? '#04060a' })
}

// ═════════════════════════════════════════════════════════════════════
// GEOMETRIC — ten compositions with depth: gradient strokes, blur planes.
// ═════════════════════════════════════════════════════════════════════

const hexPts = (cx, cy, s) => [[cx + s, cy], [cx + s / 2, cy + s * 0.866], [cx - s / 2, cy + s * 0.866], [cx - s, cy], [cx - s / 2, cy - s * 0.866], [cx + s / 2, cy - s * 0.866]].map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
const strokeGrad = (id, c, a0, a1) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c}" stop-opacity="${a0}"/><stop offset="100%" stop-color="${c}" stop-opacity="${a1}"/></linearGradient>`

const GEO_BUILDERS = [
  // 1 hex halos — concentric hexes, sharper near, softer far
  () => scene(
    strokeGrad('sg', '#58b7e8', 0.55, 0.1) + radial('cg', 50, 50, 60, '#58b7e8', 0.1) + blur('b3', 3) + blur('b7', 7),
    rect('#0f1d2e') + rect('url(#cg)') +
    `<g fill="none" stroke="url(#sg)" stroke-width="3">${[70, 130].map(r => `<polygon points="${hexPts(C, C, r)}"/>`).join('')}</g>` +
    `<g fill="none" stroke="url(#sg)" stroke-width="4" filter="url(#b3)">${[195, 260].map(r => `<polygon points="${hexPts(C, C, r)}"/>`).join('')}</g>` +
    `<g fill="none" stroke="url(#sg)" stroke-width="5" filter="url(#b7)">${[330, 400].map(r => `<polygon points="${hexPts(C, C, r)}"/>`).join('')}</g>`),
  // 2 orbits — off-center rings with one lit node
  () => scene(
    strokeGrad('sg', '#b389f0', 0.6, 0.08) + radial('cg', 33, 40, 56, '#b389f0', 0.12) + blur('b5g', 5),
    rect('#170e2c') + rect('url(#cg)') +
    `<g fill="none" stroke="url(#sg)" stroke-width="2.5">${[110, 185, 265, 350].map(r => `<circle cx="170" cy="205" r="${r}"/>`).join('')}</g>` +
    `<circle cx="170" cy="205" r="30" fill="#b389f0" opacity="0.25" filter="url(#b5g)"/>` +
    `<circle cx="332" cy="93" r="12" fill="#d9c2ff" opacity="0.4" filter="url(#b5g)"/><circle cx="332" cy="93" r="5" fill="#efe4ff"/>`),
  // 3 glass triangles — translucent planes at three depths
  () => scene(
    blur('b2', 2) + blur('b8', 8) + radial('cg', 60, 40, 60, '#45d6a8', 0.1),
    rect('#0b241e') + rect('url(#cg)') +
    `<polygon points="80,470 250,180 420,470" fill="#45d6a8" fill-opacity="0.14" filter="url(#b8)"/>` +
    `<polygon points="10,430 130,220 260,430" fill="#45d6a8" fill-opacity="0.18" filter="url(#b2)"/>` +
    `<polygon points="270,440 390,240 505,440" fill="#7ee8c6" fill-opacity="0.12"/>` +
    `<polygon points="270,440 390,240 505,440" fill="none" stroke="#7ee8c6" stroke-width="2" stroke-opacity="0.4"/>`),
  // 4 isometric lattice — faint cubes, one glowing
  () => {
    const cube = (x, y, s, o, fillTop, fillL, fillR) =>
      `<g opacity="${o}"><polygon points="${x},${y - s} ${x + s * 0.87},${y - s / 2} ${x},${y} ${x - s * 0.87},${y - s / 2}" fill="${fillTop}"/>` +
      `<polygon points="${x - s * 0.87},${y - s / 2} ${x},${y} ${x},${y + s} ${x - s * 0.87},${y + s / 2}" fill="${fillL}"/>` +
      `<polygon points="${x + s * 0.87},${y - s / 2} ${x},${y} ${x},${y + s} ${x + s * 0.87},${y + s / 2}" fill="${fillR}"/></g>`
    let lattice = ''
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
      const x = 40 + col * 110 + (row % 2) * 55, y = 20 + row * 122
      lattice += cube(x, y, 34, 0.14, '#e89555', '#a05f2e', '#c47a40')
    }
    return scene(
      radial('cg', 26, 76, 50, '#e89555', 0.14) + blur('b6c', 6),
      rect('#221410') + rect('url(#cg)') + lattice +
      `<g filter="url(#b6c)" opacity="0.5">${cube(128, 388, 40, 1, '#ffc890', '#c47535', '#e8964e')}</g>` +
      cube(128, 388, 40, 1, '#ffd9ae', '#b86f30', '#dd8f48'))
  },
  // 5 flow lines — a stack of drifting sine curves
  () => {
    let waves = ''
    for (let i = 0; i < 9; i++) {
      const y = 60 + i * 48, o = 0.14 + 0.3 * Math.abs(i - 4) / 4
      waves += `<path d="M -10 ${y} C 120 ${y - 44}, 200 ${y + 44}, 300 ${y - 10} S 460 ${y + 30}, 522 ${y - 20}" fill="none" stroke="#6f8fe0" stroke-width="2.6" stroke-opacity="${o.toFixed(2)}"/>`
    }
    return scene(radial('cg', 50, 20, 66, '#6f8fe0', 0.1), rect('#0f1626') + rect('url(#cg)') + waves)
  },
  // 6 prism beams — crossing translucent light bands
  () => scene(
    blur('b10p', 10) +
    `<linearGradient id="p1" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#e070a8" stop-opacity="0"/><stop offset="50%" stop-color="#e070a8" stop-opacity="0.34"/><stop offset="100%" stop-color="#e070a8" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="p2" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#70b8e0" stop-opacity="0"/><stop offset="50%" stop-color="#70b8e0" stop-opacity="0.3"/><stop offset="100%" stop-color="#70b8e0" stop-opacity="0"/></linearGradient>`,
    rect('#141122') +
    `<g transform="rotate(34 256 256)" filter="url(#b10p)"><rect x="150" y="-80" width="120" height="680" fill="url(#p1)"/></g>` +
    `<g transform="rotate(-28 256 256)" filter="url(#b10p)"><rect x="260" y="-80" width="90" height="680" fill="url(#p2)"/></g>` +
    `<g transform="rotate(6 256 256)" filter="url(#b10p)"><rect x="60" y="-80" width="46" height="680" fill="url(#p2)" opacity="0.5"/></g>`),
  // 7 fading dot field — dots thinning with distance, one ring accent
  () => {
    let dots = ''
    for (let gx = 0; gx < 16; gx++) for (let gy = 0; gy < 16; gy++) {
      const x = 20 + gx * 31.5, y = 20 + gy * 31.5
      const d = Math.hypot(x - 150, y - 390) / 460
      const o = Math.max(0, 0.55 - d * 0.62)
      if (o > 0.02) dots += `<circle cx="${x}" cy="${y}" r="2" fill="#55c8c0" fill-opacity="${o.toFixed(2)}"/>`
    }
    return scene(
      radial('cg', 30, 76, 60, '#55c8c0', 0.1) + blur('b4d', 4),
      rect('#0d1f26') + rect('url(#cg)') + dots +
      `<circle cx="368" cy="128" r="46" fill="none" stroke="#7fe0d8" stroke-width="2.4" stroke-opacity="0.55"/>` +
      `<circle cx="368" cy="128" r="46" fill="none" stroke="#7fe0d8" stroke-width="6" stroke-opacity="0.2" filter="url(#b4d)"/>`)
  },
  // 8 corner arcs — radar sweep from the lower-left
  () => scene(
    strokeGrad('sg8', '#e070a8', 0.55, 0.06) + radial('cg', 8, 96, 56, '#e070a8', 0.12) + blur('b5a', 5),
    rect('#1e0f20') + rect('url(#cg)') +
    `<g fill="none" stroke="url(#sg8)" stroke-width="2.6">${[110, 190, 275, 365, 460].map(r => `<path d="M ${40 - r} 472 A ${r} ${r} 0 0 1 ${40 + r} 472"/>`).join('')}</g>` +
    `<circle cx="238" cy="288" r="10" fill="#ffa8ce" opacity="0.4" filter="url(#b5a)"/><circle cx="238" cy="288" r="4" fill="#ffd2e5"/>`),
  // 9 honeycomb wall — the brand pattern, three lit cells
  () => {
    const s = 44, dx = s * 1.5, dy = s * 0.866
    let cells = '', lit = ''
    for (let col = -1; col < 9; col++) for (let row = -1; row < 8; row++) {
      const x = col * dx, y = row * dy * 2 + (col % 2 ? dy : 0)
      cells += `<polygon points="${hexPts(x, y, s)}"/>`
    }
    ;[[3 * dx, 2 * dy * 2 + dy, 0.2], [dx, 5 * 2 * dy, 0.14], [6 * dx, 6 * 2 * dy + dy, 0.16]].forEach(([x, y, o]) => {
      lit += `<polygon points="${hexPts(x, y, s - 3)}" fill="#d6b25c" fill-opacity="${o}"/>`
    })
    return scene(
      radial('cg', 40, 30, 62, '#d6b25c', 0.08),
      rect('#161307') + rect('url(#cg)') +
      `<g fill="none" stroke="#d6b25c" stroke-width="1.6" stroke-opacity="0.24">${cells}</g>` + lit)
  },
  // 10 phyllotaxis — a golden spiral of dots breathing outward
  () => {
    let dots = ''
    for (let n = 8; n < 130; n++) {
      const a = n * 2.39996, r = 11.5 * Math.sqrt(n)
      const x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r
      if (x < -6 || x > 518 || y < -6 || y > 518) continue
      const o = Math.max(0.06, 0.6 - n * 0.0042)
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.6 + n * 0.02).toFixed(1)}" fill="#8fb3e8" fill-opacity="${o.toFixed(2)}"/>`
    }
    return scene(radial('cg', 50, 50, 52, '#8fb3e8', 0.09), rect('#10131f') + rect('url(#cg)') + dots)
  },
]

// ═════════════════════════════════════════════════════════════════════
// ABSTRACT — ten aurora-silk fields: heavily blurred color, film grain.
// ═════════════════════════════════════════════════════════════════════

const ABSTRACT_SPECS = [
  { base: '#120f22', blobs: [['#7a5cff', 130, 120, 150], ['#ff7eb0', 400, 400, 160], ['#3fc4ff', 400, 110, 110]] },
  { base: '#071418', blobs: [['#22d0b8', 120, 400, 150], ['#3f7bd8', 390, 130, 150], ['#9be59a', 110, 110, 90]] },
  { base: '#1c0f14', blobs: [['#ff8a5b', 140, 130, 140], ['#ffd166', 420, 420, 130], ['#ef476f', 420, 120, 110]], silk: -18 },
  { base: '#0d1420', blobs: [['#4f9fd6', 110, 390, 150], ['#8a7bff', 410, 130, 150], ['#36d1a8', 130, 110, 90]] },
  { base: '#170f26', blobs: [['#c77dff', 400, 120, 150], ['#ff9ec7', 110, 420, 140], ['#7ab8ff', 120, 130, 100]], silk: 22 },
  { base: '#081410', blobs: [['#52d68b', 130, 120, 140], ['#bfe35a', 420, 400, 120], ['#39b3c7', 410, 130, 110]] },
  { base: '#1a1210', blobs: [['#f0a05a', 400, 400, 150], ['#d95970', 120, 120, 140], ['#7a4a9e', 420, 110, 100]] },
  { base: '#0c111e', blobs: [['#5c8fff', 130, 130, 150], ['#45e0d0', 410, 410, 140], ['#d97ab8', 420, 120, 100]], silk: -26 },
  { base: '#150a18', blobs: [['#ff6f91', 410, 130, 140], ['#ffc75f', 130, 410, 120], ['#845ec2', 120, 120, 130]] },
  { base: '#0a1616', blobs: [['#4ecdc4', 120, 400, 150], ['#a8e063', 410, 120, 130], ['#e8f6f5', 420, 420, 80]], silk: 14 },
]
const abstract = (i) => {
  const s = ABSTRACT_SPECS[i]
  let body = rect(s.base)
  let defs = blur('bb70', 70) + blur('bb30', 30)
  s.blobs.forEach(([c, x, y, r]) => { body += `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="0.55" filter="url(#bb70)"/>` })
  if (s.silk !== undefined) {
    defs += `<linearGradient id="silk" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ffffff" stop-opacity="0"/><stop offset="50%" stop-color="#ffffff" stop-opacity="0.14"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/></linearGradient>`
    body += `<g transform="rotate(${s.silk} 256 256)" filter="url(#bb30)"><rect x="-60" y="210" width="640" height="80" fill="url(#silk)"/></g>`
  }
  return scene(defs, body, { grain: 0.12, vig: 0.34 })
}

// ═════════════════════════════════════════════════════════════════════
// COSMOS — ten deep-space plates. Dark by nature: text always wins.
// ═════════════════════════════════════════════════════════════════════

/** A bright star with a soft cross glint. */
const glint = (x, y, s, c = '#ffffff') =>
  `<circle cx="${x}" cy="${y}" r="${s * 0.28}" fill="${c}"/>` +
  `<rect x="${x - s}" y="${y - s * 0.06}" width="${s * 2}" height="${s * 0.12}" rx="${s * 0.06}" fill="${c}" opacity="0.7"/>` +
  `<rect x="${x - s * 0.06}" y="${y - s}" width="${s * 0.12}" height="${s * 2}" rx="${s * 0.06}" fill="${c}" opacity="0.7"/>`

const COSMOS_BUILDERS = [
  // 1 rose nebula
  () => scene(
    blur('n60', 60) + blur('n24', 24),
    rect('#0a0714') + stars(301, 90, [6, 6, 506, 506]) +
    `<circle cx="150" cy="150" r="140" fill="#b0397a" fill-opacity="0.4" filter="url(#n60)"/>` +
    `<circle cx="380" cy="390" r="150" fill="#5b2d9e" fill-opacity="0.45" filter="url(#n60)"/>` +
    `<circle cx="120" cy="120" r="60" fill="#ff8ac2" fill-opacity="0.3" filter="url(#n24)"/>` +
    glint(392, 108, 16, '#ffe9f4'),
    { grain: 0.1, vig: 0.36 }),
  // 2 planetrise — an atmosphere rim along the bottom of the frame
  () => scene(
    blur('p18', 18) + blur('p6', 6) +
    `<linearGradient id="atm" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#6fd0ff" stop-opacity="0.85"/><stop offset="100%" stop-color="#6fd0ff" stop-opacity="0"/></linearGradient>`,
    rect('#05070f') + stars(311, 70, [6, 6, 506, 330]) +
    `<circle cx="256" cy="880" r="470" fill="#0d1a30"/>` +
    `<circle cx="256" cy="880" r="470" fill="none" stroke="url(#atm)" stroke-width="14" filter="url(#p6)"/>` +
    `<ellipse cx="256" cy="414" rx="260" ry="26" fill="#4fb8e8" opacity="0.25" filter="url(#p18)"/>` +
    glint(120, 100, 12) + glint(420, 170, 9, '#cfe4ff'),
    { grain: 0.09, vig: 0.3 }),
  // 3 the galactic band — a diagonal river of stars
  () => scene(
    blur('g40', 40),
    rect('#070812') + stars(331, 60, [6, 6, 506, 506]) +
    `<g transform="rotate(-28 256 256)">` +
    `<rect x="-100" y="196" width="712" height="120" fill="#8f7bd8" opacity="0.22" filter="url(#g40)"/>` +
    `<rect x="-100" y="226" width="712" height="56" fill="#e8dff8" opacity="0.16" filter="url(#g40)"/>` +
    `</g>` + stars(337, 150, [40, 60, 480, 440], 1.1) +
    glint(96, 400, 11, '#f2e8ff'),
    { grain: 0.1, vig: 0.34 }),
  // 4 ringed wanderer — a small saturn in a teal drift
  () => scene(
    blur('r40', 40) + blur('r3', 3),
    rect('#041014') + stars(347, 80, [6, 6, 506, 506]) +
    `<circle cx="160" cy="380" r="130" fill="#0e5a66" fill-opacity="0.4" filter="url(#r40)"/>` +
    `<circle cx="380" cy="120" r="46" fill="#e8c9a0"/>` +
    `<circle cx="366" cy="108" r="44" fill="#c9a071" opacity="0.5"/>` +
    `<g transform="rotate(-22 380 120)"><ellipse cx="380" cy="120" rx="86" ry="20" fill="none" stroke="#f2ddba" stroke-width="5" stroke-opacity="0.8" filter="url(#r3)"/><ellipse cx="380" cy="120" rx="104" ry="26" fill="none" stroke="#c9ad86" stroke-width="3" stroke-opacity="0.5"/></g>`,
    { grain: 0.09, vig: 0.34 }),
  // 5 comet — a long tail from the upper corner
  () => scene(
    blur('c20', 20) + blur('c5', 5) +
    `<linearGradient id="tail" x1="1" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#bfe6ff" stop-opacity="0.7"/><stop offset="100%" stop-color="#bfe6ff" stop-opacity="0"/></linearGradient>`,
    rect('#060a16') + stars(353, 80, [6, 6, 506, 506]) +
    `<polygon points="428,84 -60,430 -60,560 448,120" fill="url(#tail)" filter="url(#c20)" opacity="0.8"/>` +
    `<circle cx="430" cy="96" r="18" fill="#eaf6ff" filter="url(#c5)"/><circle cx="430" cy="96" r="8" fill="#ffffff"/>`,
    { grain: 0.09, vig: 0.32 }),
  // 6 deep field — nothing but graded darkness and stars
  () => scene(
    blur('d50', 50),
    rect('#05060d') +
    `<circle cx="140" cy="360" r="150" fill="#1a2a5e" fill-opacity="0.35" filter="url(#d50)"/>` +
    `<circle cx="400" cy="130" r="120" fill="#4a1e3e" fill-opacity="0.3" filter="url(#d50)"/>` +
    stars(367, 160, [6, 6, 506, 506]) + glint(312, 342, 10, '#ffd9c2') + glint(88, 96, 13),
    { grain: 0.08, vig: 0.3 }),
  // 7 emerald pillars — towers of glowing dust
  () => scene(
    blur('e34', 34) + blur('e14', 14),
    rect('#04100c') + stars(373, 70, [6, 6, 506, 506]) +
    `<g filter="url(#e34)">` +
    `<path d="M120 512 Q 96 330 130 208 Q 150 150 172 208 Q 196 330 186 512 Z" fill="#1f8a5e" opacity="0.55"/>` +
    `<path d="M300 512 Q 286 360 316 262 Q 334 210 352 268 Q 372 370 360 512 Z" fill="#2aa06a" opacity="0.4"/>` +
    `<path d="M430 512 Q 420 400 444 330 Q 456 300 468 334 Q 482 410 474 512 Z" fill="#187a52" opacity="0.45"/>` +
    `</g>` +
    `<circle cx="150" cy="196" r="10" fill="#c2ffe0" opacity="0.6" filter="url(#e14)"/>` +
    glint(338, 250, 9, '#d2ffe8'),
    { grain: 0.1, vig: 0.36 }),
  // 8 eclipse — the black disc and its corona, low in frame
  () => scene(
    blur('ec18', 18) + blur('ec40', 40),
    rect('#060608') + stars(379, 60, [6, 6, 506, 300]) +
    `<circle cx="256" cy="392" r="118" fill="#fff3d6" opacity="0.5" filter="url(#ec40)"/>` +
    `<circle cx="256" cy="392" r="92" fill="#fff8e8" opacity="0.85" filter="url(#ec18)"/>` +
    `<circle cx="256" cy="392" r="84" fill="#050505"/>`,
    { grain: 0.08, vig: 0.26 }),
  // 9 binary glow — two suns sharing a veil of dust
  () => scene(
    blur('t30', 30) + blur('t10', 10),
    rect('#0c0a18') + stars(383, 80, [6, 6, 506, 506]) +
    `<circle cx="170" cy="170" r="70" fill="#ff9e5e" opacity="0.35" filter="url(#t30)"/>` +
    `<circle cx="170" cy="170" r="22" fill="#ffd9ae" filter="url(#t10)"/><circle cx="170" cy="170" r="10" fill="#fff2e0"/>` +
    `<circle cx="368" cy="330" r="60" fill="#6f9eff" opacity="0.3" filter="url(#t30)"/>` +
    `<circle cx="368" cy="330" r="16" fill="#cfe0ff" filter="url(#t10)"/><circle cx="368" cy="330" r="7" fill="#ffffff"/>` +
    `<g transform="rotate(-32 256 256)" filter="url(#t30)"><rect x="-40" y="236" width="600" height="44" fill="#8a6fd0" opacity="0.14"/></g>`,
    { grain: 0.09, vig: 0.34 }),
  // 10 ice moon — a pale cratered disc on indigo
  () => {
    const r = rng(397)
    let craters = ''
    for (let i = 0; i < 9; i++) {
      const a = r() * Math.PI * 2, d = r() * 66
      const x = 150 + Math.cos(a) * d, y = 150 + Math.sin(a) * d * 0.9, cr = 5 + r() * 13
      craters += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${cr.toFixed(0)}" fill="#aab8cc" fill-opacity="0.5"/><circle cx="${(x - cr * 0.16).toFixed(0)}" cy="${(y - cr * 0.16).toFixed(0)}" r="${(cr * 0.72).toFixed(0)}" fill="#dbe4ee" fill-opacity="0.7"/>`
    }
    return scene(
      blur('m24', 24),
      rect('#0b1026') + stars(401, 90, [6, 6, 506, 506]) +
      `<circle cx="150" cy="150" r="108" fill="#cdd8e4" filter="url(#m24)" opacity="0.4"/>` +
      `<circle cx="150" cy="150" r="88" fill="#c4d0de"/>` + craters +
      `<circle cx="186" cy="186" r="88" fill="#0b1026" opacity="0.35"/>`,
      { grain: 0.09, vig: 0.32 })
  },
]

// ═════════════════════════════════════════════════════════════════════
// INK — eight sumi-e plates on warm paper. Calm, light, a red seal.
// ═════════════════════════════════════════════════════════════════════

const PAPER = '#ebe4d2'
const INK1 = '#3a3f42', INK2 = '#5c6266', INK3 = '#8a8f8e'
const seal = (x, y) => `<rect x="${x}" y="${y}" width="24" height="24" rx="3" fill="#b8422e" opacity="0.85"/><rect x="${x + 6}" y="${y + 6}" width="12" height="12" fill="none" stroke="#ebe4d2" stroke-width="2"/>`
/** brushy edge: light turbulence displacement on whatever it wraps */
const BRUSH = `<filter id="brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" result="n" seed="7"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9"/></filter>`
const inkScene = (body) => scene(BRUSH + blur('ib14', 14), rect(PAPER) + body, { grain: 0.07, vig: 0.14, vigColor: '#6e6450' })

const INK_BUILDERS = [
  // 1 mountain washes
  () => inkScene(
    `<g filter="url(#brush)">` +
    `<path d="M-20 300 Q 100 170 210 286 Q 260 336 330 276 Q 420 200 532 296 L 532 348 L -20 348 Z" fill="${INK3}" opacity="0.5"/>` +
    `<path d="M-20 356 Q 140 250 280 340 Q 380 400 532 330 L 532 400 L -20 400 Z" fill="${INK2}" opacity="0.65"/>` +
    `<path d="M-20 430 Q 180 360 350 420 Q 450 452 532 428 L 532 480 L -20 480 Z" fill="${INK1}" opacity="0.8"/>` +
    `</g>` +
    `<rect x="0" y="336" width="512" height="30" fill="${PAPER}" opacity="0.8" filter="url(#ib14)"/>` + seal(436, 60)),
  // 2 lone pine on a cliff
  () => inkScene(
    `<g filter="url(#brush)">` +
    `<path d="M-20 512 L -20 300 Q 60 288 120 320 Q 160 342 150 512 Z" fill="${INK1}" opacity="0.85"/>` +
    `<path d="M96 306 Q 112 220 122 180" stroke="${INK1}" stroke-width="9" fill="none" stroke-linecap="round"/>` +
    `<path d="M118 196 Q 170 176 224 186" stroke="${INK1}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `</g>` +
    [[128, 168, 44], [180, 176, 52], [230, 186, 40]].map(([x, y, w]) => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * 0.26}" fill="${INK2}" opacity="0.75" filter="url(#brush)"/>`).join('') +
    `<path d="M240 420 Q 340 400 460 416" stroke="${INK3}" stroke-width="3" fill="none" opacity="0.6"/>` + seal(430, 430)),
  // 3 bamboo at the right margin
  () => inkScene(
    `<g filter="url(#brush)">` +
    [[358, 9], [412, 13], [456, 7]].map(([x, w]) =>
      `<path d="M${x} 512 L ${x + 6} 0" stroke="${INK1}" stroke-width="${w}" fill="none" opacity="0.8"/>` +
      [90, 210, 330, 440].map(y => `<ellipse cx="${x + 3}" cy="${y}" rx="${w * 0.9}" ry="3" fill="${PAPER}"/>`).join('')).join('') +
    [[336, 140, -30], [382, 260, 20], [326, 350, -14], [434, 180, 28]].map(([x, y, rot]) =>
      `<g transform="rotate(${rot} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="44" ry="7" fill="${INK2}" opacity="0.8"/></g>`).join('') +
    `</g>` + seal(56, 420)),
  // 4 the open circle — one brushstroke, incomplete
  () => inkScene(
    `<g filter="url(#brush)"><path d="M 200 84 A 96 96 0 1 0 288 78" fill="none" stroke="${INK1}" stroke-width="17" stroke-linecap="round" opacity="0.85"/></g>` +
    `<path d="M60 430 Q 256 414 452 428" stroke="${INK3}" stroke-width="2.4" fill="none" opacity="0.5"/>` + seal(404, 396)),
  // 5 fisherman on wide water
  () => inkScene(
    `<g filter="url(#brush)">` +
    `<path d="M-20 200 Q 120 130 240 196 L 240 218 L -20 226 Z" fill="${INK3}" opacity="0.45"/>` +
    `<path d="M60 348 Q 256 336 460 346" stroke="${INK2}" stroke-width="3" fill="none" opacity="0.55"/>` +
    `<path d="M120 396 Q 300 388 420 396" stroke="${INK3}" stroke-width="2.4" fill="none" opacity="0.4"/>` +
    `</g>` +
    `<g fill="${INK1}"><path d="M300 342 Q 330 332 366 342 L 358 352 L 308 352 Z"/><rect x="328" y="316" width="3.4" height="26"/><circle cx="330" cy="312" r="5"/><path d="M332 318 L 366 302" stroke="${INK1}" stroke-width="2" fill="none"/></g>` + seal(66, 66)),
  // 6 wild geese over the marsh
  () => inkScene(
    `<g stroke="${INK1}" stroke-width="5" fill="none" stroke-linecap="round" filter="url(#brush)">` +
    [[190, 118, 1], [258, 150, 0.85], [318, 106, 0.7], [368, 140, 0.55]].map(([x, y, o]) =>
      `<path d="M ${x - 26} ${y + 12} Q ${x} ${y - 10} ${x + 26} ${y + 12}" stroke-opacity="${o}"/>`).join('') +
    `</g>` +
    `<g filter="url(#brush)">` +
    `<path d="M-20 448 Q 140 428 300 442 T 532 436 L 532 512 L -20 512 Z" fill="${INK2}" opacity="0.35"/>` +
    [[80, 470], [130, 460], [420, 466]].map(([x, y]) => `<path d="M${x} ${y + 30} Q ${x + 3} ${y - 8} ${x + 10} ${y - 26}" stroke="${INK1}" stroke-width="3" fill="none" opacity="0.7"/>`).join('') +
    `</g>` + seal(432, 76)),
  // 7 hanging cliffs in mist
  () => inkScene(
    `<g filter="url(#brush)">` +
    `<path d="M126 0 Q 100 120 144 220 Q 164 268 136 330 L 70 330 Q 52 160 74 0 Z" fill="${INK2}" opacity="0.7"/>` +
    `<path d="M396 0 Q 424 100 396 200 Q 378 258 410 340 L 468 340 Q 482 140 468 0 Z" fill="${INK2}" opacity="0.6"/>` +
    `<path d="M272 0 Q 258 90 286 170 Q 298 210 282 250 L 234 250 Q 226 100 240 0 Z" fill="${INK3}" opacity="0.5"/>` +
    `</g>` +
    `<rect x="0" y="230" width="512" height="60" fill="${PAPER}" opacity="0.85" filter="url(#ib14)"/>` +
    `<rect x="0" y="330" width="512" height="44" fill="${PAPER}" opacity="0.7" filter="url(#ib14)"/>` +
    `<path d="M120 452 Q 260 440 400 450" stroke="${INK3}" stroke-width="2.6" fill="none" opacity="0.5"/>`),
  // 8 plum branch — angular strokes, red-ink blossoms
  () => inkScene(
    `<g filter="url(#brush)">` +
    `<path d="M532 120 L 400 160 L 330 230 L 240 258" stroke="${INK1}" stroke-width="9" fill="none" stroke-linecap="round"/>` +
    `<path d="M400 160 L 360 120" stroke="${INK1}" stroke-width="6" fill="none" stroke-linecap="round"/>` +
    `<path d="M330 230 L 300 310 L 250 350" stroke="${INK1}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `</g>` +
    [[362, 116], [318, 238], [296, 312], [244, 262], [252, 344]].map(([x, y], n) =>
      [0, 1, 2, 3, 4].map(p => { const a = (p / 5) * 2 * Math.PI + n; return `<circle cx="${(x + Math.cos(a) * 7).toFixed(1)}" cy="${(y + Math.sin(a) * 7).toFixed(1)}" r="5.4" fill="#c25a48" opacity="0.8"/>` }).join('') +
      `<circle cx="${x}" cy="${y}" r="3" fill="#8a2f22"/>`).join('') + seal(64, 396)),
]

// ═════════════════════════════════════════════════════════════════════
// BOTANICAL — eight plates of deep foliage. Leaves at the edges only.
// ═════════════════════════════════════════════════════════════════════

/** A fern frond arcing from (x,y) at angle deg. */
const frond = (x, y, deg, len, c, o) => {
  let leaflets = ''
  for (let i = 2; i < 11; i++) {
    const t = i / 11, lx = len * t
    const ll = len * 0.22 * (1 - t * 0.72)
    leaflets += `<ellipse cx="${lx.toFixed(1)}" cy="0" rx="${ll.toFixed(1)}" ry="${(ll * 0.3).toFixed(1)}" transform="rotate(${-38} ${lx.toFixed(1)} 0)"/>` +
      `<ellipse cx="${lx.toFixed(1)}" cy="0" rx="${ll.toFixed(1)}" ry="${(ll * 0.3).toFixed(1)}" transform="rotate(38 ${lx.toFixed(1)} 0)"/>`
  }
  return `<g transform="translate(${x} ${y}) rotate(${deg})" fill="${c}" fill-opacity="${o}"><path d="M0 0 Q ${len * 0.5} -8 ${len} -4" stroke="${c}" stroke-opacity="${o}" stroke-width="3" fill="none"/>${leaflets}</g>`
}
/** A monstera-ish split leaf at (x,y), scaled s, rotated deg. */
const monstera = (x, y, s, deg, c, o) => {
  const holes = [[-0.28, -0.1], [0.02, -0.34], [0.3, -0.06], [0.02, 0.26]]
    .map(([hx, hy]) => `<ellipse cx="${(hx * s).toFixed(1)}" cy="${(hy * s).toFixed(1)}" rx="${(s * 0.16).toFixed(1)}" ry="${(s * 0.056).toFixed(1)}" transform="rotate(${(hx * 60).toFixed(0)} ${(hx * s).toFixed(1)} ${(hy * s).toFixed(1)})"/>`).join('')
  return `<g transform="translate(${x} ${y}) rotate(${deg})"><path d="M 0 ${-s} C ${s * 0.9} ${-s * 0.9}, ${s} ${s * 0.5}, 0 ${s} C ${-s} ${s * 0.5}, ${-s * 0.9} ${-s * 0.9}, 0 ${-s} Z" fill="${c}" fill-opacity="${o}"/><g fill="#0a130d" fill-opacity="${o}">${holes}</g></g>`
}

const BOTANICAL_BUILDERS = [
  // 1 monstera corners
  () => scene(
    radial('gg', 54, 40, 62, '#3d8a58', 0.2) + blur('bg8', 8),
    rect('#102418') + rect('url(#gg)') +
    monstera(64, 84, 96, -28, '#1e5232', 0.95) +
    monstera(452, 440, 116, 152, '#276440', 0.9) +
    monstera(470, 60, 70, 40, '#1a462a', 0.9) +
    `<circle cx="120" cy="430" r="34" fill="#57c88a" opacity="0.16" filter="url(#bg8)"/>`,
    { grain: 0.09, vig: 0.34 }),
  // 2 fern arcs from below
  () => scene(
    radial('gg', 46, 30, 60, '#4a9a72', 0.18) + blur('bg6', 6),
    rect('#132a1c') + rect('url(#gg)') +
    frond(-10, 470, -38, 240, '#2c6a44', 0.9) +
    frond(30, 512, -62, 280, '#357a4e', 0.85) +
    frond(522, 460, 216, 250, '#28583a', 0.9) +
    frond(480, 512, 242, 230, '#3d8a58', 0.7) +
    [[150, 120], [420, 200], [90, 240]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#bfe8cf" opacity="0.5"/>`).join(''),
    { grain: 0.09, vig: 0.34 }),
  // 3 eucalyptus sprigs
  () => {
    const sprig = (x, y, deg, n, c) => {
      let leaves = ''
      for (let i = 1; i <= n; i++) {
        const t = i / n
        leaves += `<circle cx="${(t * 150).toFixed(0)}" cy="${(i % 2 ? -14 : 14) * (1 - t * 0.4)}" r="${(15 - t * 6).toFixed(1)}" fill="${c}"/>`
      }
      return `<g transform="translate(${x} ${y}) rotate(${deg})"><path d="M0 0 L 152 0" stroke="${c}" stroke-width="2.6"/> ${leaves}</g>`
    }
    return scene(
      radial('gg', 50, 56, 60, '#9dc4ae', 0.14),
      rect('#1c2e24') + rect('url(#gg)') +
      sprig(20, 60, 34, 6, '#47705f') + sprig(512, 96, 148, 6, '#527a6c') +
      sprig(-8, 420, -26, 5, '#3d5c50') + sprig(500, 452, 206, 6, '#5c8674'),
      { grain: 0.08, vig: 0.3 })
  },
  // 4 palm blades from the left
  () => {
    const blade = (deg, len, c, o) => `<g transform="translate(-30 256) rotate(${deg})"><path d="M0 0 Q ${len * 0.6} ${-len * 0.1} ${len} 0 Q ${len * 0.6} ${len * 0.06} 0 0 Z" fill="${c}" fill-opacity="${o}"/></g>`
    return scene(
      radial('gg', 70, 40, 60, '#4a9a68', 0.18) + blur('bg10', 10),
      rect('#0e1e16') + rect('url(#gg)') +
      [-52, -34, -18, -2, 14, 30, 48].map((deg, i) => blade(deg, 300 - Math.abs(deg) * 1.4, i % 2 ? '#1f4a30' : '#2a6040', 0.9)).join('') +
      `<circle cx="420" cy="120" r="48" fill="#57c88a" opacity="0.16" filter="url(#bg10)"/>`,
      { grain: 0.09, vig: 0.34 })
  },
  // 5 midnight garden — gold line-art on near-black
  () => scene(
    radial('gg', 50, 44, 58, '#d6b25c', 0.09),
    rect('#11151d') + rect('url(#gg)') +
    `<g fill="none" stroke="#d6b25c" stroke-opacity="0.7" stroke-width="2.4">` +
    `<path d="M -10 480 Q 80 420 96 330 M 96 388 Q 130 372 148 340 M 96 430 Q 60 414 48 382 M 96 356 Q 116 348 128 322"/>` +
    `<path d="M 522 470 Q 440 430 420 340 M 420 396 Q 396 384 384 356 M 420 430 Q 452 420 464 392"/>` +
    `<circle cx="470" cy="88" r="20"/><circle cx="470" cy="88" r="8"/>` +
    `</g>` +
    `<g fill="#d6b25c" opacity="0.75">${[[96, 322], [148, 334], [48, 376], [420, 334], [384, 350], [464, 386]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4"/>`).join('')}</g>`,
    { grain: 0.08, vig: 0.28 }),
  // 6 olive light — the one bright plate
  () => {
    const sprig = (x, y, deg, c, fruit) => {
      let out = `<g transform="translate(${x} ${y}) rotate(${deg})"><path d="M0 0 L 170 0" stroke="${c}" stroke-width="3"/>`
      for (let i = 1; i <= 5; i++) {
        const t = i / 5
        out += `<ellipse cx="${t * 160}" cy="${i % 2 ? -12 : 12}" rx="17" ry="5.5" fill="${c}" transform="rotate(${i % 2 ? -24 : 24} ${t * 160} ${i % 2 ? -12 : 12})"/>`
      }
      if (fruit) out += `<circle cx="60" cy="6" r="7" fill="#4a5a38"/><circle cx="98" cy="-6" r="7" fill="#5d6f42"/>`
      return out + `</g>`
    }
    return scene(
      radial('gg', 40, 20, 70, '#ffffff', 0.5),
      rect('#e6e2d0') + rect('url(#gg)') +
      sprig(-16, 84, 22, '#8a9c68', true) + sprig(522, 120, 158, '#7d8f5f', false) +
      sprig(-10, 440, -18, '#98a878', false) + sprig(516, 430, 196, '#8a9c68', true),
      { grain: 0.05, vig: 0.14, vigColor: '#5c5940' })
  },
  // 7 dark rose — silhouette stems, one ember bloom
  () => scene(
    radial('gg', 74, 78, 56, '#a84a64', 0.2) + blur('bg16', 16),
    rect('#1d1119') + rect('url(#gg)') +
    `<circle cx="404" cy="404" r="66" fill="#d84a66" opacity="0.4" filter="url(#bg16)"/>` +
    `<g fill="#54293d"><circle cx="404" cy="404" r="34"/><circle cx="388" cy="392" r="26"/><circle cx="418" cy="390" r="22"/><circle cx="404" cy="404" r="16" fill="#7a3a52"/></g>` +
    `<g stroke="#3d2133" stroke-width="5" fill="none"><path d="M404 438 Q 380 480 360 512"/><path d="M120 512 Q 140 420 118 350 M118 396 Q 96 384 88 358 M118 428 Q 142 420 152 396"/></g>` +
    `<g fill="#3d2133">${[[88, 352], [152, 390], [118, 344]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="14" ry="6" transform="rotate(-30 ${x} ${y})"/>`).join('')}</g>`,
    { grain: 0.09, vig: 0.34 }),
  // 8 lotus pond at night
  () => scene(
    radial('gg', 60, 30, 60, '#57a8c0', 0.14) + blur('bg12', 12),
    rect('#10222b') + rect('url(#gg)') +
    `<g fill="#22504a">${[[110, 440, 74], [280, 470, 92], [430, 430, 60]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.32}"/><path d="M ${x} ${y} L ${x + r * 0.8} ${y - r * 0.16} L ${x + r * 0.72} ${y + r * 0.08} Z" fill="#10222b"/>`).join('')}</g>` +
    `<g fill="none" stroke="#457a88" stroke-width="1.8" stroke-opacity="0.65">${[[180, 380], [360, 396]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="40" ry="8"/><ellipse cx="${x}" cy="${y}" rx="64" ry="13"/>`).join('')}</g>` +
    `<circle cx="392" cy="352" r="30" fill="#e8c9d4" opacity="0.3" filter="url(#bg12)"/>` +
    `<g fill="#e8c9d4"><path d="M392 344 Q 384 328 392 316 Q 400 328 392 344 Z"/><path d="M392 346 Q 376 336 372 322 Q 388 326 392 346 Z" opacity="0.85"/><path d="M392 346 Q 408 336 412 322 Q 396 326 392 346 Z" opacity="0.85"/><ellipse cx="392" cy="350" rx="16" ry="5" fill="#c9a0b4"/></g>`,
    { grain: 0.09, vig: 0.36 }),
]

// ── theme table + build pipeline ─────────────────────────────────────

const nature = (i) => NATURE_SCENES[i % NATURE_SCENES.length]()
const geometric = (i) => GEO_BUILDERS[i % GEO_BUILDERS.length]()
const cosmos = (i) => COSMOS_BUILDERS[i % COSMOS_BUILDERS.length]()
const ink = (i) => INK_BUILDERS[i % INK_BUILDERS.length]()
const botanical = (i) => BOTANICAL_BUILDERS[i % BOTANICAL_BUILDERS.length]()

const THEMES = [
  { id: 'theme-minimal',   label: 'Minimal',   build: minimal,   count: MINIMAL_SPECS.length },
  { id: 'theme-geometric', label: 'Geometric', build: geometric, count: GEO_BUILDERS.length },
  { id: 'theme-abstract',  label: 'Abstract',  build: abstract,  count: ABSTRACT_SPECS.length },
  { id: 'theme-nature',    label: 'Nature',    build: nature,    count: NATURE_SCENES.length },
  { id: 'theme-cosmos',    label: 'Cosmos',    build: cosmos,    count: COSMOS_BUILDERS.length },
  { id: 'theme-ink',       label: 'Ink',       build: ink,       count: INK_BUILDERS.length },
  { id: 'theme-botanical', label: 'Botanical', build: botanical, count: BOTANICAL_BUILDERS.length },
]

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
    for (let i = 0; i < t.count; i++) {
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
    console.log(`✓ ${t.label.padEnd(10)} → ${t.count} png × ${PUBLIC_DIRS.length} dirs`)
  }
  await browser.close()
}
run().catch(e => { console.error(e); process.exit(1) })
