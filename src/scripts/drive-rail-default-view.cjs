#!/usr/bin/env node
// drive-rail-default-view — the header rail's THIRD gesture on a view icon.
//
//   node scripts/drive-rail-default-view.cjs [--url http://localhost:4253]
//                                            [--out <dir>] [--engine chrome]
//
// One icon on the rail now carries three meanings, and this walks them on a
// live shell:
//
//   click        enter / leave the view
//   ctrl-click   make it the LAYER'S DEFAULT — the face it opens as — and
//                ctrl-click again to clear the mark
//   long-press   turn the view off here (unchanged, not driven here)
//
// It also proves the two things the mark exists for:
//   • back on the HEXAGONS the marked icon is still marked — that is the whole
//     point, since every toggle is off there and the ring is the only thing
//     that says which face the place opens as
//   • the rail gesture does NOT open the Beehaviors panel over the hive
//     (`silent`) — its answer is the icon lighting up
//
// Vendor-neutral: Playwright against the dev server, no bridge. `--engine
// chrome` is the one with a GPU — headless chromium cannot initialize Pixi's
// shaders and never leaves the splash.

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

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({
    headless: !process.argv.includes('--headed'),
    ...opts,
    // classic scrollbars, so the shell is measured the way Windows draws it
    args: ['--disable-features=OverlayScrollbar'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  const mode = () => page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
  const toHexagons = async () => {
    for (let i = 0; i < 3 && (await mode()) !== 'hexagons'; i++) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1500)
    }
  }
  const rail = page.locator('.rail-btn.view-toggle-btn')
  const marked = page.locator('.rail-btn.view-toggle-btn.is-default')

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await shot('01-hive')

    // ── a view has to be ON here before the rail carries its icon ──────
    const beeBtn = page.locator('.rail-btn.features-toggle-btn').first()
    if (await beeBtn.count()) { await beeBtn.click(); await page.waitForTimeout(2500) }
    const panel = page.locator('.features-panel')
    check('the Beehaviors panel opened', (await panel.count()) > 0)
    const target = panel.locator('.features-row.view.off:not(.inherited)').first()
    let named = ''
    if (await target.count()) {
      named = (await target.locator('.feature-name').first().innerText().catch(() => '')).trim()
      await target.click()
      await page.waitForTimeout(4000)
    }
    check('a view was turned on here', named !== '', named)
    if (await beeBtn.count()) { await beeBtn.click(); await page.waitForTimeout(1200) }
    await toHexagons()
    await shot('02-rail')

    const count = await rail.count()
    check('the rail carries the view icon', count > 0, count + ' view toggle(s)')
    check('nothing is marked as the default yet', (await marked.count()) === 0)

    // ── ctrl-click: the layer's DEFAULT ────────────────────────────────
    const view = await rail.first().getAttribute('title')
    await rail.first().click({ modifiers: ['Control'] })
    await page.waitForTimeout(6000)
    check('the rail gesture did NOT open the Beehaviors panel',
      (await page.locator('.features-panel').count()) === 0)
    await shot('03-marked')

    await toHexagons()
    await page.waitForTimeout(1500)
    const markedNow = await marked.count()
    check('ctrl-click marked exactly one icon as the default',
      markedNow === 1, markedNow + ' marked (' + view + ')')

    // THE MARK IS A RECORD, not a highlight — a reload has to land on the
    // view, which is the only thing that proves the decoration was written.
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(12000)
    const arrived = await mode()
    check('the layer OPENS AS that view after a reload',
      !!arrived && arrived !== 'hexagons', 'mode=' + arrived)

    // And back on the hexagons the mark still reads — the whole point.
    await toHexagons()
    await page.waitForTimeout(1500)
    check('back on the hexagons the mark still reads',
      (await mode()) === 'hexagons' && (await marked.count()) === 1,
      'mode=' + (await mode()) + ', marked=' + (await marked.count()))
    await shot('04-hexagons-marked')

    const paint = await page.evaluate(() => {
      const el = document.querySelector('.rail-btn.view-toggle-btn.is-default')
      if (!el) return null
      const s = getComputedStyle(el)
      const glyph = el.querySelector('.mat-sym')
      return {
        color: s.color,
        shadow: s.boxShadow,
        fill: glyph ? getComputedStyle(glyph).fontVariationSettings : null,
      }
    })
    const violet = !!paint && /200,\s*184,\s*255/.test(paint.color + paint.shadow)
    check('the marked icon wears the accent ring', violet, JSON.stringify(paint))

    // ── a plain click still enters the view ────────────────────────────
    await rail.first().click()
    await page.waitForTimeout(3000)
    const entered = await mode()
    check('a plain click still enters the view', entered !== 'hexagons', 'mode=' + entered)
    await toHexagons()

    // ── ctrl-click again: the mark clears ──────────────────────────────
    await rail.first().click({ modifiers: ['Control'] })
    await page.waitForTimeout(6000)
    await toHexagons()
    const stillMarked = await marked.count()
    check('ctrl-clicking the marked icon clears the mark',
      stillMarked === 0, stillMarked + ' still marked')
    await shot('05-cleared')
  } finally {
    const real = errors.filter(e => !/Could not initialize shader|favicon|ResizeObserver/i.test(e))
    if (real.length) console.log('\npage errors:\n  ' + real.slice(0, 8).join('\n  '))
    else console.log('\nno page errors')
    console.log('\nshots in ' + out)
    const failed = results.filter(r => !r.ok).length
    console.log(failed ? failed + ' CHECK(S) FAILED' : 'all ' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed ? 1 : 0
  }
}

main().catch(e => { console.error(e); process.exit(1) })
