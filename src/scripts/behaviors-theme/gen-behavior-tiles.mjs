// Themed tile art for the behaviors hive — one 512×512 PNG per cell.
// Reads census.json (paths from the fresh bridge walk), derives each cell's
// tier (root/collection/behavior/part) + category color + Material glyph,
// renders inline-SVG-in-HTML with real fonts, screenshots each card.
// Output: tiles/<slug>.png + tiles/manifest.json (path → file).
//
// Run: node gen-behavior-tiles.mjs   (cwd = scratchpad; playwright from repo)
import { createRequire } from 'node:module'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('playwright')

const W = 512, H = 512, C = 256

// ── Category palette (mirror TagRegistry pheromone colors) ──────────
const CATEGORIES = {
  behaviors:   { color: '#d9a514', glyph: 'hive' },
  games:       { color: '#c05b4d', glyph: 'sports_esports' },
  views:       { color: '#4d7fae', glyph: 'visibility' },
  assistant:   { color: '#8a63c9', glyph: 'smart_toy' },
  swarm:       { color: '#4f9d6e', glyph: 'hub' },
  appearance:  { color: '#b06a9e', glyph: 'palette' },
  structure:   { color: '#8b909a', glyph: 'account_tree' },
  input:       { color: '#579fa5', glyph: 'keyboard' },
  guidance:    { color: '#c98f2f', glyph: 'school' },
  'tool-windows': { color: '#6b7fae', glyph: 'web_asset' },
}

const GLYPHS = {
  arkanoid: 'apps', bubble: 'bubble_chart', roper: 'gesture', solomon: 'castle',
  tree: 'account_tree', present: 'slideshow', website: 'web', view: 'visibility',
  postit: 'sticky_note_2', welcome: 'door_open',
  home: 'home', lightbox: 'photo_library', tutor: 'school', mobile: 'smartphone',
  screensaver: 'wallpaper', tags: 'sell', history: 'history', revise: 'edit_note',
  versions: 'layers',
  opus: 'auto_awesome', sonnet: 'bolt', haiku: 'spa', fable: 'auto_stories',
  ask: 'help', chat: 'chat', expand: 'unfold_more', record: 'mic',
  'translate-sweep': 'translate', workflow: 'conversion_path',
  observe: 'travel_explore', domain: 'dns', 'block-peer': 'block',
  'clear-mesh': 'wifi_off', repush: 'sync', host: 'router', invite: 'person_add',
  meeting: 'groups', publish: 'cloud_upload',
  accent: 'colorize', border: 'border_style', canvas: 'texture',
  backgrounds: 'image', substrate: 'grid_on', reroll: 'casino', theme: 'palette',
  heal: 'healing',
  // the toolchain that renders these cards, mirrored under appearance
  'behaviors-theme': 'auto_fix_high',
  header: 'web_asset', format: 'format_paint', 'text-only': 'text_fields',
  background: 'landscape',
  keyword: 'label', remove: 'delete', move: 'open_with', arrange: 'dashboard_customize',
  swirl: 'cyclone', sequence: 'linear_scale', layout: 'view_quilt', title: 'format_size',
  reference: 'link', branch: 'call_split', snapshot: 'photo_camera',
  restore: 'settings_backup_restore', dropbox: 'inbox', contact: 'contact_page',
  files: 'folder', clear: 'clear_all', hive: 'hive',
  voice: 'record_voice_over', 'push-to-talk': 'mic', language: 'language',
  'i18n-override': 'g_translate',
  help: 'help_center', docs: 'menu_book', tutorial: 'flag', debug: 'bug_report',
  'atomize-ui': 'science',
}

// deterministic per-name jitter so the wall reads varied, not stamped
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return (h >>> 0) }

// Hex orientation for the whole set — ring AND lattice, so a card never
// disagrees with itself. Point-top matches the platform grid; a flat-top
// snapshot is the same census re-rendered with HEX_ORIENTATION=flat.
const ROT = process.env.HEX_ORIENTATION === 'flat' ? 0 : 30
// Each orientation is its own SET — never render one over the other's files.
const OUT = process.env.OUT_DIR || 'tiles'

const hexPts = (cx, cy, s, rot = 0) => Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 180 * (60 * i + rot)
  return `${(cx + s * Math.cos(a)).toFixed(1)},${(cy + s * Math.sin(a)).toFixed(1)}`
}).join(' ')

// Faint hex lattice. NOTE the tiling offsets below are flat-top spacing
// (column pitch 1.5s, row pitch √3·s) — so with HEX_ORIENTATION=flat the mesh
// tessellates exactly, while the point-top default draws point-top cells on
// that same flat-top pitch and they overlap slightly. At 0.05 opacity that
// reads as texture, and it is what the shipped point-top set already wears,
// so it is deliberately left alone rather than re-cut under 458 live cards.
function lattice(color, seed) {
  const rows = []
  const s = 46, dx = s * 1.5, dy = s * Math.sqrt(3) / 2
  const off = (seed % 23)
  for (let r = -1; r < 8; r++) for (let q = -1; q < 8; q++) {
    const cx = q * dx + off, cy = r * dy * 2 + (q % 2 ? dy : 0) + off
    rows.push(`<polygon points="${hexPts(cx, cy, s, ROT)}" fill="none" stroke="${color}" stroke-opacity="0.05" stroke-width="1.5"/>`)
  }
  return rows.join('')
}

