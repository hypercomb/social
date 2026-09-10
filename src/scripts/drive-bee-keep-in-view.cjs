// scripts/drive-bee-keep-in-view.cjs
//
// Proof for THE VIEWPORT IS THE ROOM: an agent bee can never fly off screen,
// and it can never fly up under the header bar (Jaime, 2026-09-09: they
// "should never be able to fly off screen — currently they're going underneath
// the header and you can't see them").
//
// It drives the real drone — no stubs. Agents are raised through the same
// `agent:start` lane any behaviour uses, the header band is declared the way
// the shell declares it (`--hc-header-bottom`, the controls bar's measured
// ResizeObserver value), and what is asserted is the PIXI SCENE: the GLOBAL
// position of every bee sprite bright enough to be seen.
//
// Two states are proven, because they fail differently:
//   1. AT REST — a bee's dance centre must stay inside the band.
//   2. DEPARTING — a finished bee drifts upward "and out" (26 px/s). That
//      drift is what used to carry it under the bar; clamped, it fades where
//      it can still be seen.
//
// THE PROOF IS THE SCENE GRAPH, NOT THE PICTURE. Headless Chromium has no GPU
// to compile Pixi's shaders with, so the screenshots are for orientation only.
//
//   node scripts/drive-bee-keep-in-view.cjs [--headed] [--port 4250] [--out bee-room.png]
//
// Runs in its own Playwright profile — a fresh, empty hive of its own. It
// never touches the participant's OPFS.

const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORT = String(arg('port', '4250'))
const URL = `http://localhost:${PORT}/`
const OUT = String(arg('out', 'bee-room.png'))
const HEADED = process.argv.includes('--headed')
/** A deliberately TALL header, so "under the bar" is unambiguous in the
 *  numbers rather than a matter of a few pixels. */
const HEADER_PX = 420

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const suffix = (tag) => OUT.replace(/(\.png)?$/i, `-${tag}.png`)

const failures = []

async function waitForReady(page, timeoutMs = 120000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/AgentRegistry')
      && window.__hypercombEffectBus
    )).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

/** Take the Pixi handles off the bus — `render:host-ready` is last-value
 *  replayed, so a late subscriber gets them immediately. */
async function grabStage(page, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => new Promise(resolve => {
      if (window.__proof && window.__proof.world) return resolve(true)
      let done = false
      try {
        window.__hypercombEffectBus.on('render:host-ready', p => {
          if (done || !p || !p.container) return
          done = true
          window.__proof = { app: p.app, world: p.container, canvas: p.canvas }
          resolve(true)
        })
      } catch { return resolve(false) }
      setTimeout(() => resolve(done), 1500)
    })).catch(() => false)
    if (ok) return true
    await sleep(500)
  }
  return false
}

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

/** Drive the renderer forward by hand — a headless page composites only when
 *  Chromium feels like it, and the drone's per-frame work hangs off the Pixi
 *  ticker. Nothing is stubbed; the clock is turned by the driver. */
const pump = (page, frames = 120) => page.evaluate((n) => {
  const app = window.__proof && window.__proof.app
  if (!app) return { pumped: 0 }
  let t = performance.now()
  let pumped = 0
  for (let i = 0; i < n; i++) {
    t += 16.7
    // The renderer runs at LOW priority, so a headless GL that cannot compile
    // Pixi's shaders throws AFTER the drone's logic has already run for the
    // frame. Swallow it: the numbers read here are the drone's.
    try { app.ticker.update(t); pumped++ } catch { /* no GPU — only the picture is lost */ }
  }
  return { pumped }
}, frames)

/** THE HEADER, DECLARED THE WAY THE SHELL DECLARES IT. The controls bar
 *  publishes its measured bottom edge here; re-asserted before every read in
 *  case that ResizeObserver has fired in between. */
const setHeader = (page, px) => page.evaluate((h) => {
  document.documentElement.style.setProperty('--hc-header-bottom', `${h}px`)
}, px)

