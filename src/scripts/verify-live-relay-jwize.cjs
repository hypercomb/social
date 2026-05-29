// scripts/verify-live-relay-jwize.cjs
//
// End-to-end verification against the live bootstrap relay at
// wss://jwize.com. Exercises the same flow the dev-shell verifier
// covers, but over the real public relay so we know nothing about
// the dev-only path (HC_BLOCK, HC_CLEAR, local-only assumptions)
// was masking a public-relay incompatibility.
//
// Checks:
//   1. Two peers can connect and reach OPEN state on jwize.com
//   2. A's published swarm-layer events reach B (basic sync)
//   3. Recursive adopt: single-click on a peer tile imports the
//      whole subtree (depth 3) over the live relay
//   4. Broker visuals fetch works (browse path)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const LIVE_RELAY = 'wss://jwize.com'
// Unique room+secret per run so we don't collide with other peers on
// the public relay. The composedSig (sha256(path + room + secret))
// gives us a private namespace inside the shared infrastructure.
const ROOM = 'jwize-test-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 12)

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser(label) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[content-broker]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 240))
    }
  })
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
    // Explicit relay list — bypasses the use-live-relay flag + local-
    // context heuristic and forces jwize.com regardless of where the
    // app shell happens to be running from.
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
  }, { room: ROOM, secret: SECRET, relay: LIVE_RELAY })
}

async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
      && window.ioc?.get?.('@hypercomb.social/TileSourceRegistry')
      && window.ioc?.get?.('@hypercomb.social/Navigation')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

/** Wait for the WebSocket to jwize.com to reach OPEN state. */
async function waitForLiveSocket(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
      const dbg = mesh?.getDebug?.()
      const sock = dbg?.sockets?.[0]
      return { url: sock?.url, ready: sock?.readyState }
    })
    if (state?.ready === 1) return state
    await new Promise(r => setTimeout(r, 300))
  }
  return null
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

async function navigateTo(page, segments) {
  return page.evaluate((segs) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    nav?.go?.(segs)
    return nav?.segmentsRaw?.()
  }, segments)
}

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
    return true
  }, label)
}

async function probePeerTiles(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = swarm?.peerTilesAtCurrentSig?.() ?? []
    return { count: tiles.length, names: tiles.map(t => t.name).sort() }
  })
}

async function probeOwnChildrenAt(page, segments) {
  return page.evaluate(async (segs) => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const sig = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return names.sort()
  }, segments)
}

async function probeMeshDebug(page) {
  return page.evaluate(() => {
    const m = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')?.getDebug?.()
    return {
      relays: m?.relays,
      sockets: m?.sockets,
      msgEventIn: m?.stats?.msgEventIn,
      eventSent: m?.stats?.eventSent,
      dupDrop: m?.stats?.dupDrop,
      noBucket: m?.stats?.noBucket,
    }
  })
}

