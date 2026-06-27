// scripts/backgrounds/gen-sets.mjs
//
// Generates the five themed background sets as both:
//   • tile rasters   — 512×512  → public/substrate/<set>/<archetype>.png
//   • screen rasters  — 1600×1000 → public/substrate/<set>/screen/<archetype>.png
// plus the SVG sources under the background textures tree, and a manifest.json
// per set (tile rasters) for the SubstrateService.
//
// The screen rasters are the canvas/screen backgrounds (see /canvas). Patterns
// use a fixed 90px tile so density stays correct at any canvas size; gradients
// are percentage-based so they fill whatever box they're drawn into.
//
// Run from the monorepo root (src/):  node scripts/backgrounds/gen-sets.mjs

import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const SETS = [
  { id: 'steel',    label: 'Steel',    light: false, base: '#0e161c', base2: '#15242f', deep: '#05080c', accent: '#7eb6d6', accent2: '#1f4f76' },
  { id: 'daylight', label: 'Daylight', light: true,  base: '#f4ecde', base2: '#fdf7ea', deep: '#c7b79a', accent: '#1f4376', accent2: '#6f9ec9' },
  { id: 'indigo',   label: 'Indigo',   light: false, base: '#0d1226', base2: '#161d3a', deep: '#04060f', accent: '#7b8be0', accent2: '#243079' },
  { id: 'teal',     label: 'Teal',     light: false, base: '#07201c', base2: '#0c2e28', deep: '#020f0c', accent: '#45c7a5', accent2: '#0d4d40' },
  { id: 'ember',    label: 'Ember',    light: false, base: '#1a1410', base2: '#2a1d12', deep: '#0b0704', accent: '#d3a47a', accent2: '#5a3a18' },
]

const HEX = [
  '75,25.98 60,51.96 30,51.96 15,25.98 30,0 60,0',
  '30,0 15,25.98 -15,25.98 -30,0 -15,-25.98 15,-25.98',
  '120,0 105,25.98 75,25.98 60,0 75,-25.98 105,-25.98',
  '30,51.96 15,77.94 -15,77.94 -30,51.96 -15,25.98 15,25.98',
  '120,51.96 105,77.94 75,77.94 60,51.96 75,25.98 105,25.98',
]

const wrap = (inner, W, H) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${inner}</svg>`
const fill = (ref, W, H) => `<rect width="${W}" height="${H}" fill="${ref}"/>`

const glow = (p, id, W, H, cy = 6, r = 82, a) => {
  const c = p.light ? '#ffffff' : p.accent
  const alpha = a ?? (p.light ? 0.5 : 0.1)
  return {
    def: `<radialGradient id="${id}" cx="50%" cy="${cy}%" r="${r}%"><stop offset="0%" stop-color="${c}" stop-opacity="${alpha}"/><stop offset="58%" stop-color="${c}" stop-opacity="0"/></radialGradient>`,
    use: fill(`url(#${id})`, W, H),
  }
}
const vig = (p, id, W, H, a) => {
  const alpha = a ?? (p.light ? 0.16 : 0.58)
  return {
    def: `<radialGradient id="${id}" cx="50%" cy="44%" r="80%"><stop offset="50%" stop-color="${p.deep}" stop-opacity="0"/><stop offset="100%" stop-color="${p.deep}" stop-opacity="${alpha}"/></radialGradient>`,
    use: fill(`url(#${id})`, W, H),
  }
}

