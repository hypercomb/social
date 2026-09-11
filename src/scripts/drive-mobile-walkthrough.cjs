#!/usr/bin/env node
// drive-mobile-walkthrough — record the phone experience end to end.
//
//   node scripts/drive-mobile-walkthrough.cjs --port 4254 --out <dir>
//                                            [--only portrait|landscape]
//                                            [--engine msedge|chrome|chromium]
//
// Two passes — portrait 375×812, then landscape 812×375 — each in a fresh,
// touch-capable phone context with the mobile override ON and Playwright's
// video recorder running. Every step writes a numbered PNG and a row in
// steps.json: what was pressed, and the DOM facts measured right then (is the
// top bar there, is the bottom bar there, which sheet is up, what the command
// line holds). The rows are what a report is written from; the PNGs and the
// .webm are the proof.
//
// The phone bar it walks has two rows. The BOTTOM ROW (.mobile-nav) is always
// there: back · face · camera · add · tools. The TOOLS ROW (.mobile-tools-row)
// is what the tools disc opens directly above it, on the same five columns:
// share · swarm · tags · pin · fullscreen. In landscape the rows become two
// columns down the left edge. The bottom row reads tools · add · camera ·
// face · back from top to bottom, and the tools column sits to its right. The
// list · hexagons switch is the FACE disc now, not part of the list header.
//
// Besides what is on screen, the facts carry:
//   bottomOrder     — the bottom row's disc classes in reading order (by x in
//                     portrait, by y top→bottom in landscape);
//   toolsOver       — which bottom-row disc each tools-row disc lines up with
//                     (same column in portrait, same slot in landscape);
//   hits            — for every visible disc in both rows, whether
//                     elementFromPoint at its centre lands inside it (false =
//                     something is on top of it);
//   sheetClearsRows — with the Add sheet up, that it overlaps neither row;
//   viewfinder      — the camera video's size while its overlay is up
//                     ([0,0] = overlay up, no frames).
//
// The browser gets a FAKE CAMERA: Chromium's fake media device, the permission
// prompt auto-accepted, and a camera grant on the context. That way the camera
// disc opens a live viewfinder instead of the "no camera" toast.
//
// Headed msedge by default: headless has no GPU, and without one the
// hexagons never paint (see drive-mobile-deck.cjs).

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const port = Number(arg('port', 4254))
const outDir = path.resolve(String(arg('out', 'mobile-walkthrough')))
const only = arg('only', null)
const channel = String(arg('engine', 'msedge'))
const base = `http://localhost:${port}`

/** The phone bar's two rows and their discs, in portrait left→right order. */
const ROWS = {
  nav: '.pill-stage.mobile .mobile-nav',
  tools: '.pill-stage.mobile .mobile-tools-row',
  navDiscs: ['back-btn', 'face-btn', 'camera-btn', 'add-btn', 'tools-btn'],
  toolDiscs: ['share-btn', 'mesh-mobile-btn', 'pheromone-btn', 'pin-btn', 'fullscreen-btn'],
}

/** The standalone camera's close control. The tile editor has its own
 *  `.camera-overlay` with the same controls, so scope to the surface's host. */
const CAMERA_CLOSE = 'hc-camera-capture .camera-overlay .camera-controls > .camera-control-btn:first-child'

/** The facts every step records — measured, never assumed. `rows` carries the
 *  bar's selectors (facts runs in the page, so it cannot close over them) and
 *  which way the pass holds the phone. */
