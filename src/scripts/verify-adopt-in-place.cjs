// scripts/verify-adopt-in-place.cjs
//
// Confirms: a peer tile rendered at slot N stays at slot N after the
// receiver adopts it (no leap to a different slot).

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const RELAY = 'ws://localhost:7777'
const ROOM = 'adopt-' + Date.now().toString(36)
const SECRET = 'sec-' + Math.random().toString(36).slice(2, 10)
const NAMES = ['coaching', 'operations', 'community']

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

async function fireAdopt(page, label) {
  return page.evaluate((cellLabel) => {
    const swarm = window.ioc?.get?.('@diamondcoreprocessor.com/SwarmDrone')
    swarm?.emitEffect?.('tile:action', { action: 'adopt', label: cellLabel, q: 0, r: 0, index: 0 })
    return true
  }, label)
}

async function probeSlots(page) {
  return page.evaluate(() => {
    const showCell = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const cells = showCell?.renderedCells ? [...showCell.renderedCells.values()] : []
    const axial = window.ioc?.get?.('@diamondcoreprocessor.com/AxialService')
    const out = []
    for (const c of cells) {
      let slot = -1
      if (axial?.items) {
        for (const [i, a] of axial.items.entries()) {
          if (a?.q === c.q && a?.r === c.r) { slot = i; break }
        }
      }
      out.push({ label: c.label, slot, external: c.external })
    }
    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  })
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
  log('boot', 'launching A — publisher with 3 tiles')
  const A = await newBrowser()
  await A.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(A.page)
  await configure(A.page)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(A.page))) { log('A', 'TIMEOUT'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1500))

  for (const n of NAMES) { await addTile(A.page, n); await new Promise(r => setTimeout(r, 500)) }
  await new Promise(r => setTimeout(r, 2000))
  log('A', 'slots after add:', JSON.stringify(await probeSlots(A.page)))

  log('boot', 'launching B — late joiner')
  const B = await newBrowser()
  await B.page.goto(URL, { waitUntil: 'domcontentloaded' })
  await clearOpfs(B.page)
  await configure(B.page)
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(B.page))) { log('B', 'TIMEOUT'); process.exit(1) }

  // Wait for peer sync + render.
  await new Promise(r => setTimeout(r, 4000))
  const beforeAdopt = await probeSlots(B.page)
  log('B', 'slots BEFORE adopt:', JSON.stringify(beforeAdopt))

  // Pick a tile to adopt and record its current slot.
  const targetName = NAMES[1]  // operations
  const targetSlot = beforeAdopt.find(s => s.label === targetName)?.slot
  log('B', `adopting "${targetName}" — currently at slot ${targetSlot}`)

  await fireAdopt(B.page, targetName)
  // Poll until the layer cascade settles + show-cell re-renders the
  // adopted tile as local (external:false). Up to 5s — typically <500ms.
  let afterAdopt = null
  const tt = Date.now()
  while (Date.now() - tt < 5000) {
    afterAdopt = await probeSlots(B.page)
    const t = afterAdopt.find(s => s.label === targetName)
    if (t && t.external === false) break
    await new Promise(r => setTimeout(r, 200))
  }
  const afterChildren = await probeOwnChildren(B.page)
  log('B', 'slots AFTER adopt:', JSON.stringify(afterAdopt))
  log('B', 'B own children after adopt:', JSON.stringify(afterChildren))

  const afterSlot = afterAdopt.find(s => s.label === targetName)?.slot
  const adopted = afterChildren.includes(targetName)
  const slotPreserved = afterSlot === targetSlot
  const isLocal = afterAdopt.find(s => s.label === targetName)?.external === false

  console.log('\n========== VERDICT ==========')
  console.log(`peer "${targetName}" was at slot:    ${targetSlot}`)
  console.log(`after adopt at slot:                  ${afterSlot}`)
  console.log(`slot preserved (adopt-in-place):      ${slotPreserved ? '✓' : '✗'}`)
  console.log(`tile now in B's local layer:          ${adopted ? '✓' : '✗'}`)
  console.log(`rendered as local (external=false):   ${isLocal ? '✓' : '✗'}`)
  const ok = slotPreserved && adopted && isLocal
  console.log(ok ? 'OVERALL: ✓ PASS' : 'OVERALL: ✗ FAIL')
  console.log('=============================\n')

  await A.browser.close()
  await B.browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
