// scripts/drive-local-tiles-test.cjs
//
// Regression test for the "no tiles after reload" symptom Jaime hit.
// show-cell reads tile membership exclusively from history.currentLayerAt,
// which warms via preloadAllBags. If preloadAllBags races Store.initialize
// and bails early without warming, currentLayerAt returns null forever
// and the canvas is blank even though the bag has tiles on disk.
//
// This test:
//   1. opens dev shell
//   2. wipes OPFS
//   3. adds two tiles
//   4. reloads the page
//   5. verifies BOTH tiles are still there (read via the same layer-driven
//      path show-cell uses)

const { chromium } = require('playwright')

const URL = 'http://localhost:4250/'
const HEADED = process.argv.includes('--headed')

function ts() { return new Date().toISOString().slice(11, 23) }
function log(tag, ...args) { console.log(`[${ts()}] [${tag}]`, ...args) }

async function newPage(browser, label) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', (msg) => {
    const text = msg.text()
    if (text.includes('[preload]') || msg.type() === 'error') {
      log(label, `[${msg.type()}]`, text.slice(0, 220))
    }
  })
  page.on('pageerror', (err) => log(label, 'PAGE ERROR:', String(err)))
  return { ctx, page }
}

async function clearOpfs(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    for await (const [name] of root.entries()) {
      await root.removeEntry(name, { recursive: true }).catch(() => null)
    }
  })
}

async function waitForReady(page, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
      && window.ioc?.get?.('@hypercomb.social/Lineage')
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

/** Read children at root via the same path show-cell uses — currentLayerAt
 *  + getLayerBySig. If preloadAllBags failed to warm, this returns []. */
async function probeRootChildren(page) {
  return page.evaluate(async () => {
    const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
    if (!history?.sign || !history?.currentLayerAt || !history?.getLayerBySig) return { err: 'history missing' }
    const sig = await history.sign({ explorerSegments: () => [] })
    const layer = await history.currentLayerAt(sig)
    const childSigs = Array.isArray(layer?.children) ? layer.children : []
    const names = []
    for (const cs of childSigs) {
      try {
        const child = await history.getLayerBySig(cs)
        if (child?.name) names.push(child.name)
      } catch { /* skip */ }
    }
    return { count: names.length, names: names.sort() }
  })
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED })
  const { page } = await newPage(browser, 'dev')

  log('boot', 'first load')
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  log('boot', 'wiping OPFS')
  await clearOpfs(page)

  log('boot', 'reloading after wipe')
  await page.reload({ waitUntil: 'domcontentloaded' })

  if (!(await waitForReady(page))) { log('dev', 'TIMEOUT waiting for IoC'); process.exit(1) }
  await new Promise(r => setTimeout(r, 1000))

  log('test', 'adding alpha + bravo')
  await addTile(page, 'alpha'); await new Promise(r => setTimeout(r, 700))
  await addTile(page, 'bravo'); await new Promise(r => setTimeout(r, 700))

  const before = await probeRootChildren(page)
  log('test', 'before reload:', JSON.stringify(before))

  log('test', 'reloading page (THIS is the regression path)')
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(page))) { log('dev', 'TIMEOUT after reload'); process.exit(1) }

  // Poll for currentLayerAt becoming hot. Should be near-instant after
  // Store.initialize() resolves, but exact timing depends on bundle.
  let after = { count: 0 }
  const t0 = Date.now()
  while (Date.now() - t0 < 5000) {
    after = await probeRootChildren(page)
    if (after.count > 0) break
    await new Promise(r => setTimeout(r, 100))
  }
  const elapsed = Date.now() - t0
  log('test', `after reload (${elapsed}ms wait):`, JSON.stringify(after))

  const ok = after.count === 2 && JSON.stringify(after.names) === JSON.stringify(['alpha', 'bravo'])

  console.log('\n========== VERDICT ==========')
  console.log(ok ? `Tiles survive reload: ✓ PASS (${elapsed}ms to warm)` : 'Tiles survive reload: ✗ FAIL')
  console.log('=============================\n')

  if (!HEADED) await browser.close()
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
