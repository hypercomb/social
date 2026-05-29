// scripts/verify-multi-adopt.cjs
//
// Verifies multi-tile adopt — the action the selection vertical menu
// will fire. Publisher A creates 4 tiles at root. Adopter B sees them
// all, fires one tile:action with `action: 'adopt'` carrying the
// full label set, and ends up with all 4 in their local layer.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'multi-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const NAMES = ['alpha', 'bravo', 'charlie', 'delta']

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  return { browser, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => null)
    }
  })
}

async function configure(page) {
  await page.evaluate(({ room, secret, relay }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
  }, { room: ROOM, secret: SECRET, relay: RELAY })
}

async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
}

async function fireMultiAdopt(page, labels) {
  return page.evaluate((labelList) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', labels: labelList })
  }, labels)
}

async function probeOwnChildren(page) {
  return page.evaluate(async () => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const segs = lineage?.explorerSegments?.() ?? []
    const sig = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return names.sort()
  })
}

async function main() {
  log('A', 'launching publisher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  log('A', `publishing ${NAMES.length} tiles`)
  for (const n of NAMES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 500)) }
  await new Promise(r => setTimeout(r, 2500))

  log('B', 'launching adopter')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3000))

  log('B', `firing multi-adopt for ${JSON.stringify(NAMES)}`)
  await fireMultiAdopt(B.page, NAMES)

  // Poll for all 4 to land.
  let elapsed = -1
  let children = []
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    children = await probeOwnChildren(B.page)
    if (NAMES.every(n => children.includes(n))) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 300))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  log('B', `final local children: ${JSON.stringify(children)}`)

  const expected = NAMES.slice().sort()
  const allLanded = NAMES.every(n => children.includes(n))

  console.log('\n========== VERDICT ==========')
  console.log(`expected: ${JSON.stringify(expected)}`)
  console.log(`actual:   ${JSON.stringify(children)}`)
  console.log(allLanded ? `OVERALL: ✓ PASS (multi-adopt landed all ${NAMES.length} tiles in ${elapsed}ms)` : `OVERALL: ✗ FAIL`)
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(allLanded ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
