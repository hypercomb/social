#!/usr/bin/env node
// drive-clipboard-look — the clipboard is a MODE, and it has to look like one.
//
//   node scripts/drive-clipboard-look.cjs [--url http://localhost:4250] [--out <dir>]
//
// Opening the clipboard window rewrites what a click does on the whole hive:
// a click TAKES a tile instead of walking into it, and a click on a row here
// puts one back. Nothing else in the app does that, so this drives the three
// surfaces that have to say so, in every look:
//
//   THE WINDOW  its own identity (aqua, nobody else's) and its own material —
//               an accent-tinted pane under a hex weave — deepened, not
//               swapped, under the bright themes.
//   THE ROW     hovering the swap target lights the rail, lifts the hex, and
//               NAMES the verb: `place`, or `walk in` while ctrl is held.
//   THE HIVE    a captioned rule + vignette marks the stage (the mode marker
//               that replaced the old centre-screen watermark), and the tile
//               under the pointer answers with the cut rim — `clipboard:verb`
//               take/copy, resolved once by the cue and painted by the shader.
//
// HEADED (pass --headless to opt out, and expect the canvas half to prove
// nothing): the Pixi drone needs a real GL context or the hive renders blank
// and there is no tile to hover. Real mouse moves and a real Control key
// through CDP — synthetic events never reach the Pixi EventSystem the same way.

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

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + String(detail).slice(0, 180) : ''))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    // LEAVE THE LINE. `command:composing` stands the hive's hover down while
    // the caret is in the command line — deliberately, so a pointer merely
    // crossing the hive while you are writing does not light tiles up. A
    // harness that types a name and never blurs is testing a SUPPRESSED hive:
    // every hover-driven cue reads as missing, and the key-driven ones (ctrl)
    // still work, which makes it look like a bug in the cue rather than in
    // the harness. Cost a full investigation once; never again.
    input.blur()
    return { ok: true }
  }, name)
}

/** Where a tile IS on screen — the render's own numbers, inverted. */
async function tileClientPoint(page, label, offset) {
  return page.evaluate(({ name, off: nudge }) => {
    const last = window.__hypercombEffectBus?.lastValue
    if (!last) return { ok: false, reason: 'no bus' }
    const host = last.get('render:host-ready')
    const cells = last.get('render:cell-count')
    const off = last.get('render:mesh-offset') ?? { x: 0, y: 0 }
    const flat = !!(last.get('render:set-orientation') ?? {}).flat
    if (!host?.container || !host?.canvas || !host?.renderer) return { ok: false, reason: 'no host' }
    const i = (cells?.labels ?? []).indexOf(name)
    if (i < 0) return { ok: false, reason: 'not rendered', labels: cells?.labels ?? [] }
    const { q, r } = cells.coords[i]
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/HexDetector')?.spacing
    if (!s) return { ok: false, reason: 'no detector' }
    const mx = flat ? 1.5 * s * q : Math.sqrt(3) * s * (q + r / 2)
    const my = flat ? Math.sqrt(3) * s * (r + q / 2) : s * 1.5 * r
    const pt = host.container.toGlobal({ x: mx + off.x + (nudge?.x ?? 0), y: my + off.y + (nudge?.y ?? 0) })
    const rect = host.canvas.getBoundingClientRect()
    const screen = host.renderer.screen
    return {
      ok: true, radius: s,
      x: rect.left + pt.x * (rect.width / screen.width),
      y: rect.top + pt.y * (rect.height / screen.height),
    }
  }, { name: label, off: offset ?? null })
}

async function dismissBuildOverlay(page) {
  const overlayUp = () => page.evaluate(() =>
    !!document.querySelector('vite-error-overlay')
    || /TS\d{4,5}:|NG\d{4}:/.test(document.body?.innerText?.slice(0, 4000) ?? ''))
  if (!(await overlayUp())) return
  const text = await page.evaluate(() =>
    (document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '').slice(0, 400))
  console.log('  [overlay] dev-server error overlay:', text.trim().slice(0, 300))
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await overlayUp()) throw new Error('compile-error overlay will not dismiss — fix the build first')
}

/** Everything the WINDOW is made of, read off the live document. */
const WINDOW_LOOK = () => {
  const panel = document.querySelector('hc-clipboard-panel .clipboard-panel')
  const stage = document.querySelector('hc-clipboard-panel .swap-stage')
  const legend = document.querySelector('hc-clipboard-panel .swap-stage-legend')
  if (!panel) return { ok: false, reason: 'no panel' }
  const cs = getComputedStyle(panel)
  const weave = getComputedStyle(panel, '::before')
  return {
    ok: true,
    theme: document.documentElement.getAttribute('data-theme'),
    acc: cs.getPropertyValue('--acc').replace(/\s+/g, ' ').trim(),
    background: cs.background.slice(0, 160),
    weaveMask: (weave.maskImage || weave.webkitMaskImage || 'none').slice(0, 40),
    weaveColor: weave.backgroundColor,
    stage: !!stage,
    stageAcc: stage ? getComputedStyle(stage).getPropertyValue('--acc').replace(/\s+/g, ' ').trim() : null,
    stageShadow: stage ? getComputedStyle(stage).boxShadow.slice(0, 90) : null,
    stageCut: stage ? getComputedStyle(stage, '::before').backgroundImage : null,
    legend: legend ? legend.textContent.replace(/\s+/g, ' ').trim() : null,
    legendColor: legend ? getComputedStyle(legend).color : null,
  }
}

