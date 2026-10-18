// capture-clips — re-record the deck's live-capture clips against the CURRENT interface.
//
//   node capture-clips.cjs --probe          # boot a fresh hive, save stills, touch nothing
//   node capture-clips.cjs                  # record all four clips into capture-out/
//   node capture-clips.cjs create zoom      # just those
//   node capture-clips.cjs --url http://localhost:4250/
//
// Each clip is choreographed on a REAL browser (headed, GPU — headless stalls
// Pixi's rAF) with real mouse and keyboard, in a fresh Playwright context: its
// own OPFS, its own identity, nobody's data touched. Playwright records the
// whole session; segments are cut by wall-clock marks and cropped to the
// deck's 960x328 letterbox with ffmpeg.
//
// Output goes to capture-out/ for review — NOTHING overwrites media/*.mp4
// until a human (or the caller) copies it there deliberately.
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const OUT = path.join(ROOT, 'capture-out')
// the viewport IS the deck letterbox (2.93:1) — the app's own global fit lays
// the hive into it, so no crop is ever needed, and the command line stays in frame
const VP = { width: 960, height: 328 }
// recorded at twice the pixel density: the deck shows these up to ~1420 px wide,
// and a 960 px cut upscaled there left names a few pixels tall. Playwright's
// recorder delivers at most 1440 px wide frames (a larger canvas is padded grey),
// which is native for the deck's largest frame — so 1440x492, no padding, no upscale.
const DPR = 2
const OUT_W = 1440, OUT_H = 492

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback
}
const URL_ = arg('url', 'http://localhost:4250/')
const PROBE = process.argv.includes('--probe')
const WANTED = process.argv.slice(2).filter(a => !a.startsWith('--') && !/^https?:/.test(a))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[capture]', ...a)

async function waitForShell(page, timeoutMs = 60000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@hypercomb.social/Lineage') &&
      window.ioc?.get?.('@hypercomb.social/Navigation')
    )).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

async function waitForRender(page, timeoutMs = 45000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() =>
      !!window.__hypercombEffectBus?.lastValue?.get('render:host-ready')).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

/** Screen point of a rendered tile, from the render's own numbers. */
async function tileClientPoint(page, label, nudge) {
  return page.evaluate(({ name, off: n }) => {
    const last = window.__hypercombEffectBus?.lastValue
    if (!last) return { ok: false, reason: 'no bus' }
    const host = last.get('render:host-ready')
    const cells = last.get('render:cell-count')
    const off = last.get('render:mesh-offset') ?? { x: 0, y: 0 }
    const flat = !!(last.get('render:set-orientation') ?? {}).flat
    if (!host?.container || !host?.canvas || !host?.renderer) return { ok: false, reason: 'no host' }
    // rendered labels are slugs — fold the asked-for name the same way
    const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const i = (cells?.labels ?? []).findIndex(l =>
      String(l).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug)
    if (i < 0) return { ok: false, reason: 'not rendered', labels: cells?.labels ?? [] }
    const { q, r } = cells.coords[i]
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/HexDetector')?.spacing
    if (!s) return { ok: false, reason: 'no detector' }
    const mx = flat ? 1.5 * s * q : Math.sqrt(3) * s * (q + r / 2)
    const my = flat ? Math.sqrt(3) * s * (r + q / 2) : s * 1.5 * r
    // nudge in fractions of the hex spacing, so it scales with the tile
    const pt = host.container.toGlobal({ x: mx + off.x + (n?.fx ?? 0) * s, y: my + off.y + (n?.fy ?? 0) * s })
    const rect = host.canvas.getBoundingClientRect()
    const screen = host.renderer.screen
    return { ok: true, x: rect.left + pt.x * (rect.width / screen.width), y: rect.top + pt.y * (rect.height / screen.height) }
  }, { name: label, off: nudge ?? null })
}

async function commandInput(page) {
  const sel = 'hc-command-line input, input.command-input, input[type="text"]'
  await page.waitForSelector(sel, { timeout: 30000 })
  return sel
}

/** Type into the real command line with the real keyboard — the typing IS the shot. */
async function typeName(page, text, { perKey = 85, settle = 2400 } = {}) {
  const sel = 'input.command-input'
  if (await page.locator(sel).first().isVisible().catch(() => false)) { await page.click(sel); await sleep(300) }
  await page.keyboard.type(text, { delay: perKey })
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(settle)
}

