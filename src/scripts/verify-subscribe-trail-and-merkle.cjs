// scripts/verify-subscribe-trail-and-merkle.cjs
//
// Two-part feature verification:
//
// PART 1 — "leaves behind their hive elements wherever they go"
//   A walks  /  → /topic1  → /topic1/sub  publishing distinct tiles
//   at each stop. B (subscriber, NOT following) stays at /.
//   Expectation: B's local hive at / accumulates the union of A's tiles.
//
// PART 2 — "signatures are streamed so you can add them"
//   A publishes a subtree at /topic1 with children [c1, c2, c3].
//   B receives the publish (which now includes child layer SIGS,
//   not just names). B can call swarm.requestSubtree(parentSig) to
//   pull the subtree via the content broker — even if A never
//   personally visited c1/c2/c3 to publish their contents.
//
// Run after a dev restart so the latest swarm.drone is loaded.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'trail-' + Date.now().toString(36)
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
    for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => null)
  })
}
async function configure(page, label) {
  await page.evaluate(({ room, secret, relay, lbl }) => {
    localStorage.setItem('hc:room', room); localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true'); localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
    if (lbl) localStorage.setItem('hc:user-label', lbl)
  }, { room: ROOM, secret: SECRET, relay: RELAY, lbl: label })
}
async function waitForReady(page) {
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() =>
      typeof window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo === 'function')
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}
async function addTile(page, name) {
  return page.evaluate(async (n) => {
    const i = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!i) return false
    i.focus(); i.value = n
    i.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
}
async function navTo(page, segs) {
  return page.evaluate((s) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s), segs)
}
async function getPubkey(page) {
  return page.evaluate(async () => (await window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()))
}
async function subscribeTo(page, pk) {
  return page.evaluate(async (pubkey) =>
    window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo?.(pubkey), pk)
}
async function ownChildrenAt(page, segs) {
  return page.evaluate(async (s) => {
    const h = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const sig = await h.sign({ explorerSegments: () => s })
    const layer = await h.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await h.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return names.sort()
  }, segs)
}
async function probeSubscribedTilesWithSigs(page) {
  return page.evaluate(() => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = s?.subscribedTiles?.() ?? []
    return tiles.map(t => ({ name: t.name, layerSig: t.layerSig ?? null }))
  })
}
async function tryRequestSubtree(page, parentSig) {
  return page.evaluate(async (sig) => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (typeof s?.requestSubtree !== 'function') return { supported: false }
    try {
      const got = await s.requestSubtree(sig)
      return { supported: true, adopted: got?.adopted ?? 0, failed: got?.failed ?? 0 }
    } catch (e) { return { supported: true, adopted: 0, failed: -1, error: String(e?.message ?? e) } }
  }, parentSig)
}

