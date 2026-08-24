#!/usr/bin/env node
// drive-stance-sigil — does the prompt glyph wear the stance, and does the
// slash live in the ICON rather than the text?
//
//   node scripts/drive-stance-sigil.cjs [--url http://localhost:4250]
//
// Two standing meanings for the bar's plain text, worn by the left icon and
// the box hue. Typing '/' walks into command stance and the slash DISAPPEARS
// INTO THE ICON — commands are typed bare ('help', not '/help'), further
// slashes are refused, and the typed text wears command honey (#ecbc57) so
// words that will run code look alive. Typing '>' on the empty line (or
// clicking the glyph) walks back to tile creation. Sticky across reloads.
// Real keystrokes through Playwright so the Angular (input) pipeline runs.
// HEADED like the other drive harnesses: the Pixi boot throws without a GPU.

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function glyph(page) {
  return page.evaluate(() => {
    const slash = document.querySelector('hc-command-shell .prompt-slash')
    const chevron = document.querySelector('hc-command-shell .prompt-chevron')
    const tinted = !!document.querySelector('hc-command-shell .command-shell.stance-command')
    const input = document.querySelector('hc-command-shell input')
    const color = input ? getComputedStyle(input).color : null
    return { slash: !!slash, chevron: !!chevron, tinted, value: input ? input.value : null, color }
  })
}

async function focusLine(page) {
  // Programmatic focus: a fresh context is a first boot, and the welcome
  // offer's backdrop intercepts pointer clicks — keystrokes still land in
  // the focused input, which is all this harness needs.
  await page.evaluate(() => {
    const input = document.querySelector('hc-command-shell input')
    if (input) input.focus()
  })
}

async function clickGlyph(page) {
  // Dispatch the mousedown directly — the first-boot offer backdrop would
  // intercept a real pointer, but the glyph's handler listens on the element.
  await page.evaluate(() => {
    const g = document.querySelector('hc-command-shell .prompt-glyph')
    if (g) g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
}

async function main() {
  const url = arg('url', 'http://localhost:4250')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  // The stance is this harness's own participant preference — start neutral.
  // Once only: init scripts re-run on reload, and the reload assertion is
  // exactly that the stance SURVIVES one.
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('hc:stance-harness-cleared')) {
      localStorage.removeItem('hc:command-line-stance')
      sessionStorage.setItem('hc:stance-harness-cleared', '1')
    }
  })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('hc-command-shell input', { timeout: 30000 })
    await sleep(1500)

    // 1 — neutral boot: chevron, no tint
    let g = await glyph(page)
    check('boots in tile mode (chevron, untinted)', g.chevron && !g.slash && !g.tinted, JSON.stringify(g))

    // 2 — the first '/' disappears INTO the icon: consumed, icon flips, box tints
    await focusLine(page)
    await page.keyboard.type('/')
    await sleep(300)
    g = await glyph(page)
    check("typing '/' consumes it into the icon", g.slash && !g.chevron && g.value === '', JSON.stringify(g))
    check('command stance tints the box', g.tinted)

    // 3 — commands are typed BARE, the dropdown still offers them, and the
    //     text wears command honey
    await page.keyboard.type('hel')
    await sleep(400)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('hc-command-shell .command-results li')].map(li => li.textContent?.trim() ?? '')
    )
    check("bare 'hel' still gets command intellisense", rows.some(r => r.startsWith('help')), JSON.stringify(rows.slice(0, 3)))
    await page.keyboard.type('p')
    await sleep(300)
    g = await glyph(page)
    check("command typed bare ('help', no slash in text)", g.slash && g.value === 'help', JSON.stringify(g))
    check('typed text wears the command color', g.color === 'rgb(236, 188, 87)', g.color)

    // 4 — a further '/' is refused (the icon already IS one)
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await sleep(200)
    await page.keyboard.type('/')
    await sleep(300)
    g = await glyph(page)
    check("a second '/' never lands (not allowed in command stance)", g.slash && g.value === '', JSON.stringify(g))

    // 5 — Enter on the empty command line is a no-op (no junk tile)
    await page.keyboard.press('Enter')
    await sleep(400)
    g = await glyph(page)
    check('Enter on the empty command line is a no-op', g.slash && g.value === '', JSON.stringify(g))

    // 6 — '>' walks back out: consumed, chevron returns
    await page.keyboard.type('>')
    await sleep(300)
    g = await glyph(page)
    check("typing '>' returns to tile mode (chevron, consumed)", g.chevron && !g.slash && g.value === '', JSON.stringify(g))

    // 7 — one CLICK on the glyph toggles the stance, both directions
    await clickGlyph(page)
    await sleep(300)
    g = await glyph(page)
    check('clicking the glyph walks into command stance', g.slash && g.tinted, JSON.stringify(g))
    await clickGlyph(page)
    await sleep(300)
    g = await glyph(page)
    check('clicking again walks back to tile mode', g.chevron && !g.slash && !g.tinted, JSON.stringify(g))

    // 8 — the stance survives a reload (participant preference)
    await clickGlyph(page)
    await sleep(300)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('hc-command-shell input', { timeout: 30000 })
    await sleep(1500)
    g = await glyph(page)
    check('stance survives reload (slash icon, empty line)', g.slash && !g.chevron && g.value === '', JSON.stringify(g))

    // 9 — leave the hive as we found it: back to tile mode
    await focusLine(page)
    await page.keyboard.type('>')
    await sleep(300)
    g = await glyph(page)
    check('final exit back to tile mode', g.chevron && !g.slash && !g.tinted && g.value === '', JSON.stringify(g))
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
