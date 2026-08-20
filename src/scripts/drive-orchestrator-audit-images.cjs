// scripts/drive-orchestrator-audit-images.cjs
//
// Proof for BEE CLICK ROUTING and the ORCHESTRATOR'S GATHERED VIEW:
//
//   1. Clicking a REGULAR agent's bee opens its own window and does NOT open
//      the orchestrator's audit view.
//   2. Clicking the FOLDER-SYNC agent's bee opens the Backup & Restore
//      window — no agent panel, no audit, no tiles changing. Its bee is
//      hive-wide (pseudo-tile targets are gone), so it is actually there to
//      click, in its own slot (rank-spaced — never stacked on the watcher).
//   3. From the orchestrator's report, the folder-sync row raises the backup
//      window OVER the report — the report stays standing.
//   4. Clicking the ORCHESTRATOR's bee opens the audit view (one tile per
//      agent target, gathered into one page).
//   5. A gathered tile wears ITS OWN image — the props lookup signs the
//      tile's real path (['proofpage','brand']), never the page the audit was
//      opened from. A DECOY entry seeded under the root-signed key proves the
//      direction: the old code resolved that key and would paint the decoy.
//
// It drives the real drones — no stubs. Bees are clicked through the same
// window-capture pointer path a person's press takes, aimed at the dance
// centre the drone derives (rank-spaced #viewAnchor, mirrored in-page from
// the live registry).
//
//   node scripts/drive-orchestrator-audit-images.cjs [--headed] [--port 4251] [--out orchestrator-audit.png]
//
// Runs in its own Playwright profile — a fresh, empty hive. It never touches
// the participant's OPFS.

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
const OUT = String(arg('out', 'orchestrator-audit.png'))
const HEADED = process.argv.includes('--headed')

const TARGET_PAGE = 'proofpage'
const TARGET_TILE = 'brand'
const PLAIN_ID = 'proof-plain-agent'
const FOLDER_ID = 'folder-sync:proof-device'

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const suffix = (tag) => OUT.replace(/(\.png)?$/i, `-${tag}.png`)

