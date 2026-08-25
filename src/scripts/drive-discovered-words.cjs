#!/usr/bin/env node
// drive-discovered-words — the words you lead with, offered back as TEXT.
//
//   node scripts/drive-discovered-words.cjs [--url http://localhost:4250]
//
// Spoken habits already answered once the line had become a sentence:
// "open " offered "open help". Nothing answered BEFORE the first space, so
// starting a phrasing you could not remember whole got no help at all. This
// drives the other half: the discovered WORD itself is a row — "op" offers
// "open" — and accepting it completes as PLAIN TEXT. The word and a space,
// nothing run. The space is what turns the phrasings on, so the ending
// arrives on the very next keystroke.
//
// Strictly additive is the thing that has to hold: the census speaks first,
// a word a behaviour already spells stays that behaviour's row, and a blank
// line still offers only the catalogue.
//
// Real keystrokes through Playwright so the Angular (input) pipeline runs,
// and the habit is taught by RUNNING a sentence — only execution teaches.
// HEADED like the other drive harnesses: the Pixi boot throws without a GPU.
// Its own browser profile, so its own OPFS — never a second tab on a hive.

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

async function lineValue(page) {
  return page.evaluate(() => document.querySelector('hc-command-shell input')?.value ?? null)
}

/** Every dropdown row as {row, description} — the row text is the name half,
 *  the description is what the row says about itself. */
async function dropdownRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('hc-command-shell .command-results li')].map(li => ({
      row: [
        li.querySelector('.typed')?.textContent ?? '',
        li.querySelector('.rest')?.textContent ?? '',
      ].join(''),
      description: li.querySelector('.slash-desc')?.textContent?.trim() ?? '',
    })),
  )
}

async function focusLine(page) {
  await page.evaluate(() => document.querySelector('hc-command-shell input')?.focus())
}