const depth = (p, W, H) => {
  const g = glow(p, 'g', W, H), v = vig(p, 'v', W, H)
  return wrap(`<defs>${g.def}${v.def}</defs>${fill(p.base, W, H)}${g.use}${v.use}`, W, H)
}
const honeycomb = (p, W, H) => {
  const lineA = p.light ? 0.11 : 0.16
  const pat = `<pattern id="hx" width="90" height="51.96" patternUnits="userSpaceOnUse"><g fill="none" stroke="${p.accent}" stroke-width="1.2" stroke-opacity="${lineA}">${HEX.map(pt => `<polygon points="${pt}"/>`).join('')}</g></pattern>`
  const g = glow(p, 'g', W, H, 10, 80, p.light ? 0.4 : 0.09), v = vig(p, 'v', W, H)
  return wrap(`<defs>${pat}${g.def}${v.def}</defs>${fill(p.base, W, H)}${fill('url(#hx)', W, H)}${g.use}${v.use}`, W, H)
}
const sheen = (p, W, H) => {
  const bandA = p.light ? 0.06 : 0.11
  const base = `<linearGradient id="b" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${p.base}"/><stop offset="100%" stop-color="${p.base2}"/></linearGradient>`
  const band = `<linearGradient id="s" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="30%" stop-color="${p.accent}" stop-opacity="0"/><stop offset="50%" stop-color="${p.accent}" stop-opacity="${bandA}"/><stop offset="70%" stop-color="${p.accent}" stop-opacity="0"/></linearGradient>`
  const v = vig(p, 'v', W, H, p.light ? 0.12 : 0.42)
  return wrap(`<defs>${base}${band}${v.def}</defs>${fill('url(#b)', W, H)}${fill('url(#s)', W, H)}${v.use}`, W, H)
}
const mesh = (p, W, H) => {
  if (p.light) {
    const b1 = `<radialGradient id="m1" cx="20%" cy="18%" r="60%"><stop offset="0%" stop-color="#cce0f2" stop-opacity="0.55"/><stop offset="70%" stop-color="#cce0f2" stop-opacity="0"/></radialGradient>`
    const b2 = `<radialGradient id="m2" cx="82%" cy="84%" r="62%"><stop offset="0%" stop-color="#f3dcc0" stop-opacity="0.6"/><stop offset="70%" stop-color="#f3dcc0" stop-opacity="0"/></radialGradient>`
    const v = vig(p, 'v', W, H, 0.14)
    return wrap(`<defs>${b1}${b2}${v.def}</defs>${fill(p.base2, W, H)}${fill('url(#m1)', W, H)}${fill('url(#m2)', W, H)}${v.use}`, W, H)
  }
  const b1 = `<radialGradient id="m1" cx="20%" cy="16%" r="55%"><stop offset="0%" stop-color="${p.accent}" stop-opacity="0.14"/><stop offset="70%" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>`
  const b2 = `<radialGradient id="m2" cx="84%" cy="82%" r="62%"><stop offset="0%" stop-color="${p.accent2}" stop-opacity="0.42"/><stop offset="70%" stop-color="${p.accent2}" stop-opacity="0"/></radialGradient>`
  const b3 = `<radialGradient id="m3" cx="60%" cy="28%" r="46%"><stop offset="0%" stop-color="${p.accent}" stop-opacity="0.12"/><stop offset="70%" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>`
  const v = vig(p, 'v', W, H, 0.5)
  return wrap(`<defs>${b1}${b2}${b3}${v.def}</defs>${fill(p.base, W, H)}${fill('url(#m1)', W, H)}${fill('url(#m2)', W, H)}${fill('url(#m3)', W, H)}${v.use}`, W, H)
}
const dots = (p, W, H) => {
  const dA = p.light ? 0.13 : 0.18
  const pat = `<pattern id="dt" width="90" height="51.96" patternUnits="userSpaceOnUse"><g fill="${p.accent}" fill-opacity="${dA}"><circle cx="0" cy="0" r="1.8"/><circle cx="90" cy="0" r="1.8"/><circle cx="0" cy="51.96" r="1.8"/><circle cx="90" cy="51.96" r="1.8"/><circle cx="45" cy="25.98" r="1.8"/></g></pattern>`
  const g = glow(p, 'g', W, H, 10, 80, p.light ? 0.4 : 0.08), v = vig(p, 'v', W, H)
  return wrap(`<defs>${pat}${g.def}${v.def}</defs>${fill(p.base, W, H)}${fill('url(#dt)', W, H)}${g.use}${v.use}`, W, H)
}
const contour = (p, W, H) => {
  const cx = W / 2, cy = H / 2
  const maxR = Math.hypot(W, H) / 2 * 1.02
  const step = maxR / 12
  let rings = ''
  for (let r = step; r <= maxR; r += step) rings += `<ellipse cx="${cx}" cy="${cy}" rx="${r.toFixed(1)}" ry="${(r * 0.8).toFixed(1)}"/>`
  const gc = p.light ? '#ffffff' : p.accent
  const g = `<radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${gc}" stop-opacity="${p.light ? 0.45 : 0.06}"/><stop offset="70%" stop-color="${gc}" stop-opacity="0"/></radialGradient>`
  const v = vig(p, 'v', W, H)
  return wrap(`<defs>${g}${v.def}</defs>${fill(p.base, W, H)}${fill('url(#g)', W, H)}<g fill="none" stroke="${p.accent}" stroke-opacity="0.11" stroke-width="1.2">${rings}</g>${v.use}`, W, H)
}

