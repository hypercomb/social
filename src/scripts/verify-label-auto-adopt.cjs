// scripts/verify-label-auto-adopt.cjs
//
// Verifies the label + follow ("auto-adopt") feature.
//   - A sets a label "Alice", publishes a tile.
//   - B receives the visuals event.
//   - B sees A's label via swarm.labelFor(aPubkey).
//   - Without auto-adopt: B's local layer stays empty (visuals only,
//     no import — the safety property the user wants).
//   - With auto-adopt on for A: B auto-imports new tiles from A.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'label-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const A_LABEL = 'Alice'

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

async function configure(page, label) {
  await page.evaluate(({ room, secret, relay, lbl }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
    if (lbl) localStorage.setItem('hc:user-label', lbl)
  }, { room: ROOM, secret: SECRET, relay: RELAY, lbl: label })
}

async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      return !!s && typeof s.labelFor === 'function' && typeof s.setAutoAdopt === 'function'
    })
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

async function getPubkey(page) {
  return page.evaluate(async () => {
    const signer = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return await signer?.getPublicKeyHex?.()
  })
}

async function probeLabelFor(page, pubkey) {
  return page.evaluate((pk) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return swarm?.labelFor?.(pk)
  }, pubkey)
}

async function setAutoAdopt(page, pubkey, on) {
  return page.evaluate(({ pk, val }) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.setAutoAdopt?.(pk, val)
  }, { pk: pubkey, val: on })
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
  log('A', 'launching publisher with label')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page, A_LABEL)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))
  await addTile(A.page, 'gardenia')
  await new Promise(r => setTimeout(r, 2000))
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey?.slice(0,8)} label=${A_LABEL}`)

  log('B', 'launching receiver (no label, no follow)')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page, null)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3500))

  // ── Test 1: Label propagation ──
  const labelSeen = await probeLabelFor(B.page, aPubkey)
  const localChildrenBefore = await probeOwnChildren(B.page)
  log('B', `labelFor(A)=${labelSeen}, local children: ${JSON.stringify(localChildrenBefore)}`)

  // ── Test 2: No auto-adopt → visuals only, no import ──
  const labelOk = labelSeen === A_LABEL
  const noAutoImport = !localChildrenBefore.includes('gardenia')

  // ── Test 3: Enable auto-adopt → B imports A's tiles ──
  log('B', `enabling auto-adopt for A`)
  await setAutoAdopt(B.page, aPubkey, true)

  // Need to trigger A to re-publish or wait for heartbeat.
  // Quickest path: have A add another tile.
  await addTile(A.page, 'rose')
  await new Promise(r => setTimeout(r, 3000))

  const localChildrenAfter = await probeOwnChildren(B.page)
  log('B', `after follow + A added rose: local children: ${JSON.stringify(localChildrenAfter)}`)

  // Auto-adopt should have queued BOTH gardenia (existing) and rose
  // (new) since the re-publish from A carries both visuals and our
  // current layer didn't have either. swarm-adopt is idempotent on
  // duplicate writes (same content sig → same commit).
  const autoAdoptedRose = localChildrenAfter.includes('rose')

  console.log('\n========== VERDICT ==========')
  console.log(`B sees A's label "${A_LABEL}":            ${labelOk ? '✓' : '✗'}`)
  console.log(`No import without auto-adopt:           ${noAutoImport ? '✓' : '✗'}`)
  console.log(`After follow + new publish: imported:   ${autoAdoptedRose ? '✓' : '✗'}`)
  const ok = labelOk && noAutoImport && autoAdoptedRose
  console.log(ok ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
