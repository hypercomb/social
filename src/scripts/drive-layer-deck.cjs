#!/usr/bin/env node
// drive-layer-deck — prove the phone's Views sheet opens, is a sheet of big
// plates, and that the hardware BACK button closes it.
//
//   node scripts/drive-layer-deck.cjs [--port 4254] [--out layer-deck] [--engine msedge]
//
// Boots the dev shell phone-shaped (390×844) with the mobile override forced
// ON, seeds the example hive, walks into it, then:
//
//   1. emits `layer:deck-open` (what the bar's VIEWS disc emits) and asserts
//      the <hc-layer-deck> surface is visible with at least three plates and
//      its group headings;
//   2. `history.back()` — the hardware BACK — closes it, and the lineage is
//      where it was;
//   3. emits it again in landscape (844×390) and asserts ONE row of plates.
//
// HEADLESS HAS NO GPU and Pixi never builds its mesh without one, so this
// drives a headed real browser (msedge by default). PASS exit 0, FAIL 1,
// crash 2.

const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** Everything the sheet says about itself, in one read. */
const SHEET = () => {
  const el = document.querySelector('hc-layer-deck')
  if (!el) return { mounted: false }
  const box = n => {
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }
  }
  const visible = getComputedStyle(el).display !== 'none' && el.childElementCount > 0
  const pages = Array.from(el.querySelectorAll('[data-role="deck-page"]'))
  return {
    mounted: true,
    visible,
    plates: el.querySelectorAll('[data-hc-tv-app]').length,
    pages: pages.length,
    rowsOnFirstPage: pages[0]?.children.length ?? 0,
    cols: el.querySelector('[data-role="app-deck"]')?.dataset?.cols ?? null,
    rows: el.querySelector('[data-role="app-deck"]')?.dataset?.rows ?? null,
    title: el.querySelector('[data-role="deck-title"]')?.textContent ?? null,
    count: el.querySelector('[data-role="deck-count"]')?.textContent ?? null,
    dock: Array.from(el.querySelectorAll('[data-role="deck-dock"] [data-hc-tv-app]')).map(b => b.getAttribute('aria-label')),
    names: Array.from(el.querySelectorAll('[data-role="deck-page"] [data-hc-tv-app]')).map(b => b.getAttribute('aria-label')),
    sheetBox: box(el.querySelector('[data-role="sheet"]')),
    // Does the whole sheet land, or must the close plate be scrolled to?
    sheetScroll: (() => {
      const s = el.querySelector('[data-role="sheet"]')
      return s ? { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight } : null
    })(),
    dockBox: box(el.querySelector('[data-role="deck-dock"]')),
    z: getComputedStyle(el).zIndex,
    viewActive: window.__hypercombEffectBus?.lastValue?.get('view:active')?.active ?? null,
    segments: window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
    viewport: { w: innerWidth, h: innerHeight },
  }
}

