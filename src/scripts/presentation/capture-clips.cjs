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
const VP = { width: 1440, height: 492 }

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
    const pt = host.container.toGlobal({ x: mx + off.x + (n?.x ?? 0), y: my + off.y + (n?.y ?? 0) })
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
  const sel = await commandInput(page)
  await page.click(sel)
  await sleep(300)
  await page.type(sel, text, { delay: perKey })
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(settle)
}

async function clickIntoTile(page, label) {
  // first click stays put (select), the second walks in — the click grammar
  const at = await tileClientPoint(page, label, { x: 0, y: -14 })
  if (!at.ok) { log('clickIntoTile MISS', label, at.reason); return at }
  await page.mouse.move(at.x, at.y, { steps: 24 })
  await sleep(450)
  await page.mouse.down(); await sleep(70); await page.mouse.up()
  await sleep(900)
  await page.mouse.down(); await sleep(70); await page.mouse.up()
  await sleep(2400)
  log('at', await page.evaluate(() => location.pathname))
  return at
}

async function rightClickBack(page) {
  await page.mouse.move(VP.width / 2, VP.height / 2, { steps: 10 })
  await sleep(300)
  await page.mouse.click(VP.width / 2, VP.height / 2, { button: 'right' })
  await sleep(2200)
}

async function boot(browser, videoDir) {
  const ctx = await browser.newContext({
    viewport: VP,
    ...(videoDir ? { recordVideo: { dir: videoDir, size: VP } } : {}),
  })
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
  await sleep(2500)
  // never film the example-hives offer mid-frame
  await page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    bus?.emit?.('examples:dismiss', {})
  }).catch(() => {})
  await sleep(800)
  return { ctx, page, t0 }
}

/* ── the four choreographies ──────────────────────────────────────────────
   Each returns a list of {name, from, to} wall-clock marks (ms since the
   context opened) to cut from the session video. */

const CLIPS = {
  // your first tile: type a name, press Enter, a tile exists — then walk in
  async create(page, mark) {
    mark.begin('hive-create')
    await typeName(page, 'journal')
    await sleep(600)
    const at = await tileClientPoint(page, 'journal')
    if (at.ok) { await page.mouse.move(at.x, at.y - 14, { steps: 30 }); await sleep(1200) }
    mark.end()
  },

  // creating structure: inside a tile, names become children, one by one
  async children(page, mark) {
    await typeName(page, 'journal', { settle: 2000 })
    await clickIntoTile(page, 'journal')
    mark.begin('hive-children')
    await typeName(page, 'sketches', { settle: 1700 })
    await typeName(page, 'recordings', { settle: 1700 })
    await typeName(page, 'plans', { settle: 1700 })
    await typeName(page, 'postcards', { settle: 2200 })
    mark.end()
  },

  // the hive: go in, go deeper, and right-click comes back out
  async navigate(page, mark) {
    await typeName(page, 'journal', { settle: 1600 })
    await typeName(page, 'archive', { settle: 1600 })
    await typeName(page, 'garden', { settle: 1600 })
    await clickIntoTile(page, 'journal')
    await typeName(page, 'sketches', { settle: 1400 })
    await typeName(page, 'recordings', { settle: 1400 })
    await rightClickBack(page)
    mark.begin('hive-navigate')
    await clickIntoTile(page, 'journal')
    await clickIntoTile(page, 'sketches')
    await rightClickBack(page)
    await rightClickBack(page)
    await clickIntoTile(page, 'garden')
    await rightClickBack(page)
    mark.end()
  },

  // one hive, many worlds: wheel out until the world is small, then dive back
  async zoom(page, mark) {
    await typeName(page, 'journal', { settle: 1500 })
    await typeName(page, 'archive', { settle: 1500 })
    await typeName(page, 'garden', { settle: 1500 })
    await typeName(page, 'postcards', { settle: 1500 })
    await clickIntoTile(page, 'journal')
    await typeName(page, 'sketches', { settle: 1300 })
    await typeName(page, 'recordings', { settle: 1500 })
    mark.begin('hive-zoom')
    await page.mouse.move(VP.width / 2, VP.height / 2)
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 240); await sleep(260) }
    await sleep(1400)
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -240); await sleep(260) }
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
    '-vf', 'scale=960:328',
    '-an', '-c:v', 'libx264', '-crf', '24', '-preset', 'slow',
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
