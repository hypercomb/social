// Throwaway end-to-end audit of LAYERLESS, visuals-only navigation +
// presence-driven visibility. Two participants against the dev shell
// (localhost:4250), a self-spawned mesh relay, isolated OPFS each.
//
// Claims under audit (public-navigation doctrine):
//   - A participant navigating to a location it doesn't hold arrives
//     LAYERLESS (no local layer) and sees only VISUALS broadcast by
//     present participants.
//   - Visibility is presence-driven: a participant who HAS tiles at a
//     location but hasn't visited/broadcast it shows nothing there.
//   - As a participant joins a location, its tiles appear in the swarm.
//
// Scenario:
//   A authors root tiles (home, lab) and stays at root — present there,
//   broadcasting. A has NOT entered /lab.
//   B (fresh) navigates root → sees A's root tiles via the swarm.
//   B navigates /lab → sees NOTHING (A not present there) and has no
//   local layer (layerless).
//   A then enters /lab and adds 'experiment'. B's /lab view fills with
//   'experiment' — purely via visuals, no layer transferred.
//
// Run: node audit-layerless-visuals.cjs  (from hypercomb-relay/, dev shell up)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const RELAY_PORT = 7796
const RELAY = `ws://localhost:${RELAY_PORT}`
const URL = 'http://localhost:4250/'
const ROOM = 'vis-' + Date.now().toString(36)
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
    const ok = await page.evaluate(() => !!(window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone') && window.ioc?.get?.('@hypercomb.social/Navigation')))
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
  return tiles.map((t) => ({ name: t.name, image: t.image ?? t.imageSig ?? t.background ?? null }))
}, segs)
const localChildren = (page, segs) => page.evaluate(async (s) => {
  const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
  if (!history?.sign) return null
  const sig = await history.sign({ explorerSegments: () => s })
  const layer = await history.currentLayerAt?.(sig)
  const out = []
  for (const cs of (layer?.children ?? [])) { try { const c = await history.getLayerBySig(cs); if (c?.name) out.push(c.name) } catch {} }
  return out.sort()
}, segs)

async function main() {
  await startRelay(); log('boot', `mesh relay ${RELAY} | dev shell ${URL} | room ${ROOM}`)

  const A = await newBrowser()
  await A.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.p); await configure(A.p); await A.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.p))) { log('A', 'TIMEOUT — swarm/nav not ready'); process.exit(2) }
  await sleep(1500)
  log('A', 'authoring root tiles: home, lab (stays at root, does NOT enter /lab)')
  await addTile(A.p, 'home'); await sleep(700); await addTile(A.p, 'lab'); await sleep(1800)
  log('A', `root local children: ${JSON.stringify(await localChildren(A.p, []))}`)

  const B = await newBrowser()
  await B.p.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.p); await configure(B.p); await B.p.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.p))) { log('B', 'TIMEOUT — swarm/nav not ready'); process.exit(2) }
  await sleep(2500)

  // ── Phase 1: B witnesses root via visuals; /lab is layerless + empty ──
  await navigateTo(B.p, []); await sleep(2500)
  const rootSeenLateJoin = await seenTiles(B.p, [])
  log('B', `at root (late-join, before A re-broadcasts) — swarm visuals: ${JSON.stringify(names(rootSeenLateJoin))}`)
  // Disambiguate the late-joiner case: now that B is subscribed at root,
  // force A to re-broadcast root LIVE (bounce to /home and back). If B then
  // sees the root tiles, the initial miss was pure late-join timing and
  // live presence-visibility works at root too.
  log('A', 're-affirming root presence live (bounce /home → root) while B is subscribed')
  await navigateTo(A.p, ['home']); await sleep(1200); await navigateTo(A.p, []); await sleep(1500)
  let rootSeen = []
  const tr = Date.now()
  while (Date.now() - tr < 12000) { rootSeen = await seenTiles(B.p, []); if (names(rootSeen).includes('home') && names(rootSeen).includes('lab')) break; await sleep(500) }
  log('B', `at root (after A re-broadcasts live) — swarm visuals: ${JSON.stringify(names(rootSeen))}`)
  await navigateTo(B.p, ['lab']); await sleep(3000)
  const labBefore = await seenTiles(B.p, ['lab'])
  const labLocal = await localChildren(B.p, ['lab'])
  log('B', `at /lab BEFORE A visits — swarm visuals: ${JSON.stringify(names(labBefore))} | local layer: ${JSON.stringify(labLocal)}`)

  // ── Phase 2: A enters /lab, adds experiment; B's view fills ──
  log('A', 'entering /lab, adding experiment')
  await navigateTo(A.p, ['lab']); await sleep(1800); await addTile(A.p, 'experiment'); await sleep(2000)
  let labAfter = []
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) { labAfter = await seenTiles(B.p, ['lab']); if (names(labAfter).includes('experiment')) break; await sleep(500) }
  log('B', `at /lab AFTER A visits — swarm visuals: ${JSON.stringify(names(labAfter))}`)

  const rootOk = names(rootSeen).includes('home') && names(rootSeen).includes('lab')
  const labEmptyBefore = names(labBefore).length === 0 && (labLocal || []).length === 0
  const labAfterOk = names(labAfter).includes('experiment')

  console.log('\n========== VERDICT ==========')
  console.log(`root visuals on late-join (no replay expected):   ${names(rootSeenLateJoin).length === 0 ? 'empty (late-join miss)' : JSON.stringify(names(rootSeenLateJoin))}`)
  console.log(`root visuals after A re-broadcasts live:          ${rootOk ? '✓' : '✗'}  seen=${JSON.stringify(names(rootSeen))}`)
  console.log(`/lab layerless + invisible before A visits:       ${labEmptyBefore ? '✓' : '✗'}  swarm=${JSON.stringify(names(labBefore))} local=${JSON.stringify(labLocal)}`)
  console.log(`/lab 'experiment' appears after A visits:         ${labAfterOk ? '✓' : '✗'}  seen=${JSON.stringify(names(labAfter))}`)
  const pass = rootOk && labEmptyBefore && labAfterOk
  console.log(pass ? 'OVERALL: ✓ PASS — layerless visuals navigation + presence-driven visibility' : 'OVERALL: ✗ FAIL (see rows)')
  console.log('=============================\n')

  await A.b.close(); await B.b.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); try { relay.kill() } catch {}; process.exit(1) })