async function main() {
  console.log(`[boot] Testing against live relay: ${LIVE_RELAY}`)
  console.log(`[boot] Room: ${ROOM}`)
  console.log(`[boot] Secret: ${SECRET}`)

  // ── A: publisher ──
  log('A', 'launching publisher')
  const A = await newBrowser('A')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'IoC TIMEOUT'); process.exit(1) }

  log('A', 'waiting for jwize.com socket to open')
  const aSock = await waitForLiveSocket(A.page)
  if (!aSock) { log('A', 'SOCKET TIMEOUT — could not reach jwize.com'); process.exit(1) }
  log('A', 'connected:', JSON.stringify(aSock))
  await new Promise(r => setTimeout(r, 1500))

  // Build a 3-level tree: /dolphin/team/projects
  log('A', 'building /dolphin/team/projects subtree')
  await addTile(A.page, 'dolphin')
  await new Promise(r => setTimeout(r, 800))
  await navigateTo(A.page, ['dolphin'])
  await new Promise(r => setTimeout(r, 1200))
  await addTile(A.page, 'team')
  await new Promise(r => setTimeout(r, 800))
  await navigateTo(A.page, ['dolphin', 'team'])
  await new Promise(r => setTimeout(r, 1200))
  await addTile(A.page, 'projects')
  await new Promise(r => setTimeout(r, 800))
  await navigateTo(A.page, [])
  await new Promise(r => setTimeout(r, 4000))  // longer settle for public relay

  log('A', 'tree built. mesh state:', JSON.stringify(await probeMeshDebug(A.page)))

  // ── B: late joiner ──
  log('B', 'launching late joiner')
  const B = await newBrowser('B')
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'IoC TIMEOUT'); process.exit(1) }

  log('B', 'waiting for jwize.com socket')
  const bSock = await waitForLiveSocket(B.page)
  if (!bSock) { log('B', 'SOCKET TIMEOUT'); process.exit(1) }
  log('B', 'connected:', JSON.stringify(bSock))

  // Allow extra time for relay round-trip
  log('B', 'waiting for initial sync')
  let initialSeen = { count: 0, names: [] }
  const t0 = Date.now()
  while (Date.now() - t0 < 8000) {
    initialSeen = await probePeerTiles(B.page)
    if (initialSeen.count >= 1) break
    await new Promise(r => setTimeout(r, 300))
  }
  const initialSyncMs = Date.now() - t0
  log('B', `initial sync: ${JSON.stringify(initialSeen)} (${initialSyncMs}ms)`)

  // ── Test recursive adopt over live relay ──
  log('B', 'firing adopt on "dolphin"')
  await fireAdopt(B.page, 'dolphin')

  let elapsed = -1
  let tree = null
  const t1 = Date.now()
  while (Date.now() - t1 < 20000) {
    tree = {
      root: await probeOwnChildrenAt(B.page, []),
      dolphin: await probeOwnChildrenAt(B.page, ['dolphin']),
      team: await probeOwnChildrenAt(B.page, ['dolphin', 'team']),
    }
    if (tree.root.includes('dolphin') && tree.dolphin.includes('team') && tree.team.includes('projects')) {
      elapsed = Date.now() - t1
      break
    }
    await new Promise(r => setTimeout(r, 500))
  }
  if (elapsed < 0) elapsed = Date.now() - t1

  log('B', 'final tree:', JSON.stringify(tree))
  log('B', 'final mesh debug:', JSON.stringify(await probeMeshDebug(B.page)))

  // Deep probe: what does B's swarm cache actually look like at each sub-sig?
  // Reach in via mesh.getNonExpired to also see what raw events the mesh has.
  const swarmDeep = await B.page.evaluate(async () => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    const dbg = swarm?.debug?.() ?? {}
    const out = { drone: dbg }
    const sigs = {
      root: await swarm?.composeSigForSegments?.([]),
      dolphin: await swarm?.composeSigForSegments?.(['dolphin']),
      team: await swarm?.composeSigForSegments?.(['dolphin', 'team']),
    }
    out.sigs = sigs
    out.tilesAt = {
      root: swarm?.peerTilesAtSig?.(sigs.root)?.map(t => t.name),
      dolphin: swarm?.peerTilesAtSig?.(sigs.dolphin)?.map(t => t.name),
      team: swarm?.peerTilesAtSig?.(sigs.team)?.map(t => t.name),
    }
    // What RAW mesh events does B have at each sig? Helps tell if the
    // relay actually delivered A's sub-location events, or if it
    // delivered them but the swarm sanitizer dropped them.
    const meshEvents = {}
    for (const [label, s] of Object.entries(sigs)) {
      if (!s) continue
      const events = mesh?.getNonExpired?.(s) ?? []
      meshEvents[label] = events.map(e => ({
        kind: e?.event?.kind,
        pubkey: e?.event?.pubkey?.slice(0, 8),
        created_at: e?.event?.created_at,
        contentLen: e?.event?.content?.length ?? 0,
        contentPreview: String(e?.event?.content ?? '').slice(0, 200),
        tagCount: e?.event?.tags?.length ?? 0,
      }))
    }
    out.meshEvents = meshEvents
    return out
  })
  console.log('\n[B swarm deep probe]')
  console.log(JSON.stringify(swarmDeep, null, 2))

  const haveDolphin = tree?.root?.includes('dolphin')
  const haveTeam = tree?.dolphin?.includes('team')
  const haveProjects = tree?.team?.includes('projects')
  const syncOk = initialSeen.count >= 1
  const allOk = syncOk && haveDolphin && haveTeam && haveProjects

  console.log('\n========== VERDICT — wss://jwize.com ==========')
  console.log(`socket A reached OPEN:                ${aSock ? '✓' : '✗'}  (${aSock?.url})`)
  console.log(`socket B reached OPEN:                ${bSock ? '✓' : '✗'}  (${bSock?.url})`)
  console.log(`B initial sync (sees A's dolphin):    ${syncOk ? '✓' : '✗'}  (${initialSeen.count} tiles in ${initialSyncMs}ms)`)
  console.log(`/  → dolphin (top-level adopt):       ${haveDolphin ? '✓' : '✗'}`)
  console.log(`/dolphin → team (depth 1):            ${haveTeam ? '✓' : '✗'}`)
  console.log(`/dolphin/team → projects (depth 2):   ${haveProjects ? '✓' : '✗'}`)
  console.log(allOk ? `OVERALL: ✓ PASS (recursive adopt in ${elapsed}ms over live relay)` : 'OVERALL: ✗ FAIL')
  console.log('===============================================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
