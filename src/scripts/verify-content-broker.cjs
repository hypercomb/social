// scripts/verify-content-broker.cjs
//
// Verifies the ContentBrokerDrone end-to-end. Setup:
//   - A creates a resource locally (the bytes are in Store.putResource).
//   - B (fresh, no overlap) asks the broker for the same sig.
//   - B should receive the bytes via the broker, verify sha256, and
//     surface them via Store.getResource.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'broker-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newBrowser() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[content-broker]') || msg.type() === 'error') {
      log('console', `[${msg.type()}]`, text.slice(0, 220))
    }
  })
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
      && window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')
      && window.ioc?.get?.('@hypercomb.social/Store')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

/** Create a known resource on A and return its sig. */
async function seedResourceOnA(page) {
  return page.evaluate(async () => {
    const store = window.ioc?.get?.('@hypercomb.social/Store')
    // A bespoke-content blob — sha256 of "hello-broker-test-" + Math.random() will be unique to this run.
    const bytes = new TextEncoder().encode('hello-broker-test-' + Math.random().toString(36))
    const blob = new Blob([bytes])
    const sig = await store?.putResource?.(blob)
    return { sig, byteLength: bytes.byteLength }
  })
}

/** Ask B's broker for the sig and report what happens. */
async function fetchOnB(page, sig) {
  return page.evaluate(async (s) => {
    const broker = window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')
    if (!broker?.fetchBySig) return { error: 'no broker' }
    const t0 = performance.now()
    const bytes = await broker.fetchBySig(s, 'resource', 3000)
    const elapsedMs = performance.now() - t0
    return {
      receivedByteLength: bytes ? bytes.byteLength : null,
      elapsedMs: Math.round(elapsedMs),
      // After fetch, the bytes should also be in B's local store via putResource.
      localStoreHasIt: !!(await window.ioc?.get?.('@hypercomb.social/Store')?.getResource?.(s)),
    }
  }, sig)
}

async function main() {
  log('boot', 'launching A — seeds a resource locally')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  const seed = await seedResourceOnA(A.page)
  log('A', 'seeded resource:', JSON.stringify(seed))
  if (!seed?.sig) { log('A', 'no sig minted'); process.exit(1) }

  log('boot', 'launching B — separate browser, will fetch via broker')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  // Let the broker boot subscription settle.
  await new Promise(r => setTimeout(r, 1500))

  log('B', 'broker.fetchBySig(sig, "resource")')
  const result = await fetchOnB(B.page, seed.sig)
  log('B', 'result:', JSON.stringify(result))

  const ok = result?.receivedByteLength === seed.byteLength && result?.localStoreHasIt === true

  console.log('\n========== VERDICT ==========')
  console.log(`seeded byteLength:        ${seed.byteLength}`)
  console.log(`fetched byteLength:       ${result?.receivedByteLength}`)
  console.log(`local store hit after:    ${result?.localStoreHasIt}`)
  console.log(`elapsed:                  ${result?.elapsedMs}ms`)
  console.log(ok ? `OVERALL: ✓ PASS` : `OVERALL: ✗ FAIL`)
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
