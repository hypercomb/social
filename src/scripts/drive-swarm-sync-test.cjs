// scripts/drive-swarm-sync-test.cjs
//
// End-to-end swarm test harness. Drives two browser contexts of the
// hypercomb-dev shell (4250) against a local Nostr relay (port 7777,
// expected to be running). Each context gets a fresh OPFS at the start
// so reruns are deterministic.
//
// Test order is critical: events on the relay expire (~90s NIP-40 TTL),
// so we must do all root-level work (sync proof + adopt) BEFORE either
// peer navigates away. After adopt, we test:
//   - that the adopted tile lives in the local layer
//   - that navigation into it works through the normal local path
//   - that deeper-level sync works when both peers navigate together
//
// Usage:
//   node scripts/drive-swarm-sync-test.cjs            # headless
//   node scripts/drive-swarm-sync-test.cjs --headed   # visible

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'swarm-test-' + Date.now().toString(36)
const SECRET = 'swarm-secret-' + Math.random().toString(36).slice(2, 10)

const HEADED = process.argv.includes('--headed')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newPage(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[swarm]') || text.includes('[sync]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 220))
    }
  })
  page.on('pageerror', (err) => log(label, 'PAGE ERROR:', String(err)))
  return { ctx, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    try {
      const root = await navigator.storage.getDirectory()
      const removals = []
      for await (const [name] of root.entries()) {
        removals.push(root.removeEntry(name, { recursive: true }).catch(() => null))
      }
      await Promise.all(removals)
      return { ok: true }
    } catch (e) { return { ok: false, err: String(e) } }
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

async function waitForReady(page, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const ioc = window.ioc
      return !!(ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
        && ioc?.get?.('@hypercomb.social/Lineage')
        && ioc?.get?.('@diamondcoreprocessor.com/NostrSigner')
        && ioc?.get?.('@hypercomb.social/Navigation'))
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

async function navigateTo(page, segments) {
  return page.evaluate((segs) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    if (!nav?.go) return { ok: false }
    nav.go(segs)
    return { ok: true }
  }, segments)
}

async function currentSegments(page) {
  return page.evaluate(() => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    return lineage?.explorerSegments?.() ?? []
  })
}

async function addTile(page, name) {
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
    if (!input) return { ok: false, reason: 'no input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true, name: cellName }
  }, name)
}

async function probePeerTiles(page) {
  return page.evaluate(() => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const tiles = swarm?.peerTilesAtCurrentSig?.() ?? []
    const SWARM_META = new Set(['name', 'peerPubkey', 'imageSig'])
    return {
      count: tiles.length,
      entries: tiles.map(t => {
        // First-class cell properties live directly on the entry now
        // (no `props` wrapper). Strip swarm-only metadata to see what
        // 0000 fields actually arrived.
        const cellPropKeys = Object.keys(t).filter(k => !SWARM_META.has(k)).sort()
        return {
          name: t.name,
          peerPubkey: t.peerPubkey?.slice(0, 8) ?? null,
          allKeys: Object.keys(t).sort(),
          cellPropKeys,
          hasProps: cellPropKeys.length > 0,
          hasImageSig: typeof t.imageSig === 'string' && /^[0-9a-f]{64}$/.test(t.imageSig),
        }
      }),
    }
  })
}

async function probeOwnChildren(page) {
  return page.evaluate(async () => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!lineage || !history) return { err: 'no lineage / history' }
    const segments = lineage.explorerSegments?.() ?? []
    const sig = await history.sign({ explorerSegments: () => segments })
    const layer = await history.currentLayerAt(sig)
    const childSigs = Array.isArray(layer?.children) ? layer.children : []
    const names = []
    for (const cs of childSigs) {
      try {
        const child = await history.getLayerBySig(cs)
        if (child?.name) names.push(child.name)
      } catch { /* skip */ }
    }
    return { segments, count: names.length, names: names.sort() }
  })
}

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    try {
      const bee = window.ioc.get('@diamondcoreprocessor.com/SwarmDrone')
      if (!bee || typeof bee.emitEffect !== 'function') {
        return { ok: false, reason: 'no SwarmDrone or emitEffect' }
      }
      bee.emitEffect('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
      return { ok: true }
    } catch (e) { return { ok: false, reason: String(e && e.message || e) } }
  }, label)
}

function pass(s) { return `${s}: ✓ PASS` }
function fail(s) { return `${s}: ✗ FAIL` }

