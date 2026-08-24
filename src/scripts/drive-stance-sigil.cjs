#!/usr/bin/env node
// drive-stance-sigil — does the prompt glyph wear the stance?
//
//   node scripts/drive-stance-sigil.cjs [--url http://localhost:4250]
//
// The command bar has two standing meanings and the left icon must wear the
// one in force: typing '/' walks into command stance (the chevron becomes a
// slash, the box tints), typing '>' walks back out to tile creation (chevron
// returns, the '>' is consumed, never text). The stance survives a reload,
// Enter on the bare seed is a no-op, and a lost seed re-slashes typed words.
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
    return { slash: !!slash, chevron: !!chevron, tinted, value: input ? input.value : null }
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

    // 2 — typing '/' walks in: the icon becomes the slash, the box tints
    await focusLine(page)
    await page.keyboard.type('/')
    await sleep(300)
    g = await glyph(page)
    check("typing '/' flips the icon to '/'", g.slash && !g.chevron, JSON.stringify(g))
    check('command stance tints the box', g.tinted)

    // 3 — a command keeps the sigil while it is typed
    await page.keyboard.type('help')
    await sleep(300)
    g = await glyph(page)
    check("'/help' keeps the slash sigil", g.slash && g.value === '/help', JSON.stringify(g))

    // 4 — back down to the bare seed, then '>' walks out: consumed, chevron back
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await sleep(200)
    await page.keyboard.type('>')
    await sleep(300)
    g = await glyph(page)
    check("typing '>' returns to tile mode (chevron, consumed)", g.chevron && !g.slash && g.value === '', JSON.stringify(g))

    // 5 — walk back in, Enter on the bare seed must be a no-op (no husk tile)
    await page.keyboard.type('/')
    await sleep(200)
    await page.keyboard.press('Enter')
    await sleep(400)
    g = await glyph(page)
    check('Enter on the bare seed is a no-op (stays in stance)', g.slash && g.value === '/', JSON.stringify(g))

    // 6 — the stance survives a reload (participant preference)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('hc-command-shell input', { timeout: 30000 })
    await sleep(1500)
    g = await glyph(page)
    check('stance survives reload (slash icon on empty line)', g.slash && !g.chevron, JSON.stringify(g))

    // 7 — lost seed: typing a word in command stance re-slashes it
    await focusLine(page)
    await page.keyboard.type('f')
    await sleep(300)
    g = await glyph(page)
    check("typed word re-slashes under the stance ('f' → '/f')", g.value === '/f', JSON.stringify(g))

    // 8 — leave the hive as we found it: back to tile mode
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await sleep(200)
    await page.keyboard.type('>')
    await sleep(300)
    g = await glyph(page)
    check('final exit back to tile mode', g.chevron && !g.slash && !g.tinted, JSON.stringify(g))
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
