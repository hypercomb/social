// scripts/verify-tile-order.cjs
//
// Confirms, against the running dev shell (default http://localhost:4250/) in
// a FRESH Playwright browser context — its own OPFS, never a second tab on
// anyone's hive — that where a tile sits is its PAGE's claim
// (history/tile-order.ts):
//
//   1. a created tile is seated in the page's `order`, and its own layer
//      carries no `index`;
//   2. a reorder is ONE marker at the page and leaves every tile's sig alone;
//   3. `into` moves a tile with its listed sig unchanged, seats it at the
//      destination and unseats it at the source;
//   4. a create is ONE undo step;
//   5. seats survive a reload.
//
// Usage: node scripts/verify-tile-order.cjs [url]

const { chromium } = require('playwright')

const URL = process.argv[2] || 'http://localhost:4250/'
const RUN = Date.now().toString(36)
const [ALPHA, BETA, WORK, GAMMA] = ['alpha', 'beta', 'work', 'gamma'].map(n => `${n}-${RUN}`)

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...args) => console.log(`[${ts()}]`, ...args)
const wait = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures++
  log(ok ? 'PASS' : 'FAIL', label, detail === undefined ? '' : JSON.stringify(detail))
}

async function waitForReady(page, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      && window.ioc?.get?.('@diamondcoreprocessor.com/LayerCommitter')
      && window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
      && window.ioc?.get?.('@diamondcoreprocessor.com/IntoQueenBee')
    )).catch(() => false)
    if (ok) return true
    await wait(250)
  }
  return false
}

async function addTile(page, name) {
  await page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) throw new Error('no command line')
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 100))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  }, name)
}

/** The page at `segments`: its children by name → sig, its seats, its marker count. */
async function pageState(page, segments) {
  return page.evaluate(async (segs) => {
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc.get('@hypercomb.social/Store')
    await window.ioc.get('@diamondcoreprocessor.com/LayerCommitter').settled?.()
    const loc = await history.sign({ explorerSegments: () => segs })
    const layer = await history.currentLayerAt(loc)
    const children = {}
    for (const sig of layer?.children ?? []) {
      const child = await history.getLayerBySig(sig)
      if (child?.name) children[child.name] = sig
    }
    let seats = {}
    const ref = Array.isArray(layer?.order) ? layer.order[0] : null
    if (ref) {
      const blob = await store.getResource(ref)
      if (blob) seats = JSON.parse(await blob.text())
    }
    const markers = (await history.listLayers(loc)).length
    return { children, seats, markers }
  }, segments)
}

/** The `index` inside a tile's own properties (what older builds wrote). */
async function ownIndex(page, segments, name) {
  return page.evaluate(async ({ segs, name }) => {
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc.get('@hypercomb.social/Store')
    const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => [...segs, name] }))
    const ref = Array.isArray(layer?.properties) ? layer.properties[0] : null
    if (!ref) return null
    const blob = await store.getResource(ref)
    return blob ? (JSON.parse(await blob.text()).index ?? null) : null
  }, { segs: segments, name })
}

async function untilChildren(page, segments, names, present = true, ms = 8000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    const { children } = await pageState(page, segments)
    if (names.every(n => (n in children) === present)) return true
    await wait(200)
  }
  return false
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', err => log('pageerror', err.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (!(await waitForReady(page))) { log('FAIL', 'shell never became ready'); await browser.close(); process.exit(1) }
  await wait(2000)

  // 1. Created tiles take seats in the page's order; their layers carry none.
  for (const name of [ALPHA, BETA, WORK]) { await addTile(page, name); await wait(400) }
  check('three tiles created', await untilChildren(page, [], [ALPHA, BETA, WORK]))
  await wait(1500)
  let root = await pageState(page, [])
  check('each new tile is seated in the page order', [ALPHA, BETA, WORK].every(n => Number.isInteger(root.seats[n])), root.seats)
  check('no tile carries an index of its own', (await Promise.all([ALPHA, BETA, WORK].map(n => ownIndex(page, [], n)))).every(i => i === null))

  // 2. A reorder is one marker at the page; no tile's sig changes.
  const before = root
  await page.evaluate(names => window.ioc.get('@diamondcoreprocessor.com/MoveDrone').reorderList(names), [WORK, BETA, ALPHA])
  root = await pageState(page, [])
  check('a reorder is one marker at the page', root.markers === before.markers + 1, { before: before.markers, after: root.markers })
  check('the reorder left every tile sig alone', [ALPHA, BETA, WORK].every(n => root.children[n] === before.children[n]))
  check('the reorder wrote dense seats', root.seats[WORK] === 0 && root.seats[BETA] === 1 && root.seats[ALPHA] === 2, root.seats)

  // 3. `into` moves the listed sig, seats it there, unseats it here.
  const listed = root.children[ALPHA]
  await page.evaluate(line => window.ioc.get('@diamondcoreprocessor.com/IntoQueenBee').invoke(line), `${WORK} = ${ALPHA}`)
  check('alpha left the page', await untilChildren(page, [], [ALPHA], false))
  root = await pageState(page, [])
  const work = await pageState(page, [WORK])
  check('the destination lists alpha’s own sig', work.children[ALPHA] === listed, { listed, there: work.children[ALPHA] })
  check('the destination seats alpha', Number.isInteger(work.seats[ALPHA]), work.seats)
  check('the source no longer seats alpha', !(ALPHA in root.seats), root.seats)

  // 4. A create is one undo step.
  const preCreate = await pageState(page, [])
  await addTile(page, GAMMA)
  check('gamma created', await untilChildren(page, [], [GAMMA]))
  await wait(1200)
  const postCreate = await pageState(page, [])
  check('a create is one marker, seat included', postCreate.markers === preCreate.markers + 1 && Number.isInteger(postCreate.seats[GAMMA]),
    { before: preCreate.markers, after: postCreate.markers, seat: postCreate.seats[GAMMA] })
  await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/UndoQueenBee').invoke(''))
  await wait(800)
  const atCursor = await page.evaluate(async () => {
    const cursor = window.ioc.get('@diamondcoreprocessor.com/HistoryCursorService')
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const content = await cursor.layerContentAtCursor()
    const names = []
    for (const sig of content?.children ?? []) { const c = await history.getLayerBySig(sig); if (c?.name) names.push(c.name) }
    return names
  })
  check('one undo takes gamma away', !atCursor.includes(GAMMA) && atCursor.includes(BETA), atCursor)
  await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/RedoQueenBee')?.invoke?.(''))
  await wait(800)

  // 5. Seats survive a reload.
  const slotsOf = () => page.evaluate(() => {
    const names = window.ioc.get('@diamondcoreprocessor.com/ShowCellDrone')?.cachedCellNames ?? []
    const out = {}
    names.forEach((name, i) => { if (name) out[name] = i })
    return out
  })
  const shown = await slotsOf()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForReady(page)
  await wait(3000)
  const reloaded = await slotsOf()
  check('seats survive a reload', [BETA, WORK].every(n => shown[n] !== undefined && shown[n] === reloaded[n]), { shown, reloaded })

  await browser.close()
  log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
