// scripts/verify-share-flow.cjs
//
// End-to-end driver test for the SIG-HANDOFF share workflow.
//
// Under the sig-handoff model (architecturally locked in 2026-06), the
// adopt button on the hive does ONE thing: dispatch portal:open with the
// peer's branchSig + the participant's current location ("at" path).
// Everything else (commit, fetch, organize, render the branch UI) happens
// inside the canonical installer iframe.
//
// Phases:
//   1. Two browsers join the same swarm (room + secret)
//   2. Publisher creates a tile that broadcasts on the mesh
//   3. Adopter clicks Adopt on the peer tile
//   4. Assert: portal-overlay iframe rendered, src points at the canonical
//      installer URL (localhost:2400 in dev) with #branch=<sig>&at=<path>
//   5. Assert: address breadcrumb shows host + branch=<6chars> + path
//   6. Assert: install-monitor stayed 'idle' throughout (NO breadcrumb flash —
//      retired during the full-split refactor; portal IS the visible feedback)
//   7. Assert: adopter's tree did NOT auto-fill (adoption no longer commits;
//      that's the installer's job now)
//
// Runs against ports 4250 (publisher) and 4251 (adopter) — hypercomb-dev
// shell. The iframe target (localhost:2400) is the DCP dev SPA expected
// to be running concurrently.

const { chromium } = require('playwright')

const PUBLISHER_PORT = 4250
const ADOPTER_PORT = 4251
const RELAY = 'ws://localhost:7777'
const ROOM = 'share-flow-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const TILE = 'shared-tile-' + Math.random().toString(36).slice(2, 6)

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }
function pass(msg) { console.log(`  [PASS] ${msg}`) }
function fail(msg) { console.log(`  [FAIL] ${msg}`); FAILED.push(msg) }
const FAILED = []

async function newBrowser() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newContext().then(c => c.newPage())
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

async function configure(page, { room, secret, relay }) {
  await page.evaluate((cfg) => {
    localStorage.setItem('hc:room', cfg.room)
    localStorage.setItem('hc:secret', cfg.secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([cfg.relay]))
  }, { room, secret, relay })
}

async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@hypercomb.social/Navigation')
      && window.ioc?.get?.('@hypercomb.social/InstallMonitor')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function buildPublisherTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command-line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 200))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 1500))

    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!history) return { ok: false, reason: 'no HistoryService' }
    const rootSig = await history.sign({ explorerSegments: () => [] })
    const layer = await history.currentLayerAt(rootSig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return { ok: names.includes(cellName), names, rootSig: rootSig?.slice(0, 12) }
  }, name)
}

async function clickAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
  }, label)
}

/** Wait until the adopter's swarm cache surfaces the given tile name with
 *  a valid layerSig — only then is the adopt click meaningful. Without
 *  this, the test races mesh propagation and the click fires before the
 *  peer visual has arrived. */
async function waitForPeerVisible(page, label, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate((cellLabel) => {
      const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      if (!swarm?.peerTilesAtCurrentSig) return false
      const tiles = swarm.peerTilesAtCurrentSig()
      const entry = tiles.find(t => t.name === cellLabel)
      if (!entry) return false
      const layerSig = String(entry.layerSig ?? '').trim().toLowerCase()
      return /^[a-f0-9]{64}$/.test(layerSig) ? { layerSig: layerSig.slice(0, 12) } : false
    }, label)
    if (found) return found
    await new Promise(r => setTimeout(r, 300))
  }
  return null
}

async function probeTree(page, paths) {
  return page.evaluate(async (paths) => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!history) return null
    const out = {}
    for (const path of paths) {
      const segs = path === '/' ? [] : path.split('/').filter(Boolean)
      const sig = await history.sign({ explorerSegments: () => segs })
      const layer = await history.currentLayerAt(sig)
      const names = []
      for (const cs of (layer?.children ?? [])) {
        try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
      }
      out[path] = names.sort()
    }
    return out
  }, paths)
}

async function getInstallMonitorState(page) {
  return page.evaluate(() => {
    const im = window.ioc?.get?.('@hypercomb.social/InstallMonitor')
    return im ? { state: im.state, adoptLabel: im.adoptLabel } : null
  })
}

async function probePortalOverlay(page) {
  return page.evaluate(() => {
    const overlayHost = document.querySelector('hc-portal-overlay')
    const iframe = document.querySelector('hc-portal-overlay iframe')
    const address = document.querySelector('hc-portal-overlay .portal-address .address-text')
    return {
      overlayMounted: !!overlayHost,
      iframeVisible: iframe ? getComputedStyle(iframe).display !== 'none' : false,
      iframeSrc: iframe?.getAttribute('src') ?? null,
      addressBreadcrumb: address?.textContent?.trim() ?? null,
    }
  })
}

