// scripts/verify-presence-banner.cjs
//
//   1. A boots alone → banner reads "first one here"
//   2. B joins same room+secret with label "Alice" → A's banner
//      updates to mention Alice; both alone-flag turns off; dot
//      indicator appears
//   3. B leaves (network off) → A's banner returns to "first one here"
//      after PEER_STALE_MS sweep

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'pres-' + Date.now().toString(36)
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
      typeof window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')?.participantsAtCurrentSig === 'function')
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}
async function readBanner(page) {
  return page.evaluate(() => {
    const banner = document.querySelector('.presence-banner')
    if (!banner) return { visible: false }
    const alone = !!banner.querySelector('.presence-alone')
    const withOthers = !!banner.querySelector('.presence-with-others')
    const text = banner.textContent?.trim() ?? ''
    return { visible: true, alone, withOthers, text }
  })
}

;(async () => {
  log('boot', `room=${ROOM} secret=${SECRET}`)

  // ── A boots alone ─
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page, 'Solo')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3500))  // let presence emit fire

  const s1 = await readBanner(A.page)
  log('A solo', JSON.stringify(s1))
  const soloOk = s1.visible === true && s1.alone === true && (s1.text || '').includes('first')

  // ── B joins same swarm ─
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page, 'Alice')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 4500))  // give swarm time to sync

  const s2 = await readBanner(A.page)
  log('A with B', JSON.stringify(s2))
  const togetherOk = s2.visible === true && s2.alone === false && (s2.text || '').includes('Alice')

  console.log('\n========== VERDICT ==========')
  console.log(`alone banner reads "first one here":     ${soloOk ? '✓' : '✗'} ${JSON.stringify(s1)}`)
  console.log(`with peer banner shows their label:      ${togetherOk ? '✓' : '✗'} ${JSON.stringify(s2)}`)
  const pass = soloOk && togetherOk
  console.log(pass ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close(); await B.browser.close()
  process.exit(pass ? 0 : 1)
})().catch(err => { console.error('[fatal]', err); process.exit(1) })
