// scripts/verify-subscribe-and-follow.cjs
//
// Verifies the two now-independent concepts:
//   SUBSCRIBE = data flow (their tiles available + auto-adopt + consent)
//   FOLLOW    = navigation sync (you go where they go; local choice)
//
// Three pages:
//   - A (publisher/teacher)
//   - B (subscriber — sees A's tiles, doesn't move)
//   - C (follower — moves to wherever A is, doesn't auto-adopt)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'sf-' + Date.now().toString(36)
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
    const ok = await page.evaluate(() => {
      const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      return !!s && typeof s.subscribeTo === 'function' && typeof s.follow === 'function'
    })
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
  return page.evaluate((s) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    nav?.go?.(s)
  }, segs)
}
async function getPubkey(page) {
  return page.evaluate(async () => (await window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()))
}
async function subscribeTo(page, pubkey) {
  return page.evaluate(async (pk) => {
    await window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo?.(pk)
  }, pubkey)
}
async function follow(page, pubkey) {
  return page.evaluate(async (pk) => {
    await window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.follow?.(pk)
  }, pubkey)
}
async function probeOwnChildren(page) {
  return page.evaluate(async () => {
    const l = window.ioc?.get?.('@hypercomb.social/Lineage')
    const h = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const segs = l?.explorerSegments?.() ?? []
    const sig = await h.sign({ explorerSegments: () => segs })
    const layer = await h.currentLayerAt(sig)
    const names = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await h.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
    }
    return names.sort()
  })
}
async function probeSubscribedTiles(page) {
  return page.evaluate(() => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return (s?.subscribedTiles?.() ?? []).map(t => t.name).sort()
  })
}
async function probeSegments(page) {
  return page.evaluate(() => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    return nav?.segmentsRaw?.() ?? []
  })
}

async function main() {
  log('boot', 'launching A (publisher)')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(A.page)
  await configure(A.page, 'Teacher'); await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  await addTile(A.page, 'topic1')
  await new Promise(r => setTimeout(r, 1500))
  await navTo(A.page, ['topic1']); await new Promise(r => setTimeout(r, 1200))
  await addTile(A.page, 'subtopic')
  await new Promise(r => setTimeout(r, 1500))
  // A stays at /topic1
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey?.slice(0,8)} at /topic1 (children: subtopic)`)

  // ── B: subscriber only ─
  log('boot', 'launching B (subscribe only)')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(B.page)
  await configure(B.page, 'Student-B'); await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2500))
  await subscribeTo(B.page, aPubkey)

  // ── C: follower only ─
  log('boot', 'launching C (follow only)')
  const C = await newBrowser()
  await C.page.goto(URL, { waitUntil: 'domcontentloaded' }); await clearOpfs(C.page)
  await configure(C.page, 'Student-C'); await C.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(C.page))) { log('C', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2500))
  await follow(C.page, aPubkey)

  // Trigger A to navigate again so presence/channel events fire after both B+C set up.
  await new Promise(r => setTimeout(r, 1500))
  await navTo(A.page, ['topic1'])  // re-publish presence at same location
  await new Promise(r => setTimeout(r, 1500))
  await addTile(A.page, 'subtopic2')
  await new Promise(r => setTimeout(r, 3000))

  const bSubscribed = await probeSubscribedTiles(B.page)
  const bLocal = await probeOwnChildren(B.page)
  const bSegs = await probeSegments(B.page)

  const cSegs = await probeSegments(C.page)
  const cLocal = await probeOwnChildren(C.page)

  log('B', `subscribed tiles: ${JSON.stringify(bSubscribed)}, local: ${JSON.stringify(bLocal)}, at segments: ${JSON.stringify(bSegs)}`)
  log('C', `at segments: ${JSON.stringify(cSegs)}, local: ${JSON.stringify(cLocal)}`)

  // Verdict:
  //   B (subscribe only): sees A's tiles via subscribedTiles + auto-adopted locally, DID NOT navigate
  //   C (follow only): navigated to /topic1, did NOT auto-adopt
  const bSawTiles = bSubscribed.length > 0
  const bAutoAdopted = bLocal.length > 0
  const bStayedHome = bSegs.length === 0
  const cFollowed = cSegs.length === 1 && cSegs[0] === 'topic1'
  const cDidntAdopt = cLocal.length === 0

  console.log('\n========== VERDICT ==========')
  console.log(`B (subscribe): sees A's tiles            ${bSawTiles ? '✓' : '✗'} ${JSON.stringify(bSubscribed)}`)
  console.log(`B (subscribe): auto-adopted              ${bAutoAdopted ? '✓' : '✗'} ${JSON.stringify(bLocal)}`)
  console.log(`B (subscribe): did NOT navigate          ${bStayedHome ? '✓' : '✗'} ${JSON.stringify(bSegs)}`)
  console.log(`C (follow):    navigated to /topic1      ${cFollowed ? '✓' : '✗'} ${JSON.stringify(cSegs)}`)
  console.log(`C (follow):    did NOT auto-adopt        ${cDidntAdopt ? '✓' : '✗'} ${JSON.stringify(cLocal)}`)
  const ok = bSawTiles && bAutoAdopted && bStayedHome && cFollowed && cDidntAdopt
  console.log(ok ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close(); await B.browser.close(); await C.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