async function main() {
  log('boot', 'launching browsers (headed=' + HEADED + ')')
  const browser = await chromium.launch({ headless: !HEADED })

  const A = await newPage(browser, 'A')
  const B = await newPage(browser, 'B')

  log('boot', 'first load')
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })

  log('boot', 'OPFS wipe on both contexts')
  log('A', 'clearOpfs:', await clearOpfs(A.page))
  log('B', 'clearOpfs:', await clearOpfs(B.page))

  log('boot', 'configuring credentials')
  await configure(A.page)
  await configure(B.page)

  log('boot', 'reload to apply')
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page.reload({ waitUntil: 'domcontentloaded' })

  log('boot', 'waiting for IoC ready')
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  const pkA = await pubkeyOf(A.page)
  const pkB = await pubkeyOf(B.page)
  log('boot', 'pubkeys A=' + pkA?.slice(0, 8) + ' B=' + pkB?.slice(0, 8))
  if (pkA && pkA === pkB) { log('boot', 'FATAL: same pubkey'); process.exit(1) }

  await new Promise(r => setTimeout(r, 1000))

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ T1: Basic sync at root — both peers stay at root throughout      ║
  // ╚══════════════════════════════════════════════════════════════════╝
  log('test1', 'A adds alpha + bravo; B adds charlie + delta; verify mutual sync')
  await addTile(A.page, 'alpha'); await new Promise(r => setTimeout(r, 700))
  await addTile(A.page, 'bravo'); await new Promise(r => setTimeout(r, 700))
  await addTile(B.page, 'charlie'); await new Promise(r => setTimeout(r, 700))
  await addTile(B.page, 'delta'); await new Promise(r => setTimeout(r, 700))

  log('test1', 'waiting 5s for sync')
  await new Promise(r => setTimeout(r, 5000))

  const t1A = await probePeerTiles(A.page)
  const t1B = await probePeerTiles(B.page)
  log('test1', 'A sees:', JSON.stringify(t1A.entries))
  log('test1', 'B sees:', JSON.stringify(t1B.entries))

  const t1AseesNames = (t1A.entries ?? []).map(e => e.name).sort()
  const t1BseesNames = (t1B.entries ?? []).map(e => e.name).sort()
  const t1aOk = JSON.stringify(t1AseesNames) === JSON.stringify(['charlie', 'delta'])
  const t1bOk = JSON.stringify(t1BseesNames) === JSON.stringify(['alpha', 'bravo'])
  const t1aProps = (t1A.entries ?? []).every(e => e.hasProps)
  const t1bProps = (t1B.entries ?? []).every(e => e.hasProps)

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ T2: Adopt at root — B adopts alpha (still at root, cache fresh) ║
  // ╚══════════════════════════════════════════════════════════════════╝
  log('test2', 'B reads local children before adopt')
  const t2Before = await probeOwnChildren(B.page)
  log('test2', 'B before adopt:', JSON.stringify(t2Before))

  log('test2', 'B fires adopt on alpha (A still at root, peer cache fresh)')
  const t2Fire = await fireAdopt(B.page, 'alpha')
  log('test2', 'adopt fire:', JSON.stringify(t2Fire))
  await new Promise(r => setTimeout(r, 3000))

  const t2After = await probeOwnChildren(B.page)
  log('test2', 'B after adopt:', JSON.stringify(t2After))
  const t2Ok = (t2After.names ?? []).includes('alpha')

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ T3: Navigate into the adopted tile — local path, normal flow    ║
  // ╚══════════════════════════════════════════════════════════════════╝
  log('test3', 'B navigates into alpha (now local on B)')
  await navigateTo(B.page, ['alpha'])
  await new Promise(r => setTimeout(r, 2000))
  const t3Segs = await currentSegments(B.page)
  log('test3', 'B segments after nav:', t3Segs)
  const t3Ok = JSON.stringify(t3Segs) === JSON.stringify(['alpha'])

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ T4: Deep sync — A navigates to /alpha + adds echo, B sees it    ║
  // ╚══════════════════════════════════════════════════════════════════╝
  log('test4', 'A navigates to /alpha and adds echo')
  await navigateTo(A.page, ['alpha'])
  await new Promise(r => setTimeout(r, 1500))
  await addTile(A.page, 'echo')
  await new Promise(r => setTimeout(r, 4000))

  // B is already at /alpha from T3 — should see A's echo as a peer.
  const t4B = await probePeerTiles(B.page)
  log('test4', 'B sees at /alpha:', JSON.stringify(t4B.entries))
  const t4Names = (t4B.entries ?? []).map(e => e.name).sort()
  const t4Ok = t4Names.includes('echo')
  const t4Props = (t4B.entries ?? []).every(e => e.hasProps)

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║ T5: Image transport — A attaches an image to echo, B sees it    ║
  // ║         (imageSig field arrives in peer props + bytes pulled)    ║
  // ╚══════════════════════════════════════════════════════════════════╝
  // T5/T6 (image transport) intentionally deferred — image bytes round-
  // trip via the kind-30201 resource pipeline (see SwarmDrone#publishResource
  // + #pullResourcesFromLayer), but exercising it cleanly from the
  // playwright eval context requires either a loaded substrate pool or
  // a route into writeTilePropertiesAt that mid-eval imports can't easily
  // reach. The plumbing is in place — manual verification path:
  //   1. open /dev shell, add a tile, open the editor
  //   2. drop an image onto the tile
  //   3. on the second browser, look at peerTilesAtCurrentSig() —
  //      the entry's `props.imageSig` (or props.small.image) should be set
  //      and `Store.getResource(imageSig)` should return the bytes.

  // ── Verdict ──
  console.log('\n========== VERDICT ==========')
  console.log(t1aOk ? pass('T1 A sees B\'s tiles') : fail('T1 A sees B\'s tiles'))
  console.log(t1bOk ? pass('T1 B sees A\'s tiles') : fail('T1 B sees A\'s tiles'))
  console.log(t1aProps ? pass('T1 A: props inlined') : fail('T1 A: props inlined'))
  console.log(t1bProps ? pass('T1 B: props inlined') : fail('T1 B: props inlined'))
  console.log(t2Ok ? pass('T2 B adopted alpha → in local layer') : fail('T2 B adopted alpha → in local layer'))
  console.log(t3Ok ? pass('T3 B navigates into adopted alpha') : fail('T3 B navigates into adopted alpha'))
  console.log(t4Ok ? pass('T4 B sees A\'s echo at /alpha (deep sync)') : fail('T4 B sees A\'s echo at /alpha (deep sync)'))
  console.log(t4Props ? pass('T4 deep props inlined') : fail('T4 deep props inlined'))
  console.log('=============================\n')

  const allPassed = t1aOk && t1bOk && t1aProps && t1bProps && t2Ok && t3Ok && t4Ok && t4Props
  if (!HEADED) await browser.close()
  else log('boot', 'leaving open for inspection (Ctrl+C to exit)')
  process.exit(allPassed ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
