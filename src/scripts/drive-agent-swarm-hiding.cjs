// scripts/drive-agent-swarm-hiding.cjs
//
// Proof for AGENTS OUT OF SIGHT IN A SWARM: the bees working for you LOCALLY
// stand down for as long as you are in a swarm, and an agent that belongs to
// the swarm (`origin:'swarm'`) keeps flying.
//
// It drives the real drone — no stubs. Agents are raised through the generic
// `agent:start` lane the way any behaviour raises one, the swarm is entered by
// the same `mesh:public-changed` broadcast the mesh header sends, and what is
// counted is the PIXI SCENE: sprites on the agent layer with enough alpha to
// be seen (the drone fades a grounded bee out where it stands).
//
// THE PROOF IS THE SCENE GRAPH, NOT THE PICTURE. Headless Chromium has no GPU
// to compile Pixi's shaders with, and a fresh profile opens on the first-boot
// offer anyway, so the screenshots it writes are for orientation only.
//
//   node scripts/drive-agent-swarm-hiding.cjs [--headed] [--port 4251] [--out agents-swarm.png]
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

const PORT = String(arg('port', '4251'))
const URL = `http://localhost:${PORT}/`
const OUT = String(arg('out', 'agents-swarm.png'))
const HEADED = process.argv.includes('--headed')

const LOCAL_ID = 'proof-local-agent'
const SWARM_ID = 'proof-swarm-agent'

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const suffix = (tag) => OUT.replace(/(\.png)?$/i, `-${tag}.png`)

const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  log(`${ok ? 'OK  ' : 'FAIL'} ${label} — bees shown: ${actual} (expected ${expected})`)
  if (!ok) failures.push(`${label}: shown ${actual}, expected ${expected}`)
}

function checkPanel(label, actual, expected) {
  const ok = actual === expected
  log(`${ok ? 'OK  ' : 'FAIL'} ${label} — panel open: ${actual} (expected ${expected})`)
  if (!ok) failures.push(`${label}: panel ${actual}, expected ${expected}`)
}

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
          window.__proof = { app: p.app, world: p.container, layerIndex: -1 }
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

/** Drive the renderer forward by hand.
 *
 *  A headless page composites only when Chromium feels like it, so
 *  requestAnimationFrame — and with it the Pixi ticker the drone's per-frame
 *  work hangs off — stalls between screenshots. Pumping the ticker runs the
 *  REAL `#onTick` with real frame deltas; nothing about the drone is stubbed,
 *  the clock is just turned by the driver instead of by the compositor. */
const pump = (page, frames = 90) => page.evaluate((n) => {
  const app = window.__proof && window.__proof.app
  if (!app) return { pumped: 0 }
  let t = performance.now()
  let pumped = 0
  let lastError = ''
  for (let i = 0; i < n; i++) {
    t += 16.7
    // The drone's per-frame work runs at NORMAL priority, the renderer's at
    // LOW — so a headless GL that cannot compile Pixi's shaders throws AFTER
    // the frame's logic has already run. Swallow it: the numbers this driver
    // reads are the drone's, and only the picture is lost.
    try { app.ticker.update(t); pumped++ } catch (e) { lastError = String(e && e.message) }
  }
  return { pumped, lastError }
}, frames)

/** Sprite counts per candidate agent layer (zIndex 11 under the world). The
 *  layer is PINNED the first time one of them grows a sprite, so a second
 *  layer that happens to share the z never confuses the count. */
function readLayers(page) {
  return page.evaluate(() => {
    const world = window.__proof && window.__proof.world
    if (!world) return { error: 'no world container' }
    const candidates = world.children.filter(c => c.zIndex === 11 && Array.isArray(c.children))
    const shape = candidates.map(layer => {
      // A bee is a Sprite. Pixi 8 puts a `texture` on Graphics too, so the
      // waggle trace under the bees is told apart by its lack of an anchor.
      const sprites = layer.children.filter(c => c.texture !== undefined && c.anchor !== undefined)
      return {
        visible: layer.visible,
        total: sprites.length,
        shown: sprites.filter(s => s.alpha > 0.25).length,
        alphas: sprites.map(s => Number(s.alpha.toFixed(2))),
      }
    })
    if (window.__proof.layerIndex < 0) {
      const grown = shape.findIndex(s => s.total > 0)
      if (grown >= 0) window.__proof.layerIndex = grown
    }
    const pinned = window.__proof.layerIndex
    return { candidates: shape.length, pinned, layer: pinned >= 0 ? shape[pinned] : null }
  })
}

async function shown(page) {
  const state = await readLayers(page)
  if (state.error) throw new Error(state.error)
  log(`     layers=${state.candidates} pinned=${state.pinned} ${JSON.stringify(state.layer)}`)
  return state.layer ? state.layer.shown : 0
}

const panelOpen = (page) => page.evaluate(() => !!document.querySelector('.hc-agent'))

