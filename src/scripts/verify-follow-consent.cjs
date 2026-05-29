// scripts/verify-follow-consent.cjs
//
// Verifies the simplified follow model:
//   - Follow == auto-adopt: setFollowing(pubkey) subscribes to the
//     leader's personal channel AND queues adoption of their tiles.
//   - The leader receives a swarm:follow-request-received notification
//     when a participant follows them — the consent surface for an
//     "Accept / No thanks" UI.
//   - Leader's children appear in follower's swarm.followedTiles()
//     wherever the leader is (no navigation sync).

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'follow-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const A_LABEL = 'Teacher'
const B_LABEL = 'Student'

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
      return !!s
        && typeof s.setFollowing === 'function'
        && typeof s.followedTiles === 'function'
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

async function startRequestLogging(page) {
  return page.evaluate(() => {
    window.__followReqs = []
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.['onEffect']?.('swarm:follow-request-received', (p) => {
      window.__followReqs.push({
        requesterPubkey: p?.requesterPubkey?.slice(0, 8),
        requesterLabel: p?.requesterLabel,
      })
    })
  })
}

async function setFollow(page, pubkey) {
  return page.evaluate(async (pk) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    await swarm?.setFollowing?.(pk)
  }, pubkey)
}

async function probeFollowedTiles(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return (swarm?.followedTiles?.() ?? []).map(t => t.name).sort()
  })
}

async function probeRequests(page) {
  return page.evaluate(() => window.__followReqs ?? [])
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
  log('A', 'launching leader/teacher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page, A_LABEL)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  await addTile(A.page, 'lesson1')
  await new Promise(r => setTimeout(r, 2000))
  await startRequestLogging(A.page)
  const aPubkey = await getPubkey(A.page)
  log('A', `pubkey=${aPubkey?.slice(0,8)} published lesson1`)

  log('B', 'launching follower/student')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page, B_LABEL)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 3500))
  const bPubkey = await getPubkey(B.page)
  log('B', `pubkey=${bPubkey?.slice(0,8)}`)

  log('B', `following ${aPubkey?.slice(0,8)}`)
  await setFollow(B.page, aPubkey)

  // Allow round-trip: B's follow request → A; A's personal channel publish → B.
  await new Promise(r => setTimeout(r, 4000))

  // Trigger A to refresh their personal channel by adding another tile
  // (so the publish happens AFTER B subscribed).
  log('A', 'adding lesson2 — should appear in B.followedTiles')
  await addTile(A.page, 'lesson2')
  await new Promise(r => setTimeout(r, 3500))

  const aRequests = await probeRequests(A.page)
  const bFollowed = await probeFollowedTiles(B.page)
  const bLocalChildren = await probeOwnChildren(B.page)

  log('A', `received follow requests: ${JSON.stringify(aRequests)}`)
  log('B', `followedTiles(): ${JSON.stringify(bFollowed)}`)
  log('B', `local children (auto-adopt): ${JSON.stringify(bLocalChildren)}`)

  const consentNotice = aRequests.some(r => r.requesterPubkey === bPubkey?.slice(0, 8))
  const tilesVisible = bFollowed.includes('lesson1') || bFollowed.includes('lesson2')
  const autoAdopted = bLocalChildren.includes('lesson1') || bLocalChildren.includes('lesson2')

  console.log('\n========== VERDICT ==========')
  console.log(`A received follow request notification:  ${consentNotice ? '✓' : '✗'} ${JSON.stringify(aRequests)}`)
  console.log(`B sees A's tiles via followedTiles:       ${tilesVisible ? '✓' : '✗'} ${JSON.stringify(bFollowed)}`)
  console.log(`B auto-adopted A's tiles (follow=auto):   ${autoAdopted ? '✓' : '✗'} ${JSON.stringify(bLocalChildren)}`)
  const ok = consentNotice && tilesVisible && autoAdopted
  console.log(ok ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
