// scripts/drive-filter-audit.cjs
//
// Late-joiner scenario with FULL filter audit. Publisher creates 5 tiles
// at root; subscriber joins fresh and we report what every layer of the
// filter chain decides about those tiles. If only one (or none) renders,
// this tells us which layer dropped them.
//
// Filter layers we probe (in pipeline order from show-cell.drone.ts):
//   1. SwarmDrone.peerTilesAtCurrentSig() — raw cache (post-sanitize)
//   2. TileSourceRegistry.resolve() — what every source contributes
//   3. localCellSet dedup at show-cell:1932 — keeps only !localCellSet
//   4. hc:hidden-lineages localStorage hide list (zone-scoped + bare)
//   5. hc:blocked-tiles:{loc} localStorage block list
//   6. SwarmDrone.hiddenAtCurrentSig() — peer kind-30202 hides
//   7. showCell.renderedCells — final rendered cells

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'audit-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const NAMES = ['coaching', 'operations', 'community', 'instructions', 'dashboard']

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

/** Full audit — walks every filter layer and reports drop counts. */
async function auditFilters(page) {
  return page.evaluate(async () => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const reg = ioc?.get?.('@hypercomb.social/TileSourceRegistry')
    const showCell = ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const lineage = ioc?.get?.('@hypercomb.social/Lineage')
    const segs = lineage?.explorerSegments?.() ?? []
    const locationKey = String(lineage?.explorerLabel?.() ?? '/')

    // 1. Raw swarm cache.
    const peerCache = swarm?.peerTilesAtCurrentSig?.() ?? []

    // 2. What the registry actually returns to show-cell.
    const registryEntries = await reg?.resolve?.({ segments: segs, dir: null }) ?? []

    // 3. localCellSet — what show-cell considers "local" at this location.
    //    Approximate by reading the layer's children list.
    const history = ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const locSig = await history?.sign?.({ explorerSegments: () => segs })
    const layer = locSig ? await history?.currentLayerAt?.(locSig) : null
    const localChildNames = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) localChildNames.push(c.name) } catch {}
    }
    const localCellSet = new Set(localChildNames)

    // 4. Hide lists — every flavour show-cell consults.
    const hiddenLineages = JSON.parse(localStorage.getItem('hc:hidden-lineages') ?? '[]')
    const zone = localStorage.getItem('hc:current-zone') ?? ''
    const zoneHiddenKey = zone ? `hc:hidden-tiles:${locationKey}:z${zone}` : ''
    const zoneHiddenTiles = zoneHiddenKey ? JSON.parse(localStorage.getItem(zoneHiddenKey) ?? '[]') : []
    const bareHiddenTiles = JSON.parse(localStorage.getItem(`hc:hidden-tiles:${locationKey}`) ?? '[]')
    const blockedTiles = JSON.parse(localStorage.getItem(`hc:blocked-tiles:${locationKey}`) ?? '[]')
    const swarmHidden = swarm?.hiddenAtCurrentSig?.() ?? new Set()

    // 5. show-cell rendered cells (final output).
    const rendered = showCell?.renderedCells ? [...showCell.renderedCells.values()].map(c => c.label) : []
    const peerCellSet = showCell?.peerCellSet ? [...showCell.peerCellSet] : null

    // Compute pipeline drop reasons per peer tile.
    const dropReasons = []
    for (const p of peerCache) {
      const name = p.name
      const reasons = []
      if (localCellSet.has(name)) reasons.push('matches local layer child (dedup)')
      if (hiddenLineages.includes(name) || hiddenLineages.includes((locationKey === '/' ? '' : locationKey) + '/' + name)) reasons.push('in hc:hidden-lineages')
      if (zoneHiddenTiles.includes(name)) reasons.push(`in zone-hidden (${zoneHiddenKey})`)
      if (bareHiddenTiles.includes(name)) reasons.push('in bare-hidden')
      if (blockedTiles.includes(name)) reasons.push('in hc:blocked-tiles')
      if (swarmHidden.has?.(name)) reasons.push('in peer-published hide')
      if (!rendered.includes(name)) reasons.push('NOT in renderedCells')
      dropReasons.push({ name, reasons })
    }

    return {
      locationKey,
      segments: segs,
      // pipeline:
      peerCacheNames: peerCache.map(p => p.name).sort(),
      registryEntries: registryEntries.map(e => ({ name: e.name, kind: e.kind })).sort((a, b) => a.name.localeCompare(b.name)),
      localChildNames: localChildNames.sort(),
      // filter contents:
      hiddenLineages,
      zoneHiddenKey,
      zoneHiddenTiles,
      bareHiddenTiles,
      blockedTiles,
      swarmHiddenSize: swarmHidden.size,
      swarmHiddenList: [...(swarmHidden.entries?.() ? swarmHidden.entries() : [])].map(e => e[0] ?? e),
      // final:
      renderedLabels: rendered.sort(),
      peerCellSet: peerCellSet?.sort(),
      // diagnosis:
      dropReasons,
    }
  })
}

async function main() {
  log('boot', 'launching A — publisher')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  for (const n of NAMES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 500)) }
  await new Promise(r => setTimeout(r, 3000))

  log('boot', 'launching B — subscriber')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  // Wait for sync + render.
  await new Promise(r => setTimeout(r, 3000))

  const audit = await auditFilters(B.page)
  console.log('\n========== B FILTER AUDIT ==========')
  console.log(JSON.stringify(audit, null, 2))
  console.log('====================================\n')

  // Tile-by-tile drop reason summary.
  console.log('========== PER-TILE DECISION ==========')
  for (const t of audit.dropReasons) {
    if (t.reasons.length === 0) console.log(`  ${t.name}: passed all filters`)
    else console.log(`  ${t.name}: DROPPED — ${t.reasons.join(' AND ')}`)
  }
  console.log('=======================================\n')

  await A.browser.close()
  await B.browser.close()
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
