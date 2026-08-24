#!/usr/bin/env node
// drive-arrival-practice — Jaime's drill: mark BOTH the root and a child
// ("behaviors") with default views, then PRACTICE SWITCHING between them and
// screenshot every beat. The rule under test: a layer marked as opening in a
// view must NEVER show its hexagon tiles — not at rest, not mid-transition.
//
//   node scripts/drive-arrival-practice.cjs [--url http://localhost:4253]
//                                           [--out <dir>] [--engine chrome]
//
// A page-side sampler polls every 80ms: {mode, covered-class, canvas
// visibility, rendered cell count}. "Tiles visible" = rendered cells > 0
// while the canvas is actually visible. The go()-switching legs must have
// ZERO such samples. The gesture exits (right-click back, Escape) are
// sampled and screenshotted too, and reported — they are where the hexagon
// stop lives.

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

const SAMPLER = `(() => {
  if (window.__practice) return
  const log = []
  window.__practice = { log, mark: (m) => log.push({ t: Date.now(), mark: m }) }
  setInterval(() => {
    try {
      const vm = window.ioc?.get?.('@hypercomb.social/ViewMode')
      const sc = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const canvas = document.querySelector('#pixi-host canvas') || document.getElementById('pixi-host')
      log.push({
        t: Date.now(),
        mode: vm?.mode ?? '',
        covered: document.body.classList.contains('hc-view-covered'),
        canvas: canvas ? getComputedStyle(canvas).visibility : 'none',
        cells: sc?.snapshotCells?.().length ?? -1,
      })
    } catch (e) { log.push({ t: Date.now(), err: String(e).slice(0, 80) }) }
  }, 80)
})()`

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/arrival-practice')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const mode = () => page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
  const go = (segs) => page.evaluate((s) => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    if (s.length) nav?.go?.(s); else nav?.go?.([])
  }, segs)
  const markBeat = (m) => page.evaluate((x) => window.__practice?.mark(x), m)

  // Set a view as THIS layer's default via the Beehaviors panel. Picks the
  // Nth available (off, non-inherited) view row so root and child can wear
  // DIFFERENT views. Returns the row's name ('' = nothing available).
  async function markLayerDefault(nth) {
    const beeBtn = page.locator('.rail-btn.features-toggle-btn, [aria-label*="eehavior" i]').first()
    if (!(await page.locator('.features-panel').count()) && await beeBtn.count()) {
      await beeBtn.click().catch(() => {})
      await page.waitForTimeout(2000)
    }
    const panel = page.locator('.features-panel')
    if (!(await panel.count())) return ''
    const rows = panel.locator('.features-row.view.off:not(.inherited)')
    const n = Math.min(nth, Math.max(0, (await rows.count()) - 1))
    const row = rows.nth(n)
    if (!(await row.count())) return ''
    const named = (await row.locator('.feature-name').first().innerText().catch(() => '')).trim()
    await row.click()
    await page.waitForTimeout(3500)
    const icon = panel.locator('.features-row.view.lit .feature-icon.as-default').last()
    if (await icon.count()) { await icon.click(); await page.waitForTimeout(3000) }
    return named
  }

  try {
    // ── setup: a hive with a "behaviors" child, both layers marked ──────
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    // a child to practice against
    await page.evaluate(async () => {
      const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
      if (!input) return
      input.focus(); input.value = 'behaviors'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 150))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    })
    await page.waitForTimeout(3000)

    const rootView = await markLayerDefault(0)
    check('the root wears a default view', rootView !== '', rootView)
    await shot('01-root-marked')

    await go(['behaviors']); await page.waitForTimeout(3000)
    const childView = await markLayerDefault(0)
    check('behaviors wears a default view', childView !== '', childView)
    check('both layers wear a default view', !!rootView && !!childView,
      rootView + ' / ' + childView)
    await shot('02-behaviors-marked')

    // ── the practice: switch, switch, switch ────────────────────────────
    await page.evaluate(SAMPLER)
    const legs = [
      { segs: [], name: 'root' },
      { segs: ['behaviors'], name: 'behaviors' },
      { segs: [], name: 'root' },
      { segs: ['behaviors'], name: 'behaviors' },
      { segs: [], name: 'root' },
    ]
    let i = 0
    const settled = []
    for (const leg of legs) {
      i++
      await markBeat(`leg-${i}-${leg.name}:go`)
      await go(leg.segs)
      await page.waitForTimeout(300)
      await shot(`1${i}-leg-${leg.name}-early`)
      await page.waitForTimeout(2200)
      const settledMode = await mode()
      settled.push({ leg: i, name: leg.name, mode: settledMode })
      await markBeat(`leg-${i}-${leg.name}:settled mode=${settledMode}`)
      await shot(`1${i}-leg-${leg.name}-settled`)
    }
    const hexStops = settled.filter(l => l.mode === 'hexagons')
    check('every leg SETTLES on a view — marked layers never rest on hexagons',
      hexStops.length === 0, JSON.stringify(settled))

    const practice = await page.evaluate(() => window.__practice.log)
    const leak = practice.filter(s => !s.mark && s.cells > 0 && s.canvas === 'visible')
    check('SWITCHING NEVER SHOWS TILES — zero visible-tile samples across 5 legs',
      leak.length === 0,
      leak.length + ' leaked sample(s): ' + JSON.stringify(leak.slice(0, 4)))
    const modesSeen = [...new Set(practice.filter(s => s.mode).map(s => s.mode))]
    console.log('  info  modes seen while switching =', modesSeen.join(', '))
    check('both arrival views actually took the surface during practice',
      modesSeen.filter(m => m !== 'hexagons').length >= 1, modesSeen.join(','))

    // ── the gesture exits — where the hexagon stop lives today ──────────
    const before = await page.evaluate(() => window.__practice.log.length)
    await markBeat('right-click-back')
    await page.mouse.click(720, 450, { button: 'right' })
    await page.waitForTimeout(2500)
    await shot('20-after-right-click')
    const rc = await page.evaluate((n) => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      segs: window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
      leak: (window.__practice?.log ?? []).slice(n).filter(s => !s.mark && s.cells > 0 && s.canvas === 'visible').length,
    }), before)
    console.log('  info  right-click at root arrival →', JSON.stringify(rc))
    check('right-click on an arrival face never lands on tiles (leaves the place, or the face holds at the root)',
      rc.leak === 0 && rc.mode !== 'hexagons', 'mode=' + rc.mode + ' leaked=' + rc.leak)

    await page.evaluate(SAMPLER)   // survive any reload the gesture caused
    const before2 = await page.evaluate(() => window.__practice.log.length)
    await markBeat('escape')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2500)
    await shot('21-after-escape')
    const esc = await page.evaluate((n) => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      leak: (window.__practice?.log ?? []).slice(n).filter(s => !s.mark && s.cells > 0 && s.canvas === 'visible').length,
    }), before2)
    check('Escape off an arrival face never lands on tiles (leaves the place, or the face holds at the root)',
      esc.leak === 0 && esc.mode !== 'hexagons', 'mode=' + esc.mode + ' leaked=' + esc.leak)
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