async function main() {
  const port = Number(arg('port', 4254))
  const out = String(arg('out', 'layer-deck'))
  const channel = String(arg('engine', 'msedge'))
  const browser = await chromium.launch({
    headless: false,
    ...(channel === 'chromium' ? {} : { channel }),
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({
      viewport: { ...PORTRAIT },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
    await context.addInitScript(() => {
      try { localStorage.setItem('hc:mobile-mode', 'on') } catch { /* ignore */ }
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    const clearSplash = () => page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('body > div'))) {
        const z = Number(getComputedStyle(el).zIndex || 0)
        if (z >= 100000) el.remove()
      }
    })
    const settle = async (ms) => { await page.waitForTimeout(ms); await clearSplash() }
    const waitForTiles = async () => {
      for (let i = 0; i < 60; i++) {
        const n = await page.evaluate(() =>
          (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
        if (n > 0) return n
        await page.waitForTimeout(500)
      }
      return 0
    }

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    await settle(6000)

    // Empty OPFS lands on the first-boot offer; take the example hive.
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await settle(10000)

    const rootCount = await waitForTiles()
    console.log(`tiles rendered at the root: ${rootCount}`)
    if (!rootCount) throw new Error('no tiles rendered')

    // Walk into the example hive so "add here" has a tile to mark.
    const hive = await page.evaluate(() => {
      const last = window.__hypercombEffectBus.lastValue.get('render:cell-count')
      return (last?.branchLabels ?? last?.labels ?? [])[0] ?? null
    })
    if (hive) {
      await page.evaluate(label => {
        window.__hypercombEffectBus.emit('tile:enter-request', { label })
      }, hive)
      await settle(4000)
      await waitForTiles()
    }
    await settle(1000)

    const before = await page.evaluate(SHEET)
    check('surface is mounted by the registry', before.mounted === true)
    check('sheet is hidden until asked', before.visible === false)

    // ── 1. the disc's effect opens the sheet ──────────────────────────
    await page.evaluate(() => { window.__hypercombEffectBus.emit('layer:deck-open', {}) })
    await page.waitForTimeout(900)
    const open = await page.evaluate(SHEET)
    console.log('\nOPEN', JSON.stringify({ ...open, names: open.names?.length }))
    check('sheet is visible', open.visible === true)
    check('at least three plates', open.plates >= 3, `${open.plates} plates: ${JSON.stringify(open.names)}`)
    check('it is a bottom sheet inside the viewport',
      !!open.sheetBox && open.sheetBox.bottom <= open.viewport.h + 1 && open.sheetBox.y > open.viewport.h * 0.3,
      JSON.stringify(open.sheetBox))
    check('above the bar', Number(open.z) > 60000, open.z)
    check('it is chrome — view:active is not held', open.viewActive !== true)
    check('dock is a named close plate', open.dock.length === 1 && !!open.dock[0], JSON.stringify(open.dock))
    check('portrait: two rows of four', open.cols === '4' && open.rows === '2', `${open.cols}×${open.rows}`)
    await page.screenshot({ path: path.resolve(`${out}-portrait.png`) })

    // ── 2. the hardware BACK closes it ────────────────────────────────
    const segmentsBefore = open.segments
    await page.evaluate(() => { history.back() })
    await page.waitForTimeout(900)
    const closed = await page.evaluate(SHEET)
    check('history.back() closes the sheet', closed.visible === false)
    check('the lineage did not move', JSON.stringify(closed.segments) === JSON.stringify(segmentsBefore),
      `${JSON.stringify(segmentsBefore)} → ${JSON.stringify(closed.segments)}`)

    // ── 3. landscape: one row across ──────────────────────────────────
    await page.setViewportSize({ ...LANDSCAPE })
    await page.evaluate(() => { window.dispatchEvent(new Event('orientationchange')) })
    await settle(1500)
    await page.evaluate(() => { window.__hypercombEffectBus.emit('layer:deck-open', {}) })
    await page.waitForTimeout(900)
    const wide = await page.evaluate(SHEET)
    console.log('\nLANDSCAPE', JSON.stringify({ ...wide, names: wide.names?.length }))
    check('landscape: sheet is visible', wide.visible === true)
    check('landscape: one row of six', wide.cols === '6' && wide.rows === '1' && wide.rowsOnFirstPage === 1, `${wide.cols}×${wide.rows}, rows ${wide.rowsOnFirstPage}`)
    check('landscape: the sheet fits', !!wide.sheetBox && wide.sheetBox.bottom <= wide.viewport.h + 1, JSON.stringify(wide.sheetBox))
    check('landscape: the close plate lands without a scroll',
      !!wide.sheetScroll && wide.sheetScroll.scrollHeight <= wide.sheetScroll.clientHeight + 1
        && !!wide.dockBox && wide.dockBox.bottom <= wide.viewport.h + 1,
      JSON.stringify({ ...wide.sheetScroll, dock: wide.dockBox }))
    check('portrait: the close plate lands without a scroll',
      !!open.sheetScroll && open.sheetScroll.scrollHeight <= open.sheetScroll.clientHeight + 1,
      JSON.stringify(open.sheetScroll))
    await page.screenshot({ path: path.resolve(`${out}-landscape.png`) })
    await page.evaluate(() => { window.__hypercombEffectBus.emit('layer:deck-close', {}) })
    await page.waitForTimeout(500)
    const done = await page.evaluate(SHEET)
    check('layer:deck-close puts it away', done.visible === false)

    if (errors.length) console.log(`\npage errors:\n  ${errors.slice(0, 8).join('\n  ')}`)
    const failed = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    process.exitCode = failed.length ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch(err => { console.error(err); process.exit(2) })
