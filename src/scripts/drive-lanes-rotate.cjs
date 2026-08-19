#!/usr/bin/env node
// drive-lanes-rotate — prove the lane viewport's axis lock follows the DEVICE.
//
//   node scripts/drive-lanes-rotate.cjs [--port 4253] [--out lanes-rotate]
//
// Boots the dev shell phone-shaped with the mobile override forced ON, seeds
// the example hive so there are tiles to arrange, engages `/lanes`, then
// probes the pan axis in PORTRAIT, rotates the viewport to LANDSCAPE and
// probes again.
//
// The probe is the user's actual complaint, measured: push the stage along
// each axis through the real PanningDrone.panBy() — the same call every touch
// drag and wheel scroll lands on — and report which axis moved.
//
//   portrait  ⇒ moves on Y only (the strip runs up/down)
//   landscape ⇒ moves on X only (the strip runs left/right)
//
// HEADLESS HAS NO GPU and Pixi never builds its mesh without one, so this
// drives a headed real browser (msedge by default).

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

/** Push the stage along each axis through the real pan path and report the
 *  distance it actually travelled. Restores the viewport after each push so
 *  the two axes are measured from the same origin. */
const PROBE = () => {
  const pan = window.ioc?.get?.('@diamondcoreprocessor.com/PanningDrone')
  const stage = pan?.stage
  if (!pan?.panBy || !stage) return { error: 'no pan/stage' }
  const at = () => ({ x: stage.position.x, y: stage.position.y })
  const push = (dx, dy) => {
    const before = at()
    pan.panBy({ x: dx, y: dy })
    const after = at()
    pan.panBy({ x: -(after.x - before.x), y: -(after.y - before.y) })
    return { x: after.x - before.x, y: after.y - before.y }
  }
  return {
    pushX: push(24, 0),
    pushY: push(0, 24),
    inner: { w: window.innerWidth, h: window.innerHeight },
    hexOrientation: localStorage.getItem('hc:hex-orientation'),
    lanes: window.__hypercombEffectBus?.lastValue?.get('lanes:changed') ?? null,
    mobile: window.ioc?.get?.('@diamondcoreprocessor.com/MobileMode')?.active ?? null,
  }
}

const verdict = (p) => {
  if (p.error) return `ERROR ${p.error}`
  const movedX = Math.abs(p.pushX.x) > 0.5
  const movedY = Math.abs(p.pushY.y) > 0.5
  if (movedX && movedY) return 'FREE (both axes) — no lane lock'
  if (movedX) return 'LOCKED to X (left↔right)'
  if (movedY) return 'LOCKED to Y (up↕down)'
  return 'FROZEN (neither axis moved — clamp?)'
}

async function main() {
  const port = Number(arg('port', 4253))
  const out = String(arg('out', 'lanes-rotate'))
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

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    await page.waitForTimeout(6000)
    await clearSplash()

    // Empty OPFS lands on the first-boot offer; take the example hive so the
    // page has a row of tiles for lanes to arrange.
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await page.waitForTimeout(10000)
    await clearSplash()

    let count = 0
    for (let i = 0; i < 60; i++) {
      count = await page.evaluate(() =>
        (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
      if (count > 0) break
      await page.waitForTimeout(500)
    }
    console.log(`tiles rendered: ${count}`)
    if (!count) throw new Error('no tiles rendered — cannot engage lanes')

    // ── portrait ──────────────────────────────────────────────────────
    await page.evaluate(() =>
      window.__hypercombEffectBus.emit('lanes:set', { lanes: 3 }))
    await page.waitForTimeout(2500)
    await clearSplash()
    const portrait = await page.evaluate(PROBE)
    console.log('\nPORTRAIT ', JSON.stringify(portrait))
    console.log('  verdict:', verdict(portrait), '(want: LOCKED to Y)')
    await page.screenshot({ path: path.resolve(`${out}-portrait.png`) })

    // ── rotate ────────────────────────────────────────────────────────
    // setViewportSize fires the same `resize` a real rotation does.
    await page.setViewportSize({ ...LANDSCAPE })

    // Probe BEFORE the re-pack can have run. This is the iOS case in
    // miniature: the device is landscape and nothing has re-arranged yet. The
    // lock must already point along the new long side — if it only flips when
    // the re-pack lands, then a rotation whose re-pack is late or swallowed
    // leaves the phone scrolling across the strip.
    const instant = await page.evaluate(PROBE)
    console.log('\nJUST ROTATED (no re-pack yet)', JSON.stringify(instant))
    console.log('  verdict:', verdict(instant), '(want: LOCKED to X)')

    await page.waitForTimeout(3000)
    await clearSplash()
    const landscape = await page.evaluate(PROBE)
    console.log('\nLANDSCAPE', JSON.stringify(landscape))
    console.log('  verdict:', verdict(landscape), '(want: LOCKED to X)')
    await page.screenshot({ path: path.resolve(`${out}-landscape.png`) })

    // ── rotate back ───────────────────────────────────────────────────
    await page.setViewportSize({ ...PORTRAIT })
    await page.waitForTimeout(3000)
    await clearSplash()
    const back = await page.evaluate(PROBE)
    console.log('\nBACK TO PORTRAIT', JSON.stringify(back))
    console.log('  verdict:', verdict(back), '(want: LOCKED to Y)')
    await page.screenshot({ path: path.resolve(`${out}-back.png`) })

    if (errors.length) console.log('\npage errors:', errors.slice(0, 8))

    const pass = verdict(portrait).startsWith('LOCKED to Y')
      && verdict(instant).startsWith('LOCKED to X')
      && verdict(landscape).startsWith('LOCKED to X')
      && verdict(back).startsWith('LOCKED to Y')
    console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`)
    process.exitCode = pass ? 0 : 1
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(2)
})
