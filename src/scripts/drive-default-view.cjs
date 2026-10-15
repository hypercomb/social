#!/usr/bin/env node
// drive-default-view — proves the Beehaviors row's three parts on a live shell.
//
//   node scripts/drive-default-view.cjs [--url http://localhost:4253]
//                                       [--out <dir>] [--engine chrome]
//
// Walks a real browser through the gesture the panel now owns:
//
//   1. boot a fresh hive (Start empty)
//   2. open Beehaviors from the rail — and confirm the rail no longer carries
//      a Views button of its own
//   3. read the rows: some are views, some are not
//   4. turn a view ON here (the bulb) — a lit view stands on its own ground
//      (the quiet list: the hue is there ONLY while lit) — then press its
//      ICON, the layer's DEFAULT, and confirm only ONE row carries it
//   5. the two controls above the list: the KIND (Beehaviors / Views, exactly
//      one lit; Views narrows the list to views) and the SCOPE (this layer /
//      the pool)
//   6. close the panel — while it shows, the surface is held on hexagons
//      (view.bee.ts) — reload, and the layer OPENS AS its default; Escape
//      back to the hexagons sticks
//
// Vendor-neutral: Playwright against the dev server, no bridge, no renderer to
// attach to. `--engine chrome` is the one that has a GPU: headless chromium
// cannot initialize Pixi's shaders and never leaves the splash.

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
  const browser = await type.launch({ headless: true, ...opts })
  const shot = async (name) => {
    await page.screenshot({ path: path.join(out, name + '.png') })
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  const missing = new Set()
  page.on('pageerror', e => errors.push(String(e)))
  // A console 404 names no URL; the response does. Misses are listed apart —
  // a fresh hive probes for content it does not hold yet.
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('response', r => { if (r.status() >= 400) missing.add(r.status() + ' ' + new URL(r.url()).pathname) })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)

    // ── 1. a fresh hive ────────────────────────────────────────────────
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click()
      await page.waitForTimeout(2500)
    }
    await shot('01-hive')

    // ── 2. the rail ────────────────────────────────────────────────────
    const viewsBtn = page.locator('.rail-btn.views-toggle-btn')
    check('the Views rail button is gone', (await viewsBtn.count()) === 0,
      (await viewsBtn.count()) + ' found')

    const beeBtn = page.locator('.rail-btn.features-toggle-btn, [aria-label*="eehavior" i]').first()
    if (await beeBtn.count()) await beeBtn.click()
    else await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/EffectBus'))
    await page.waitForTimeout(2500)

    let panel = page.locator('.features-panel')
    if (!(await panel.count())) {
      // Fall back to the command line, which is how /views reaches it too.
      await page.keyboard.press('Escape')
      await page.locator('.command-input, input.shell-input, [role="combobox"]').first()
        .fill('/beehaviors')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(2500)
      panel = page.locator('.features-panel')
    }
    check('the Beehaviors panel opened', (await panel.count()) > 0)
    await shot('02-panel')

    // ── 3. the rows ────────────────────────────────────────────────────
    const rows = panel.locator('.features-row')
    const total = await rows.count()
    const viewRows = panel.locator('.features-row.view')
    const views = await viewRows.count()
    check('rows rendered', total > 0, total + ' rows')
    check('some rows are VIEWS, some are not', views > 0 && views < total,
      views + ' of ' + total + ' rows are views')

    // ── 4. the bulb, then the icon ─────────────────────────────────────
    // Pick a view row that is not lit and not inherited, turn it on, then
    // press its icon.
    const target = panel.locator('.features-row.view.off:not(.inherited)').first()
    let named = ''
    if (await target.count()) {
      named = (await target.locator('.feature-name').first().innerText().catch(() => '')).trim()
      await target.click()
      await page.waitForTimeout(4000)
      await shot('03-deposited')
    }
    check('a view was turned on here', named !== '', named)

    // The quiet list: a view is told apart by its hue, and ONLY while lit —
    // a dark view row looks like any other dark row.
    const grounds = await page.evaluate(() => {
      const bg = (el) => el ? getComputedStyle(el).backgroundColor : null
      const all = [...document.querySelectorAll('.features-panel .features-row')]
      return {
        litView: bg(all.find(e => e.classList.contains('view') && e.classList.contains('lit'))),
        darkView: bg(all.find(e => e.classList.contains('view') && e.classList.contains('off'))),
        darkOther: bg(all.find(e => !e.classList.contains('view') && e.classList.contains('off'))),
      }
    })
    check('a lit view stands on its own ground; a dark one does not',
      !!grounds.litView && grounds.litView !== grounds.darkView && grounds.darkView === grounds.darkOther,
      JSON.stringify(grounds))

    const litView = panel.locator('.features-row.view.lit').first()
    const iconBtn = litView.locator('.feature-icon.as-default')
    check('a lit view row offers its icon as a control', (await iconBtn.count()) > 0)

    if (await iconBtn.count()) {
      await iconBtn.first().click()
      await page.waitForTimeout(4000)
      await shot('04-default')
      const marked = await panel.locator('.feature-icon.as-default.is-default').count()
      check('exactly one row carries the default', marked === 1, marked + ' marked')
      const tint = await page.evaluate(() => {
        const el = document.querySelector('.features-panel .feature-icon.as-default.is-default')
        return el ? getComputedStyle(el).borderColor + ' / ' + getComputedStyle(el).backgroundImage.slice(0, 50) : null
      })
      check('the default icon is tinted', !!tint, String(tint))

      const record = await page.evaluate(async () => {
        const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
        const segs = (lineage?.explorerSegments?.() ?? []).slice()
        const mod = window.__hcViewDefault
        return { segs, probe: typeof mod }
      })
      console.log('  info  layer =', JSON.stringify(record.segs))
    }

    // ── 5. the kind and the scope ──────────────────────────────────────
    // KIND: a choice between two, exactly one lit; Views narrows the same
    // list to the views, Beehaviors (views included) filters nothing.
    const kinds = async () => ({
      behaviors: await panel.locator('.scope-kind.behaviors.on').count(),
      views: await panel.locator('.scope-kind.views.on').count(),
      rows: await panel.locator('.features-row').count(),
      viewRows: await panel.locator('.features-row.view').count(),
    })
    const asBehaviors = await kinds()
    await panel.locator('.scope-kind.views').first().click()
    await page.waitForTimeout(800)
    const asViews = await kinds()
    await panel.locator('.scope-kind.behaviors').first().click()
    await page.waitForTimeout(800)
    const back = await kinds()
    check('the kind is a choice of two — Views narrows the list to views, Beehaviors filters nothing',
      asBehaviors.behaviors === 1 && asBehaviors.views === 0
        && asViews.views === 1 && asViews.behaviors === 0
        && asViews.rows === asViews.viewRows && asViews.rows === asBehaviors.viewRows
        && back.rows === asBehaviors.rows,
      `beehaviors ${asBehaviors.rows} rows, views ${asViews.rows}, back ${back.rows}`)

    // SCOPE: one toggle — this layer, or the pool (no kind choice there).
    await panel.locator('.scope-toggle').first().click()
    await page.waitForTimeout(1200)
    const inPool = {
      pressed: await panel.locator('.scope-toggle.pool').count(),
      store: await panel.locator('.features-scroll.store').count(),
      kinds: await panel.locator('.scope-kind').count(),
    }
    await shot('05-pool')
    await panel.locator('.scope-toggle').first().click()
    await page.waitForTimeout(1200)
    const backHere = await panel.locator('.features-scroll.store').count()
    check('the scope toggles between this layer and the pool',
      inPool.pressed === 1 && inPool.store === 1 && inPool.kinds === 0 && backHere === 0,
      JSON.stringify({ ...inPool, backHere }))

    // ── 6. ARRIVAL — the whole point ───────────────────────────────────
    // Close the panel first: while it shows, the surface is held on the
    // hexagons (view.bee.ts — Beehaviors is an assignment). Then reload onto
    // the layer that names a default. The surface must come up as that view
    // rather than as hexagons, and it must survive the boot guard (one
    // settled paint) rather than racing it.
    await panel.locator('.features-close').first().click()
    await page.waitForTimeout(1500)
    check('the panel closes', (await page.locator('.features-panel').count()) === 0)
    const wanted = await page.evaluate(() =>
      window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(12000)
    const arrived = await page.evaluate(() =>
      window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
    check('the layer OPENS AS its default view after a reload',
      !!arrived && arrived !== 'hexagons', 'mode=' + arrived + ' (was ' + wanted + ')')
    await shot('06-arrival')

    // And escaping back to the hexagons must STICK — the latch is what stops
    // the next recompute shoving the view back up.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(3500)
    const afterEscape = await page.evaluate(() =>
      window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
    check('escaping back to the hexagons sticks', afterEscape === 'hexagons',
      'mode=' + afterEscape)
    await shot('07-escaped')
  } finally {
    const real = errors.filter(e => !/Could not initialize shader|favicon|ResizeObserver/i.test(e))
    if (real.length) console.log('\npage errors:\n  ' + real.slice(0, 8).join('\n  '))
    else console.log('\nno page errors')
    if (missing.size) console.log('\nmisses (info):\n  ' + [...missing].slice(0, 12).join('\n  '))
    console.log('\nshots in ' + out)
    const failed = results.filter(r => !r.ok).length
    console.log(failed ? failed + ' CHECK(S) FAILED' : 'all ' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed ? 1 : 0
  }
}

main().catch(e => { console.error(e); process.exit(1) })
