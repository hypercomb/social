// scripts/drive-late-joiner-test.cjs
//
// Late-joiner reproduction. Peer A publishes a tile and runs heartbeats
// for ~10s, THEN peer B joins fresh. Verifies B sees A's tile via the
// relay's replay of stored events (parameterized-replaceable kind 30200).
//
// This is the scenario the user reports: "mesh doesn't synchronize tiles
// when meeting at same location / secret" — specifically "late joiner
// sees nothing".

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'late-test-' + Date.now().toString(36)
const SECRET = 'late-secret-' + Math.random().toString(36).slice(2, 10)
const HEADED = process.argv.includes('--headed')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newPage(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[mesh]') || text.includes('[nostr') || text.includes('[trace]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 280))
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
    const dbg = swarm?.debug?.() ?? {}
    return { count: tiles.length, names: tiles.map(t => t.name).sort(), dbg }
  })
}

async function probeMeshDebug(page) {
  return page.evaluate(() => {
    const mesh = window.ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    return mesh?.getDebug?.() ?? null
  })
}

async function main() {
  log('boot', 'launching browsers (headed=' + HEADED + ')')
  const browser = await chromium.launch({ headless: !HEADED })

  // ── Phase 1: Peer A boots, publishes, heartbeats ──
  log('A', 'opening tab')
  const A = await newPage(browser, 'A')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }

  log('A', 'settling 1.5s after IoC ready')
  await new Promise(r => setTimeout(r, 1500))

  // Trace every effect bus emission relating to layer/cell commits so we
  // see what fires AFTER the addTile (and whether currentLayerAt updates).
  await A.page.evaluate(() => {
    const eb = window.ioc?.get?.('@hypercomb/EffectBus') ?? null
    const knownEvents = ['cell:added', 'cell:0000-changed', 'cell:removed', 'layer:committed', 'fs:changed', 'tile:saved']
    for (const ev of knownEvents) {
      try {
        eb?.on?.(ev, (p) => console.log(`[trace] ${ev}`, JSON.stringify(p).slice(0, 100)))
      } catch (e) { /* ignore */ }
    }
    // Probe lineage + layer state every 500ms.
    let pollCount = 0
    const poll = setInterval(async () => {
      pollCount++
      if (pollCount > 10) { clearInterval(poll); return }
      try {
        const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
        const segs = lineage?.explorerSegments?.() ?? '?'
        const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
        const rootSig = await history.sign({ explorerSegments: () => [] })
        const liveSig = await history.sign({ explorerSegments: () => segs })
        const rootLayer = await history.currentLayerAt(rootSig)
        const liveLayer = await history.currentLayerAt(liveSig)
        const rootChildren = Array.isArray(rootLayer?.children) ? rootLayer.children.length : 'null'
        const liveChildren = Array.isArray(liveLayer?.children) ? liveLayer.children.length : 'null'
        console.log(`[trace] poll${pollCount}: segs=${JSON.stringify(segs)} rootSig=${rootSig.slice(0,8)} rootChildren=${rootChildren} liveSig=${liveSig.slice(0,8)} liveChildren=${liveChildren}`)
        // Also check OPFS
        const store = window.ioc?.get?.('@hypercomb.social/Store')
        const root = store?.hypercombRoot
        if (root) {
          const dirNames = []
          for await (const [n, h] of root.entries()) {
            dirNames.push(n + (h.kind === 'directory' ? '/' : ''))
          }
          console.log(`[trace] poll${pollCount}: opfsRoot=${JSON.stringify(dirNames)}`)
        }
      } catch (e) { console.log(`[trace] poll${pollCount} err`, String(e).slice(0, 120)) }
    }, 500)
  })

  log('A', 'adding alpha')
  await addTile(A.page, 'alpha')
  await new Promise(r => setTimeout(r, 5000))
  log('A', 'after add:', JSON.stringify(await probePeerTiles(A.page)))

  // ── Phase 2: Peer B joins LATE (10s after A's first publish) ──
  log('boot', 'waiting 10s — A should heartbeat once during this window')
  await new Promise(r => setTimeout(r, 10000))

  log('B', 'opening tab — A is already publishing')
  const B = await newPage(browser, 'B')
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  log('B', 'IoC ready — polling for peer tile')

  // Poll B's peer count for up to 8 seconds.
  const t0 = Date.now()
  let elapsed = -1
  let lastProbe = null
  while (Date.now() - t0 < 8000) {
    lastProbe = await probePeerTiles(B.page)
    if (lastProbe.count >= 1) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 200))
  }

  log('B', 'final peer tiles:', JSON.stringify(lastProbe))
  log('B', 'mesh debug:', JSON.stringify(await probeMeshDebug(B.page))?.slice(0, 500))

  const ok = lastProbe && lastProbe.names.includes('alpha')
  console.log('\n========== VERDICT ==========')
  console.log(ok ? `Late joiner B sees A's tile: ✓ PASS (${elapsed}ms)` : `Late joiner B sees A's tile: ✗ FAIL (timeout 8000ms)`)
  console.log('=============================\n')

  if (!HEADED) await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