function facts(rows) {
  const shown = el => {
    if (!el) return null
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return null
    const b = el.getBoundingClientRect()
    return b.width === 0 && b.height === 0 ? null : b
  }
  const round = b => (b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null)
  const box = sel => round(shown(document.querySelector(sel)))
  const centre = b => [b.left + b.width / 2, b.top + b.height / 2]
  const discs = (row, names) => names
    .map(name => {
      const el = document.querySelector(`${row} .${name}`)
      return { name, el, b: shown(el) }
    })
    .filter(d => d.b)
  const nav = discs(rows.nav, rows.navDiscs)
  const tools = discs(rows.tools, rows.toolDiscs)
  /** More than a pixel shared on both axes. A sheet seated flush on the
   *  published edge can round a fraction into it; that is not an overlap. */
  const overlaps = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
  const sheet = shown(document.querySelector('[data-role="add-sheet"]'))
  const input = document.querySelector('hc-command-shell input.command-input')
  const toast = [...document.querySelectorAll('hc-toast *')].map(e => e.textContent?.trim()).filter(Boolean)[0] ?? null
  return {
    path: decodeURIComponent(location.pathname),
    face: localStorage.getItem('hc:phone-face'),
    faceGlyph: document.querySelector(`${rows.nav} .face-btn .mat-sym`)?.textContent?.trim() ?? null,
    listTitle: box('[data-role="list-title"]'),
    listRows: document.querySelectorAll('[data-hc-layer-list] .hc-ll-row').length,
    bar: box('.pill-stage.mobile'),
    back: box(`${rows.nav} .back-btn`),
    faceBtn: box(`${rows.nav} .face-btn`),
    cameraBtn: box(`${rows.nav} .camera-btn`),
    add: box(`${rows.nav} .add-btn`),
    toolsBtn: box(`${rows.nav} .tools-btn`),
    // Reading order: by x in portrait, by y top→bottom in landscape.
    bottomOrder: [...nav]
      .sort((p, q) => (rows.landscape ? p.b.top - q.b.top : p.b.left - q.b.left))
      .map(d => d.name),
    toolsOpen: localStorage.getItem('hc:phone-tools-row') === 'open',
    toolsRow: box(rows.tools),
    // The bottom-row disc each tools disc lines up with: the same column in
    // portrait, the same slot in landscape. null = lines up with none.
    toolsOver: Object.fromEntries(tools.map(t => {
      const [x, y] = centre(t.b)
      const under = nav.find(d => (rows.landscape
        ? y >= d.b.top && y <= d.b.bottom
        : x >= d.b.left && x <= d.b.right))
      return [t.name, under ? under.name : null]
    })),
    // Can each visible disc be pressed, i.e. does the topmost element at its
    // centre belong to it? false = something is on top of it. A disabled disc
    // (Back at the hive root) takes no pointer events, so the point falls
    // through it by design — report 'disabled', never a false "covered".
    hits: Object.fromEntries([...nav, ...tools].map(d => {
      if (d.el.disabled) return [d.name, 'disabled']
      const at = document.elementFromPoint(...centre(d.b))
      return [d.name, !!at && d.el.contains(at)]
    })),
    header: box('.header-bar'),
    addSheet: round(sheet),
    sheetClearsRows: sheet
      ? [rows.nav, rows.tools]
        .map(sel => shown(document.querySelector(sel)))
        .filter(Boolean)
        .every(r => !overlaps(sheet, r))
      : null,
    deck: box('hc-layer-deck > *'),
    tilePage: box('[data-role="stage"]'),
    viewfinder: (() => {
      const video = document.querySelector('hc-camera-capture .camera-overlay video')
      return video ? [video.videoWidth, video.videoHeight] : null
    })(),
    stance: localStorage.getItem('hc:command-line-stance'),
    commandValue: input ? input.value : null,
    toast,
    bees: (() => {
      try { return window.ioc.get('@diamondcoreprocessor.com/AgentLogActionDrone')?.armed ?? null } catch { return null }
    })(),
    agentToggle: box('.agent-visibility-toggle'),
    canvasTop: (() => {
      const host = document.getElementById('pixi-host')
      return host ? Math.round(host.getBoundingClientRect().top) : null
    })(),
  }
}

