// scripts/verify-subscribe-consent-toast.cjs
//
// End-to-end consent flow:
//   1. B subscribes to A → kind-30205 request reaches A
//   2. A's SubscribeConsentDrone surfaces a sticky toast with two
//      Material combo buttons: Accept (primary) / No thanks (secondary)
//   3. Clicking Accept → swarm.acceptSubscribeRequest writes B's
//      pubkey into hc:subscribe-allowed; toast dismisses
//   4. Reload + B subscribes again — A's consent drone sees the
//      pubkey is pre-approved and surfaces an INFO toast (no buttons)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'consent-' + Date.now().toString(36)
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
async function waitForReady(page, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      return !!s && typeof s.subscribeTo === 'function' && typeof s.acceptSubscribeRequest === 'function'
    })
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}
async function getPubkey(page) {
  return page.evaluate(async () => (await window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')?.getPublicKeyHex?.()))
}
async function subscribeTo(page, pk) {
  return page.evaluate(async (pubkey) => {
    await window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo?.(pubkey)
  }, pk)
}
async function readToastState(page) {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.toast-item'))
    return items.map(it => ({
      title: it.querySelector('.toast-title')?.textContent?.trim() ?? '',
      message: it.querySelector('.toast-message')?.textContent?.trim() ?? '',
      type: it.getAttribute('data-type'),
      comboCount: it.querySelectorAll('.toast-combo-btn').length,
      primaryLabel: it.querySelector('.toast-combo-btn.primary')?.textContent?.trim() ?? null,
      secondaryLabel: it.querySelector('.toast-combo-btn.secondary')?.textContent?.trim() ?? null,
    }))
  })
}
async function clickToastPrimary(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.toast-item .toast-combo-btn.primary')
    if (!btn) return false
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  })
}
async function probeAllowedList(page) {
  return page.evaluate(() => localStorage.getItem('hc:subscribe-allowed') ?? '')
}

async function main() {
  log('A', 'launching leader')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page, 'Leader')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey?.slice(0,8)}`)

  log('B', 'launching follower')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page, 'Alice')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2500))
  const bPubkey = await getPubkey(B.page)
  log('B', `pubkey=${bPubkey?.slice(0,8)}`)

  log('B', `subscribing to A (${aPubkey?.slice(0,8)})`)
  await subscribeTo(B.page, aPubkey)
  await new Promise(r => setTimeout(r, 3000))

  // Step 1 — A's consent toast appears with two combo buttons
  const t1 = await readToastState(A.page)
  log('A', `toast state after B subscribed: ${JSON.stringify(t1)}`)
  const promptShown =
    t1.length >= 1 &&
    t1[0].comboCount === 2 &&
    t1[0].primaryLabel === 'Accept' &&
    t1[0].secondaryLabel === 'No thanks' &&
    (t1[0].message || '').includes('Alice')

  // Step 2 — A clicks Accept, B's pubkey lands in hc:subscribe-allowed
  await clickToastPrimary(A.page)
  await new Promise(r => setTimeout(r, 1500))
  const allowed = await probeAllowedList(A.page)
  log('A', `hc:subscribe-allowed after Accept: "${allowed}"`)
  const accepted = allowed.toLowerCase().includes((bPubkey ?? '').toLowerCase())

  // Step 3 — B re-subscribes (simulates a return visit). A's drone
  // should see the pre-approved tag and show the INFO variant (no
  // combo buttons).
  await new Promise(r => setTimeout(r, 1500))
  // Force B to re-issue the subscribe-request publish: toggle
  // subscribed-to off then back on. (subscribeTo('') closes the sub.)
  await B.page.evaluate(async () => {
    await window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.subscribeTo?.('')
  })
  await new Promise(r => setTimeout(r, 1000))
  await subscribeTo(B.page, aPubkey)
  await new Promise(r => setTimeout(r, 3000))

  const t2 = await readToastState(A.page)
  log('A', `toast state after re-subscribe: ${JSON.stringify(t2)}`)
  // The new toast should be info-only (0 combo buttons) and mention
  // the requester. Tolerant of any prior toast still lingering.
  const infoOnly = t2.some(t => t.comboCount === 0 && (t.message ?? '').includes('Alice'))

  console.log('\n========== VERDICT ==========')
  console.log(`Accept / No thanks combo shown:                  ${promptShown ? '✓' : '✗'}`)
  console.log(`Accept click recorded pubkey in allowed list:    ${accepted ? '✓' : '✗'}`)
  console.log(`Pre-approved re-subscribe shows INFO only:       ${infoOnly ? '✓' : '✗'}`)
  const pass = promptShown && accepted && infoOnly
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close(); await B.browser.close()
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
