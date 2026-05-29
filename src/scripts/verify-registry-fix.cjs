// scripts/verify-registry-fix.cjs
//
// Confirms (a) TileSourceRegistry is now in IoC after the fix,
// (b) late-joiner sees peer tiles AND show-cell actually renders them.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'fix-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const NAMES = ['coaching', 'operations', 'community']

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
      && window.ioc?.get?.('@hypercomb.social/Lineage')
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

async function probeFullState(page) {
  return page.evaluate(() => {
    const ioc = window.ioc
    const reg = ioc?.get?.('@hypercomb.social/TileSourceRegistry')
    const showCell = ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return {
      registryExists: !!reg,
      registryHasResolve: typeof reg?.resolve === 'function',
      swarmPeerCount: swarm?.peerTilesAtCurrentSig?.()?.length ?? 0,
      renderedCellsSize: showCell?.renderedCells?.size ?? 0,
      renderedLabels: showCell?.renderedCells
        ? [...showCell.renderedCells.values()].map(c => c.label).sort()
        : null,
    }
  })
}

async function main() {
  log('boot', 'launching A — publisher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  for (const n of NAMES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 600)) }
  await new Promise(r => setTimeout(r, 2000))

  log('A', 'state:', JSON.stringify(await probeFullState(A.page)))

  log('boot', 'waiting 10s — A heartbeat refreshes')
  await new Promise(r => setTimeout(r, 10000))

  log('boot', 'launching B — late joiner')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  log('B', 'polling state up to 10s — expect rendered peer tiles')
  const t0 = Date.now()
  let elapsed = -1
  let last = null
  while (Date.now() - t0 < 10000) {
    last = await probeFullState(B.page)
    if (last.renderedCellsSize >= NAMES.length) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 250))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  log('B', 'final:', JSON.stringify(last))

  const ok =
    last?.registryExists === true &&
    last?.registryHasResolve === true &&
    last?.swarmPeerCount === NAMES.length &&
    last?.renderedCellsSize === NAMES.length &&
    JSON.stringify(last?.renderedLabels) === JSON.stringify(NAMES.slice().sort())

  console.log('\n========== VERDICT ==========')
  console.log(`registryExists=${last?.registryExists} (expect true)`)
  console.log(`registryHasResolve=${last?.registryHasResolve} (expect true)`)
  console.log(`swarmPeerCount=${last?.swarmPeerCount} (expect ${NAMES.length})`)
  console.log(`renderedCellsSize=${last?.renderedCellsSize} (expect ${NAMES.length})`)
  console.log(`renderedLabels=${JSON.stringify(last?.renderedLabels)}`)
  console.log(ok ? `OVERALL: ✓ PASS (${elapsed}ms)` : `OVERALL: ✗ FAIL`)
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