async function pass(browser, orientation) {
  const portrait = orientation === 'portrait'
  const size = portrait ? { width: 375, height: 812 } : { width: 812, height: 375 }
  const dir = path.join(outDir, orientation)
  fs.mkdirSync(dir, { recursive: true })
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    recordVideo: { dir, size },
  })
  // The camera disc needs a camera. The launch args supply a fake device and
  // answer the prompt; this grant is a backup, and it is skipped if the
  // channel refuses it.
  try { await context.grantPermissions(['camera'], { origin: base }) } catch { /* the fake-ui flag still answers */ }
  await context.addInitScript(() => {
    try { localStorage.setItem('hc:mobile-mode', 'on') } catch { /* ignore */ }
    // A recording shows ONE build, start to finish. The dev server's
    // live-reload client (Vite's socket, protocol 'vite-hmr') reloads the page
    // whenever any session saves any file — a reload lands mid-step, a tap
    // fails, and a compile-error overlay can cover the frame. Hand that client
    // a socket that never connects; every other socket is left alone.
    const Native = window.WebSocket
    function Guarded(url, protocols) {
      const asked = [].concat(protocols ?? []).map(String)
      if (asked.some(p => /vite/i.test(p))) {
        const inert = new EventTarget()
        Object.assign(inert, { url: String(url), protocol: '', readyState: 0, send() {}, close() {} })
        return inert
      }
      return protocols === undefined ? new Native(url) : new Native(url, protocols)
    }
    Guarded.prototype = Native.prototype
    Object.assign(Guarded, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    window.WebSocket = Guarded
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/ERR_CONNECTION_REFUSED|Failed to load resource/.test(text)) return
    errors.push(text)
  })

  const steps = []
  let n = 0
  const settle = ms => page.waitForTimeout(ms)
  const shot = async (name, did, ok = true) => {
    n += 1
    const file = `${String(n).padStart(2, '0')}-${name}.png`
    await page.screenshot({ path: path.join(dir, file) })
    const measured = await page.evaluate(facts, { ...ROWS, landscape: !portrait })
    const row = { step: n, name, did, ok, file, facts: measured, errors: errors.splice(0) }
    steps.push(row)
    console.log(`[${orientation}] ${file} ${ok ? '' : '(ACTION FAILED) '}${JSON.stringify(row.facts)}`)
  }
  const tap = async (selector, name, did, wait = 1200) => {
    let ok = true
    try { await page.locator(selector).first().tap({ timeout: 4000 }) } catch { ok = false }
    await settle(wait)
    await shot(name, did, ok)
    return ok
  }
  const key = async (k, name, did) => {
    await page.keyboard.press(k)
    await settle(900)
    await shot(name, did)
  }
  /** Tap a hexagon by its DOM name label (tile names are real DOM text). */
  const tapHexagon = async (label, name, did) => {
    const at = await page.evaluate(text => {
      const hits = [...document.querySelectorAll('body *')].filter(e =>
        e.childElementCount === 0 && e.textContent?.trim() === text && !e.closest('[data-hc-layer-list]'))
      for (const e of hits) {
        const b = e.getBoundingClientRect()
        if (b.width > 0 && b.height > 0) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      return null
    }, label)
    let ok = !!at
    if (at) {
      try { await page.touchscreen.tap(at.x, at.y) } catch { ok = false }
    }
    await settle(1500)
    await shot(name, did, ok)
  }

  await page.goto(`${base}/`, { waitUntil: 'load' })
  await settle(7000)
  await shot('first-boot', 'fresh phone, first load')

  // Seed: the example hive, through its own card.
  await tap('hc-example-hives-offer button.add', 'example-added', 'tap "Add +" on Honey Garden', 4000)
  await tap('.back-btn', 'root-list', 'tap Back to the root')
  await tap('[data-role="list-title"] [data-action="path"]', 'path-open', 'tap the title (where am I)')
  await tap('[data-role="list-title"] [data-action="path"]', 'path-closed', 'tap the title again')
  // The bar has no More disc now. The header ⋯ opens the same layer deck.
  await tap('[data-role="list-title"] [data-action="more"]', 'more-deck', 'tap ⋯ in the list header (the layer deck)')
  await key('Escape', 'more-closed', 'Escape')
  await tap('.add-btn', 'add-sheet', 'tap Add')
  let typed = true
  try {
    await page.locator('[data-role="add-sheet"] input[data-action="name"]').fill('notebook', { timeout: 3000 })
    await page.keyboard.press('Enter')
  } catch { typed = false }
  await settle(1500)
  await shot('added-notebook', 'type "notebook" + Enter in the Add sheet', typed)
  await key('Escape', 'add-closed', 'Escape')
  // The tools row: the tools disc opens it above the bottom row (a second
  // column to its right in landscape). It stays open until pressed again,
  // even while a sheet comes and goes.
  await tap(`${ROWS.nav} .tools-btn`, 'tools-open', 'tap Tools (the tools row opens)')
  await tap(`${ROWS.nav} .add-btn`, 'tools-add-sheet', 'tap Add with the tools row open (the sheet must clear both rows)')
  await key('Escape', 'tools-add-closed', 'Escape')
  await tap(`${ROWS.nav} .tools-btn`, 'tools-closed', 'tap Tools again (the tools row closes)')
  // The camera disc: a live viewfinder from the fake device, then close it.
  await tap(`${ROWS.nav} .camera-btn`, 'camera-open', 'tap Camera', 2500)
  if (await page.locator(CAMERA_CLOSE).first().isVisible().catch(() => false)) {
    await tap(CAMERA_CLOSE, 'camera-closed', 'tap close on the viewfinder')
  } else {
    await key('Escape', 'camera-closed', 'no viewfinder close control on screen, so Escape')
  }
  await tap('[data-hc-layer-list] .hc-ll-row >> text=notebook', 'leaf-page', 'tap the "notebook" row (a leaf)', 1800)
  await tap('[data-action="exit"]', 'leaf-back', 'tap "back" on the tile page')
  await tap('[data-hc-layer-list] .hc-ll-row:has-text("notebook") .hc-ll-row-more', 'row-menu', 'tap ⋯ on the notebook row')
  await key('Escape', 'row-menu-closed', 'Escape')
  await tap(`${ROWS.nav} .face-btn`, 'hexagons', 'tap Face (list → hexagons)', 2500)
  await tapHexagon('honey-garden', 'hexagon-in', 'tap the honey-garden hexagon (a branch)')
  await tap('.back-btn', 'hexagon-back', 'tap Back', 2000)
  // Back to the list from the hexagons: the same face disc, now offering "list".
  await tap(`${ROWS.nav} .face-btn`, 'back-to-list', 'tap Face (hexagons → list)', 1500)
  // Back inside, on the list face.
  await tap('[data-hc-layer-list] .hc-ll-row:has-text("honey-garden")', 'into-garden', 'tap honey-garden', 1800)
  // "Add a tile" — the welcome card and the empty page both send this.
  await page.evaluate(() => window.__hypercombEffectBus?.emit('hive:empty:add-tile', {}))
  await settle(1200)
  await shot('add-a-tile-door', '"Add a tile" (welcome card / empty page)')
  await key('Escape', 'add-a-tile-closed', 'Escape')
  // The command line, the way the mic / a long-press reveals it.
  await page.evaluate(() => window.__hypercombEffectBus?.emit('mobile:input-visible', { visible: true, mobile: true }))
  await settle(1200)
  await shot('command-line', 'reveal the command line (mic / long-press path)')
  await key('Escape', 'command-line-closed', 'Escape')

  fs.writeFileSync(path.join(dir, 'steps.json'), JSON.stringify(steps, null, 2))
  const video = page.video()
  await context.close()
  if (video) {
    const from = await video.path()
    const to = path.join(dir, `${orientation}.webm`)
    try { fs.renameSync(from, to) } catch { /* keep the recorder's name */ }
  }
  return steps
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({
    headless: false,
    ...(channel === 'chromium' ? {} : { channel }),
    args: [
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      // A fake camera, and its permission prompt answered, so the camera
      // disc opens a viewfinder with frames in it.
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  })
  try {
    for (const orientation of ['portrait', 'landscape']) {
      if (only && only !== orientation) continue
      await pass(browser, orientation)
    }
  } finally {
    await browser.close()
  }
  console.log(`done → ${outDir}`)
}

main().catch(e => { console.error(e); process.exit(1) })