async function main() {
  log('boot', `room=${ROOM}, secret=${SECRET.slice(0, 4)}…, tile=${TILE}`)
  log('boot', `publisher port=${PUBLISHER_PORT}, adopter port=${ADOPTER_PORT}, relay=${RELAY}`)
  log('boot', `model: sig-handoff-only (no commit, no fetch — just portal:open)`)

  // ── Phase 1: both join swarm ────────────────────────────────────────────
  log('phase 1', 'starting publisher')
  const pub = await newBrowser()
  await pub.page.goto(`http://localhost:${PUBLISHER_PORT}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(pub.page)
  await configure(pub.page, { room: ROOM, secret: SECRET, relay: RELAY })
  await pub.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(pub.page))) { fail('publisher did not reach ready'); return done() }
  pass('publisher ready')
  await new Promise(r => setTimeout(r, 1500))

  log('phase 1', 'starting adopter')
  const ado = await newBrowser()
  await ado.page.goto(`http://localhost:${ADOPTER_PORT}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(ado.page)
  await configure(ado.page, { room: ROOM, secret: SECRET, relay: RELAY })
  await ado.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(ado.page))) { fail('adopter did not reach ready'); return done() }
  pass('adopter ready')
  await new Promise(r => setTimeout(r, 2000))

  // ── Phase 2: publisher creates a tile ───────────────────────────────────
  log('phase 2', `publisher adds tile "${TILE}"`)
  const buildResult = await buildPublisherTile(pub.page, TILE)
  log('phase 2', 'build result:', buildResult)
  if (!buildResult?.ok) { fail(`publisher tile not added: ${buildResult?.reason ?? 'unknown'}`); return done() }
  pass(`publisher tree contains "${TILE}"`)

  // Wait for the peer's visual (with valid layerSig) to actually land in
  // the adopter's swarm cache. The mesh propagation isn't instant; without
  // this gate the test races the broadcast and the adopt click fires
  // before peerTilesAtCurrentSig has anything to find.
  log('phase 2.5', `waiting for adopter to see "${TILE}" via mesh`)
  const peerVisible = await waitForPeerVisible(ado.page, TILE, 15000)
  if (!peerVisible) {
    fail(`adopter never saw "${TILE}" in peerTilesAtCurrentSig within 15s`)
    return done()
  }
  pass(`adopter sees peer tile (layerSig=${peerVisible.layerSig}…)`)

  // ── Phase 3: adopter fires adopt ────────────────────────────────────────
  log('phase 3', `adopter clicks adopt on "${TILE}"`)
  const installBefore = await getInstallMonitorState(ado.page)
  log('phase 3', `install-monitor before adopt: ${installBefore?.state}`)
  await clickAdopt(ado.page, TILE)
  await new Promise(r => setTimeout(r, 600))   // brief settle

  // ── Phase 4: portal-overlay rendered with correct hash handoff ──────────
  log('phase 4', 'verifying portal-overlay iframe + hash handoff')
  const portal = await probePortalOverlay(ado.page)
  log('phase 4', 'portal state:', portal)
  if (!portal.overlayMounted) {
    fail('portal-overlay component not mounted in adopter shell')
  } else if (!portal.iframeVisible) {
    fail('portal-overlay iframe not visible after adopt click')
  } else {
    pass('portal-overlay iframe visible after adopt click')
    // src checks
    const src = portal.iframeSrc || ''
    if (!src.startsWith('http://localhost:2400') && !src.startsWith('https://diamondcoreprocessor.com')) {
      fail(`iframe src points at unexpected host: ${src}`)
    } else {
      pass(`iframe src points at canonical installer (${src.split('#')[0]})`)
    }
    if (!/[#&]branch=[a-f0-9]{64}/.test(src)) {
      fail(`iframe src missing #branch=<sig> handoff: ${src}`)
    } else {
      pass('iframe URL carries branch=<64-hex> handoff')
    }
    if (!/[#&]at=/.test(src)) {
      fail(`iframe src missing at=<path> handoff: ${src}`)
    } else {
      pass('iframe URL carries at=<path> handoff')
    }
  }

  // ── Phase 5: address breadcrumb shows host + branch + path ──────────────
  if (portal.addressBreadcrumb) {
    const br = portal.addressBreadcrumb
    if (/branch=[a-f0-9]{6}/.test(br)) {
      pass(`address breadcrumb shows branch fingerprint: "${br}"`)
    } else {
      fail(`address breadcrumb missing branch fingerprint: "${br}"`)
    }
  } else {
    fail('address breadcrumb element not found in portal-overlay')
  }

  // ── Phase 6: install-monitor stayed idle (no breadcrumb flash) ──────────
  // Under sig-handoff-only, the adopt:started/meta/done event chain is no
  // longer consumed by install-monitor — the portal opening IS the
  // feedback. The crumb should NOT have flipped to 'adopting'.
  const installAfter = await getInstallMonitorState(ado.page)
  log('phase 6', `install-monitor after adopt: ${installAfter?.state}`)
  if (installAfter?.state === 'idle') {
    pass('install-monitor stayed idle (no legacy breadcrumb flash)')
  } else {
    fail(`install-monitor unexpectedly went to '${installAfter?.state}' — listeners not fully retired?`)
  }

  // ── Phase 7: adopter's tree did NOT auto-fill ───────────────────────────
  // Under sig-handoff-only, the hive's adopt does not commit the tile to
  // the adopter's local tree. The installer is now responsible for that.
  // So the adopter's tree should NOT contain the publisher's tile after
  // the click; the tile only commits if the installer iframe completes
  // the adoption flow (which this test doesn't exercise — it stops at
  // the handoff).
  await new Promise(r => setTimeout(r, 2000))
  const tree = await probeTree(ado.page, ['/'])
  log('phase 7', 'adopter tree after handoff:', tree)
  if (tree?.['/']?.includes(TILE)) {
    fail(`adopter's tree should NOT auto-fill under sig-handoff model, but contains "${TILE}"`)
  } else {
    pass('adopter\'s tree did NOT auto-fill (handoff model — installer commits, not the hive)')
  }

  await pub.browser.close()
  await ado.browser.close()
  done()
}

function done() {
  console.log('\n========== SHARE-FLOW VERDICT ==========')
  if (FAILED.length === 0) {
    console.log('OVERALL: ✓ ALL HARD ASSERTIONS PASS')
  } else {
    console.log(`OVERALL: ✗ ${FAILED.length} FAILED`)
    for (const f of FAILED) console.log(`  - ${f}`)
  }
  console.log('========================================\n')
  process.exit(FAILED.length === 0 ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
