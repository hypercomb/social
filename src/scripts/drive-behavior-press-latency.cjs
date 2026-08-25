#!/usr/bin/env node
// drive-behavior-press-latency — what does the row DO between the press and
// the answer?
//
// drive-behavior-toggle-clicks proved the bulb is a two-state switch when you
// wait 4s between presses. The complaint is different: "feels like I have to
// click twice the first time". That is a LATENCY claim, not a state-machine
// one — if the row says nothing for half a second, the participant presses
// again, the second press is swallowed as pending, and the flip they finally
// see is the FIRST press landing. Three presses, one result.
//
// So this samples the row every 80ms across a single press and reports:
//   • time to the FIRST visible change (the acknowledgement)
//   • time to SETTLED (the final class, pending cleared)
//   • what an impatient second press 300ms later actually does
//
//   node scripts/drive-behavior-press-latency.cjs [--url http://localhost:4253]
//                                                 [--out <dir>] [--engine chrome]

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

// One row's whole visible answer: its classes and its bulb.
const ROW = (scope, i) => {
  const sel = scope === 'store' ? '.features-scroll.store .features-row' : '.features-scroll .features-row'
  const li = document.querySelectorAll(sel)[i]
  if (!li) return null
  return {
    cls: li.className,
    checked: li.getAttribute('aria-checked'),
    bulb: li.querySelector('.feat-bulb')?.className ?? '',
    busy: li.getAttribute('aria-busy'),
    label: (li.querySelector('.feature-name')?.textContent ?? '').trim().slice(0, 30),
  }
}

const same = (a, b) => a && b && a.cls === b.cls && a.bulb === b.bulb && a.checked === b.checked && a.busy === b.busy

/** Press once, then sample until the row stops moving. */
async function press(page, scope, i, ms = 6000, step = 80) {
  const sel = scope === 'store' ? '.features-scroll.store .features-row' : '.features-scroll .features-row'
  const before = await page.evaluate(([s, n]) => {
    const sel2 = s === 'store' ? '.features-scroll.store .features-row' : '.features-scroll .features-row'
    const li = document.querySelectorAll(sel2)[n]
    if (!li) return null
    return {
      cls: li.className,
      checked: li.getAttribute('aria-checked'),
      bulb: li.querySelector('.feat-bulb')?.className ?? '',
      busy: li.getAttribute('aria-busy'),
      label: (li.querySelector('.feature-name')?.textContent ?? '').trim().slice(0, 30),
    }
  }, [scope, i])
  const t0 = Date.now()
  await page.locator(sel).nth(i).click()
  const frames = []
  let firstChange = -1, lastChange = 0
  let prev = before
  while (Date.now() - t0 < ms) {
    const now = await page.evaluate(([s, n]) => {
      const sel2 = s === 'store' ? '.features-scroll.store .features-row' : '.features-scroll .features-row'
      const li = document.querySelectorAll(sel2)[n]
      if (!li) return null
      return {
        cls: li.className,
        checked: li.getAttribute('aria-checked'),
        bulb: li.querySelector('.feat-bulb')?.className ?? '',
        busy: li.getAttribute('aria-busy'),
        label: (li.querySelector('.feature-name')?.textContent ?? '').trim().slice(0, 30),
      }
    }, [scope, i])
    const at = Date.now() - t0
    if (!same(now, prev)) {
      if (firstChange < 0) firstChange = at
      lastChange = at
      frames.push({ at, cls: now?.cls, bulb: now?.bulb, checked: now?.checked, busy: now?.busy })
      prev = now
    }
    await page.waitForTimeout(step)
  }
  return { before, after: prev, firstChange, lastChange, frames }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/press-latency')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()
  const report = {}

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    await page.locator('.rail-btn.features-toggle-btn').click()
    await page.waitForTimeout(4000)

    // ── LAYER: one press, sampled ─────────────────────────────────────
    const layer = await press(page, 'layer', 0)
    report.layer = layer
    console.log(`\n== LAYER row 0 (${layer.before?.label}) ==`)
    console.log(`  before: ${layer.before?.cls} | bulb=${layer.before?.bulb}`)
    console.log(`  FIRST VISIBLE CHANGE: ${layer.firstChange < 0 ? 'NEVER' : layer.firstChange + 'ms'}`)
    console.log(`  settled at: ${layer.lastChange}ms`)
    for (const f of layer.frames) console.log(`    ${String(f.at).padStart(5)}ms  ${f.cls} | bulb=${f.bulb} | busy=${f.busy}`)

    // put it back, settle
    await page.locator('.features-scroll .features-row').nth(0).click()
    await page.waitForTimeout(5000)

    // ── LAYER: the IMPATIENT double press ─────────────────────────────
    const t0 = Date.now()
    const start = await page.evaluate(([s, n]) => {
      const li = document.querySelectorAll('.features-scroll .features-row')[n]
      return li ? { cls: li.className, checked: li.getAttribute('aria-checked') } : null
    }, ['layer', 0])
    await page.locator('.features-scroll .features-row').nth(0).click()
    await page.waitForTimeout(300)
    await page.locator('.features-scroll .features-row').nth(0).click()
    await page.waitForTimeout(6000)
    const end = await page.evaluate(([s, n]) => {
      const li = document.querySelectorAll('.features-scroll .features-row')[n]
      return li ? { cls: li.className, checked: li.getAttribute('aria-checked') } : null
    }, ['layer', 0])
    report.impatient = { start, end, elapsed: Date.now() - t0 }
    const flipped = start?.checked !== end?.checked
    console.log(`\n== LAYER impatient double press (300ms apart) ==`)
    console.log(`  ${start?.checked} -> ${end?.checked}  ${flipped ? 'ONE flip (second press swallowed — good)' : 'NO net change (both landed — the "click twice" feel)'}`)

    // ── POOL: one press, sampled ──────────────────────────────────────
    await page.locator('.features-panel .scope-toggle').click()
    await page.waitForTimeout(3000)
    const pool = await press(page, 'store', 0)
    report.pool = pool
    console.log(`\n== POOL row 0 (${pool.before?.label}) ==`)
    console.log(`  before: ${pool.before?.cls} | bulb=${pool.before?.bulb}`)
    console.log(`  FIRST VISIBLE CHANGE: ${pool.firstChange < 0 ? 'NEVER' : pool.firstChange + 'ms'}`)
    console.log(`  settled at: ${pool.lastChange}ms`)
    for (const f of pool.frames) console.log(`    ${String(f.at).padStart(5)}ms  ${f.cls} | bulb=${f.bulb} | busy=${f.busy}`)
    await page.locator('.features-scroll.store .features-row').nth(0).click()
    await page.waitForTimeout(4000)

    await page.screenshot({ path: path.join(out, 'end.png') })
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    await browser.close()
  }
}

main()