const failures = []
function check(label, ok, detail = '') {
  log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${label}${detail ? ` (${detail})` : ''}`)
}

async function waitForReady(page, timeoutMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/AgentRegistry')
      && window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      && window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
      && window.ioc?.get?.('@hypercomb.social/Store')
      && window.__hypercombEffectBus
    )).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

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

/** Turn the Pixi clock by hand — headless Chromium starves rAF. */
const pump = (page, frames = 120) => page.evaluate((n) => {
  const app = window.__proof && window.__proof.app
  if (!app) return 0
  let t = performance.now()
  let pumped = 0
  for (let i = 0; i < n; i++) {
    t += 16.7
    try { app.ticker.update(t); pumped++ } catch { /* headless GL — logic already ran */ }
  }
  return pumped
}, frames)

/** Client coordinates of a hive-wide bee's dance centre — the drone's
 *  rank-spaced #viewAnchor, computed from the live registry, mapped through
 *  the canvas rect. The centre floats HOVER_PX (38 CSS px) above the anchor. */
const clientPointFor = (page, agentId) => page.evaluate((id) => {
  const reg = window.ioc.get('@diamondcoreprocessor.com/AgentRegistry')
  const open = reg.list().filter(a => a.targets.length === 0).map(a => a.id).sort()
  const index = Math.max(0, open.indexOf(id))
  const spread = (index + 0.5) / Math.max(1, open.length)
  const app = window.__proof.app
  const canvas = window.__proof.canvas ?? app.canvas
  const rect = canvas.getBoundingClientRect()
  const screen = app.renderer.screen
  return {
    x: rect.left + screen.width * (0.2 + spread * 0.6) * (rect.width / screen.width),
    y: rect.top + (screen.height * 0.34 - 38) * (rect.height / screen.height),
  }
}, agentId)

/** A press the way the drone hears one: window-capture pointer events. */
const pressAt = (page, point) => page.evaluate(({ x, y }) => {
  const opts = { clientX: x, clientY: y, pointerId: 7, bubbles: true, cancelable: true }
  window.dispatchEvent(new PointerEvent('pointerdown', opts))
  window.dispatchEvent(new PointerEvent('pointerup', opts))
  window.dispatchEvent(new MouseEvent('click', opts))
}, point)

/** Re-anchor (Date.now cadence) and let the eased centres settle. */
async function settle(page) {
  await sleep(700)
  await pump(page, 300)
}

const surfaces = (page) => page.evaluate(() => ({
  panel: !!document.querySelector('.hc-agent'),
  title: document.querySelector('.hc-agent-title')?.childNodes[0]?.textContent?.trim() ?? '',
  backup: !!document.querySelector('.hc-backup-window'),
  gather: window.__gatherState,
}))

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
  await sleep(2500)

  // Watch the gather lane from the start — activation is the audit opening.
  await page.evaluate(() => {
    window.__gatherState = null
    window.__hypercombEffectBus.on('render:gathered', p => { window.__gatherState = p })
  })

  // ── seed the image truth ─────────────────────────────────────────────
  //
  // The RIGHT props live under sign(['proofpage','brand']) — the tile's own
  // path. The DECOY lives under sign(['brand']) — the key the render location
  // would produce at root, which is what the broken lookup resolved.
  const seeded = await page.evaluate(async ([pageSeg, tile]) => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')

    const png = (color) => new Promise(resolve => {
      const canvas = document.createElement('canvas')
      canvas.width = 32; canvas.height = 32
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color; ctx.fillRect(0, 0, 32, 32)
      canvas.toBlob(b => resolve(b), 'image/png')
    })

    const rightImg = await store.putResource(await png('#d6b26e'))
    const decoyImg = await store.putResource(await png('#4a90d6'))
    const rightProps = await store.putResource(new Blob(
      [JSON.stringify({ small: { image: rightImg } })], { type: 'application/json' }))
    const decoyProps = await store.putResource(new Blob(
      [JSON.stringify({ small: { image: decoyImg } })], { type: 'application/json' }))

    const rightKey = await history.sign({ explorerSegments: () => [pageSeg, tile] })
    const wrongKey = await history.sign({ explorerSegments: () => [tile] })

    const index = JSON.parse(localStorage.getItem('hc:tile-props-index') ?? '{}')
    index[rightKey] = rightProps
    index[wrongKey] = decoyProps
    localStorage.setItem('hc:tile-props-index', JSON.stringify(index))
    return { rightImg, decoyImg, rightKey, wrongKey }
  }, [TARGET_PAGE, TARGET_TILE])
  log('seeded props:', JSON.stringify(seeded))

  // ── raise the agents ─────────────────────────────────────────────────
  await emit(page, 'agent:start', {
    id: PLAIN_ID, behavior: 'opus', kind: 'model',
    request: 'proof: plain agent, opens its own window', targets: [], segments: [],
  })
  await emit(page, 'agent:start', {
    id: 'proof-target-agent', behavior: 'sonnet', kind: 'model',
    request: 'proof: targeted work the audit gathers',
    targets: [TARGET_TILE], segments: [TARGET_PAGE],
  })
  // The folder agent exactly as folder-sync.service.ts raises it now:
  // hive-wide, no pseudo-tile targets.
  await emit(page, 'agent:start', {
    id: FOLDER_ID, behavior: 'folder-sync', kind: 'script',
    request: 'proof: back up this device', targets: [], segments: [],
  })

  // ── wait for the watcher, THEN click — the hive-wide lineup is stable ──
  const start = Date.now()
  let orchestrated = false
  while (Date.now() - start < 40000) {
    orchestrated = await page.evaluate(() =>
      !!window.ioc.get('@diamondcoreprocessor.com/AgentRegistry').get('orchestrator'))
    if (orchestrated) break
    await sleep(1000)
  }
  check('orchestrator raised itself over the running agents', orchestrated)
  await settle(page)

  // ── 1. a regular bee opens its window, never the audit ───────────────
  await pressAt(page, await clientPointFor(page, PLAIN_ID))
  await sleep(800)
  await pump(page, 30)
  const afterPlain = await surfaces(page)
  check('regular bee click opens its window', afterPlain.panel === true, `title="${afterPlain.title}"`)
  check('regular bee click shows THE AGENT, not the orchestrator', afterPlain.title === 'opus', `title="${afterPlain.title}"`)
  check('regular bee click does NOT open the audit', !(afterPlain.gather && afterPlain.gather.active), JSON.stringify(afterPlain.gather))
  await emit(page, 'agent:close', { id: PLAIN_ID })
  await sleep(500)

  // ── 2. the folder-sync bee opens Backup & Restore, nothing else ──────
  await pressAt(page, await clientPointFor(page, FOLDER_ID))
  await sleep(800)
  await pump(page, 30)
  const afterFolder = await surfaces(page)
  check('folder-sync bee click opens Backup & Restore', afterFolder.backup === true)
  check('folder-sync bee click opens NO agent panel', afterFolder.panel === false)
  check('folder-sync bee click does NOT open the audit (tiles unchanged)',
    !(afterFolder.gather && afterFolder.gather.active), JSON.stringify(afterFolder.gather))
  await page.screenshot({ path: suffix('1-folder-sync-window') })
  await page.evaluate(() => document.querySelector('.hc-backup-window .hc-backup-icon')?.click())
  await sleep(400)

  // ── 3. the orchestrator's bee opens the audit ────────────────────────
  await pressAt(page, await clientPointFor(page, 'orchestrator'))
  await sleep(800)
  await pump(page, 120)
  const afterOrch = await surfaces(page)
  check('orchestrator bee click opens its report', afterOrch.panel === true, `title="${afterOrch.title}"`)
  check('orchestrator bee click opens the audit view', !!(afterOrch.gather && afterOrch.gather.active),
    JSON.stringify(afterOrch.gather))
  check('the audit gathers only REAL tiles (no folder-backup phantom)',
    afterOrch.gather?.key === `orchestrator:${TARGET_TILE}`, `key="${afterOrch.gather?.key}"`)

  // ── 4. the report's folder-sync row raises the window OVER the report ─
  const rowClicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.hc-agent-runmain')]
    const hit = rows.find(r => r.querySelector('.hc-agent-runwho')?.textContent?.trim() === 'folder-sync')
    if (!hit) return false
    hit.click()
    return true
  })
  await sleep(600)
  const afterRow = await surfaces(page)
  check('the report lists the folder-sync agent', rowClicked)
  check('folder-sync row opens Backup & Restore', afterRow.backup === true)
  check('…and the report STAYS standing', afterRow.panel === true && afterRow.title === 'orchestrator',
    `panel=${afterRow.panel} title="${afterRow.title}"`)
  await page.evaluate(() => document.querySelector('.hc-backup-window .hc-backup-icon')?.click())

  // ── 5. the gathered tile wears its OWN image ─────────────────────────
  let tileState = null
  const renderStart = Date.now()
  while (Date.now() - renderStart < 30000) {
    await pump(page, 60)
    tileState = await page.evaluate((tile) => {
      const drone = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')
      const cell = drone?.renderedCells?.get?.(tile)
      return cell
        ? { rendered: true, imageSig: cell.imageSig ?? null, cached: drone.cellImageCache?.get?.(tile) ?? null }
        : { rendered: false }
    }, TARGET_TILE)
    if (tileState.rendered && tileState.imageSig) break
    await sleep(700)
  }
  check('the audit painted the target tile', !!(tileState && tileState.rendered), JSON.stringify(tileState))
  check('the gathered tile wears its own image (path-signed lookup)',
    tileState?.imageSig === seeded.rightImg,
    `imageSig=${String(tileState?.imageSig).slice(0, 12)} expected=${seeded.rightImg.slice(0, 12)}`)
  check('…and never the decoy the render location would have resolved',
    tileState?.imageSig !== seeded.decoyImg)
  // Let the paint settle before the picture — the scene-graph proof above is
  // instant, the GPU's first paint of the gathered view is not.
  await sleep(4000)
  await pump(page, 120)
  await sleep(1000)
  await page.screenshot({ path: suffix('2-audit-view') })

  await browser.close()

  if (failures.length) {
    console.error(`\n${failures.length} FAILED:`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch(e => { console.error('driver failed:', e); process.exit(1) })
