// Throwaway audit: late-joiner visuals recovery (#48). A stays present at a
// location and has already published; B joins AFTER and must recover A's
// tiles via broker.fetchVisualsAt — WITHOUT A re-broadcasting.
//
// The definitive proof is B's console line "late-join recovery injected",
// which ONLY comes from the #48 injection path (a live re-broadcast logs
// "onEvent CACHED" instead). So if that line fires AND B sees A's tiles
// while A sat still, recovery — not a live event — delivered them.
//
// Run: node audit-late-join-recovery.cjs  (from hypercomb-relay/, dev shell up)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const RELAY_PORT = 7795
const RELAY = `ws://localhost:${RELAY_PORT}`
const URL = 'http://localhost:4250/'
const ROOM = 'ljr-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

const ts = () => new Date().toISOString().slice(11, 23)
const log = (tag, ...a) => console.log(`[${ts()}] [${tag}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = (arr) => (arr || []).map((t) => t.name).sort()

let relay
async function startRelay() {
  relay = spawn('node', [RELAY_JS, '--port', String(RELAY_PORT), '--memory'], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  relay.stderr.on('data', (d) => process.stderr.write('[relay-err] ' + d))
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${RELAY_PORT}/`)).ok) return } catch {} await sleep(100) }
}

async function newBrowser() {
  const b = await chromium.launch({ headless: true })
  const p = await (await b.newContext()).newPage()
  return { b, p }
}
const clearOpfs = (page) => page.evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  for await (const [n] of root.entries()) await root.removeEntry(n, { recursive: true }).catch(() => null)
})
const configure = (page) => page.evaluate(({ room, secret, relay }) => {
  localStorage.setItem('hc:room', room)
  localStorage.setItem('hc:secret', secret)
  localStorage.setItem('hc:mesh-public', 'true')
  localStorage.setItem('hc:nostrmesh:network', '1')
  localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
  localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
}, { room: ROOM, secret: SECRET, relay: RELAY })
async function waitForReady(page, t = 30000) {
  const s = Date.now()
  while (Date.now() - s < t) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') &&
      window.ioc?.get?.('@hypercomb.social/Navigation') &&
      window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')?.fetchVisualsAt
    ))
    if (ok) return true
    await sleep(250)
  }
  return false
}
const addTile = (page, name) => page.evaluate(async (n) => {
  const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
  if (!input) return false
  input.focus(); input.value = n; input.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 100))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  return true
}, name)
const navigateTo = (page, segs) => page.evaluate((s) => {
  const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
  nav?.go?.(s)
  return nav?.segmentsRaw?.()
}, segs)
const seenTiles = (page, segs) => page.evaluate(async (s) => {
  const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.composeSigForSegments || !swarm?.peerTilesAtSig) return null
  const sig = await swarm.composeSigForSegments(s)
  const tiles = swarm.peerTilesAtSig(sig) ?? []
  return tiles.map((t) => ({ name: t.name }))
}, segs)

async function main() {
  await startRelay(); log('boot', `mesh relay ${RELAY} | dev shell ${URL} | room ${ROOM}`)

  // ── A authors at root and STAYS present (no re-broadcast later) ──
  const A = await newBrowser()
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.p); await configure(A.p); await A.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.p))) { log('A', 'TIMEOUT — not ready'); process.exit(2) }
  await sleep(1500)
  log('A', 'authoring root tiles: home, lab (then stays put — no re-broadcast)')
  await addTile(A.p, 'home'); await sleep(700); await addTile(A.p, 'lab'); await sleep(1800)

  // ── B joins LATE (after A already published) ──
  const B = await newBrowser()
  const recoveryLogs = []
  B.p.on('console', (m) => { const t = m.text(); if (t.includes('late-join recovery') || t.includes('recovery injected')) { recoveryLogs.push(t); log('B-console', t.slice(0, 120)) } })
  await B.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.p); await configure(B.p); await B.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.p))) { log('B', 'TIMEOUT — not ready'); process.exit(2) }
  await sleep(2500)  // settle: mesh + broker live

  // Force a clean #syncForSig at root with the broker ready: bounce to a
  // throwaway empty location, then back to root (flushes the root cache so
  // recovery re-fires on arrival).
  log('B', 'bounce → throwaway → root, to trigger late-join recovery with broker ready')
  await navigateTo(B.p, ['warm-' + Math.random().toString(36).slice(2, 7)]); await sleep(1500)
  await navigateTo(B.p, []); await sleep(500)

  // Poll for recovery: A is NOT re-broadcasting, so home/lab can only reach
  // B via fetchVisualsAt recovery.
  let seen = []
  const t0 = Date.now()
  while (Date.now() - t0 < 18000) {
    seen = await seenTiles(B.p, [])
    if (names(seen).includes('home') && names(seen).includes('lab')) break
    await sleep(500)
  }
  log('B', `at root (A sat still) — swarm visuals: ${JSON.stringify(names(seen))}`)

  const recoveryFired = recoveryLogs.length > 0
  const tilesRecovered = names(seen).includes('home') && names(seen).includes('lab')
  const pass = recoveryFired && tilesRecovered

  console.log('\n========== VERDICT ==========')
  console.log(`recovery path fired (console "late-join recovery injected"):  ${recoveryFired ? '✓' : '✗'}  ${recoveryLogs.length} log(s)`)
  console.log(`B recovered A's tiles WITHOUT A re-broadcasting:               ${tilesRecovered ? '✓' : '✗'}  seen=${JSON.stringify(names(seen))}`)
  console.log(pass
    ? 'OVERALL: ✓ PASS — late-joiner visuals recovery via fetchVisualsAt (#48)'
    : 'OVERALL: ✗ FAIL (see rows)')
  console.log('=============================\n')

  await A.b.close(); await B.b.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); try { relay.kill() } catch {}; process.exit(1) })
