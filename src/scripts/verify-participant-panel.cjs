// scripts/verify-participant-panel.cjs
//
// Exercises the inline participant panel under the presence banner.
//
//   1. A boots, B joins as "Alice"
//   2. A clicks the banner → participant panel expands; one row, label "Alice"
//   3. A clicks the subscribe icon on Alice's row →
//      swarm.subscribedTo() == B.pubkey; row gains .active class
//   4. A clicks the follow icon on Alice's row →
//      swarm.following() == B.pubkey; follow row gains .active
//   5. A clicks subscribe icon again → unsubscribes
//      (swarm.subscribedTo() == '', row loses .active)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'panel-' + Date.now().toString(36)
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
  return page.evaluate(({ room, secret, relay, lbl }) => {
    localStorage.setItem('hc:room', room); localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true'); localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
    if (lbl) localStorage.setItem('hc:user-label', lbl)
  }, { room: ROOM, secret: SECRET, relay: RELAY, lbl: label })
}
async function waitReady(page) {
  for (let i = 0; i < 100; i++) {
    const ok = await page.evaluate(() =>
      typeof window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo === 'function' &&
      typeof window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.follow === 'function')
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}
async function clickBanner(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.presence-banner')
    if (!btn) return false
    btn.click()
    return true
  })
}
async function readPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.participant-panel')
    if (!panel) return { expanded: false }
    const rows = Array.from(panel.querySelectorAll('.participant-row')).map(r => ({
      label: r.querySelector('.participant-label')?.textContent?.trim() ?? '',
      subscribeActive: !!r.querySelector('.subscribe-toggle.active'),
      followActive: !!r.querySelector('.follow-toggle.active'),
    }))
    return { expanded: true, rows }
  })
}
async function clickRowToggle(page, which) {
  // which: 'subscribe' or 'follow'
  return page.evaluate((sel) => {
    const btn = document.querySelector(`.participant-row .${sel}-toggle`)
    if (!btn) return false
    btn.click()
    return true
  }, which)
}
async function getPubkey(page) {
  return page.evaluate(async () => (await window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()))
}
async function probeSwarmTargets(page) {
  return page.evaluate(() => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return { subscribedTo: s?.subscribedTo?.() ?? '', following: s?.following?.() ?? '' }
  })
}

;(async () => {
  log('A', 'launching')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page); await configure(A.page, 'Host')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }

  log('B', 'launching')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page); await configure(B.page, 'Alice')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  const bPubkey = await getPubkey(B.page)
  log('B', `pubkey=${bPubkey?.slice(0,8)}`)
  await new Promise(r => setTimeout(r, 5000))

  // 1 — banner expanded reveals participant panel with Alice's label
  await clickBanner(A.page)
  await new Promise(r => setTimeout(r, 400))
  const p1 = await readPanel(A.page)
  log('panel after open', JSON.stringify(p1))
  const panelOpens = p1.expanded === true && p1.rows?.length === 1 && p1.rows[0].label === 'Alice'

  // 2 — subscribe toggle flips swarm.subscribedTo + .active class
  await clickRowToggle(A.page, 'subscribe')
  await new Promise(r => setTimeout(r, 800))
  const t1 = await probeSwarmTargets(A.page)
  const p2 = await readPanel(A.page)
  log('after subscribe', JSON.stringify({ targets: t1, panel: p2 }))
  const subscribeFlipped =
    t1.subscribedTo === bPubkey &&
    p2.rows?.[0]?.subscribeActive === true

  // 3 — follow toggle (orthogonal to subscribe)
  await clickRowToggle(A.page, 'follow')
  await new Promise(r => setTimeout(r, 800))
  const t2 = await probeSwarmTargets(A.page)
  const p3 = await readPanel(A.page)
  log('after follow', JSON.stringify({ targets: t2, panel: p3 }))
  const followFlipped =
    t2.following === bPubkey &&
    p3.rows?.[0]?.followActive === true &&
    p3.rows?.[0]?.subscribeActive === true  // still subscribed

  // 4 — subscribe toggle again unsubscribes
  await clickRowToggle(A.page, 'subscribe')
  await new Promise(r => setTimeout(r, 800))
  const t3 = await probeSwarmTargets(A.page)
  const p4 = await readPanel(A.page)
  log('after unsubscribe', JSON.stringify({ targets: t3, panel: p4 }))
  const unsubscribed =
    t3.subscribedTo === '' &&
    p4.rows?.[0]?.subscribeActive === false &&
    p4.rows?.[0]?.followActive === true  // follow still active

  console.log('\n========== VERDICT ==========')
  console.log(`panel opens with Alice row:           ${panelOpens ? '✓' : '✗'}`)
  console.log(`subscribe toggle binds swarm + class: ${subscribeFlipped ? '✓' : '✗'}`)
  console.log(`follow toggle orthogonal to subscribe:${followFlipped ? '✓' : '✗'}`)
  console.log(`re-click subscribe unsubscribes:      ${unsubscribed ? '✓' : '✗'}`)
  const pass = panelOpens && subscribeFlipped && followFlipped && unsubscribed
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close(); await B.browser.close()
  process.exit(pass ? 0 : 1)
})().catch(err => { console.error('[fatal]', err); process.exit(1) })
