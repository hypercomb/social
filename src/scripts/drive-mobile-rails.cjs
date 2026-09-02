#!/usr/bin/env node
// drive-mobile-rails — prove the phone reads the hive in rails, by default,
// one direction only, turning with the device, and never writes a layer.
//
//   node scripts/drive-mobile-rails.cjs [--port 4254] [--out mobile-rails] [--engine msedge]
//
// Boots the dev shell phone-shaped (390×844) with the mobile override forced
// ON, seeds the example hive, and WITHOUT ever emitting `lanes:set` checks:
//
//   1. rails by default — `lanes:changed {active:true, lanes:3}` and the lane
//      viewport engaged; the rendered coordinates form rows of three
//      (portrait: three lanes across, the strip running down);
//   2. one-axis travel — PanningDrone.panBy moves the stage on Y only, and a
//      REAL touch drag (CDP Input.dispatchTouchEvent on the canvas) moves the
//      strip vertically and not at all horizontally; pinch does not zoom;
//   3. rotation — after the viewport turns landscape the coordinates form
//      columns walked left→right, the lock is X, and the hexes are flat-top;
//      turning back restores portrait;
//   4. no commit — walking into a child page and back keeps the rails, and no
//      `cell:reorder` (the arrangement commit's signal) was ever emitted.
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

/** Everything the page knows about its posture, in one read. */
const STATE = () => {
  const bus = window.__hypercombEffectBus
  const last = bus?.lastValue?.get('render:cell-count') ?? {}
  const pan = window.ioc?.get?.('@diamondcoreprocessor.com/PanningDrone')
  const stage = pan?.stage
  const at = () => ({ x: stage.position.x, y: stage.position.y })
  const push = (dx, dy) => {
    if (!pan?.panBy || !stage) return { x: 0, y: 0 }
    const before = at()
    pan.panBy({ x: dx, y: dy })
    const after = at()
    pan.panBy({ x: -(after.x - before.x), y: -(after.y - before.y) })
    return { x: after.x - before.x, y: after.y - before.y }
  }
  const zoom = window.ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone')
  const rail = window.ioc?.get?.('@diamondcoreprocessor.com/RailProjectionDrone')
  const axial = window.ioc?.get?.('@diamondcoreprocessor.com/AxialService')
  return {
    labels: (last.labels ?? []).map(String),
    coords: (last.coords ?? []).map(c => ({ q: c.q, r: c.r })),
    lanes: bus?.lastValue?.get('lanes:changed') ?? null,
    viewport: bus?.lastValue?.get('lanes:viewport') ?? null,
    orientation: bus?.lastValue?.get('render:set-orientation') ?? null,
    railActive: rail?.active ?? null,
    projected: axial?.projected ?? null,
    pushX: push(24, 0),
    pushY: push(0, 24),
    scale: zoom?.renderContainer?.scale?.x ?? null,
    inner: { w: window.innerWidth, h: window.innerHeight },
    mobile: window.ioc?.get?.('@diamondcoreprocessor.com/MobileMode')?.active ?? null,
    reorders: window.__railReorders ?? 0,
    segments: window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
  }
}

/** The hex-mesh content layer's screen-space box — the strip as painted. The
 *  render container also holds overlay/selection layers, so the layer is the
 *  one whose grandchildren carry geometry (ZoomDrone's own test). */
const STRIP_BOUNDS = () => {
  const zoom = window.ioc?.get?.('@diamondcoreprocessor.com/ZoomDrone')
  const container = zoom?.renderContainer
  if (!container) return null
  const layer = (container.children ?? []).find(child =>
    (child.children ?? []).some(g => g && g.geometry))
  if (!layer?.getBounds) return null
  const b = layer.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height, scale: container.scale?.x ?? null }
}
const window_w = (vp) => vp.width
const window_h = (vp) => vp.height

/** Rows of `lanes` in portrait: every rendered r holds ≤ lanes tiles and the
 *  ranks fill row by row. Columns of 3/2 in landscape: q holds ≤ lanes. */
