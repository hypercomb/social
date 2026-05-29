// scripts/verify-toggle-rejoin.cjs
//
// Confirms peer tiles re-appear after a public→private→public toggle,
// WITHIN the heartbeat window (under 30s). Without the recentIds clear
// in pauseNetwork, the replayed event from the relay is deduped against
// the previous session's id and never reaches SwarmDrone — peer cache
// stays empty until the next heartbeat (~30s) produces a fresh id.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'tog-' + Date.now().toString(36)
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
      && window.ioc?.get?.('@hypercomb.social/TileSourceRegistry')
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

async function probePeerState(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = swarm?.peerTilesAtCurrentSig?.() ?? []
    const showCell = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const cells = showCell?.renderedCells ? [...showCell.renderedCells.values()] : []
    const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    const md = mesh?.getDebug?.() ?? {}
    return {
      peerCount: tiles.length,
      peerNames: tiles.map(t => t.name).sort(),
      renderedCount: cells.length,
      renderedLabels: cells.map(c => c.label).sort(),
      networkEnabled: mesh?.isNetworkEnabled?.(),
      dupDrop: md.stats?.dupDrop,
      msgEventIn: md.stats?.msgEventIn,
    }
  })
}

async function toggleMeshPublic(page, next) {
  await page.evaluate((nextValue) => {
    const ioc = window.ioc
    const mesh = ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    localStorage.setItem('hc:mesh-public', String(nextValue))
    mesh?.setNetworkEnabled?.(nextValue, true)
    // Fire mesh:public-changed via SwarmDrone's own emitEffect, which
    // routes through EffectBus (the same singleton App.ts uses). This
    // is what the UI toggle does in production. TypeScript's `protected`
    // doesn't carry to runtime, so we can call it directly here.
    swarm?.emitEffect?.('mesh:public-changed', { public: nextValue })
  }, next)
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

  for (const n of NAMES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 500)) }
  await new Promise(r => setTimeout(r, 2000))

  log('boot', 'launching B — joins fresh, should see A')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  // Wait for initial sync.
  let initial = null
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    initial = await probePeerState(B.page)
    if (initial.peerCount >= NAMES.length) break
    await new Promise(r => setTimeout(r, 250))
  }
  log('B', 'initial state:', JSON.stringify(initial))
  const initialOk = initial?.peerCount === NAMES.length

  // ── TOGGLE TO PRIVATE ─────────────────────────────────────────
  log('B', 'toggle → PRIVATE')
  await toggleMeshPublic(B.page, false)
  await new Promise(r => setTimeout(r, 1500))
  const afterPrivate = await probePeerState(B.page)
  log('B', 'after private:', JSON.stringify(afterPrivate))
  const privateOk = afterPrivate?.peerCount === 0 && afterPrivate?.networkEnabled === false

  // ── TOGGLE BACK TO PUBLIC ─────────────────────────────────────
  // Critical: do this WELL INSIDE the heartbeat window (<30s) so the
  // relay still holds the same event id we saw in the first session.
  // Without the recentIds clear, dedup drops it silently.
  log('B', 'toggle → PUBLIC (within heartbeat window — same event id at relay)')
  await toggleMeshPublic(B.page, true)

  // Poll for the cache to repopulate within 8s. With the fix this
  // happens in milliseconds. Without the fix it stays empty until
  // A's next heartbeat (~30s).
  let rejoinElapsed = -1
  let rejoin = null
  const t1 = Date.now()
  while (Date.now() - t1 < 8000) {
    rejoin = await probePeerState(B.page)
    if (rejoin.peerCount >= NAMES.length) { rejoinElapsed = Date.now() - t1; break }
    await new Promise(r => setTimeout(r, 200))
  }
  if (rejoinElapsed < 0) rejoinElapsed = Date.now() - t1
  log('B', 'after rejoin:', JSON.stringify(rejoin))

  const rejoinOk = rejoin?.peerCount === NAMES.length && rejoin?.renderedCount === NAMES.length

  console.log('\n========== VERDICT ==========')
  console.log(`initial sync: peers=${initial?.peerCount}, rendered=${initial?.renderedCount} ${initialOk ? '✓' : '✗'}`)
  console.log(`after private: peers=${afterPrivate?.peerCount}, networkEnabled=${afterPrivate?.networkEnabled} ${privateOk ? '✓' : '✗'}`)
  console.log(`after rejoin: peers=${rejoin?.peerCount}, rendered=${rejoin?.renderedCount} (in ${rejoinElapsed}ms) ${rejoinOk ? '✓' : '✗'}`)
  const all = initialOk && privateOk && rejoinOk
  console.log(all ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(all ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