async function clickIntoTile(page, label, { hold = 160 } = {}) {
  // press the LOWER tile body (the hover icon block owns the centre) and HOLD:
  // a branch enters on pointerdown, a childless tile enters at the 450ms hold —
  // one gesture walks into either
  const at = await tileClientPoint(page, label, { fy: 0.55 })
  if (!at.ok) { log('clickIntoTile MISS', label, at.reason); return at }
  // arrive and press at once: a lingering cursor raises the tile's action
  // menu and tooltip over the footage
  await page.mouse.move(at.x, at.y, { steps: 18 })
  await sleep(90)
  // a branch enters on pointerdown: a short press keeps the tile's menu off screen
  await page.mouse.down(); await sleep(hold); await page.mouse.up()
  await parkCursor(page)
  await sleep(2400)
  log('at', await segmentsOf(page))
  return at
}

/** The right margin: no tile under the cursor, so no hover overlay. */
async function parkCursor(page) {
  await page.mouse.move(VP.width * 0.97, VP.height * 0.55, { steps: 8 })
}

async function segmentsOf(page) {
  return page.evaluate(() =>
    [...(window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])].join('/') || '(root)')
}

async function rightClickBack(page) {
  const before = await segmentsOf(page)
  for (let tries = 0; tries < 3; tries++) {
    await page.mouse.move(VP.width / 2, VP.height / 2, { steps: 10 })
    await sleep(300)
    await page.mouse.click(VP.width / 2, VP.height / 2, { button: 'right' })
    await parkCursor(page)
    await sleep(2200)
    if (await segmentsOf(page) !== before) return
  }
  log('rightClickBack stuck at', before)
}

async function boot(browser, videoDir) {
  const ctx = await browser.newContext({
    viewport: VP,
    deviceScaleFactor: DPR,
    colorScheme: 'dark',
    ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: OUT_W, height: OUT_H } } } : {}),
  })
  // the deck is dark: film the app in its dark theme whatever the OS says
  await ctx.addInitScript(() => { try { localStorage.setItem('hc:theme', 'dark') } catch {} })
  // the recording has no OS cursor — draw one, so clicks read as clicks
  await ctx.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div')
      c.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;' +
        'border:2px solid rgba(255,255,255,.9);border-radius:50%;pointer-events:none;left:-40px;top:-40px;' +
        'box-shadow:0 0 6px rgba(0,0,0,.6);transition:transform .12s ease'
      document.body.appendChild(c)
      addEventListener('pointermove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
      addEventListener('pointerdown', () => { c.style.transform = 'scale(0.55)'; c.style.background = 'rgba(255,255,255,.5)' }, true)
      addEventListener('pointerup', () => { c.style.transform = ''; c.style.background = 'transparent' }, true)
    })
  })
  const page = await ctx.newPage()
  const t0 = Date.now() // the session video starts with the page — marks are relative to THIS
  page.on('pageerror', e => log('PAGE ERROR:', String(e).slice(0, 160)))
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  if (!await waitForShell(page)) throw new Error('shell never became ready')
  if (!await waitForRender(page)) throw new Error('renderer never became ready')
  // the activity log lists every tile the setup added — not part of the shot
  await page.addStyleTag({ content: 'hc-activity-log,hc-upgrade-indicator{display:none!important}' }).catch(() => {})
  // a fresh hive greets with the example-hives offer; it is answered by the
  // clip (opening()), and nothing is filmed until it has gone
  await page.waitForSelector('hc-example-hives-offer button', { timeout: 45000 }).catch(() => log('no welcome offer'))
  await sleep(900)
  await page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    // disarm the empty-layer beehaviors offer: telling the prompt drone the
    // panel is already open means it never raises one over the footage
    bus?.emit?.('features:viewer-state', { open: true })
  }).catch(() => {})
  await sleep(800)
  return { ctx, page, t0 }
}

/** Answer the welcome offer: take an example hive by name (real pictures,
 *  real depth), or "Add a tile", which also opens the command line. */
