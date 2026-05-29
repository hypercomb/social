// scripts/verify-adopt-fetches-resources.cjs
//
// Verifies that single-tile adopt pulls the tile's resources via the
// content broker. Setup:
//   - A puts a resource blob in Store, gets its sig.
//   - A creates a tile with imageSig pointing at that sig, publishes.
//   - B receives the visuals (but does NOT auto-pull the resource —
//     it's the new safety property).
//   - B fires adopt for the tile.
//   - B's swarm-adopt drone iterates the props, finds the sig, and
//     calls broker.fetchBySig — A's broker responds with the bytes,
//     B writes them to Store, the resource is now locally available.
//
// Pass condition: B has the resource bytes in Store after adopt.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'adoptres-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

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
      && window.ioc?.get?.('@diamondcoreprocessor.com/SwarmAdoptDrone')
      && window.ioc?.get?.('@hypercomb.social/Store')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function hasBroker(page) {
  return page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone'))
}

/** Seed a resource on A and create a peer-style tile entry that
 *  references it via small.image. Returns the sig so the test can
 *  check whether B fetches it after adopt. */
async function seedResourceAndTile(page) {
  return page.evaluate(async () => {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    const bytes = new TextEncoder().encode('adopt-fetches-resources-' + Math.random())
    const blob = new Blob([bytes])
    const sig = await store?.putResource?.(blob)
    // Create a local tile that references this sig — same shape the
    // publisher would have if they'd attached an image. Bypass the
    // editor (Playwright text input) and write the properties directly.
    const editor = window.ioc?.get?.('@diamondcoreprocessor.com/TileEditorService')
    // Simpler: write the tile via the command-line, then patch props.
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return { sig, ok: false, reason: 'no input' }
    input.focus(); input.value = 'painted'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await new Promise(r => setTimeout(r, 800))
    // Now patch properties to reference the sig.
    const { writeTilePropertiesAt } = await import('/@fs/' + window.location.pathname.replace(/^\//, '').replace(/[^/]+$/, '') + 'hypercomb-essentials/src/diamondcoreprocessor.com/editor/tile-properties.ts').catch(() => ({}))
    if (writeTilePropertiesAt) {
      await writeTilePropertiesAt([], 'painted', { small: { image: sig } })
    }
    return { sig, ok: true }
  })
}

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
  }, label)
}

async function hasResource(page, sig) {
  return page.evaluate(async (s) => {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    const blob = await store?.getResource?.(s)
    return !!blob
  }, sig)
}

async function probeOwnChildren(page) {
  return page.evaluate(async () => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const segs = lineage?.explorerSegments?.() ?? []
    const sig = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return names.sort()
  })
}

async function main() {
  log('A', 'launching publisher with resource-bearing tile')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  const seed = await seedResourceAndTile(A.page)
  log('A', 'seeded:', JSON.stringify({ sig: seed?.sig?.slice(0, 12), ok: seed?.ok }))
  if (!seed?.sig) { log('A', 'no sig'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3000))

  log('B', 'launching adopter')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3500))

  // Sanity: B should NOT have the resource yet (auto-pull is disabled).
  const beforeAdopt = await hasResource(B.page, seed.sig)
  log('B', `before adopt — has resource? ${beforeAdopt} (expected: false)`)

  log('B', 'firing adopt for "painted"')
  await fireAdopt(B.page, 'painted')

  // Poll for resource to land via broker.
  const t0 = Date.now()
  let after = false
  while (Date.now() - t0 < 8000) {
    after = await hasResource(B.page, seed.sig)
    if (after) break
    await new Promise(r => setTimeout(r, 200))
  }
  const elapsed = Date.now() - t0

  const children = await probeOwnChildren(B.page)
  log('B', `after adopt — has resource? ${after} (${elapsed}ms)`)
  log('B', `local children after adopt: ${JSON.stringify(children)}`)

  const tileLanded = children.includes('painted')
  const resourceArrived = after === true
  const noPrematureFetch = beforeAdopt === false

  const brokerOnA = await hasBroker(A.page)
  const brokerOnB = await hasBroker(B.page)
  const brokerReq = brokerOnA && brokerOnB

  console.log('\n========== VERDICT ==========')
  console.log(`browse-only: no auto-fetch:       ${noPrematureFetch ? '✓' : '✗'}`)
  console.log(`adopt commits tile:               ${tileLanded ? '✓' : '✗'}`)
  console.log(`broker drone loaded both sides:   ${brokerReq ? '✓' : '✗'} (A=${brokerOnA} B=${brokerOnB})`)
  if (brokerReq) {
    console.log(`adopt fetches resource via broker: ${resourceArrived ? '✓' : '✗'} (${elapsed}ms)`)
  } else {
    console.log(`adopt fetches resource via broker: SKIPPED (dev shell restart required to load broker drone)`)
  }
  const requiredOk = noPrematureFetch && tileLanded
  const fullOk = requiredOk && brokerReq && resourceArrived
  console.log(fullOk ? 'OVERALL: ✓ FULL PASS' : requiredOk ? 'OVERALL: PARTIAL — broker piece pending dev shell restart' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  const ok = fullOk

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