/** Every bee sprite on the agent layer, in SCREEN coordinates. */
function readBees(page) {
  return page.evaluate(() => {
    const world = window.__proof && window.__proof.world
    const app = window.__proof && window.__proof.app
    if (!world || !app) return { error: 'no world container' }
    const layers = world.children.filter(c => c.zIndex === 11 && Array.isArray(c.children))
    const sprites = []
    for (const layer of layers) {
      for (const child of layer.children) {
        // A bee is a Sprite. Pixi 8 puts a `texture` on Graphics too, so the
        // waggle trace under the bees is told apart by its lack of an anchor.
        if (child.texture === undefined || child.anchor === undefined) continue
        if (child.alpha <= 0.25) continue
        const p = child.getGlobalPosition()
        sprites.push({ x: Math.round(p.x), y: Math.round(p.y), alpha: Number(child.alpha.toFixed(2)) })
      }
    }
    const screen = app.renderer.screen
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--hc-header-bottom')
    const canvasTop = (window.__proof.canvas?.getBoundingClientRect?.().top) ?? 0
    return {
      bees: sprites,
      headerBottom: Number.parseFloat(raw) || 0,
      canvasTop,
      screen: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
    }
  })
}

/** Re-declare the header, let the drone MEASURE it (it re-reads on its own
 *  400ms cadence, never per frame), then judge against the value that is
 *  actually live — the shell's own ResizeObserver rewrites the variable on
 *  every resize, so a claim made after the pump would be judging the drone
 *  against a number it never saw. */
async function check(page, label) {
  await setHeader(page, HEADER_PX)
  await sleep(700)
  await pump(page, 120)
  const state = await readBees(page)
  if (state.error) throw new Error(state.error)
  const { bees, headerBottom, canvasTop, screen } = state
  const top = Math.max(0, headerBottom - canvasTop)
  if (!bees.length) {
    failures.push(`${label}: no bees on the layer to judge`)
    log(`FAIL ${label} — no bees visible`)
    return
  }
  const outside = bees.filter(b =>
    b.y < top || b.y > screen.y + screen.height || b.x < screen.x || b.x > screen.x + screen.width)
  const lowest = Math.min(...bees.map(b => b.y))
  const ok = outside.length === 0
  if (!ok) failures.push(`${label}: ${outside.length} bee(s) out of the room — ${JSON.stringify(outside)}`)
  log(`${ok ? 'OK  ' : 'FAIL'} ${label} — ${bees.length} bees, highest y=${lowest}, band starts ${top}, screen ${screen.width}×${screen.height}`)
}

async function main() {
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', e => log('page error:', e.message))

  log(`opening ${URL}`)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 })
  if (!await waitForReady(page)) throw new Error('runtime never became ready')
  if (!await grabStage(page)) throw new Error('never got the pixi host off the bus')
  log('runtime ready, pixi host captured')
  await setHeader(page, HEADER_PX)
  await sleep(2500)

  const ids = ['proof-bee-a', 'proof-bee-b', 'proof-bee-c']
  for (const id of ids) {
    await emit(page, 'agent:start', {
      id, behavior: 'opus', kind: 'model',
      request: `proof: ${id} at work`, targets: [], segments: [],
    })
  }
  await sleep(900)

  // 1. AT REST — the dance sits inside the band, below the bar.
  await check(page, 'at rest, tall header')
  await page.screenshot({ path: suffix('1-at-rest') })

  // 2. DEPARTING — a finished bee drifts up 26 px/s. Fifteen seconds of drift
  //    is ~390px: without the clamp that is straight up under a 420px bar and
  //    then off the top of the screen.
  for (const id of ids) await emit(page, 'agent:progress', { id, status: 'done' })
  await sleep(400)
  await pump(page, 900)   // fifteen seconds of drift, in one breath
  await check(page, 'after 15s of departure drift')
  await page.screenshot({ path: suffix('2-departing') })

  // 3. A NARROW ROOM — the band is shorter than the sprite is tall. The clamp
  //    must park the bee in the middle of what there is, never off the edge.
  await page.setViewportSize({ width: 900, height: 520 })
  await sleep(500)
  await check(page, 'viewport shorter than the header claim')

  await browser.close()

  if (failures.length) {
    log(`FAILED (${failures.length}):`)
    for (const f of failures) log('  •', f)
    process.exit(1)
  }
  log('ALL CHECKS PASSED — every bee stayed in the room')
}

main().catch(e => { log('ERROR', e && e.stack || e); process.exit(1) })