/** What the hovered ROW is offering. */
const ROW_LOOK = () => {
  const item = document.querySelector('hc-clipboard-panel .clipboard-item')
  if (!item) return { ok: false, reason: 'no row' }
  const verb = item.querySelector('.item-verb')
  const place = item.querySelector('.verb-place')
  const walk = item.querySelector('.verb-walk')
  const vis = el => el && getComputedStyle(el).display !== 'none'
  return {
    ok: true,
    rowBg: getComputedStyle(item).backgroundColor,
    rail: getComputedStyle(item, '::before').transform,
    verbOpacity: verb ? getComputedStyle(verb).opacity : null,
    showing: [vis(place) && 'place', vis(walk) && 'walk'].filter(Boolean).join('+'),
    words: (verb?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ctrlHeld: !!document.querySelector('hc-clipboard-panel .clipboard-panel.ctrl-held'),
  }
}

async function main() {
  const url = arg('url', 'http://localhost:4250')
  const out = arg('out', path.join(__dirname, '..', '..', 'test-results', 'clipboard-look'))
  fs.mkdirSync(out, { recursive: true })

  // HEADED by default: under headless (even with SwiftShader) the Pixi drone
  // gets no usable GL context, the hive renders blank, and there is no tile to
  // hover — the canvas half of this would silently prove nothing.
  const headless = arg('headless', false) === true
  const browser = await chromium.launch({
    headless,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForFunction(() => !!window.__hypercombEffectBus?.lastValue?.get('render:host-ready'), null, { timeout: 90000 })
      await sleep(1800)
      await dismissBuildOverlay(page)
      break
    } catch (err) {
      if (attempt >= 2 || !/context was destroyed|Execution context/i.test(String(err))) throw err
      console.log('  [reload] page reloaded under us — waiting')
      await sleep(2000)
    }
  }

  await addTile(page, 'swap-probe')
  await page.waitForFunction(() =>
    (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).includes('swap-probe'),
    null, { timeout: 30000 })
  await sleep(900)

  // ── THE WINDOW ────────────────────────────────────────────────────
  await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:panel', { visible: true }))
  await page.waitForFunction(() =>
    window.__hypercombEffectBus?.lastValue?.get('clipboard:open')?.open === true, null, { timeout: 15000 })
  // A row to hover: gather the probe as a reference (a COPY-append, so the
  // page keeps its tile and the canvas checks below still have one to hover).
  await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:take-entries',
    { entries: [{ label: 'swap-probe', sourceSegments: [] }] }))
  await sleep(1400)

  let look = await page.evaluate(WINDOW_LOOK)
  check('the WINDOW is ordinary tool-window chrome (steel, no pane of its own)',
    look.acc === '126, 182, 214' || look.acc === '39, 93, 123',
    '--acc=' + look.acc + ' (theme=' + look.theme + ')')
  check('…and takes no tint and no weave of its own',
    !/linear-gradient/.test(look.background) && look.weaveMask === 'none',
    look.background + ' | weave=' + look.weaveMask)
  check('the mode marker is on the VIEWPORT', look.stage === true, JSON.stringify(look.stage))
  check('the viewport wears the clipboard aqua, not the window steel',
    look.stageAcc === '73, 214, 208' || look.stageAcc === '23, 101, 98', look.stageAcc)
  check('the marker is a CUT LINE (dashed, all four edges)',
    (look.stageCut.match(/repeating-linear-gradient/g) ?? []).length === 4,
    (look.stageCut ?? '').slice(0, 120))
  check('…over a wash of the mode colour', /inset/.test(look.stageShadow ?? ''), look.stageShadow)
  check('the marker is captioned', /clipboard/i.test(look.legend ?? ''), look.legend)
  await page.screenshot({ path: path.join(out, '01-dark-open.png') })

  // ── THE ROW ───────────────────────────────────────────────────────
  let row = await page.evaluate(ROW_LOOK)
  check('a row at rest names no verb', row.ok && row.verbOpacity === '0', JSON.stringify(row))

  const swap = page.locator('hc-clipboard-panel .clipboard-item .item-swap').first()
  await swap.hover()
  await sleep(400)
  row = await page.evaluate(ROW_LOOK)
  check('hovering the swap target names PLACE',
    row.verbOpacity === '1' && row.showing === 'place', JSON.stringify(row))
  check('…and opens the rail down the row',
    row.rail !== 'none' && !/matrix\(1, 0, 0, 0,/.test(row.rail), row.rail)
  await page.screenshot({ path: path.join(out, '02-row-place.png'), clip: { x: 1440 - 380, y: 0, width: 380, height: 440 } })

  await page.keyboard.down('Control')
  await sleep(300)
  row = await page.evaluate(ROW_LOOK)
  check('ctrl (pointer still) flips the row to WALK IN',
    row.ctrlHeld && row.showing === 'walk', JSON.stringify(row))
  await page.screenshot({ path: path.join(out, '03-row-walk.png'), clip: { x: 1440 - 380, y: 0, width: 380, height: 440 } })
  await page.keyboard.up('Control')
  await sleep(250)

  // ── THE HIVE ──────────────────────────────────────────────────────
  const hoverTile = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const point = await tileClientPoint(page, 'swap-probe', { x: 0, y: -14 })
      if (!point.ok) return { ok: false, point }
      await page.mouse.move(point.x + 40, point.y + 40, { steps: 3 })
      await sleep(120)
      await page.mouse.move(point.x, point.y, { steps: 8 })
      await sleep(420)
      const hover = await page.evaluate(() =>
        window.__hypercombEffectBus?.lastValue?.get('tile:hover')?.label ?? null)
      if (hover === 'swap-probe') return { ok: true, point }
      await sleep(500)
    }
    return { ok: false }
  }
  const verbNow = () => page.evaluate(() =>
    window.__hypercombEffectBus?.lastValue?.get('clipboard:verb')?.verb ?? null)

  const at = await hoverTile()
  check('the probe tile is under the pointer', at.ok, JSON.stringify(at.point ?? at))
  if (at.ok) {
    const r = Math.round(at.point.radius * 3.2)
    // Re-derive the point for every shot: closing the panel re-runs the global
    // fit and SLIDES the mesh, so a crop cached from before the close frames
    // empty felt — which is how the "after" comparison silently stops showing
    // the tile it is meant to compare.
    const crop = async (name) => {
      const p = await tileClientPoint(page, 'swap-probe', { x: 0, y: -14 })
      const c = p.ok ? p : at.point
      await page.screenshot({
        path: path.join(out, name),
        clip: {
          x: Math.max(0, Math.round(c.x - r)), y: Math.max(0, Math.round(c.y - r)),
          width: r * 2, height: r * 2,
        },
      })
    }

    check('a bare hover in swap mode says TAKE', (await verbNow()) === 'take', await verbNow())
    await crop('04-tile-take.png')

    await page.keyboard.down('Control')
    await sleep(400)
    check('ctrl (pointer still) says COPY', (await verbNow()) === 'copy', await verbNow())
    await crop('05-tile-copy.png')
    await page.keyboard.up('Control')
    await sleep(350)
    check('release goes back to TAKE', (await verbNow()) === 'take', await verbNow())

    await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:panel', { visible: false }))
    await sleep(800)
    await hoverTile()
    const cleared = (await verbNow()) === null
    const markerGone = !(await page.evaluate(() => !!document.querySelector('hc-clipboard-panel .swap-stage')))
    check('closing the window clears the verb AND the mode marker',
      cleared && markerGone, 'verb=' + (await verbNow()) + ' markerGone=' + markerGone)
    await crop('06-tile-normal.png')
  }

  // ── EVERY LOOK ────────────────────────────────────────────────────
  // The identity is the HUE; the lightness is the theme's business. Under a
  // bright pane the same aqua has to come down or the window is unreadable.
  await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:panel', { visible: true }))
  await sleep(600)
  const setTheme = (t) => page.evaluate((name) => {
    const svc = window.ioc?.get?.('@hypercomb.social/Theme')
    if (svc?.setTheme) svc.setTheme(name)
    else document.documentElement.setAttribute('data-theme', name)
  }, t)
  const PASTEL = '73, 214, 208'
  const DEEP = '23, 101, 98'
  for (const [theme, want] of [['dark', PASTEL], ['honey', DEEP], ['light', DEEP], ['sherbet', DEEP], ['bloom', DEEP]]) {
    await setTheme(theme)
    await sleep(800)
    look = await page.evaluate(WINDOW_LOOK)
    check(theme + (want === DEEP ? ': the marker DEEPENS for a bright canvas' : ': the authored aqua passes through'),
      look.stageAcc === want, '--acc=' + look.stageAcc + ' (theme=' + look.theme + ')')
    await page.screenshot({ path: path.join(out, '07-' + theme + '.png'), clip: { x: 1440 - 440, y: 0, width: 440, height: 600 } })
  }

  await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log('\nshots → ' + out)
  console.log(failed.length ? failed.length + ' FAILED' : 'all green')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
