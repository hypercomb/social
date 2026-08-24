#!/usr/bin/env node
// drive-quiet-line — does a BLANK command line stay quiet?
//
//   node scripts/drive-quiet-line.cjs [--url http://localhost:4250] [--out <dir>]
//
// Jaime: "nothing should be in your face until you click a key and then it
// filters." The intel window (`.command-intel`) used to open on a line nobody
// had typed into — worst in COMMAND stance, where the icon carries the slash,
// so a blank line reads as `/` and the pool is every behaviour there is. Every
// recompute (a navigate, a stance toggle) threw the whole catalogue up.
//
// The line the checks below draw: a blank line offers NOTHING; the first
// keystroke opens the window already filtered; emptying it shuts it again.

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

/** What the line is showing right now: stance, typed value, open rows. */
const readLine = (page) => page.evaluate(() => {
  const shell = document.querySelector('.command-shell')
  const input = document.querySelector('input.command-input')
  const intel = document.querySelector('.command-intel')
  const rows = intel ? [...intel.querySelectorAll('.intel-row, .completion-item, li, .intel-option')] : []
  return {
    stance: shell?.classList.contains('stance-command') ? 'command' : 'tiles',
    value: input ? input.value : null,
    open: !!intel,
    rows: rows.length,
    placeholder: input ? input.getAttribute('placeholder') : null,
  }
})

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  // Boot straight into COMMAND stance — the stance is a sticky participant
  // preference, so this is exactly the state Jaime opens the app in.
  await page.addInitScript(() => {
    localStorage.setItem('hc:command-line-stance', 'command')
  })

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input.command-input', { timeout: 60000 })
  await page.waitForTimeout(3000)

  // A fresh profile lands on the example-hives offer, whose backdrop swallows
  // every click. Dismiss it the way the card's own close does — its two
  // buttons would prefill or navigate, and this test needs a BLANK line.
  await page.evaluate(() => window.__hypercombEffectBus?.emit('examples:dismiss', {}))
  await page.waitForTimeout(1200)

  // 1. boot, blank line, command stance
  let state = await readLine(page)
  check('boot in / stance is quiet', state.stance === 'command' && !state.open,
    `stance=${state.stance} value=${JSON.stringify(state.value)} open=${state.open} rows=${state.rows}`)
  await page.screenshot({ path: path.join(out, 'quiet-1-boot.png') })

  // 2. stance toggles — the glyph click that started the report
  await page.click('.prompt-glyph')
  await page.waitForTimeout(400)
  state = await readLine(page)
  check('toggle to tiles stance is quiet', state.stance === 'tiles' && !state.open,
    `stance=${state.stance} open=${state.open} rows=${state.rows}`)

  await page.click('.prompt-glyph')
  await page.waitForTimeout(400)
  state = await readLine(page)
  check('toggle back to / stance is quiet', state.stance === 'command' && !state.open,
    `stance=${state.stance} open=${state.open} rows=${state.rows}`)
  await page.screenshot({ path: path.join(out, 'quiet-2-toggled.png') })

  // 3. the first keystroke MUST open it — quiet is not mute
  await page.click('input.command-input')
  await page.keyboard.type('h')
  await page.waitForTimeout(500)
  const typed = await readLine(page)
  check('first keystroke opens the window', typed.open, `open=${typed.open} rows=${typed.rows}`)
  await page.screenshot({ path: path.join(out, 'quiet-3-typed.png') })

  // ...and it must be FILTERED, not the whole catalogue.
  await page.keyboard.type('el')
  await page.waitForTimeout(500)
  const filtered = await readLine(page)
  check('typing filters it down', filtered.open && filtered.rows <= typed.rows,
    `"h"=${typed.rows} rows → "hel"=${filtered.rows} rows`)

  // 4. emptying the line shuts it again
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.waitForTimeout(500)
  state = await readLine(page)
  check('emptying the line shuts it', state.value === '' && !state.open,
    `value=${JSON.stringify(state.value)} open=${state.open} rows=${state.rows}`)

  // 5. a NAVIGATE with a blank line — the reported trigger. A throwaway
  //    profile boots onto an empty hive, so mint somewhere to walk INTO
  //    first, then go there through the app's own navigation (a real place
  //    change, not a reload — a reload is already covered by check 1).
  await page.click('.prompt-glyph')            // tiles stance mints tiles
  await page.waitForTimeout(300)
  await page.click('input.command-input')
  await page.keyboard.type('quiet-probe')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)

  const walked = await page.evaluate(async () => {
    const nav = window.ioc?.get?.('@hypercomb.social/Navigation')
    if (typeof nav?.go !== 'function') return { ok: false, why: 'no go() on the navigation service' }
    const before = location.pathname
    try { await nav.go(['quiet-probe']) } catch (e) { return { ok: false, why: String(e) } }
    await new Promise(r => setTimeout(r, 900))
    return location.pathname !== before
      ? { ok: true, from: before, to: location.pathname }
      : { ok: false, why: 'path never changed from ' + before }
  })
  await page.waitForTimeout(1200)
  state = await readLine(page)
  check('navigate leaves the line quiet', walked.ok && !state.open,
    `${walked.ok ? `${walked.from} → ${walked.to}` : 'nav failed: ' + walked.why} open=${state.open} rows=${state.rows}`)

  // ...and the same arrival read in / stance, which is where Jaime saw it.
  await page.click('.prompt-glyph')
  await page.waitForTimeout(600)
  state = await readLine(page)
  check('arrival in / stance is quiet', state.stance === 'command' && !state.open,
    `stance=${state.stance} value=${JSON.stringify(state.value)} open=${state.open} rows=${state.rows}`)
  await page.screenshot({ path: path.join(out, 'quiet-4-navigated.png') })

  fs.writeFileSync(path.join(out, 'quiet-line-results.json'), JSON.stringify(results, null, 2))
  await browser.close()

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
