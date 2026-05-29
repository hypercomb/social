// scripts/drive-modal-flow-test.cjs
//
// Models the actual user flow: open the app fresh, THEN set credentials
// via the same store-write path the mesh modal uses (RoomStore.set +
// SecretStore.set + localStorage write + mesh:public-changed effect).
// No reload after credential change. Tests whether the post-boot
// credential write reliably triggers swarm subscribe+publish.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'modal-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const HEADED = process.argv.includes('--headed')
const NAMES = ['coaching', 'operations', 'community']

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser(label) {
  const browser = await chromium.launch({ headless: !HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[mesh]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 300))
    }
  })
  return { browser, ctx, page }
}

async function waitForReady(page, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@hypercomb.social/RoomStore')
      && window.ioc?.get?.('@hypercomb.social/SecretStore')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

/** Set credentials the way the mesh modal does — via the store APIs, NOT
 *  by writing localStorage directly. */
async function setCredsViaModal(page, room, secret, relay) {
  return page.evaluate(({ r, s, relay: rl }) => {
    const ioc = window.ioc
    const roomStore = ioc?.get?.('@hypercomb.social/RoomStore')
    const secretStore = ioc?.get?.('@hypercomb.social/SecretStore')
    // Set relay too so we hit the loopback relay
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([rl]))
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:debug', '1')
    roomStore?.set?.(r)
    secretStore?.set?.(s)
    return {
      ok: true,
      roomNow: roomStore?.value ?? null,
      secretNow: secretStore?.value ?? null,
    }
  }, { r: room, s: secret, relay })
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
    return { count: tiles.length, names: tiles.map(t => t.name).sort() }
  })
}

async function main() {
  log('boot', 'PHASE 1: A fresh, set creds via modal, add tiles')
  const A = await newBrowser('A')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1000))

  log('A', 'setting creds via store:', JSON.stringify(await setCredsViaModal(A.page, ROOM, SECRET, RELAY)))
  await new Promise(r => setTimeout(r, 1500))

  for (const n of NAMES) {
    await addTile(A.page, n)
    await new Promise(r => setTimeout(r, 600))
  }
  await new Promise(r => setTimeout(r, 3000))

  log('boot', 'PHASE 2: B fresh, set creds via modal AFTER load (no reload)')
  await new Promise(r => setTimeout(r, 3000))

  const B = await newBrowser('B')
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1000))

  log('B', 'setting creds via store:', JSON.stringify(await setCredsViaModal(B.page, ROOM, SECRET, RELAY)))

  log('B', 'polling for peer tiles up to 10s')
  const t0 = Date.now()
  let elapsed = -1
  let last = null
  while (Date.now() - t0 < 10000) {
    last = await probePeerTiles(B.page)
    if (last.count >= NAMES.length) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 250))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  log('B', 'final:', JSON.stringify(last))

  const expected = NAMES.slice().sort()
  const actual = (last?.names ?? []).sort()
  const ok = JSON.stringify(expected) === JSON.stringify(actual)
  console.log('\n========== VERDICT ==========')
  console.log(`Expected: ${JSON.stringify(expected)}`)
  console.log(`Actual:   ${JSON.stringify(actual)}`)
  console.log(ok ? `Modal-flow late joiner: ✓ PASS (${elapsed}ms)` : `Modal-flow late joiner: ✗ FAIL (${last?.count ?? 0}/${NAMES.length})`)
  console.log('=============================\n')

  if (!HEADED) {
    await A.browser.close()
    await B.browser.close()
  }
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
