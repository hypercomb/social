// scripts/verify-recursive-adopt.cjs
//
// Confirms a single-click adopt on a peer tile recursively imports
// ALL its descendants up to MAX_ADOPT_DEPTH.
//
// Scenario:
//   A creates /dolphin, navigates in, creates /dolphin/team, navigates
//   in, creates /dolphin/team/projects. Returns to root so the publish
//   walks the whole subtree on heartbeat.
//   B (fresh) adopts "dolphin" from root with a single tile:action event.
//   After settle, B's layer tree should contain:
//     /dolphin
//     /dolphin/team
//     /dolphin/team/projects

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'deep-' + Date.now().toString(36)
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
      && window.ioc?.get?.('@hypercomb.social/TileSourceRegistry')
      && window.ioc?.get?.('@hypercomb.social/Navigation')
    ))
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

async function navigateTo(page, segments) {
  return page.evaluate((segs) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    nav?.go?.(segs)
    return nav?.segmentsRaw?.()
  }, segments)
}

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
    return true
  }, label)
}

/** Walk B's layer tree to a depth and return the children at each level. */
async function probeTree(page, paths) {
  return page.evaluate(async (paths) => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const out = {}
    for (const path of paths) {
      const segs = path === '/' ? [] : path.split('/').filter(Boolean)
      const sig = await history.sign({ explorerSegments: () => segs })
      const layer = await history.currentLayerAt(sig)
      const names = []
      for (const cs of (layer?.children ?? [])) {
        try { const c = await history.getLayerBySig(cs); if (c?.name) names.push(c.name) } catch {}
      }
      out[path] = names.sort()
    }
    return out
  }, paths)
}

async function main() {
  // ── A: build a 3-level tree ──
  log('boot', 'launching A — publisher building /dolphin/team/projects tree')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  // root
  await addTile(A.page, 'dolphin')
  await new Promise(r => setTimeout(r, 800))
  // /dolphin
  await navigateTo(A.page, ['dolphin'])
  await new Promise(r => setTimeout(r, 1000))
  await addTile(A.page, 'team')
  await new Promise(r => setTimeout(r, 800))
  // /dolphin/team
  await navigateTo(A.page, ['dolphin', 'team'])
  await new Promise(r => setTimeout(r, 1000))
  await addTile(A.page, 'projects')
  await new Promise(r => setTimeout(r, 800))
  // Back to root so A's swarm walks the whole subtree on next heartbeat
  await navigateTo(A.page, [])
  await new Promise(r => setTimeout(r, 3000))

  log('A', 'tree built:', JSON.stringify(await probeTree(A.page, ['/', '/dolphin', '/dolphin/team'])))

  // Probe A's publish state — what sigs has A's swarm published to?
  const aPubState = await A.page.evaluate(async () => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const dbg = swarm?.debug?.() ?? {}
    const sigs = []
    for (const segs of [[], ['dolphin'], ['dolphin', 'team']]) {
      const s = await swarm?.composeSigForSegments?.(segs)
      sigs.push({ path: '/' + segs.join('/'), sig: s?.slice(0, 12) })
    }
    return {
      lastPublishedSigs: dbg.lastPublishedBySig ?? [],
      currentSig: dbg.currentSig,
      sigsForPaths: sigs,
    }
  })
  console.log('A publish state:', JSON.stringify(aPubState, null, 2))

  // ── B: late joiner, single-click adopt on "dolphin" ──
  log('boot', 'launching B — late joiner')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  // Wait for root sync.
  await new Promise(r => setTimeout(r, 3000))
  log('B', 'before adopt — local layer at /:', JSON.stringify((await probeTree(B.page, ['/']))['/']))

  log('B', 'single-click adopt "dolphin"')
  await fireAdopt(B.page, 'dolphin')

  // Poll for the recursive walk to finish (top-level immediate, sub-levels take SUBSCRIBE_WAIT_MS each).
  let elapsed = -1
  let tree = null
  const t0 = Date.now()
  while (Date.now() - t0 < 15000) {
    tree = await probeTree(B.page, ['/', '/dolphin', '/dolphin/team'])
    const haveDolphin = (tree['/'] ?? []).includes('dolphin')
    const haveTeam = (tree['/dolphin'] ?? []).includes('team')
    const haveProjects = (tree['/dolphin/team'] ?? []).includes('projects')
    if (haveDolphin && haveTeam && haveProjects) { elapsed = Date.now() - t0; break }
    await new Promise(r => setTimeout(r, 400))
  }
  if (elapsed < 0) elapsed = Date.now() - t0

  log('B', 'final tree:', JSON.stringify(tree))

  // Diagnostic — probe what's in B's swarm cache for each sub-sig.
  const diag = await B.page.evaluate(async () => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const out = []
    for (const segs of [[], ['dolphin'], ['dolphin', 'team']]) {
      const sig = await swarm?.composeSigForSegments?.(segs)
      const tiles = swarm?.peerTilesAtSig?.(sig) ?? []
      out.push({ path: '/' + segs.join('/'), sig: sig?.slice(0, 12), tileNames: tiles.map(t => t.name).sort() })
    }
    return out
  })
  console.log('B swarm cache by path:')
  for (const d of diag) console.log(`  ${d.path.padEnd(20)} sig=${d.sig} tiles=${JSON.stringify(d.tileNames)}`)

  const haveDolphin = (tree?.['/'] ?? []).includes('dolphin')
  const haveTeam = (tree?.['/dolphin'] ?? []).includes('team')
  const haveProjects = (tree?.['/dolphin/team'] ?? []).includes('projects')
  const allOk = haveDolphin && haveTeam && haveProjects

  console.log('\n========== VERDICT ==========')
  console.log(`/  → dolphin:          ${haveDolphin ? '✓' : '✗'}`)
  console.log(`/dolphin → team:       ${haveTeam ? '✓' : '✗'}`)
  console.log(`/dolphin/team → projects: ${haveProjects ? '✓' : '✗'}`)
  console.log(allOk ? `OVERALL: ✓ PASS (${elapsed}ms)` : `OVERALL: ✗ FAIL`)
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(allOk ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
