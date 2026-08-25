#!/usr/bin/env node
// drive-tree-exit-spawn — proves that COMING OUT OF THE TREE LANDS WHERE YOU
// CAME IN, on a live shell.
//
//   node scripts/drive-tree-exit-spawn.cjs [--url http://localhost:4251]
//                                          [--out <dir>] [--engine chrome]
//
// The bug: clicking the tree icon on a tile (the `behaviors` root is the one
// that carries the mark) walks the explorer to the branch root before it
// flips the surface — invisible while the tree is up, but still a move. So
// closing the tree left the participant standing on the branch root staring
// at raw hexagons, with the page and the view they came from thrown away.
//
// The transitions this drives are the real ones, straight through the icon
// dispatcher and the shell's own services — no fixtures, no mocks:
//
//   A. STEP-IN from the hexagons — stand somewhere, click a tree icon on a
//      cell elsewhere, come back out on the page you were standing on.
//   B. STEP-IN from another VIEW — the surface that was up comes back too.
//   C. TYPED — `/tree` opens the tree where you already are: nothing stepped
//      anywhere, so closing stays put.
//   D. TRAVEL — clicking a node in the tree is choosing a destination, and a
//      destination outranks the way back in.
//
// Vendor-neutral Playwright, no bridge. `--engine chrome` is the one with a
// GPU — headless chromium cannot initialize Pixi's shaders and never leaves
// the splash. Note 4251 is a DIFFERENT ORIGIN from the 4250 dev hive, so this
// always runs on an empty hive, never on anyone's content.