const grid = (p, W, H) => {
  const lineA = p.light ? 0.14 : 0.11
  const pat = `<pattern id="cg" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="${p.accent}" stroke-width="1" stroke-opacity="${lineA}"/></pattern>`
  const g = glow(p, 'g', W, H, 8, 80, p.light ? 0.4 : 0.07), v = vig(p, 'v', W, H)
  return wrap(`<defs>${pat}${g.def}${v.def}</defs>${fill(p.base, W, H)}${fill('url(#cg)', W, H)}${g.use}${v.use}`, W, H)
}

const ARCHS = [
  ['depth', depth], ['honeycomb', honeycomb], ['sheen', sheen],
  ['mesh', mesh], ['dots', dots], ['contour', contour], ['grid', grid],
]

const PUBLIC_DIRS = [
  'hypercomb-web/public/substrate',
  'hypercomb-dev/public/substrate',
  'shared-public/substrate',
].filter(d => existsSync(d.split('/substrate')[0]))

const SRC_DIR = 'hypercomb-essentials/src/diamondcoreprocessor.com/presentation/background/textures/sets'

const TILE = { w: 512, h: 512, dir: '', suffix: '' }                     // per-tile fill raster
const LAND = { w: 1600, h: 1000, dir: 'screen/', suffix: '' }            // landscape canvas backdrop
const PORT = { w: 1000, h: 1600, dir: 'screen/', suffix: '.portrait' }   // portrait canvas backdrop

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  for (const p of SETS) {
    await mkdir(`${SRC_DIR}/${p.id}`, { recursive: true })
    for (const dir of PUBLIC_DIRS) {
      await mkdir(`${dir}/${p.id}`, { recursive: true })
      await mkdir(`${dir}/${p.id}/screen`, { recursive: true })
    }
    const manifest = JSON.stringify({ images: ARCHS.map(([n]) => `${n}.png`) }, null, 2)

    for (const [name, build] of ARCHS) {
      for (const out of [TILE, LAND, PORT]) {
        const svgStr = build(p, out.w, out.h)
        if (out === TILE) await writeFile(`${SRC_DIR}/${p.id}/${name}.svg`, svgStr)
        await page.setViewportSize({ width: out.w, height: out.h })
        await page.setContent(
          `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}svg{display:block}</style><body>${svgStr}</body>`,
          { waitUntil: 'load' },
        )
        const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: out.w, height: out.h } })
        for (const dir of PUBLIC_DIRS) await writeFile(`${dir}/${p.id}/${out.dir}${name}${out.suffix}.png`, png)
      }
    }
    for (const dir of PUBLIC_DIRS) await writeFile(`${dir}/${p.id}/manifest.json`, manifest)
    console.log(`✓ ${p.label.padEnd(9)} → ${ARCHS.length} tile + ${ARCHS.length} land + ${ARCHS.length} portrait png × ${PUBLIC_DIRS.length} dirs`)
  }

  await browser.close()
  console.log(`\nPublic dirs: ${PUBLIC_DIRS.join(', ')}`)
}

run().catch(e => { console.error(e); process.exit(1) })
