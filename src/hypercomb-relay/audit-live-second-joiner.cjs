// Throwaway audit: FIRST participant must see a SECOND joiner's tiles LIVE.
// A joins a session at root and sits still. B joins AFTER and authors tiles.
// PASS = A's swarm cache gains B's tiles without A reloading or navigating.
//
// Instrumentation: A's console is tapped for '[swarm] onEvent' lines so a
// failure can be localized — no onEvent lines means the relay never forwarded
// B's events to A's open REQ (wire break); onEvent CACHED without tiles in
// peerTilesAtSig means a cache/render-side break.
//
// Run: node audit-live-second-joiner.cjs  (from hypercomb-relay/, dev shell up)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const RELAY_PORT = 7796
const RELAY = `ws://localhost:${RELAY_PORT}`
const URL = 'http://localhost:4250/'
const ROOM = 'lsj-' + Date.now().toString(36)
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
const seenTiles = (page, segs) => page.evaluate(async (s) => {
  const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
  if (!swarm?.composeSigForSegments || !swarm?.peerTilesAtSig) return null
  const sig = await swarm.composeSigForSegments(s)
  const tiles = swarm.peerTilesAtSig(sig) ?? []
  return tiles.map((t) => ({ name: t.name }))
}, segs)

async function main() {
  await startRelay(); log('boot', `mesh relay ${RELAY} | dev shell ${URL} | room ${ROOM}`)

  // ── A joins FIRST and sits at root (this is the user's seat) ──
  const A = await newBrowser()
  const aSwarmLogs = []
  A.p.on('console', (m) => {
    const t = m.text()
    if (t.includes('[swarm] onEvent') || t.includes('peers-changed') || t.includes('late-join recovery')) {
      aSwarmLogs.push(t)
      log('A-console', t.slice(0, 160))
    }
  })
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.p); await configure(A.p); await A.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.p))) { log('A', 'TIMEOUT — not ready'); process.exit(2) }
  await sleep(2500)  // settle: subscribed + published at root
  log('A', 'present at root, sitting still from here on (no reload, no nav)')

  // ── B joins SECOND and authors tiles at root ──
  const B = await newBrowser()
  await B.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.p); await configure(B.p); await B.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.p))) { log('B', 'TIMEOUT — not ready'); process.exit(2) }
  await sleep(2000)
  log('B', 'authoring root tiles: bravo1, bravo2')
  await addTile(B.p, 'bravo1'); await sleep(700); await addTile(B.p, 'bravo2'); await sleep(700)

  // ── A must see B's tiles arrive LIVE ──
  let seen = []
  const t0 = Date.now()
  while (Date.now() - t0 < 25000) {
    seen = await seenTiles(A.p, [])
    if (names(seen).includes('bravo1') && names(seen).includes('bravo2')) break
    await sleep(500)
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  log('A', `after ${elapsed}s — swarm visuals at root: ${JSON.stringify(names(seen))}`)

  const eventsArrived = aSwarmLogs.some((t) => t.includes('onEvent CACHED'))
  const tilesLive = names(seen).includes('bravo1') && names(seen).includes('bravo2')
  const pass = tilesLive

  console.log('\n========== VERDICT ==========')
  console.log(`A received swarm events from B over the live sub:   ${eventsArrived ? '✓' : '✗'}  (${aSwarmLogs.length} swarm log lines)`)
  console.log(`A sees B's tiles WITHOUT refresh:                   ${tilesLive ? '✓' : '✗'}  seen=${JSON.stringify(names(seen))}`)
  console.log(pass
    ? 'OVERALL: ✓ PASS — second joiner surfaces live on the first participant'
    : 'OVERALL: ✗ FAIL (see rows — localize via A-console lines above)')
  console.log('=============================\n')

  await A.b.close(); await B.b.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); try { relay.kill() } catch {}; process.exit(1) })
