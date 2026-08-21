#!/usr/bin/env node
// drive-postit-light — the Beehaviors POOL switch is what takes a post-it off
// the glass. Proves the cause and the cure in one run, on a fresh hive:
//
//   sticky on screen  →  pool light OFF  →  plain hexagon, no sticky, no view
//                     →  pool light ON   →  sticky back, hexagon gone again
//
//   node scripts/drive-postit-light.cjs [--url http://localhost:4250] [--out <dir>]
//
// No bridge, no OPFS wiping — its own browser profile, its own empty hive.

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

async function typeCommand(page, text) {
  await page.evaluate((value) => {
    const input = document.querySelector('input.command-input')
    if (!input) throw new Error('no command input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }, text)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}

/** What the glass says right now: is the post-it paper up, or the hexagon? */
async function surface(page) {
  return page.evaluate(() => {
    const drone = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    return {
      hexes: [...(drone?.renderedCells?.keys?.() ?? [])],
      stickies: document.querySelectorAll('.postit-sticky').length,
      globalOn: (() => {
        try { return JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? 'null') }
        catch { return null }
      })(),
    }
  })
}

const isOn = (s) => Array.isArray(s.globalOn) ? s.globalOn.includes('visual:postit:note') : null

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (nm) => { await page.screenshot({ path: path.join(out, nm + '.png') }) }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    await typeCommand(page, 'probe')
    await page.waitForTimeout(1200)
    await typeCommand(page, 'probe@postit Read this before Saturday')
    await page.waitForTimeout(3000)
    await shot('light-01-sticky')

    const lit = await surface(page)
    check('the post-it is the tile’s presence', lit.stickies > 0 && !lit.hexes.includes('probe'), JSON.stringify(lit.hexes))

    // ── the door: rail Beehaviors switch, then the lens to the POOL ─────
    for (let i = 0; i < 3; i++) {
      if (await page.locator('.features-mode').count()) break
      await page.click('.rail-btn.features-toggle-btn', { force: true })
      await page.waitForTimeout(2000)
    }
    await page.waitForSelector('.features-mode', { timeout: 20000 })
    await page.waitForTimeout(800)
    for (let i = 0; i < 3; i++) { await page.click('.features-mode', { force: true }); await page.waitForTimeout(1000) }
    await page.waitForTimeout(1200)
    await shot('light-02-pool')

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.features-scroll.store .features-row')].map(el => ({
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        on: el.getAttribute('aria-checked'),
      })))
    console.log('  pool rows: ' + rows.length)
    check('the pool is open with one light per behaviour', rows.length > 0, JSON.stringify(rows.slice(0, 3)))

    const postitRow = page.locator('.features-scroll.store .features-row', { hasText: '/postit' }).first()
    check('the Post-it row is in the pool, lit', (await postitRow.count()) > 0
      && (await postitRow.getAttribute('aria-checked')) === 'true',
      String(await postitRow.getAttribute('aria-checked')))

    // ── the accident: one click anywhere on the row ─────────────────────
    await postitRow.click()
    await page.waitForTimeout(3000)
    await shot('light-03-dark')
    const dark = await surface(page)
    console.log('  dark ' + JSON.stringify(dark.hexes) + ' stickies=' + dark.stickies + ' lit=' + isOn(dark))
    check('the light went out', isOn(dark) === false, String(isOn(dark)))
    check('the sticky left and the plain hexagon came back',
      dark.stickies === 0 && dark.hexes.includes('probe'), JSON.stringify(dark.hexes) + ' / ' + dark.stickies)

    // ── the cure: click it again ────────────────────────────────────────
    await postitRow.click()
    await page.waitForTimeout(3000)
    await shot('light-04-back')
    const back = await surface(page)
    console.log('  back ' + JSON.stringify(back.hexes) + ' stickies=' + back.stickies + ' lit=' + isOn(back))
    check('re-lighting brings the note back',
      isOn(back) === true && back.stickies > 0 && !back.hexes.includes('probe'),
      JSON.stringify(back.hexes) + ' / ' + back.stickies)
  } finally {
    await browser.close()
  }
  const failed = results.filter(x => !x.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