/** How many bees SHOULD be flying: every agent when you are on your own, and
 *  only the swarm's own agents once you are in a swarm. Read from the
 *  registry rather than hand-counted — the hive raises agents of its own (the
 *  orchestrator), and they are local like everything else. */
const expected = (page, inSwarm) => page.evaluate((swarm) => {
  const agents = window.ioc.get('@diamondcoreprocessor.com/AgentRegistry').list() || []
  return swarm ? agents.filter(a => (a.origin || 'local') !== 'local').length : agents.length
}, inSwarm)

async function main() {
  // Headless Chromium has no GPU: without a software GL that can compile
  // Pixi's shaders, the first real render throws inside the graphics pipe.
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
  await sleep(2500)

  // 1. a LOCAL agent — the default, and everything the hive raises today
  await emit(page, 'agent:start', {
    id: LOCAL_ID, behavior: 'opus', kind: 'model',
    request: 'proof: local work in flight', targets: [], segments: [],
  })
  await sleep(600)
  await pump(page)
  check('local agent, no swarm', await shown(page), await expected(page, false))
  await page.screenshot({ path: suffix('1-local-solo') })

  // 2. join a swarm — the local bee goes out of sight
  await emit(page, 'mesh:public-changed', { public: true })
  await sleep(600)
  await pump(page)
  check('local agent, IN A SWARM', await shown(page), await expected(page, true))
  await page.screenshot({ path: suffix('2-local-in-swarm') })

  // 3. leave — it comes back, over the same tiles
  await emit(page, 'mesh:public-changed', { public: false })
  await sleep(600)
  await pump(page)
  check('local agent, left the swarm', await shown(page), await expected(page, false))
  await page.screenshot({ path: suffix('3-local-back') })

  // 4. an agent that BELONGS to the swarm, alongside it
  await emit(page, 'agent:start', {
    id: SWARM_ID, behavior: 'scout', kind: 'script', origin: 'swarm',
    request: 'proof: work that belongs to the swarm', targets: [], segments: [],
  })
  await sleep(600)
  await pump(page)
  check('both agents, no swarm', await shown(page), await expected(page, false))
  await page.screenshot({ path: suffix('4-both-solo') })

  // 5. in a swarm exactly one is left
  await emit(page, 'mesh:public-changed', { public: true })
  await sleep(600)
  await pump(page)
  check('both agents, IN A SWARM', await shown(page), await expected(page, true))
  await page.screenshot({ path: suffix('5-both-in-swarm') })

  // 6. and it is the swarm's: end it and the sky empties
  await emit(page, 'agent:end', { id: SWARM_ID, ok: true, summary: 'proof done' })
  await sleep(7000)   // LINGER_MS is 6s of REAL time before the agent is dropped
  await pump(page, 180)
  check('swarm agent ended, still in the swarm', await shown(page), await expected(page, true))
  await page.screenshot({ path: suffix('6-swarm-agent-ended') })

  // 7. the panel is an agent surface too
  await emit(page, 'mesh:public-changed', { public: false })
  await sleep(2000)
  await emit(page, 'agent:open', { id: LOCAL_ID })
  await sleep(1200)
  await pump(page, 30)
  checkPanel('local agent panel, no swarm', await panelOpen(page), true)
  await page.screenshot({ path: suffix('7-panel-open') })

  await emit(page, 'mesh:public-changed', { public: true })
  await sleep(1500)
  await pump(page, 30)
  checkPanel('local agent panel, IN A SWARM', await panelOpen(page), false)
  await page.screenshot({ path: suffix('8-panel-closed-in-swarm') })

  // 8. a swarm agent's panel stays up in a swarm
  await emit(page, 'mesh:public-changed', { public: false })
  await sleep(1500)
  await emit(page, 'agent:start', {
    id: SWARM_ID, behavior: 'scout', kind: 'script', origin: 'swarm',
    request: 'proof: work that belongs to the swarm', targets: [], segments: [],
  })
  await sleep(1500)
  await emit(page, 'agent:open', { id: SWARM_ID })
  await sleep(1200)
  await pump(page, 30)
  checkPanel('swarm agent panel, no swarm', await panelOpen(page), true)
  await emit(page, 'mesh:public-changed', { public: true })
  await sleep(1500)
  await pump(page, 30)
  checkPanel('swarm agent panel, IN A SWARM', await panelOpen(page), true)
  await page.screenshot({ path: suffix('9-swarm-panel-stays') })

  const registry = await page.evaluate(() =>
    (window.ioc.get('@diamondcoreprocessor.com/AgentRegistry').list() || [])
      .map(a => ({ id: a.id, origin: a.origin || '(unset)', status: a.status })))
  log('registry:', JSON.stringify(registry))

  await browser.close()

  if (failures.length) {
    console.error(`\n${failures.length} FAILED:`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch(e => { console.error('driver failed:', e); process.exit(1) })
