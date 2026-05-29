// scripts/drive-existing-data-repro.cjs
//
// Reproduces the "user with existing data can't see peer tiles" failure
// the user is reporting. The fresh-incognito case works; this models the
// other side — a tab with accumulated state that's been through:
//   - tile creation + commits (layer + opfs dirs accumulate)
//   - hide actions (hc:hidden-tiles localStorage entries)
//   - block actions (hc:blocked-tiles localStorage entries)
//   - swarm public toggle history (zone key churn)
// then asks: when a NEW peer (fresh state) publishes a tile this tab
// has never seen, does this tab surface it?
//
// And — when something blocks the peer from surfacing — what specifically
// in the accumulated state is to blame, so we can recommend a repair.

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'exist-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)

// "A" simulates a user with built-up state.
const A_LOCAL_TILES = ['coaching', 'operations', 'community']
// "B" is a fresh peer publishing a tile A has never seen.
const B_NEW_TILE = 'discovery-from-fresh-peer'
// Names A hid via UI in the past, written to localStorage. Includes one
// peer-name overlap (B's new tile) and one stale entry that no longer
// has a local tile backing it — the kind of accumulated state we'd
// expect on a long-running profile.
const A_HIDDEN_LIST = ['stale-tile-never-existed', B_NEW_TILE]

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

async function seedHideListsAtRoot(page, hiddenNames) {
  await page.evaluate(({ names }) => {
    // Mimic both the legacy bare-key and the current zone-scoped key
    // shapes — a profile that's been through multiple zone/credential
    // changes may have either or both.
    localStorage.setItem('hc:hidden-tiles:/', JSON.stringify(names))
    const zone = localStorage.getItem('hc:current-zone') ?? ''
    if (zone) {
      localStorage.setItem(`hc:hidden-tiles:/:z${zone}`, JSON.stringify(names))
    }
  }, { names: hiddenNames })
}

async function audit(page, label) {
  return page.evaluate(async (label) => {
    const ioc = window.ioc
    const swarm = ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    const reg = ioc?.get?.('@hypercomb.social/TileSourceRegistry')
    const showCell = ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const lineage = ioc?.get?.('@hypercomb.social/Lineage')
    const history = ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    const segs = lineage?.explorerSegments?.() ?? []
    const locKey = String(lineage?.explorerLabel?.() ?? '/')
    const locSig = await history?.sign?.({ explorerSegments: () => segs })
    const layer = locSig ? await history?.currentLayerAt?.(locSig) : null
    const childNames = []
    for (const cs of (layer?.children ?? [])) {
      try { const c = await history.getLayerBySig(cs); if (c?.name) childNames.push(c.name) } catch {}
    }
    const peerCache = swarm?.peerTilesAtCurrentSig?.() ?? []
    const registryEntries = await reg?.resolve?.({ segments: segs, dir: null }) ?? []
    const rendered = showCell?.renderedCells ? [...showCell.renderedCells.values()].map(c => c.label) : []
    const allHcKeys = Object.keys(localStorage).filter(k => k.startsWith('hc:'))
    const hideKeys = allHcKeys.filter(k => k.includes('hidden-tiles') || k.includes('hidden-lineages') || k.includes('blocked-tiles'))
    const hideContents = {}
    for (const k of hideKeys) hideContents[k] = JSON.parse(localStorage.getItem(k) ?? 'null')
    return {
      label,
      localChildren: childNames.sort(),
      peerCacheNames: peerCache.map(p => p.name).sort(),
      registryEntries: registryEntries.map(e => ({ name: e.name, kind: e.kind })).sort((a, b) => a.name.localeCompare(b.name)),
      renderedNames: rendered.sort(),
      // What's surfaced as peer (not in localChildren).
      peerSurfacedNames: registryEntries.filter(e => e.kind === 'peer' && !childNames.includes(e.name)).map(e => e.name).sort(),
      // What's hidden that's NOT a local tile (stale).
      staleHideEntries: Object.entries(hideContents).flatMap(([k, v]) => Array.isArray(v) ? v.filter(n => !childNames.includes(n)).map(n => ({ key: k, name: n })) : []),
      hideKeys,
      hideContents,
    }
  }, label)
}

async function main() {
  log('boot', 'PHASE 1: A boots fresh, accumulates state — tiles + hide list')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  for (const n of A_LOCAL_TILES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 500)) }
  await new Promise(r => setTimeout(r, 2000))
  await seedHideListsAtRoot(A.page, A_HIDDEN_LIST)
  log('A', 'state seeded — 3 tiles + hide list containing one peer-name + one stale name')
  log('A', 'baseline audit:', JSON.stringify(await audit(A.page, 'A-baseline'), null, 2).slice(0, 600))

  log('boot', 'PHASE 2: B (fresh, no overlap) publishes a NEW tile A has never seen')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))
  await addTile(B.page, B_NEW_TILE)
  await new Promise(r => setTimeout(r, 3000))

  log('B', 'audit:', JSON.stringify(await audit(B.page, 'B'), null, 2).slice(0, 400))

  log('boot', 'PHASE 3: A sees what B published?')
  // Force A to re-pull by firing a swarm:peers-changed listener path.
  await new Promise(r => setTimeout(r, 3000))
  const aAfter = await audit(A.page, 'A-after-peer')

  console.log('\n========== A AUDIT AFTER PEER PUBLISH ==========')
  console.log(JSON.stringify(aAfter, null, 2))
  console.log('================================================\n')

  // Diagnosis: trace what happened to B's new tile name.
  console.log('========== DIAGNOSIS ==========')
  const inCache = aAfter.peerCacheNames.includes(B_NEW_TILE)
  const inRegistry = aAfter.registryEntries.some(e => e.name === B_NEW_TILE)
  const inRendered = aAfter.renderedNames.includes(B_NEW_TILE)
  console.log(`B's new tile "${B_NEW_TILE}":`)
  console.log(`  in A's swarm cache:     ${inCache}`)
  console.log(`  in A's registry result: ${inRegistry}`)
  console.log(`  in A's rendered cells:  ${inRendered}`)
  if (inCache && !inRendered) {
    console.log('\n  → DROPPED somewhere between cache and render.')
    const hideAt = Object.entries(aAfter.hideContents).find(([_, v]) => Array.isArray(v) && v.includes(B_NEW_TILE))
    if (hideAt) console.log(`  → CAUSE: present in localStorage hide key "${hideAt[0]}"`)
    else console.log('  → CAUSE: not in any hide list — bug elsewhere in show-cell filter chain')
  }
  if (aAfter.staleHideEntries.length > 0) {
    console.log('\n  Stale hide entries (point to tiles A doesn\'t own — potential repair targets):')
    for (const s of aAfter.staleHideEntries) console.log(`    - "${s.name}" in ${s.key}`)
  }
  console.log('================================\n')

  await A.browser.close()
  await B.browser.close()
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
