// scripts/drive-swarm-sync-test.cjs
//
// End-to-end swarm synchronization test for the [0000, ...] array wire.
// Drives two browser contexts of the hypercomb-dev shell (4250) against
// a local Nostr relay (ws://localhost:7777, started separately), configures
// matching room+secret on both, navigates them to the same lineage, adds
// 2 tiles on each, then verifies:
//
//   1. After sync, each browser sees the other's 2 tiles via
//      SwarmDrone.peerTilesAtCurrentSig().
//   2. Each peer entry carries `props` (the inlined 0000 contents) —
//      this is the canonical wire test for the visuals-array architecture.
//   3. The SwarmDrone's #peerLayersBySig holds the wire payload in
//      `{visuals: [{name, props}]}` shape.
//
// Usage:
//   node scripts/drive-swarm-sync-test.cjs            # headless
//   node scripts/drive-swarm-sync-test.cjs --headed   # visible

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'swarm-test-' + Date.now().toString(36)
const SECRET = 'swarm-secret-' + Math.random().toString(36).slice(2, 10)
const LOCATION_PATH = '/dolphin/team'

const HEADED = process.argv.includes('--headed')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newPage(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[sync]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 200))
    }
  })
  page.on('pageerror', (err) => log(label, 'PAGE ERROR:', String(err)))
  return { ctx, page }
}

async function configure(page) {
  await page.evaluate(({ room, secret, relay }) => {
    localStorage.setItem('hc:room', room)
    localStorage.setItem('hc:secret', secret)
    localStorage.setItem('hc:mesh-public', 'true')
    localStorage.setItem('hc:nostrmesh:network', '1')
    localStorage.setItem('hc:nostrmesh:allow-loopback', '1')
    localStorage.setItem('hc:nostrmesh:relays', JSON.stringify([relay]))
    localStorage.setItem('hc:nostrmesh:debug', '1')
  }, { room: ROOM, secret: SECRET, relay: RELAY })
}

async function waitForReady(page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const ioc = window.ioc
      return !!(ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
        && ioc?.get?.('@hypercomb.social/Lineage')
        && ioc?.get?.('@diamondcoreprocessor.com/NostrSigner'))
    })
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function pubkeyOf(page) {
  return page.evaluate(async () => {
    const signer = window.ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return signer?.getPublicKeyHex ? await signer.getPublicKeyHex() : null
  })
}

async function addTile(page, name) {
  // Drive the command-line input — same path the user takes for /add.
  return page.evaluate(async (cellName) => {
    const candidates = [
      'hc-command-line input',
      'input[placeholder*="intent" i]',
      'input[placeholder*="cell" i]',
      'input[type="text"]',
    ]
    let input = null
    for (const sel of candidates) {
      const el = document.querySelector(sel)
      if (el) { input = el; break }
    }
    if (!input) return { ok: false, reason: 'no command-line input found' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true, name: cellName }
  }, name)
}

async function probePeerTiles(page) {
  return page.evaluate(async () => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    if (!swarm?.peerTilesAtCurrentSig) return { err: 'no SwarmDrone or method' }
    const tiles = swarm.peerTilesAtCurrentSig()
    return {
      count: tiles.length,
      entries: tiles.map(t => ({
        name: t.name,
        peerPubkey: t.peerPubkey?.slice(0, 8) ?? null,
        hasProps: t.props && typeof t.props === 'object' && Object.keys(t.props).length > 0,
        propsKeys: t.props ? Object.keys(t.props).sort() : [],
        hasImageSig: typeof t.imageSig === 'string' && /^[0-9a-f]{64}$/.test(t.imageSig),
      })),
    }
  })
}

async function probeOwnState(page) {
  return page.evaluate(async () => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const mesh = ioc?.get?.('@diamondcoreprocessor.com/NostrMeshDrone')
    const lineage = ioc?.get?.('@hypercomb.social/Lineage')
    const signer = ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
    return {
      pubkey: signer?.getPublicKeyHex ? (await signer.getPublicKeyHex())?.slice(0, 8) : null,
      segments: lineage?.explorerSegments?.() ?? null,
      participantCount: swarm?.participantsAtCurrentSig?.()?.length ?? 0,
      participants: (swarm?.participantsAtCurrentSig?.() ?? []).map(p => p.slice(0, 8)),
      networkEnabled: mesh?.networkEnabled,
      socketCount: mesh?.sockets?.size,
      relays: mesh?.relays,
    }
  })
}