const fs = require('node:fs')
const path = require('node:path')
const { chromium, firefox, webkit } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function launcherFor(name) {
  switch (String(name)) {
    case 'firefox': return { type: firefox, opts: {} }
    case 'webkit': return { type: webkit, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chromium': return { type: chromium, opts: {} }
    default: return { type: chromium, opts: { channel: 'chrome' } }
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

// Everything below runs IN the page against the shell's own services.
const DRIVE = async (scenario) => {
  const ioc = window.ioc
  const vm = ioc?.get('@hypercomb.social/ViewMode')
  const lineage = ioc?.get('@hypercomb.social/Lineage')
  const bus = globalThis.__hypercombEffectBus
  if (!vm || !lineage || !bus) return { error: 'shell services missing' }

  const here = () => [...(lineage.explorerSegments?.() ?? [])]
  const goto = (segments) => {
    if (typeof lineage.explorerReplace === 'function') lineage.explorerReplace(segments)
    else { while (here().length) lineage.explorerUp(); for (const s of segments) lineage.explorerEnter(s) }
  }
  const settle = (ms) => new Promise(r => setTimeout(r, ms))
  const until = async (test, ms = 4000) => {
    const stop = Date.now() + ms
    while (Date.now() < stop) { if (test()) return true; await settle(60) }
    return test()
  }

  // Stand somewhere, looking at something.
  vm.setMode('hexagons')
  goto(scenario.from)
  if (scenario.view) vm.setMode(scenario.view)
  const spawnedIn = vm.mode
  const spawnedAt = here()

  if (scenario.typed) {
    // `/tree` — the tree opens on the branch under you. No step-in.
    ioc.get('@diamondcoreprocessor.com/TreeViewDrone')?.setRootToCurrent()
    vm.setMode('tree')
  } else {
    // The ICON: exactly what a click on the tile's tree glyph emits. The
    // dispatcher walks to the branch entrance, THEN flips the surface.
    bus.emit('tile:action', { action: 'view-enter:tree', label: scenario.tile })
    await until(() => vm.mode === 'tree')
  }
  const openedIn = vm.mode
  const openedAt = here()

  // Come back out — every exit path names the hexagons; the drone decides
  // where that actually lands.
  vm.setMode('hexagons')
  await settle(120)
  return { spawnedIn, spawnedAt, openedIn, openedAt, mode: vm.mode, at: here() }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }

  try {
    await page.goto(url, { waitUntil: 'load' })
    // A cold dev server compiles on the first request and the shell then boots
    // its drones — poll for the renderer rather than guessing at a timeout.
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      await page.waitForTimeout(3000)
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
      ready = await page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/TreeViewDrone'))
    }
    await shot('01-hive')
    check('the tree renderer is up', ready)
    if (!ready) throw new Error('the shell never finished booting')

    // ── A. step-in from the hexagons ─────────────────────────────────────
    const stepIn = await page.evaluate(DRIVE, {
      from: ['family', 'susan'], tile: 'behaviors', view: '',
    })
    console.log('    step-in →', JSON.stringify(stepIn))
    check('A. the icon really walked the explorer away first',
      JSON.stringify(stepIn.openedAt) !== JSON.stringify(stepIn.spawnedAt),
      'opened at ' + JSON.stringify(stepIn.openedAt))
    check('A. coming out lands on the PAGE the icon was clicked from',
      JSON.stringify(stepIn.at) === JSON.stringify(['family', 'susan']), 'at=' + JSON.stringify(stepIn.at))
    check('A. …on the hexagons, which is where it was clicked from',
      stepIn.mode === 'hexagons', 'mode=' + stepIn.mode)
    await shot('02-after-step-in-exit')

    // ── B. step-in from another view ─────────────────────────────────────
    const fromView = await page.evaluate(DRIVE, {
      from: ['family'], tile: 'behaviors', view: 'square-tile-view',
    })
    console.log('    from-view →', JSON.stringify(fromView))
    check('B. coming out restores the VIEW that was up',
      fromView.mode === 'square-tile-view', 'mode=' + fromView.mode)
    check('B. …on the page it was up on',
      JSON.stringify(fromView.at) === JSON.stringify(['family']), 'at=' + JSON.stringify(fromView.at))

    // ── C. typed — nothing stepped anywhere ──────────────────────────────
    const typed = await page.evaluate(DRIVE, {
      from: ['family', 'susan'], tile: 'behaviors', view: '', typed: true,
    })
    console.log('    typed   →', JSON.stringify(typed))
    check('C. a typed /tree closes where it opened',
      JSON.stringify(typed.at) === JSON.stringify(['family', 'susan']), 'at=' + JSON.stringify(typed.at))

    // ── D. travel — choosing a destination outranks the way back in ──────
    const travel = await page.evaluate(async () => {
      const ioc = window.ioc
      const vm = ioc.get('@hypercomb.social/ViewMode')
      const lineage = ioc.get('@hypercomb.social/Lineage')
      const nav = ioc.get('@hypercomb.social/Navigation')
      const bus = globalThis.__hypercombEffectBus
      const here = () => [...(lineage.explorerSegments?.() ?? [])]
      const settle = (ms) => new Promise(r => setTimeout(r, ms))
      vm.setMode('hexagons')
      lineage.explorerReplace(['family', 'susan'])
      bus.emit('tile:action', { action: 'view-enter:tree', label: 'behaviors' })
      const stop = Date.now() + 4000
      while (Date.now() < stop && vm.mode !== 'tree') await settle(60)
      // The view's own travel path, in its own order: hexagons first, then
      // go where the node points. Clicking a node runs exactly these two.
      vm.setMode('hexagons')
      nav.goRaw(['work', 'ledger'])
      await settle(200)
      return { mode: vm.mode, at: here() }
    })
    console.log('    travel  →', JSON.stringify(travel))
    check('D. traveling to a node lands on the node, not on the way in',
      JSON.stringify(travel.at) === JSON.stringify(['work', 'ledger']), 'at=' + JSON.stringify(travel.at))

    // The hive is empty, so the fabricated cells have nothing to walk —
    // those misses are the scenario, not a fault. Anything else is.
    const faults = errors.filter(e => !/404/.test(e))
    check('no page errors', faults.length === 0, faults.slice(0, 3).join(' | '))
  } finally {
    await shot('03-final')
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