async function main() {
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.page)
  await configure(A.page, 'Trailmaker'); await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  // Build A's hive:  /  has [topic1]
  //                  /topic1 has [sub]
  //                  /topic1/sub has [deep]
  await addTile(A.page, 'topic1'); await new Promise(r => setTimeout(r, 1200))
  await navTo(A.page, ['topic1']); await new Promise(r => setTimeout(r, 1000))
  await addTile(A.page, 'sub'); await new Promise(r => setTimeout(r, 1200))
  await navTo(A.page, ['topic1', 'sub']); await new Promise(r => setTimeout(r, 1000))
  await addTile(A.page, 'deep'); await new Promise(r => setTimeout(r, 1500))

  // A walks back to root for the trail test, then to /topic1, then /topic1/sub
  // — each visit triggers a fresh channel publish.
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey?.slice(0,8)}, hive: / has topic1; /topic1 has sub; /topic1/sub has deep`)

  // ── B: subscribe-only, stays at / ─
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.page)
  await configure(B.page, 'Watcher'); await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2500))
  await subscribeTo(B.page, aPubkey)
  await new Promise(r => setTimeout(r, 2000))

  // PART 1 — leader walks the trail; subscriber should accumulate.
  log('A', 'navigating /  (publishes [topic1])')
  await navTo(A.page, []); await new Promise(r => setTimeout(r, 2500))
  // Capture topic1's layerSig BEFORE A moves on — once A leaves /,
  // the channel publish at A's next location replaces what B sees.
  const rootSnapshot = await probeSubscribedTilesWithSigs(B.page)
  const topic1Sig = rootSnapshot.find(t => t.name === 'topic1')?.layerSig ?? null
  log('B', `snapshot @A/=  ${JSON.stringify(rootSnapshot)}  → topic1.layerSig=${topic1Sig?.slice(0,8)}`)

  log('A', 'navigating /topic1 (publishes [sub])')
  await navTo(A.page, ['topic1']); await new Promise(r => setTimeout(r, 2500))
  log('A', 'navigating /topic1/sub (publishes [deep])')
  await navTo(A.page, ['topic1', 'sub']); await new Promise(r => setTimeout(r, 3000))

  const bRootChildren = await ownChildrenAt(B.page, [])
  log('B', `local children at /: ${JSON.stringify(bRootChildren)}`)
  const trailAccumulated =
    bRootChildren.includes('topic1') &&
    bRootChildren.includes('sub') &&
    bRootChildren.includes('deep')

  // PART 2 — sigs streamed in payload?
  const sigsStreamed = typeof topic1Sig === 'string' && topic1Sig.length === 64

  // PART 2b — merkle pull at a non-leaf sig.
  //
  // C joins fresh, subscribed to nobody. They take topic1Sig (which
  // B happens to know — in real life it would come from a peer event
  // or shared link) and call requestSubtree. The broker walks the
  // merkle tree, pulling sub and deep via A's OPFS. C ends up with
  // {topic1, sub, deep} structure at their current location WITHOUT
  // ever subscribing.
  log('C', 'launching fresh — will merkle-pull topic1Sig with NO subscribe')
  const C = await newBrowser()
  await C.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(C.page)
  await configure(C.page, 'Explorer'); await C.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(C.page))) { log('C', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3000))

  let merklePullResult = { supported: false, adopted: 0, failed: 0 }
  if (topic1Sig) {
    merklePullResult = await tryRequestSubtree(C.page, topic1Sig)
    await new Promise(r => setTimeout(r, 1500))
    log('C', `requestSubtree(${topic1Sig.slice(0,8)}): ${JSON.stringify(merklePullResult)}`)
  } else {
    log('C', 'no topic1Sig — skip merkle pull')
  }
  const cChildren = await ownChildrenAt(C.page, [])
  const cSubChildren = await ownChildrenAt(C.page, ['sub'])
  log('C', `local children at /: ${JSON.stringify(cChildren)}, at /sub: ${JSON.stringify(cSubChildren)}`)

  // C should have pulled `sub` (and `sub` should have pulled `deep`).
  const merkleWorked = cChildren.includes('sub') && cSubChildren.includes('deep')

  console.log('\n========== VERDICT ==========')
  console.log(`PART 1 — trail accumulates in subscriber's hive:   ${trailAccumulated ? '✓' : '✗'} (got ${JSON.stringify(bRootChildren)})`)
  console.log(`PART 2 — child layer sigs streamed in payload:     ${sigsStreamed ? '✓' : '✗'}`)
  console.log(`PART 2 — requestSubtree() supported:               ${merklePullResult.supported ? '✓' : '✗'}`)
  console.log(`PART 2 — C pulled subtree via merkle (no subscribe):${merkleWorked ? '✓' : '✗'} ${JSON.stringify(merklePullResult)} children: ${JSON.stringify(cChildren)}, /sub: ${JSON.stringify(cSubChildren)}`)
  const pass = trailAccumulated && sigsStreamed && merklePullResult.supported && merkleWorked
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ NEEDS WORK')
  console.log('=============================\n')

  await A.browser.close(); await B.browser.close(); await C.browser.close()
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
