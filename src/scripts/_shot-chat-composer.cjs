#!/usr/bin/env node
// _shot-chat-composer — measures the composer against the providers console.
//
//   node scripts/_shot-chat-composer.cjs [--url http://localhost:4250] [--out <dir>]
//
// THE ONE FACT THIS PROVES: the box you type in ends where the console
// begins, and nowhere short of it. The console's width is reserved ONCE, by
// the reading column it stands beside (`.chat-reading` / `.chat-providers-host`
// are flex siblings) — the footer inside that column must not subtract it a
// second time, which is what left the composer standing on about half the
// space with dead ground beside it.
//
// Its own Playwright profile, so the hive it boots is a scratch one — it never
// touches the participant's data.

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
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-composer')))

/** Every box the answer depends on, in one round trip. */
const geometry = page => page.evaluate(() => {
  const box = sel => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }
  }
  return {
    panel: box('hc-chat-window .chat-panel'),
    reading: box('hc-chat-window .chat-reading'),
    console: box('hc-chat-window .chat-providers-host'),
    foot: box('hc-chat-window .chat-foot'),
    row: box('hc-chat-window .chat-inputrow'),
    input: box('hc-chat-window .chat-input'),
    send: box('hc-chat-window .chat-send'),
    gutter: getComputedStyle(document.documentElement).getPropertyValue('--hc-providers-width').trim() || '(unset)',
  }
})

function report(label, g) {
  console.log(`\n── ${label} ──`)
  for (const key of ['panel', 'reading', 'console', 'foot', 'row', 'input', 'send']) {
    const b = g[key]
    console.log(b ? `  ${key.padEnd(8)} left ${String(b.left).padStart(5)}  right ${String(b.right).padStart(5)}  width ${String(b.width).padStart(5)}`
      : `  ${key.padEnd(8)} (absent)`)
  }
  console.log(`  --hc-providers-width: ${g.gutter}`)
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('PixiJS')) errors.push(m.text()) })

  // A NAMED AI HOST, NOT THE BRIDGE. Either one opens the window past its
  // setup checklist, but the bridge flag makes the tab dial the broker and
  // last-hello-wins would hand it the participant's renderer slot. A dead
  // endpoint enables the window and talks to nothing.
  await page.addInitScript(() => {
    localStorage.setItem('hc:chat-visible', '1')
    localStorage.setItem('hc:ai-host', 'http://127.0.0.1:9/v1')
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
  })
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('hc-chat-window .chat-inputrow', { timeout: 60000 })
  await page.waitForTimeout(3000)

  // The first-boot offer covers the canvas, not the window, but a stray
  // dialog over the composer would poison the measurement.
  const dismiss = page.locator('hc-example-hives-offer .dismiss')
  for (let i = 0; i < 3; i++) {
    if (!(await dismiss.count()) || !(await dismiss.first().isVisible())) break
    await dismiss.first().click({ force: true })
    await page.waitForTimeout(500)
  }

  await page.waitForSelector('hc-chat-window .chat-panel', { timeout: 30000 })
  const closed = await geometry(page)
  report('console CLOSED', closed)
  await page.screenshot({ path: path.join(OUT, '01-console-closed.png') })

  // Straight at the console's own door. The header toggle rides an EffectBus
  // hop and the console re-homes itself across a few frames; asking the view
  // directly measures the layout, not the plumbing.
  // A boot-time reload can destroy the context mid-call, so ask again.
  for (let i = 0; i < 5; i++) {
    try {
      await page.waitForSelector('hc-chat-window .chat-inputrow', { timeout: 30000 })
      await page.evaluate(() => {
        window.ioc?.get('@diamondcoreprocessor.com/ProvidersWindowView')?.open?.()
      })
      break
    } catch (err) {
      if (i === 4) throw err
      await page.waitForTimeout(2000)
    }
  }
  await page.waitForSelector('.hc-providers', { timeout: 20000 })
  await page.waitForTimeout(1500)
  const open = await geometry(page)
  report('console OPEN', open)
  await page.screenshot({ path: path.join(OUT, '02-console-open.png') })

  // ── THE FAULT, REPRODUCED ───────────────────────────────────────────────
  // Put the old rule back by hand and measure it, so the diagnosis is a
  // number rather than a story: the footer subtracting the console's width a
  // second time inside a column that had already given it up.
  const faulted = await page.evaluate(() => {
    const foot = document.querySelector('hc-chat-window .chat-foot')
    foot.style.paddingRight = 'calc(0.75em + var(--hc-providers-width, 0px))'
    const row = document.querySelector('hc-chat-window .chat-inputrow').getBoundingClientRect()
    const f = foot.getBoundingClientRect()
    foot.style.paddingRight = ''
    return { row: Math.round(row.width), foot: Math.round(f.width) }
  })
  console.log(`
  with the old double reservation: composer ${faulted.row}px of ${faulted.foot - 24}px `
    + `(${((faulted.row / (faulted.foot - 24)) * 100).toFixed(1)}%)`)

  // ── AND WHILE IT MOVES ──────────────────────────────────────────────────
  // The console's grip republishes the width live, the column reads it, and
  // the send button has to stay against the console's edge THROUGHOUT — not
  // only at the two rest positions.
  const grip = await page.locator('.hc-providers-resize').boundingBox()
  let dragged = null
  if (grip) {
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x - 170, grip.y + grip.height / 2, { steps: 20 })
    await page.waitForTimeout(300)
    dragged = await geometry(page)
    await page.mouse.up()
    await page.waitForTimeout(400)
    report('console DRAGGED WIDER', dragged)
    await page.screenshot({ path: path.join(OUT, '03-console-dragged.png') })
  }

  // ── the verdicts ────────────────────────────────────────────────────────
  const fails = []
  const near = (a, b, slack) => Math.abs(a - b) <= slack

  if (!open.console || open.console.width < 100) fails.push('the console never opened — nothing to measure against')
  else {
    const gap = open.console.left - open.send.right
    console.log(`\n  gap between the send button and the console: ${gap}px`)
    if (!near(gap, 12, 8)) fails.push(`send button is ${gap}px from the console (expected one 0.75em inset, ~12px)`)
    const fill = open.row.width / (open.foot.width - 24)
    console.log(`  composer fills ${(fill * 100).toFixed(1)}% of the footer's content width`)
    if (fill < 0.97) fails.push(`composer fills only ${(fill * 100).toFixed(1)}% of the space it is given`)
    if (!near(open.reading.right, open.console.left, 2)) fails.push('the reading column does not end where the console begins')
  }

  if (closed.send && closed.foot && !near(closed.send.right, closed.foot.right - 12, 8)) {
    fails.push('with the console shut the composer still stops short of the window edge')
  }

  if (dragged && dragged.console.width > 0) {
    const gap = dragged.console.left - dragged.send.right
    console.log(`  gap mid-drag, console now ${dragged.console.width}px wide: ${gap}px`)
    if (!near(gap, 12, 8)) fails.push(`mid-drag the send button is ${gap}px from the console`)
    if (dragged.console.width <= open.console.width) fails.push('the drag did not widen the console')
  }

  console.log(errors.length ? `\npage errors:\n  ${errors.slice(0, 6).join('\n  ')}` : '\nno page errors')
  await browser.close()
  console.log(`wrote ${OUT}`)
  if (fails.length) { console.log('\nFAIL:\n  ' + fails.join('\n  ')); process.exit(1) }
  console.log('\nPASS — the composer ends at the console, and fills everything left of it.')
}

main().catch(err => { console.error(err); process.exit(1) })
