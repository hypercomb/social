#!/usr/bin/env node
// drive-site-exit-spawn — proves that LEAVING A WEBSITE COMES BACK OUT to the
// view and the page that spawned it, on a live shell.
//
//   node scripts/drive-site-exit-spawn.cjs [--url http://localhost:4251]
//                                          [--out <dir>] [--engine chrome]
//
// The bug: coming out of a site left the reader standing on the site's own
// cell, staring at the raw hexagons — whatever view they had been looking at
// when they stepped in, and wherever they had been standing, was thrown away
// in favour of a derived "entrance tile" and the default surface.
//
// The three transitions this drives are the real ones, straight through the
// shell's own services — no fixtures, no mocks:
//
//   A. ARRIVAL — the reader is looking at a view (a deck) on one page, walks
//      into a cell, and that cell's `view:default` mark opens the site as
//      they land (view.bee announces the verdict as `view:arrival`). Leaving
//      must put back BOTH halves: the deck, on the page they walked in from.
//   B. TOGGLE — the reader turns the site on while standing still. Nothing
//      spawned it from anywhere else, so leaving stays on that same cell.
//   C. INDIRECT — no session spawn at all (booted into website mode). Leaving
//      must never teleport someone who never chose to be anywhere else.
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
const DRIVE = (scenario) => {
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

  // Stand somewhere, looking at something.
  vm.setMode('hexagons')
  goto(scenario.from)
  if (scenario.view) vm.setMode(scenario.view)
  const spawnedIn = vm.mode
  const spawnedAt = here()

  // Step into the site.
  if (scenario.walk) goto(scenario.at)
  vm.setMode('website')
  // An ARRIVAL is view.bee's verdict that this cell's own mark opened the
  // surface; a TOGGLE has no verdict, which is exactly the difference.
  if (scenario.arrival) bus.emit('view:arrival', { segments: here(), view: 'website' })
  // …and read a page or two inside it, the way a reader does.
  for (const page of scenario.read ?? []) goto([...scenario.at, page])
  const readAt = here()

  // Come back out — every exit path names the hexagons; the drone decides
  // where that actually lands.
  vm.setMode('hexagons')
  return { spawnedIn, spawnedAt, readAt, mode: vm.mode, at: here() }
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
      ready = await page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/SiteViewDrone'))
    }
    await shot('01-hive')
    check('the site renderer is up', ready)
    if (!ready) throw new Error('the shell never finished booting')

    // ── A. arrival: a deck on one page, a site on the next ───────────────
    const arrival = await page.evaluate(DRIVE, {
      from: ['family'], at: ['family', 'susan'],
      view: 'square-tile-view', walk: true, arrival: true,
      read: ['about', 'updates'],
    })
    console.log('    arrival →', JSON.stringify(arrival))
    check('A. leaving returns to the VIEW that spawned the site',
      arrival.mode === 'square-tile-view', 'mode=' + arrival.mode)
    check('A. leaving returns to the PAGE that spawned the site',
      JSON.stringify(arrival.at) === JSON.stringify(['family']), 'at=' + JSON.stringify(arrival.at))
    check('A. it does NOT strand the reader on the page they were reading',
      JSON.stringify(arrival.at) !== JSON.stringify(arrival.readAt))
    await shot('02-after-arrival-exit')

    // ── B. toggle: turned on while standing still ────────────────────────
    const toggle = await page.evaluate(DRIVE, {
      from: ['family', 'susan'], at: ['family', 'susan'],
      view: '', walk: false, arrival: false, read: ['about'],
    })
    console.log('    toggle  →', JSON.stringify(toggle))
    check('B. a site toggled on in the hexagons comes back to the hexagons',
      toggle.mode === 'hexagons', 'mode=' + toggle.mode)
    check('B. …on the very cell it was toggled on, not the page read inside',
      JSON.stringify(toggle.at) === JSON.stringify(['family', 'susan']), 'at=' + JSON.stringify(toggle.at))

    // ── C. indirect: no spawn to remember ────────────────────────────────
    const indirect = await page.evaluate(() => {
      const vm = window.ioc?.get('@hypercomb.social/ViewMode')
      const lineage = window.ioc?.get('@hypercomb.social/Lineage')
      const here = () => [...(lineage.explorerSegments?.() ?? [])]
      lineage.explorerReplace(['family', 'susan', 'about'])
      vm.setMode('website')
      // Wipe the session the way a reload does: the renderer keeps no spawn
      // across one, which is what makes this the indirect case.
      window.ioc.get('@diamondcoreprocessor.com/SiteViewDrone')?.dispose?.()
      vm.setMode('hexagons')
      return { mode: vm.mode, at: here() }
    })
    console.log('    indirect→', JSON.stringify(indirect))
    check('C. an indirect session never teleports the reader',
      JSON.stringify(indirect.at) === JSON.stringify(['family', 'susan', 'about']),
      'at=' + JSON.stringify(indirect.at))

    // The hive is empty, so the fabricated pages have no content to fetch —
    // those 404s are the scenario, not a fault. Anything else is.
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
