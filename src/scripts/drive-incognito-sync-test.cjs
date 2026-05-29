// scripts/drive-incognito-sync-test.cjs
//
// Simulates the user-reported scenario: fresh incognito tab where the
// user has ONLY set room + secret via the mesh modal and toggled
// mesh-public on. None of the internal mesh keys (network, relays,
// allow-loopback) are set — the test verifies the defaults are now
// sufficient for sync to flow.
//
// What "fresh incognito" means here:
//   - hc:room          — set (user typed in the modal)
//   - hc:secret        — set (user typed in the modal)
//   - hc:mesh-public   — 'true' (user toggled it OR dev shell default)
//   - hc:nostrmesh:network — NOT SET (user has no idea this key exists)
//   - hc:nostrmesh:relays  — NOT SET (defaults to LOCAL_RELAY)
//   - hc:nostrmesh:allow-loopback — NOT SET (loopback is in defaults so allowed)
//
// Pass criteria: peer tile flows in BOTH directions, same as the full
// driver — only with minimal config.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const ROOM = 'incog-test-' + Date.now().toString(36)
const SECRET = 'incog-secret-' + Math.random().toString(36).slice(2, 10)
const HEADED = process.argv.includes('--headed')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newPage(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[sync]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 220))
    }
  })
  page.on('pageerror', (err) => log(label, 'PAGE ERROR:', String(err)))
  return { ctx, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory()
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true }).catch(() => null)
      }
      return { ok: true }
    } catch (e) { return { ok: false, err: String(e) } }
  })
}

/** Minimal config — ONLY room, secret, mesh-public. This is what a
 *  user has after opening the mesh modal and toggling public on. */
async function configureMinimal(page, room, secret) {
  await page.evaluate(({ r, s }) => {
    localStorage.setItem('hc:room', r)
    localStorage.setItem('hc:secret', s)
    localStorage.setItem('hc:mesh-public', 'true')
  }, { r: room, s: secret })
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
    if (!input) return { ok: false }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, name)
}

async function probePeerCount(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = swarm?.peerTilesAtCurrentSig?.() ?? []
    return tiles.length
  })
}

async function probeMeshState(page) {
  return page.evaluate(() => ({
    meshPublic: localStorage.getItem('hc:mesh-public'),
    network: localStorage.getItem('hc:nostrmesh:network'),
    relays: localStorage.getItem('hc:nostrmesh:relays'),
    allowLoopback: localStorage.getItem('hc:nostrmesh:allow-loopback'),
    room: localStorage.getItem('hc:room'),
    secret: localStorage.getItem('hc:secret') ? '(set)' : '(unset)',
    networkEnabled: window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')?.isNetworkEnabled?.() ?? null,
  }))
}

async function main() {
  log('boot', 'launching browsers (headed=' + HEADED + ')')
  const browser = await chromium.launch({ headless: !HEADED })
  const A = await newPage(browser, 'A')
  const B = await newPage(browser, 'B')

  log('boot', 'first load')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })

  log('boot', 'wiping OPFS on both')
  await clearOpfs(A.page)
  await clearOpfs(B.page)

  log('boot', 'minimal config: only room + secret + mesh-public')
  await configureMinimal(A.page, ROOM, SECRET)
  await configureMinimal(B.page, ROOM, SECRET)

  log('boot', 'reloading both')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })

  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  log('A', 'state:', await probeMeshState(A.page))
  log('B', 'state:', await probeMeshState(B.page))

  await new Promise(r => setTimeout(r, 1000))

  // Poll-to-first-peer measurement. With both tabs already at the same
  // location/room/secret, the relay should fire A's event back to B
  // (and vice versa) within one round-trip of the REQ. 5s ceiling is
  // there for the rare CI hiccup; we report the actual time observed.
  async function waitForPeerCount(page, label, expected, ceilingMs = 5000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ceilingMs) {
      const n = await probePeerCount(page)
      if (n >= expected) return Date.now() - t0
      await new Promise(r => setTimeout(r, 25))
    }
    return -1
  }

  log('test', 'A adds alpha; B adds bravo (no settling wait between)')
  const tAddStart = Date.now()
  await addTile(A.page, 'alpha')
  await addTile(B.page, 'bravo')
  log('test', `both tiles entered in ${Date.now() - tAddStart}ms`)

  const tA = await waitForPeerCount(A.page, 'A', 1)
  const tB = await waitForPeerCount(B.page, 'B', 1)
  const seenByA = await probePeerCount(A.page)
  const seenByB = await probePeerCount(B.page)

  console.log('\n========== VERDICT ==========')
  console.log(seenByA > 0 ? `A sees B's tile: ✓ PASS (${tA}ms)` : `A sees B's tile: ✗ FAIL (timeout)`)
  console.log(seenByB > 0 ? `B sees A's tile: ✓ PASS (${tB}ms)` : `B sees A's tile: ✗ FAIL (timeout)`)
  console.log('=============================\n')

  const ok = seenByA > 0 && seenByB > 0
  if (!HEADED) await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