const groupSizes = (coords, key) => {
  const m = new Map()
  for (const c of coords) m.set(c[key], (m.get(c[key]) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)
}

async function touchDrag(cdp, from, to, steps = 10) {
  const point = (x, y) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] })
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] })
    await new Promise(r => setTimeout(r, 16))
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function main() {
  const port = Number(arg('port', 4254))
  const out = String(arg('out', 'mobile-rails'))
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
      try {
        localStorage.setItem('hc:mobile-mode', 'on')
        localStorage.removeItem('hc:hex-orientation')
        localStorage.removeItem('hc:rails')
        localStorage.removeItem('hc:lane-count')
      } catch { /* ignore */ }
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

    // Count arrangement commits from here on: rails must never mint one.
    await page.evaluate(() => {
      window.__railReorders = 0
      window.__hypercombEffectBus?.on?.('cell:reorder', () => { window.__railReorders++ })
    })

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
    await settle(1500)

    // The root holds the example hive's ONE container tile — a strip of one
    // proves nothing. Walk into it: honey-garden is seven tiles, which is two
    // full rows and a third of one at three lanes.
    const hive = await page.evaluate(() => {
      const last = window.__hypercombEffectBus.lastValue.get('render:cell-count')
      return (last?.branchLabels ?? last?.labels ?? [])[0] ?? null
    })
    if (!hive) throw new Error('no hive tile to walk into')
    await page.evaluate(label => {
      window.__hypercombEffectBus.emit('tile:enter-request', { label })
    }, hive)
    await settle(4000)
    const count = await waitForTiles()
    console.log(`tiles rendered inside "${hive}": ${count}`)
    if (count < 4) throw new Error(`too few tiles inside ${hive} to prove a strip (${count})`)
    await settle(1500)

    // ── 1. rails by default ────────────────────────────────────────────
    const p = await page.evaluate(STATE)
    console.log('\nPORTRAIT', JSON.stringify({ ...p, coords: undefined, labels: p.labels.length }))
    check('mobile mode is on', p.mobile === true)
    check('rails engaged with no lanes:set', p.lanes?.active === true && p.lanes?.lanes === 3, JSON.stringify(p.lanes))
    check('lane viewport is on', p.viewport?.active === true)
    check('grid is projected', p.projected === true && p.railActive === true)
    const rows = groupSizes(p.coords, 'r')
    check('portrait: rows of three', rows.length > 0 && rows.every(n => n <= 3) && rows.slice(0, -1).every(n => n === 3), JSON.stringify(rows))
    check('portrait: point-top', !(p.orientation?.flat === true))
    check('portrait: pan locked to Y', Math.abs(p.pushX.x) < 0.5 && Math.abs(p.pushY.y) > 0.5, JSON.stringify({ x: p.pushX, y: p.pushY }))
    const fitP = await page.evaluate(STRIP_BOUNDS)
    check('portrait: the strip fits across the screen, from the top',
      !!fitP && fitP.width <= window_w(PORTRAIT) + 2 && fitP.x >= -2 && fitP.y >= -2 && fitP.y < window_h(PORTRAIT) * 0.35,
      JSON.stringify(fitP))
    await page.screenshot({ path: path.resolve(`${out}-portrait.png`) })

    // ── 2. a real finger ──────────────────────────────────────────────
    const cdp = await context.newCDPSession(page)
    const canvasHit = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
      return el?.tagName === 'CANVAS' && !!el.closest('#pixi-host')
    })
    check('screen centre is the hive canvas', canvasHit)
    const before = await page.evaluate(() => {
      const s = window.ioc.get('@diamondcoreprocessor.com/PanningDrone').stage.position
      return { x: s.x, y: s.y, scale: window.ioc.get('@diamondcoreprocessor.com/ZoomDrone')?.renderContainer?.scale?.x }
    })
    const cx = PORTRAIT.width / 2, cy = PORTRAIT.height / 2
    await touchDrag(cdp, { x: cx, y: cy + 120 }, { x: cx, y: cy - 120 })
    await page.waitForTimeout(1400)
    const afterV = await page.evaluate(() => {
      const s = window.ioc.get('@diamondcoreprocessor.com/PanningDrone').stage.position
      return { x: s.x, y: s.y }
    })
    check('vertical touch drag scrolls the strip', Math.abs(afterV.y - before.y) > 40, `dy=${(afterV.y - before.y).toFixed(1)}`)
    check('vertical touch drag never drifts sideways', Math.abs(afterV.x - before.x) < 1, `dx=${(afterV.x - before.x).toFixed(1)}`)
    await touchDrag(cdp, { x: cx - 120, y: cy }, { x: cx + 120, y: cy })
    await page.waitForTimeout(1400)
    const afterH = await page.evaluate(() => {
      const s = window.ioc.get('@diamondcoreprocessor.com/PanningDrone').stage.position
      return { x: s.x, y: s.y }
    })
    check('horizontal touch drag moves nothing', Math.abs(afterH.x - afterV.x) < 1 && Math.abs(afterH.y - afterV.y) < 1, `dx=${(afterH.x - afterV.x).toFixed(1)} dy=${(afterH.y - afterV.y).toFixed(1)}`)
    // Pinch: two fingers spreading — must not zoom (it steps the rung).
    const pinch = async (spread) => {
      const pts = (d) => [
        { x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 },
      ]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) })
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(20 + (spread - 20) * i / 8) })
        await new Promise(r => setTimeout(r, 16))
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    const scaleBefore = await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ZoomDrone')?.renderContainer?.scale?.x)
    await pinch(60)
    await page.waitForTimeout(900)
    const lanesAfterPinch = await page.evaluate(() => window.__hypercombEffectBus.lastValue.get('lanes:changed'))
    // A pinch either steps the rung (the fit then changes the scale for the
    // NEW rung) or does nothing; it must never free-zoom the same rung.
    const scaleAfter = await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/ZoomDrone')?.renderContainer?.scale?.x)
    const stepped = lanesAfterPinch?.lanes !== 3
    check('pinch steps the rung or holds — never free-zooms', stepped || Math.abs(scaleAfter - scaleBefore) < 0.001, `lanes=${lanesAfterPinch?.lanes} scale ${scaleBefore?.toFixed?.(3)}→${scaleAfter?.toFixed?.(3)}`)
    if (stepped) {
      await page.evaluate(() => window.__hypercombEffectBus.emit('lanes:set', { lanes: 3 }))
      await settle(1200)
    }

    // ── 3. rotation ───────────────────────────────────────────────────
    await page.setViewportSize({ ...LANDSCAPE })
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
    const instant = await page.evaluate(STATE)
    check('just rotated: lock already X', Math.abs(instant.pushX.x) > 0.5 && Math.abs(instant.pushY.y) < 0.5, JSON.stringify({ x: instant.pushX, y: instant.pushY }))
    await settle(3000)
    const l = await page.evaluate(STATE)
    console.log('\nLANDSCAPE', JSON.stringify({ ...l, coords: undefined, labels: l.labels.length }))
    const cols = groupSizes(l.coords, 'q')
    check('landscape: columns of 3/2 walked left→right', cols.length > 0 && cols.every((n, i) => n <= (i % 2 === 0 ? 3 : 2)), JSON.stringify(cols))
    check('landscape: flat-top', l.orientation?.flat === true)
    check('landscape: pan locked to X', Math.abs(l.pushX.x) > 0.5 && Math.abs(l.pushY.y) < 0.5, JSON.stringify({ x: l.pushX, y: l.pushY }))
    check('landscape: bar is the left rail', await page.evaluate(() => !!document.querySelector('.pill-stage.mobile.landscape')))
    const railRight = await page.evaluate(() => {
      const rail = document.querySelector('.pill-stage.mobile.landscape')
      return rail ? rail.getBoundingClientRect().right : 0
    })
    const fitL = await page.evaluate(STRIP_BOUNDS)
    check('landscape: the strip fits the height and starts past the rail',
      !!fitL && fitL.height <= window_h(LANDSCAPE) + 2 && fitL.y >= -2 && fitL.x >= railRight - 2 && fitL.x < window_w(LANDSCAPE) * 0.35,
      JSON.stringify({ ...fitL, railRight }))
    await page.screenshot({ path: path.resolve(`${out}-landscape.png`) })

    await page.setViewportSize({ ...PORTRAIT })
    await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
    await settle(3000)
    const b = await page.evaluate(STATE)
    const rowsBack = groupSizes(b.coords, 'r')
    check('back to portrait: rows of three, point-top, lock Y',
      rowsBack.every(n => n <= 3) && !(b.orientation?.flat === true) && Math.abs(b.pushY.y) > 0.5 && Math.abs(b.pushX.x) < 0.5,
      JSON.stringify({ rows: rowsBack, flat: b.orientation?.flat }))

    // ── 4. walk out, walk back in — still rails, nothing committed ────
    await page.evaluate(() => window.ioc.get('@hypercomb.social/Navigation')?.back?.())
    await settle(3500)
    const root = await page.evaluate(STATE)
    check('back at the root: still rails', root.lanes?.active === true && root.projected === true && root.segments.length === 0, JSON.stringify(root.segments))
    await page.evaluate(label => {
      window.__hypercombEffectBus.emit('tile:enter-request', { label })
    }, hive)
    await settle(3500)
    const again = await page.evaluate(STATE)
    const rowsAgain = groupSizes(again.coords, 'r')
    check('back inside: still rails, same tiles, same rows',
      again.lanes?.active === true && again.labels.length === p.labels.length && rowsAgain.every(n => n <= 3),
      `${again.labels.length}/${p.labels.length} rows=${JSON.stringify(rowsAgain)}`)
    const commits = await page.evaluate(() => window.__railReorders ?? 0)
    check('no arrangement commit was ever minted', commits === 0, `cell:reorder emitted ${commits}×`)
    await page.screenshot({ path: path.resolve(`${out}-back.png`) })

    if (errors.length) console.log('\npage errors:', errors.slice(0, 8))
    const failed = checks.filter(c => !c.ok)
    console.log(`\nRESULT: ${failed.length ? 'FAIL' : 'PASS'} — ${checks.length - failed.length}/${checks.length}`)
    process.exitCode = failed.length ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(2)
})