async function clearLine(page) {
  await page.evaluate(() => {
    const input = document.querySelector('hc-command-shell input')
    if (!input) return
    input.focus()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(200)
}

/** The habits store's own answer — what the completion surface is reading. */
async function leadIns(page, fragment) {
  return page.evaluate(f => {
    const habits = window.ioc?.get?.('@diamondcoreprocessor.com/SpokenHabits')
    return habits?.leadInCompletions?.(f) ?? null
  }, fragment)
}

async function main() {
  const url = arg('url', 'http://localhost:4250')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('hc-command-shell input', { timeout: 30000 })
    await sleep(2000)

    // A fresh profile is a fresh install, so the first-boot offer is up and
    // covering the line. Start empty — this harness is about the command
    // line, not about what a new hive is handed.
    // It arrives on its own schedule, so watch for it rather than sampling
    // once — a missed dismissal leaves the card over every later screenshot.
    for (let i = 0; i < 12; i++) {
      const offer = await page.$('hc-example-hives-offer .dismiss')
      if (offer) { await offer.click(); await sleep(900); break }
      await sleep(500)
    }

    // ── nothing is learned yet ──────────────────────────────
    await focusLine(page)
    await page.keyboard.type('/')
    await sleep(300)
    await page.keyboard.type('op')
    await sleep(400)
    let rows = await dropdownRows(page)
    check('before anything is run, no word is on offer',
      !rows.some(r => r.row === 'open'), JSON.stringify(rows.map(r => r.row).slice(0, 4)))
    await clearLine(page)

    // ── ONLY EXECUTION TEACHES ──────────────────────────────
    // 'help' is a real behaviour and 'open' is filler in front of it, so
    // running the sentence is what mints the habit. Escape puts the
    // reference back away afterwards.
    await focusLine(page)
    await page.keyboard.type('open help')
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(1600)
    await page.keyboard.press('Escape')
    await sleep(600)

    const learned = await leadIns(page, 'op')
    check("running 'open help' discovers the word 'open'",
      Array.isArray(learned) && learned.some(w => w.leadIn === 'open' && w.command === 'help'),
      JSON.stringify(learned))

    // ── the word is a row ───────────────────────────────────
    await clearLine(page)
    await focusLine(page)
    await page.keyboard.type('op')
    await sleep(500)
    rows = await dropdownRows(page)
    const wordRow = rows.find(r => r.row === 'open')
    check("'op' now offers the word 'open'", !!wordRow, JSON.stringify(rows.map(r => r.row).slice(0, 5)))
    check('the row admits it is yours and says where it goes',
      !!wordRow && /yours/.test(wordRow.description) && /help/.test(wordRow.description),
      wordRow?.description)
    const shot = arg('shot', '')
    if (shot) { await page.screenshot({ path: shot }); console.log('  shot   ' + shot) }

    // ── it completes as TEXT ────────────────────────────────
    // Arrow onto the word so the accept cannot be about anything else, then
    // Tab — the pure completion key.
    const wordIndex = rows.findIndex(r => r.row === 'open')
    for (let i = 0; i < wordIndex; i++) { await page.keyboard.press('ArrowDown'); await sleep(80) }
    await page.keyboard.press('Tab')
    await sleep(500)
    const completed = await lineValue(page)
    check('accepting the word writes the word and a SPACE', completed === 'open ', JSON.stringify(completed))

    rows = await dropdownRows(page)
    check('the space turns the phrasings on — the ending is right there',
      rows.some(r => r.row === 'open help'), JSON.stringify(rows.map(r => r.row).slice(0, 5)))

    // ── Enter on a half-said sentence completes, never fires ────
    // The trailing space the accept handler leaves is read as "your ending
    // goes here", so Enter takes the word and STOPS. Without that the
    // ACCEPT-AND-SEND key would run a bare filler word as if it were a
    // command — which is the one way a word row could do harm.
    await clearLine(page)
    await focusLine(page)
    await page.keyboard.type('op')
    await sleep(500)
    rows = await dropdownRows(page)
    // The census leads the list, so arrow onto the word — Enter on row 0 is
    // `opus` and would (rightly) run it.
    const enterIndex = rows.findIndex(r => r.row === 'open')
    for (let i = 0; i < enterIndex; i++) { await page.keyboard.press('ArrowDown'); await sleep(80) }
    const beforeEnter = await page.evaluate(() =>
      window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels?.length ?? -1)
    await page.keyboard.press('Enter')
    await sleep(700)
    const afterEnter = await lineValue(page)
    const cellsAfter = await page.evaluate(() =>
      window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels?.length ?? -1)
    check('Enter completes the word and holds — it does not run it',
      afterEnter === 'open ' && cellsAfter === beforeEnter,
      JSON.stringify({ line: afterEnter, cells: [beforeEnter, cellsAfter] }))

    // ── the census still speaks first ───────────────────────
    await clearLine(page)
    await focusLine(page)
    await page.keyboard.type('o')
    await sleep(500)
    rows = await dropdownRows(page)
    const names = rows.map(r => r.row)
    const firstWord = names.indexOf('open')
    const censusRows = names.filter(n => n !== 'open')
    check('a discovered word never displaces the catalogue',
      firstWord < 0 || censusRows.length === 0 || firstWord === names.length - 1,
      JSON.stringify(names.slice(0, 6)))

    // ── a blank line is still the catalogue alone ───────────
    await clearLine(page)
    await focusLine(page)
    await page.keyboard.press('Control+Space')
    await sleep(600)
    rows = await dropdownRows(page)
    check('Ctrl+Space asks for the catalogue, and filler is not in it',
      rows.length > 0 && !rows.some(r => r.row === 'open'),
      JSON.stringify({ rows: rows.length, hasWord: rows.some(r => r.row === 'open') }))

    // ── Shift+Delete forgets the word, endings and all ──────
    await clearLine(page)
    await focusLine(page)
    await page.keyboard.type('op')
    await sleep(500)
    rows = await dropdownRows(page)
    const pruneIndex = rows.findIndex(r => r.row === 'open')
    for (let i = 0; i < pruneIndex; i++) { await page.keyboard.press('ArrowDown'); await sleep(80) }
    await page.keyboard.press('Shift+Delete')
    await sleep(500)
    rows = await dropdownRows(page)
    const after = await leadIns(page, 'op')
    check('Shift+Delete forgets the word', !rows.some(r => r.row === 'open') && Array.isArray(after) && after.length === 0,
      JSON.stringify({ rows: rows.map(r => r.row).slice(0, 4), after }))

    await clearLine(page)
  } finally {
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} passed`)
    await sleep(400)
    await browser.close()
    process.exit(failed.length ? 1 : 0)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
