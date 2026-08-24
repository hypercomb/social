#!/usr/bin/env node
// drive-arrival-surface — proves a layer with a DEFAULT VIEW opens SEAMLESSLY:
// the view is the FIRST thing that renders, and the hexagons are never
// painted underneath it (the ARRIVAL GATE in show-cell + the pre-paint
// verdict in view.bee).
//
//   node scripts/drive-arrival-surface.cjs [--url http://localhost:4253]
//                                          [--out <dir>] [--engine chrome]
//
// Flow:
//   1. boot a fresh hive (Start empty), open Beehaviors, turn a view ON here
//      and press its icon — the layer's DEFAULT (same setup as
//      drive-default-view.cjs)
//   2. reload WITH A RECORDER injected at document-start: it subscribes to
//      the EffectBus the moment it exists and logs every `render:cell-count`
//      and `view:arrival` payload
//   3. assert the seamless arrival ORDER:
//        - the surface comes up as the view, not hexagons
//        - the GATE HELD: not one paint pass completed before the verdict —
//          the view is what the splash reveals
//        - a view:arrival verdict with a non-empty view was announced
//        - the splash is gone
//        - the view is FED: a completed paint pass follows the verdict (the
//          resolved cells are the tile roster the deck-shaped views read;
//          the paint lands under the covered canvas)
//   4. Escape — mode returns to hexagons, onto the already-warm mesh.
//
// `--engine chrome` required: headless chromium cannot initialize Pixi's
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

// Injected at document-start on the reload: subscribes to the EffectBus as
// soon as it exists and records the two signals the arrival contract is made
// of. Fresh EffectBus per page load, so replay can only deliver THIS boot's
// values.
const RECORDER = `(() => {
  window.__arrivalLog = []
  const t0 = Date.now()
  const poll = () => {
    const bus = window.__hypercombEffectBus
    if (bus && bus.on) {
      bus.on('render:cell-count', p => window.__arrivalLog.push(
        { t: Date.now() - t0, kind: 'cell-count', count: p && p.count, settled: !!(p && p.settled) }))
      bus.on('view:arrival', p => window.__arrivalLog.push(
        { t: Date.now() - t0, kind: 'arrival', view: (p && p.view) || '', segs: (p && p.segments) || [] }))
      return
    }
    setTimeout(poll, 25)
  }
  poll()
})()`

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/arrival-surface')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  try {
    // ── 1. fresh hive + a default view on this layer ───────────────────
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    const beeBtn = page.locator('.rail-btn.features-toggle-btn, [aria-label*="eehavior" i]').first()
    if (await beeBtn.count()) await beeBtn.click()
    await page.waitForTimeout(2500)
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

    const iconBtn = panel.locator('.features-row.view.lit .feature-icon.as-default').first()
    if (await iconBtn.count()) { await iconBtn.click(); await page.waitForTimeout(4000) }
    check('the view was made the layer default',
      (await panel.locator('.feature-icon.as-default.is-default').count()) === 1)
    await shot('01-default-set')

    // ── 2. reload with the recorder listening from document-start ──────
    await context.addInitScript(RECORDER)
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(12000)
    await shot('02-arrival')

    const boot = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      splash: !!document.getElementById('hc-splash'),
      log: window.__arrivalLog || [],
    }))
    console.log('  info  boot log =', JSON.stringify(boot.log))

    // ── 3. the seamless arrival ─────────────────────────────────────────
    check('the surface comes up as the view', !!boot.mode && boot.mode !== 'hexagons',
      'mode=' + boot.mode)
    const verdicts = boot.log.filter(e => e.kind === 'arrival' && e.view)
    check('the arrival verdict was announced', verdicts.length > 0,
      verdicts.map(v => v.view).join(','))
    // The strongest claim: the GATE HELD. Not one paint pass COMPLETED before
    // the verdict — no count>0, no settled empty. Unsettled zeroes are the
    // early "pixi not ready" clearMesh bails, the same not-ready transients
    // the splash ignores: nothing was on screen for them.
    const firstVerdictAt = verdicts.length ? verdicts[0].t : Infinity
    const paintsBefore = boot.log.filter(e =>
      e.kind === 'cell-count' && (e.count > 0 || e.settled) && e.t < firstVerdictAt)
    check('the gate held — no paint pass completed before the verdict',
      paintsBefore.length === 0, paintsBefore.length + ' pass(es) before t=' + firstVerdictAt)
    // ...and the paint still HAPPENS, after the flip: the resolved cells are
    // the tile roster the views feed on. Skipping it entirely was the
    // "no tiles until toggled back" bug.
    const paintsAfter = boot.log.filter(e =>
      e.kind === 'cell-count' && (e.count > 0 || e.settled) && e.t >= firstVerdictAt)
    check('the view is fed — a completed paint pass follows the verdict',
      paintsAfter.length > 0, paintsAfter.length + ' pass(es) after t=' + firstVerdictAt)
    check('the splash dismissed off the verdict', boot.splash === false,
      boot.splash ? 'splash still up' : 'gone')

    // ── 4. THE WAY OUT ─────────────────────────────────────────────────
    // The exits (Escape, ×, right-click) must take you OUT of the view —
    // otherwise the hexagons and the rest of the interface are unreachable
    // once a marked layer opens (Jaime). The mesh painted under the covered
    // canvas is what makes the reveal instant.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(3500)
    await shot('03-escaped')
    const back = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
    }))
    check('Escape takes you out — hexagons are reachable again', back.mode === 'hexagons', 'mode=' + back.mode)
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

main().catch(e => { console.error(e); process.exitCode = 1 })
