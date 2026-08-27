#!/usr/bin/env node
// drive-chat-beside-control-bar — does the full-screen chat window sit BESIDE
// the control bar instead of on top of it?
//
//   node scripts/drive-chat-beside-control-bar.cjs [--url http://localhost:4250] [--out <dir>]
//
// The claim under test, on BOTH edges the bar can be dragged to:
//
//   1. The bar is VISIBLE and hittable while a conversation is open — the
//      window's own box starts at the reservation the bar publishes
//      (`--hc-controls-left` / `--hc-controls-right`), the same rule every
//      other docked window already follows.
//   2. The TILES RAIL — the list the participant reads — begins inboard of the
//      bar, so nothing of the bar's chrome (including the 1px edge line drawn
//      above the docked-window band) crosses it.
//
// Its own Playwright profile, so the hive it boots is a scratch one — it never
// touches the participant's data, and it needs no bridge.

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

const URL_ = String(arg('url', 'http://localhost:4250'))
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-beside-control-bar')))

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const box = async (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  // Transitions never advance in an undisplayed page, so finish them before
  // reading geometry — a rect caught mid-transform is not where the thing is.
  el.getAnimations?.().forEach(a => { try { a.finish() } catch { /* ignore */ } })
  const r = el.getBoundingClientRect()
  return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }
}, sel)

async function run(side, browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  await page.addInitScript((dock) => {
    localStorage.setItem('hc:chat-visible', '1')
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
    localStorage.setItem('hc:controls-pill-pos', JSON.stringify({ dock }))
    // A scratch profile is a FIRST BOOT, and the example-hives offer covers the
    // whole viewport — including the rail we are here to prove is reachable.
    localStorage.setItem('hc:example-hives:dismissed', 'true')
  }, side)
  await page.goto(URL_ + (URL_.includes('?') ? '&' : '?') + 'claudeBridge=true',
    { waitUntil: 'domcontentloaded' })

  await page.locator('hc-chat-window .chat-panel').waitFor({ state: 'attached', timeout: 30000 })
  // The boot splash covers the WHOLE viewport at the top of the z stack, so a
  // hit test taken while it is still up says nothing about who owns the rail.
  // Wait it out rather than reading around it.
  await page.locator('#hc-splash').waitFor({ state: 'detached', timeout: 30000 })
  await page.waitForTimeout(1200)

  const stage = await box(page, 'hc-controls-bar .pill-stage')
  const panel = await box(page, 'hc-chat-window .chat-panel')
  const rail = await box(page, 'hc-chat-window .chat-rail')
  const reserved = await page.evaluate(s => getComputedStyle(document.documentElement)
    .getPropertyValue(`--hc-controls-${s}`).trim(), side)

  check(`[${side}] the bar is docked and reserving`, !!stage && parseFloat(reserved) > 0,
    `stage=${JSON.stringify(stage)} reserved=${reserved}`)

  if (side === 'left') {
    check('[left] the window starts at the bar’s inner edge, not at 0',
      !!panel && !!stage && panel.left >= stage.right,
      `panel.left=${panel?.left} bar.right=${stage?.right}`)
    check('[left] the tiles rail is clear of the bar',
      !!rail && !!stage && rail.left >= stage.right,
      `rail.left=${rail?.left} bar.right=${stage?.right}`)
  } else {
    check('[right] the window ends at the bar’s inner edge, not at the viewport',
      !!panel && !!stage && panel.right <= stage.left,
      `panel.right=${panel?.right} bar.left=${stage?.left}`)
  }

  // The bar must actually be REACHABLE: whatever is painted at the middle of
  // the rail has to belong to the bar, not to the window lying over it.
  const hit = await page.evaluate((s) => {
    const el = document.querySelector('hc-controls-bar .pill-stage')
    if (!el) return null
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return top ? !!top.closest('hc-controls-bar') : false
  }, side)
  check(`[${side}] a press on the bar reaches the bar`, hit === true, `hit=${hit}`)

  check(`[${side}] no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '))

  await page.screenshot({ path: path.join(OUT, `${side}.png`) })
  await context.close()
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    await run('left', browser)
    await run('right', browser)
  } finally {
    await browser.close()
  }
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  console.log(`screenshots: ${path.resolve(OUT)}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
