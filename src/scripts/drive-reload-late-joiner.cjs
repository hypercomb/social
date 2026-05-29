// scripts/drive-reload-late-joiner.cjs
//
// Reproduces the actual user scenario:
//   1. A creates tiles in a session.
//   2. A RELOADS the page (boot from existing OPFS + history).
//   3. A sits idle — no add, no nav.
//   4. B joins fresh.
//   5. Does B see A's tiles?
//
// Hypothesis: A's boot publish happens before history cache warms with the
// existing tiles. Initial publish ships empty visuals. Heartbeat keeps
// publishing that empty event until A actually does something (navigate /
// edit). B subscribes during the empty-publish window → sees nothing.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'reload-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const HEADED = process.argv.includes('--headed')
const NAMES = ['coaching', 'operations', 'community', 'instructions', 'dashboard']

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser(label) {
  const browser = await chromium.launch({ headless: !HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[mesh]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 300))
    }
  })
  return { browser, ctx, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory()
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true }).catch(() => null)
      }
      return true
    } catch { return false }
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
    localStorage.setItem('hc:nostrmesh:debug', '1')
  }, { room: ROOM, secret: SECRET, relay: RELAY })
}

async function waitForReady(page, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@hypercomb.social/Lineage')
      && window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
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

async function probePeerTiles(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = swarm?.peerTilesAtCurrentSig?.() ?? []
    return { count: tiles.length, names: tiles.map(t => t.name).sort() }
  })
}

async function probeLocalLayer(page) {
  return page.evaluate(async () => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const sig = await history.sign({ explorerSegments: () => [] })
    const layer = await history.currentLayerAt(sig)
    const childSigs = Array.isArray(layer?.children) ? layer.children : []
    const childNames = []
    for (const cs of childSigs) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) childNames.push(c.name) }
      catch {}
    }
    return { count: childSigs.length, names: childNames.sort() }
  })
}

async function main() {
  log('boot', 'PHASE 1: A creates 5 tiles in initial session')
  const A = await newBrowser('A')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT phase1'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  for (const n of NAMES) {
    await addTile(A.page, n)
    await new Promise(r => setTimeout(r, 600))
  }
  await new Promise(r => setTimeout(r, 2000))
  log('A', 'before reload, A own layer:', JSON.stringify(await probeLocalLayer(A.page)))

  log('boot', 'PHASE 2: RELOAD A (simulates user opening app fresh with existing data)')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT phase2'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2000))
  log('A', 'after reload, A own layer:', JSON.stringify(await probeLocalLayer(A.page)))

  log('boot', 'PHASE 3: A sits idle for 5s — no add, no nav')
  await new Promise(r => setTimeout(r, 5000))

  log('boot', 'PHASE 4: B joins fresh in separate browser')
  const B = await newBrowser('B')
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  log('B', 'polling for peer tiles up to 10s')
  const t0 = Date.now()
  let elapsed = -1
  let last = null
  while (Date.now() - t0 < 10000) {
    last = await probePeerTiles(B.page)
    if (last.count >= NAMES.length) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 250))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  log('B', 'final:', JSON.stringify(last))

  const expected = NAMES.slice().sort()
  const actual = (last?.names ?? []).sort()
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  console.log('\n========== VERDICT ==========')
  console.log(`Expected: ${JSON.stringify(expected)}`)
  console.log(`Actual:   ${JSON.stringify(actual)}`)
  console.log(ok ? `Late joiner after A reload: ✓ PASS (${elapsed}ms)` : `Late joiner after A reload: ✗ FAIL (${last?.count ?? 0}/${NAMES.length})`)
  console.log('=============================\n')

  if (!HEADED) {
    await A.browser.close()
    await B.browser.close()
  }
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