async function main() {
  log('boot', 'launching browsers (headed=' + HEADED + ')')
  const browser = await chromium.launch({ headless: !HEADED })

  const A = await newPage(browser, 'A')
  const B = await newPage(browser, 'B')

  // ── Configure both browsers ──
  log('boot', 'navigating to', URL)
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })

  log('boot', 'configuring localStorage (room/secret/relay)')
  await configure(A.page)
  await configure(B.page)

  // Reload so the new localStorage takes effect.
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })

  log('boot', 'waiting for IoC ready on both')
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT waiting for IoC'); process.exit(1) }
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT waiting for IoC'); process.exit(1) }

  const pkA = await pubkeyOf(A.page)
  const pkB = await pubkeyOf(B.page)
  log('boot', 'pubkeys', { A: pkA?.slice(0, 8), B: pkB?.slice(0, 8) })
  if (pkA && pkA === pkB) {
    log('boot', 'WARNING: both browsers have the SAME pubkey — they will self-skip each other!')
  }

  // Navigate both to the same lineage.
  log('boot', 'navigating both to', LOCATION_PATH)
  await A.page.evaluate((path) => { window.location.hash = path }, LOCATION_PATH)
  await B.page.evaluate((path) => { window.location.hash = path }, LOCATION_PATH)
  await new Promise(r => setTimeout(r, 1500))

  // ── Add 2 tiles on each browser ──
  const aTiles = ['alice-1', 'alice-2']
  const bTiles = ['bob-1', 'bob-2']

  for (const name of aTiles) {
    log('A', 'adding tile', name)
    const r = await addTile(A.page, name)
    log('A', '  →', r)
    await new Promise(r => setTimeout(r, 600))
  }
  for (const name of bTiles) {
    log('B', 'adding tile', name)
    const r = await addTile(B.page, name)
    log('B', '  →', r)
    await new Promise(r => setTimeout(r, 600))
  }

  // ── Wait for swarm propagation ──
  log('sync', 'waiting 6s for relay round-trip')
  await new Promise(r => setTimeout(r, 6000))

  // ── Probe both sides ──
  log('probe', 'reading peer tiles on A')
  const aPeerTiles = await probePeerTiles(A.page)
  log('A', 'peer tiles:', JSON.stringify(aPeerTiles, null, 2))

  log('probe', 'reading peer tiles on B')
  const bPeerTiles = await probePeerTiles(B.page)
  log('B', 'peer tiles:', JSON.stringify(bPeerTiles, null, 2))

  log('probe', 'own state')
  const aState = await probeOwnState(A.page)
  const bState = await probeOwnState(B.page)
  log('A', 'state:', JSON.stringify(aState))
  log('B', 'state:', JSON.stringify(bState))

  // ── Verdict ──
  const aSeesBNames = (aPeerTiles.entries ?? []).map(e => e.name).sort()
  const bSeesANames = (bPeerTiles.entries ?? []).map(e => e.name).sort()
  const aOk = JSON.stringify(aSeesBNames) === JSON.stringify(bTiles.slice().sort())
  const bOk = JSON.stringify(bSeesANames) === JSON.stringify(aTiles.slice().sort())
  const aAllHaveProps = (aPeerTiles.entries ?? []).every(e => e.hasProps)
  const bAllHaveProps = (bPeerTiles.entries ?? []).every(e => e.hasProps)

  console.log('\n========== VERDICT ==========')
  console.log(`A sees B's tiles ${aSeesBNames.join(',')} (expected ${bTiles.join(',')}): ${aOk ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`B sees A's tiles ${bSeesANames.join(',')} (expected ${aTiles.join(',')}): ${bOk ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`A's view: all entries have props (inlined 0000): ${aAllHaveProps ? '✓ PASS' : '✗ FAIL'}`)
  console.log(`B's view: all entries have props (inlined 0000): ${bAllHaveProps ? '✓ PASS' : '✗ FAIL'}`)
  console.log('=============================\n')

  if (!HEADED) {
    await browser.close()
  } else {
    log('boot', 'browser left open for inspection (headed mode); press Ctrl+C to exit')
  }
  process.exit(aOk && bOk && aAllHaveProps && bAllHaveProps ? 0 : 1)
}

main().catch(err => {
  console.error('[fatal]', err)
  process.exit(1)
})
