// scripts/verify-interest-signal.cjs
//
// Verifies the interest signal across two peers.
//   - A (publisher) is at root with `dolphin` as a child tile.
//   - B navigates to root, sees dolphin as a peer tile.
//   - B calls swarm.publishInterest('dolphin').
//   - A, sitting at root with dolphin published, should:
//       * receive the kind-30203 event via existing subscription
//       * have B's pubkey in swarm.interestedAt('dolphin')
//       * receive a swarm:interest-changed effect
//   - B's own publish ALSO echoes back from the relay, so B should
//     also see themselves in interestedAt('dolphin') — the render layer
//     decides whether to hide self-interest.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'interest-' + Date.now().toString(36)
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
    const ok = await page.evaluate(() => {
      const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      return !!s && typeof s.publishInterest === 'function'
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

async function publishInterest(page, childName) {
  return page.evaluate(async (name) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    await swarm?.publishInterest?.(name)
  }, childName)
}

async function startInterestLog(page) {
  await page.evaluate(() => {
    window.__interest = []
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.['onEffect']?.('swarm:interest-changed', (p) => {
      window.__interest.push({
        sig: p?.sig?.slice(0, 12),
        childName: p?.childName,
        pubkey: p?.pubkey?.slice(0, 8),
        joined: p?.joined,
      })
    })
  })
}

async function probeInterestState(page, childName) {
  return page.evaluate((name) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const set = swarm?.interestedAt?.(name)
    const myPubkey = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return {
      interestedAt: [...(set ?? [])].map(p => p.slice(0, 8)).sort(),
      events: window.__interest ?? [],
    }
  }, childName)
}

async function getPubkey(page) {
  return page.evaluate(async () => {
    const signer = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    const pk = await signer?.getPublicKeyHex?.()
    return pk?.slice(0, 8)
  })
}

async function main() {
  log('A', 'launching publisher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT (publishInterest missing?)'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  await addTile(A.page, 'dolphin')
  await new Promise(r => setTimeout(r, 2000))
  await startInterestLog(A.page)
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey} published dolphin at root`)

  log('B', 'launching adopter')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 2500))
  await startInterestLog(B.page)
  const bPubkey = await getPubkey(B.page)
  log('B', `pubkey=${bPubkey}`)

  log('B', 'publishing interest in "dolphin"')
  await publishInterest(B.page, 'dolphin')

  // Allow round-trip
  await new Promise(r => setTimeout(r, 2000))

  const aState = await probeInterestState(A.page, 'dolphin')
  const bState = await probeInterestState(B.page, 'dolphin')

  log('A', 'state:', JSON.stringify(aState))
  log('B', 'state:', JSON.stringify(bState))

  // Verdict:
  //   A sees B as interested in dolphin
  //   A received at least one swarm:interest-changed event
  //   B sees themselves as interested (self-echo from relay)
  const aSeesB = aState.interestedAt.includes(bPubkey)
  const aEventFired = aState.events.some(e => e.childName === 'dolphin' && e.pubkey === bPubkey && e.joined)
  const bSelfEcho = bState.interestedAt.includes(bPubkey)

  console.log('\n========== VERDICT ==========')
  console.log(`A sees B in interestedAt('dolphin'):       ${aSeesB ? '✓' : '✗'}`)
  console.log(`A received swarm:interest-changed event:   ${aEventFired ? '✓' : '✗'}`)
  console.log(`B sees self-echo in interestedAt:          ${bSelfEcho ? '✓' : '✗'}`)
  const allOk = aSeesB && aEventFired
  console.log(allOk ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