async function opening(page, example) {
  const offer = page.locator('hc-example-hives-offer')
  if (example) {
    const card = offer.locator('article, .card, li, div').filter({ hasText: example }).filter({ has: page.locator('button', { hasText: 'Add' }) }).last()
    await card.locator('button', { hasText: 'Add' }).first().click()
    const until = Date.now() + 30000
    while (Date.now() < until) {
      const n = await page.evaluate(() => (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length).catch(() => 0)
      if (n > 0) break
      await sleep(400)
    }
    await page.evaluate(() => window.__hypercombEffectBus?.emit?.('examples:dismiss', {})).catch(() => {})
    await sleep(2500)
  } else {
    await offer.locator('button', { hasText: 'Add a tile' }).first().click()
    await sleep(1200)
  }
  await parkCursor(page)
}

async function labelsOf(page) {
  return page.evaluate(() => [...(window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? [])])
}

/* ── the four choreographies ──────────────────────────────────────────────
   Each returns a list of {name, from, to} wall-clock marks (ms since the
   context opened) to cut from the session video. */

const CLIPS = {
  // your first tile: type a name, press Enter, a tile exists — then walk in
  async create(page, mark) {
    await opening(page)
    mark.begin('hive-create')
    await typeName(page, 'journal')
    await sleep(600)
    const at = await tileClientPoint(page, 'journal', { fy: 0.42 })
    if (at.ok) { await page.mouse.move(at.x, at.y, { steps: 30 }); await sleep(1200) }
    mark.end()
  },

  // creating structure: inside a tile, names become children, one by one
  async children(page, mark) {
    await opening(page)
    await typeName(page, 'journal', { settle: 2000 })
    // a tile with no children yet enters on a held press
    await clickIntoTile(page, 'journal', { hold: 600 })
    mark.begin('hive-children')
    await typeName(page, 'sketches', { settle: 1700 })
    await typeName(page, 'recordings', { settle: 1700 })
    await typeName(page, 'plans', { settle: 1700 })
    await typeName(page, 'postcards', { settle: 2200 })
    mark.end()
  },

  // the hive: go in, go deeper, and right-click comes back out —
  // every room entered on film already has something in it
  async navigate(page, mark) {
    // the Postcards example: places with postcards inside — real pictures, real depth
    await opening(page, 'Postcards')
    await clickIntoTile(page, 'postcards')
    await sleep(1200)
    const places = await labelsOf(page)
    log('places', JSON.stringify(places))
    mark.begin('hive-navigate')
    await sleep(900)
    await clickIntoTile(page, places[0])
    await sleep(600)
    await rightClickBack(page)
    await sleep(500)
    await clickIntoTile(page, places[Math.min(1, places.length - 1)])
    await sleep(600)
    await rightClickBack(page)
    await sleep(900)
    mark.end()
  },

  // one hive, many worlds: wheel out until the world is small, then dive back
  async zoom(page, mark) {
    await opening(page, 'Honey Garden')
    // the example arrives as one tile: film the garden inside it
    await clickIntoTile(page, 'honey-garden')
    await sleep(1500)
    await parkCursor(page)
    await sleep(700)
    mark.begin('hive-zoom')
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 220); await sleep(300) }
    await sleep(1500)
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -220); await sleep(300) }
    await sleep(1200)
    mark.end()
  },
}

/* ── cutting ─────────────────────────────────────────────────────────── */

function cut(webm, seg) {
  const out = path.join(OUT, seg.name + '.mp4')
  const from = Math.max(0, (seg.from - 400) / 1000)
  const dur = (seg.to - seg.from + 800) / 1000
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-ss', from.toFixed(2), '-t', dur.toFixed(2), '-i', webm,
    '-vf', `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
    '-an', '-c:v', 'libx264', '-crf', '21', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out])
  const kb = Math.round(fs.statSync(out).size / 1024)
  log('cut', seg.name + '.mp4', `${dur.toFixed(1)}s ${kb}KB`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ headless: false, args: ['--window-position=40,40'] })

  if (PROBE) {
    const { ctx, page } = await boot(browser, null)
    await page.screenshot({ path: path.join(OUT, 'probe-boot.png') })
    await typeName(page, 'journal')
    await page.screenshot({ path: path.join(OUT, 'probe-tile.png') })
    await clickIntoTile(page, 'journal')
    await page.screenshot({ path: path.join(OUT, 'probe-inside.png') })
    const state = await page.evaluate(() => ({
      labels: window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? null,
      path: location.pathname,
    }))
    log('probe state', JSON.stringify(state))
    await ctx.close(); await browser.close()
    return
  }

  const names = WANTED.length ? WANTED : ['create', 'children', 'navigate', 'zoom']
  for (const name of names) {
    if (!CLIPS[name]) { log('unknown clip:', name); continue }
    log('recording', name, '…')
    const vidDir = path.join(OUT, '.video-' + name)
    fs.rmSync(vidDir, { recursive: true, force: true })
    const { ctx, page, t0 } = await boot(browser, vidDir)
    const segs = []
    let open = null
    const mark = {
      begin: n => { open = { name: n, from: Date.now() - t0 } },
      end: () => { open.to = Date.now() - t0; segs.push(open); open = null },
    }
    try {
      await CLIPS[name](page, mark)
    } finally {
      await ctx.close() // flushes the video file
    }
    const webm = fs.readdirSync(vidDir).find(f => f.endsWith('.webm'))
    if (!webm) { log('NO VIDEO for', name); continue }
    for (const seg of segs) cut(path.join(vidDir, webm), seg)
  }
  await browser.close()
  log('done — review capture-out/*.mp4, then copy over media/ and rebuild')
}

main().catch(e => { console.error('capture failed:', e); process.exit(1) })
