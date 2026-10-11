#!/usr/bin/env node
// scripts/drive-behaviors-hold-hexagons.cjs
//
// WHILE THE BEEHAVIORS PANEL SHOWS, THE SURFACE IS THE HEXAGONS (jwize
// 2026-10-10: "the views take us away from the assignment"). Behaviours are
// applied to the tiles, so the panel and a view never share the screen.
//
//   1. a layer whose default view is postit opens AS postit (baseline)
//   2. opening the panel over that face peels it to the hexagons
//   3. walking out and back in with the panel up lands on the hexagons
//   4. closing the panel restores nothing — still the hexagons
//   5. entering a view while the panel is up closes the panel
//   6. with the panel shut, the layer opens as its face again
//
// Usage: node scripts/drive-behaviors-hold-hexagons.cjs --url http://localhost:4253
//        [--engine chrome|msedge|chromium] [--out test-results/behaviors-hold-hexagons]
// `--engine chrome` is the default: headless chromium cannot init Pixi shaders.

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

// Samples the surface and the panel every 80ms — the claim is that the two
// are NEVER up together, not just that each step settles right.
const SAMPLER = `(() => {
  if (window.__hold) return
  const log = []
  window.__hold = { log }
  setInterval(() => {
    try {
      log.push({
        t: Date.now(),
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
        panel: !!document.querySelector('.features-panel'),
      })
    } catch (e) { log.push({ t: Date.now(), err: String(e).slice(0, 80) }) }
  }, 80)
})()`

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/behaviors-hold-hexagons')))
  fs.mkdirSync(out, { recursive: true })
  const engine = String(arg('engine', 'chrome'))
  const browser = await chromium.launch({ headless: true, ...(engine === 'chromium' ? {} : { channel: engine }) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const mode = () => page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
  const panelUp = () => page.evaluate(() => !!document.querySelector('.features-panel'))
  const emit = (name, payload) => page.evaluate(({ n, p }) => window.__hypercombEffectBus?.emit?.(n, p), { n: name, p: payload })
  const go = (segs) => page.evaluate((s) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s), segs)
  const addTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
  const settle = async (ms, until) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (until && await until()) return true
      await page.waitForTimeout(150)
    }
    return until ? until() : true
  }

  // Light postit on the layer we stand in and make it the layer's face —
  // the panel row deposits the record, `features:default` writes the mark.
  async function markPostitDefault(segs) {
    await emit('features:context-open', {})
    await settle(4000, panelUp)
    const row = page.locator('.features-panel .features-row.view.off:not(.inherited)')
      .filter({ has: page.locator('.feature-name', { hasText: /post/i }) }).first()
    if (await row.count()) { await row.click(); await page.waitForTimeout(3000) }
    await emit('features:default',
      { cell: segs.length ? segs[segs.length - 1] : '/', segments: segs, view: 'postit', clear: false })
    await page.waitForTimeout(2500)
    await emit('features:viewer-close', {})
    await page.waitForTimeout(800)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await addTile('assign'); await page.waitForTimeout(2000)
    await go(['assign']); await page.waitForTimeout(2500)
    await addTile('inner'); await page.waitForTimeout(2000)
    await markPostitDefault(['assign'])
    await go([]); await page.waitForTimeout(2500)

    // 1. baseline
    await go(['assign'])
    const opened = await settle(6000, async () => (await mode()) === 'postit')
    check('baseline — the layer opens as its face (postit)', opened, await mode())
    await shot('01-face')

    await page.evaluate(SAMPLER)

    // 2. the panel peels the face
    await emit('features:context-open', {})
    await settle(4000, panelUp)
    const peeled = await settle(3000, async () => (await mode()) === 'hexagons')
    check('opening Beehaviors over the face peels it to hexagons', peeled && await panelUp(),
      `mode=${await mode()} panel=${await panelUp()}`)
    await shot('02-panel-peels')

    // 3. arrivals while the panel is up land on the grid
    await go([]); await page.waitForTimeout(2500)
    await go(['assign']); await page.waitForTimeout(3500)
    check('walking back in with the panel up lands on hexagons, panel still up',
      (await mode()) === 'hexagons' && await panelUp(), `mode=${await mode()} panel=${await panelUp()}`)
    await shot('03-arrival-held')

    // 4. closing restores nothing
    await emit('features:viewer-close', {})
    await page.waitForTimeout(2500)
    check('closing the panel restores nothing — still the hexagons',
      (await mode()) === 'hexagons' && !(await panelUp()), `mode=${await mode()} panel=${await panelUp()}`)

    // 5. entering a view with the panel up closes the panel
    await emit('features:context-open', {})
    await settle(4000, panelUp)
    await emit('view:toggle', { view: 'postit', mode: 'on' })
    const closed = await settle(3000, async () => !(await panelUp()))
    check('entering a view while the panel is up closes the panel',
      closed && (await mode()) === 'postit', `mode=${await mode()} panel=${await panelUp()}`)
    await shot('05-view-closes-panel')

    // THE INVARIANT across everything above
    const log = await page.evaluate(() => window.__hold.log)
    fs.writeFileSync(path.join(out, 'hold-log.json'), JSON.stringify(log, null, 1))
    const together = log.filter(s => s.panel && s.mode && s.mode !== 'hexagons')
    check('THE INVARIANT — the panel never shares the screen with a view (80ms samples)',
      together.length === 0, `${together.length} sample(s) of ${log.length}` +
        (together.length ? ': ' + JSON.stringify(together.slice(0, 3)) : ''))

    // 6. normal arrivals come back once the panel is shut
    await emit('view:toggle', { view: 'postit', mode: 'off' })
    await page.waitForTimeout(1000)
    await go([]); await page.waitForTimeout(2500)
    await go(['assign'])
    const back = await settle(6000, async () => (await mode()) === 'postit')
    check('panel shut — the layer opens as its face again', back, await mode())
    await shot('06-face-again')
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