function card(cell) {
  const { name, color, glyph, tier } = cell
  const seed = hash(name)
  const glowY = 42 + (seed % 9)          // subtle per-tile variation
  const rot = ROT
  const glyphSize = tier === 'root' ? 210 : tier === 'collection' ? 195 : tier === 'behavior' ? 160 : 116
  const ringR = tier === 'root' ? 178 : tier === 'collection' ? 170 : tier === 'behavior' ? 150 : 120
  const ringW = tier === 'collection' || tier === 'root' ? 3.5 : tier === 'behavior' ? 2.5 : 1.8
  const ringOp = tier === 'part' ? 0.30 : 0.55
  const glowA = tier === 'root' ? 0.30 : tier === 'collection' ? 0.26 : tier === 'behavior' ? 0.20 : 0.12
  // No baked caption — the platform draws tile labels itself.
  const caption = ''
  const glyphColor = tier === 'part' ? '#a7ada3' : color
  const glyphY = 256
  return `
  <div class="tile" style="width:${W}px;height:${H}px">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;inset:0">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d1016"/><stop offset="100%" stop-color="#131820"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="${glowY}%" r="62%">
          <stop offset="0%" stop-color="${color}" stop-opacity="${glowA}"/>
          <stop offset="72%" stop-color="${color}" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="vig" cx="50%" cy="46%" r="82%">
          <stop offset="55%" stop-color="#05070b" stop-opacity="0"/>
          <stop offset="100%" stop-color="#05070b" stop-opacity="0.55"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#bg)"/>
      ${lattice(color, seed)}
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
      <polygon points="${hexPts(C, glyphY, ringR, rot)}" fill="none" stroke="${color}" stroke-opacity="${ringOp}" stroke-width="${ringW}"/>
      ${tier === 'root' ? `<polygon points="${hexPts(C, glyphY, ringR - 14, rot)}" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-width="1.5"/>` : ''}
      <rect width="${W}" height="${H}" fill="url(#vig)"/>
    </svg>
    <span class="ms" style="font-size:${glyphSize}px;color:${glyphColor};top:${glyphY}px">${glyph}</span>
    ${caption}
  </div>`
}

async function main() {
  const census = JSON.parse(await readFile('census.json', 'utf8'))
  const cells = []
  for (const c of census) {
    if (c.error || !c.path) continue
    const path = c.path
    const name = path[path.length - 1]
    let tier, catKey
    if (path.length === 1) { tier = 'root'; catKey = 'behaviors' }
    else if (path.length === 2) { tier = 'collection'; catKey = CATEGORIES[name] ? name : path[1] }
    else if (path.length === 3) { tier = 'behavior'; catKey = path[1] }
    else { tier = 'part'; catKey = path[1] }
    const cat = CATEGORIES[catKey] ?? CATEGORIES.behaviors
    const glyph = tier === 'part' ? 'data_object'
      : tier === 'collection' || tier === 'root' ? (CATEGORIES[name]?.glyph ?? cat.glyph)
      : (GLYPHS[name] ?? cat.glyph)
    cells.push({ path, name, tier, color: cat.color, glyph })
  }

  await mkdir(OUT, { recursive: true })
  const fontB64 = (await readFile(new URL('../../hypercomb-legacy/src/assets/fonts/Material/material.woff2', import.meta.url))).toString('base64')
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: W + 40, height: H + 40 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html><head>
    <style>
      @font-face { font-family:'MSLocal'; src:url(data:font/woff2;base64,${fontB64}) format('woff2'); }
      body { margin:0; background:#000 }
      .tile { position:relative; overflow:hidden }
      .ms { font-family:'MSLocal'; font-weight:400; position:absolute;
            left:50%; transform:translate(-50%,-50%); line-height:1;
            font-feature-settings:'liga'; white-space:nowrap }
      .cap { position:absolute; left:0; right:0; text-align:center; bottom:46px; font-family:'Segoe UI', sans-serif }
      .cap.col { font-size:37px; font-weight:600; letter-spacing:0.14em }
      .cap.beh { font-size:38px; font-weight:500; letter-spacing:0.02em }
      .cap.part { font-size:26px; font-weight:500; font-family:Consolas, monospace }
    </style></head><body><div id="mount"></div>
    <span id="probe" style="font-family:'MSLocal';font-size:100px;position:absolute;visibility:hidden;white-space:nowrap"></span>
    </body></html>`)
  await page.evaluate(() => document.fonts.load('100px "MSLocal"', 'home'))
  await page.evaluate(() => document.fonts.ready)
  const ok = await page.evaluate(() => document.fonts.check('100px "MSLocal"'))
  if (!ok) throw new Error('MSLocal font failed to load')

  // ligature check: a rendered glyph is ~1em wide; a missing ligature spells
  // out the name and is much wider. Fall back to the category glyph, then to
  // a plain hexagon char if even that is missing.
  const ligOk = async name => await page.evaluate(n => {
    const p = document.getElementById('probe'); p.textContent = n
    return p.getBoundingClientRect().width < 140
  }, name)

  const manifest = {}
  let fellBack = 0
  for (const cell of cells) {
    if (!(await ligOk(cell.glyph))) {
      const catGlyph = (CATEGORIES[cell.path[1]] ?? CATEGORIES.behaviors).glyph
      cell.glyph = (await ligOk(catGlyph)) ? catGlyph : 'hexagon'
      fellBack++
    }
    await page.evaluate(html => { document.getElementById('mount').innerHTML = html }, card(cell))
    await page.waitForTimeout(16)
    const el = await page.$('.tile')
    const slug = cell.path.join('__')
    await el.screenshot({ path: `${OUT}/${slug}.png` })
    manifest[cell.path.join('/')] = { file: `${slug}.png`, tier: cell.tier, color: cell.color, glyph: cell.glyph }
  }
  console.log('ligature fallbacks:', fellBack)
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1))
  await browser.close()
  console.log('generated', cells.length, 'tiles')
}
main().catch(e => { console.error(e); process.exit(1) })
