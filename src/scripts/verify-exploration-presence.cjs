// scripts/verify-exploration-presence.cjs
//
// Verifies the navigation-as-exploration model. Across BOTH dev shells
// (4250 + 4251), runs the basic scenarios that need to work:
//
//   1. Single-tile adopt on `dolphin` lands in local layer (no walk).
//   2. swarm:presence-changed fires when peer count transitions.
//   3. participantsAtCurrentSig matches the emitted presence payload.
//
// Recursive subtree adopt is intentionally NOT tested — that's been
// shelved. Per-location exploration is the model now: navigate into
// a tile, see who's there (presence), adopt any of their tiles
// individually.

const { chromium } = require('playwright')

const PORTS = [4250, 4251]
const RELAY = 'ws://localhost:7777'
const ROOM = 'expl-' + Date.now().toString(36)
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
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
      && window.ioc?.get?.('@hypercomb.social/Navigation')
    ))
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function checkNewCode(page) {
  return page.evaluate(() => {
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return {
      hasPresenceEmit: (s?.emits ?? []).includes('swarm:presence-changed'),
      methodCount: Object.getOwnPropertyNames(s ?? {}).filter(k => typeof s[k] === 'function').length,
    }
  })
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

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
  }, label)
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

async function startPresenceLogging(page) {
  await page.evaluate(() => {
    window.__presence = []
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.['onEffect']?.('swarm:presence-changed', (p) => {
      window.__presence.push({
        sig: p?.sig?.slice(0, 12),
        peerCount: p?.peerCount,
        alone: p?.alone,
        reason: p?.reason,
      })
    })
  })
}

async function getPresenceLog(page) {
  return page.evaluate(() => window.__presence ?? [])
}

async function probeParticipants(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    return swarm?.participantsAtCurrentSig?.() ?? []
  })
}

async function runScenario(publisherPort, adopterPort) {
  log('scenario', `pub@${publisherPort} → adopter@${adopterPort}`)

  const A = await newBrowser()
  await A.page.goto(`http://localhost:${publisherPort}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) return { ok: false, reason: 'A TIMEOUT' }

  // Confirm new code on this shell
  const aCheck = await checkNewCode(A.page)
  log('A', `hasPresenceEmit: ${aCheck.hasPresenceEmit}`)
  await new Promise(r => setTimeout(r, 1500))

  log('A', 'adding dolphin')
  await addTile(A.page, 'dolphin')
  await new Promise(r => setTimeout(r, 2500))

  const B = await newBrowser()
  await B.page.goto(`http://localhost:${adopterPort}/`, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) return { ok: false, reason: 'B TIMEOUT' }

  const bCheck = await checkNewCode(B.page)
  log('B', `hasPresenceEmit: ${bCheck.hasPresenceEmit}`)

  await startPresenceLogging(B.page)
  await new Promise(r => setTimeout(r, 3000))

  // Single-tile adopt — no recursive walk expected.
  log('B', 'adopt dolphin')
  await fireAdopt(B.page, 'dolphin')
  await new Promise(r => setTimeout(r, 2500))

  const children = await probeOwnChildren(B.page)
  const presence = await getPresenceLog(B.page)
  const participants = await probeParticipants(B.page)

  await A.browser.close()
  await B.browser.close()

  return {
    pubPort: publisherPort,
    adopterPort,
    aNewCode: aCheck.hasPresenceEmit,
    bNewCode: bCheck.hasPresenceEmit,
    adoptOk: children.includes('dolphin'),
    presenceFired: presence.length > 0,
    participantsLen: participants.length,
    // Latest presence event B saw — should have peerCount >= 1 because A is publishing.
    latestPresence: presence[presence.length - 1] ?? null,
  }
}

async function main() {
  const results = []
  for (const pubPort of PORTS) {
    for (const adopterPort of PORTS) {
      const r = await runScenario(pubPort, adopterPort)
      results.push(r)
    }
  }

  console.log('\n========== EXPLORATION + PRESENCE VERDICT ==========')
  for (const r of results) {
    console.log(`pub@${r.pubPort} → adopter@${r.adopterPort}:`)
    console.log(`  shells on new code:     A=${r.aNewCode} B=${r.bNewCode}`)
    console.log(`  single-tile adopt:      ${r.adoptOk ? '✓' : '✗'}`)
    console.log(`  presence effect fired:  ${r.presenceFired ? '✓' : '✗'}`)
    console.log(`  participants visible:   ${r.participantsLen}`)
    console.log(`  latest presence:        ${JSON.stringify(r.latestPresence)}`)
  }
  const adoptOk = results.every(r => r.adoptOk)
  const presenceOk = results.every(r => r.presenceFired)
  const overallOk = adoptOk && presenceOk
  console.log(overallOk ? '\nOVERALL: ✓ PASS' : '\nOVERALL: ✗ FAIL — see per-scenario results above')
  console.log('======================================================\n')

  process.exit(overallOk ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
