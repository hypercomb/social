#!/usr/bin/env node
// drive-stance-sigil — the stance, the reading, and the marks.
//
//   node scripts/drive-stance-sigil.cjs [--url http://localhost:4250]
//
// Two standing meanings for the bar's plain text, worn by the left icon and
// the box hue. Typing '/' walks into command stance and the slash DISAPPEARS
// INTO THE ICON — commands are typed bare, further slashes are refused, '>'
// or a glyph click walks back. In command stance plain language is READ:
// action words light (each in its behaviour's own color, honey fallback)
// over the input's transparent glyphs, filler stays plain, an ambiguous word
// marks violet and Enter waits for the pathway choice, and a sentence that
// matches nothing offers create · ask · filter — NEVER a tile, because this
// stance mints nothing implicitly: `create` is the one door. Real keystrokes through
// Playwright so the Angular (input) pipeline runs. HEADED like the other
// drive harnesses: the Pixi boot throws without a GPU.

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
    const reading = document.querySelector('hc-command-shell .reading')
    const seg = role => [...(reading?.querySelectorAll('.seg-' + role) ?? [])].map(s => s.textContent)
    return {
      slash: !!slash, chevron: !!chevron, tinted,
      value: input ? input.value : null,
      inputColor: input ? getComputedStyle(input).color : null,
      marked: !!input?.classList.contains('input-marked'),
      reading: !!reading,
      actions: seg('action'), ambiguity: seg('ambiguity'), residue: seg('residue'),
    }
  })
}

/** The tiles rendered at the current level — the EffectBus replay the render
 *  keeps. Beehaviour mode is legislated on what it does NOT mint, so the
 *  harness has to be able to count. */
async function cellLabels(page) {
  return page.evaluate(() =>
    window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []
  )
}

async function dropdownRows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('hc-command-shell .command-results li')].map(li => li.textContent?.trim() ?? '')
  )
}

async function focusLine(page) {
  await page.evaluate(() => {
    const input = document.querySelector('hc-command-shell input')
    if (input) input.focus()
  })
}

async function clearLine(page) {
  await page.evaluate(() => {
    const input = document.querySelector('hc-command-shell input')
    if (!input) return
    input.focus()
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(150)
}

async function clickGlyph(page) {
  await page.evaluate(() => {
    const g = document.querySelector('hc-command-shell .prompt-glyph')
    if (g) g.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  })
}

async function main() {
  const url = arg('url', 'http://localhost:4250')
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
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

    // ── the stance ─────────────────────────────────────────
    let g = await glyph(page)
    check('boots in tile mode (chevron, untinted)', g.chevron && !g.slash && !g.tinted, JSON.stringify({ ...g, inputColor: undefined }))

    await focusLine(page)
    await page.keyboard.type('/')
    await sleep(300)
    g = await glyph(page)
    check("typing '/' consumes it into the icon", g.slash && !g.chevron && g.value === '' && g.tinted)

    await page.keyboard.type('hel')
    await sleep(400)
    const rows = await dropdownRows(page)
    check("bare 'hel' still gets command intellisense", rows.some(r => r.startsWith('help')), JSON.stringify(rows.slice(0, 3)))
    g = await glyph(page)
    check("an incomplete word stays plain (no marks yet)", !g.reading && !g.marked, JSON.stringify({ reading: g.reading, marked: g.marked }))

    await page.keyboard.type('p')
    await sleep(300)
    g = await glyph(page)
    check("'help' lights as an action in the marks overlay", g.reading && g.marked && g.actions.includes('help'), JSON.stringify({ actions: g.actions }))
    check('the input glyphs stand down while the reading paints', g.inputColor === 'rgba(0, 0, 0, 0)', g.inputColor)

    await clearLine(page)
    await page.keyboard.type('/')
    await sleep(200)
    g = await glyph(page)
    check("a second '/' never lands", g.slash && g.value === '')

    // ── the reading: tandem, residue, filler ───────────────
    await page.keyboard.type('spotlight the snacks and fit')
    await sleep(400)
    g = await glyph(page)
    check('two actions light in one sentence', g.actions.length === 2 && g.actions.includes('spotlight') && g.actions.includes('fit'), JSON.stringify(g.actions))
    check("the connective before an action is residue", g.residue.includes('and'), JSON.stringify(g.residue))

    await clearLine(page)
    await page.keyboard.type('zzz nothing matches at all')
    await sleep(400)
    g = await glyph(page)
    check('pure filler stays plain — no overlay at all', !g.reading && !g.marked)
    await page.keyboard.press('Enter')
    await sleep(400)
    const pathways = await dropdownRows(page)
    check('Enter on an unmatched sentence offers the pathways', ['create', 'ask', 'filter'].every(p => pathways.some(r => r.startsWith(p))), JSON.stringify(pathways))
    check('the pathways NEVER offer to mint a tile', !pathways.some(r => r.startsWith('tile')), JSON.stringify(pathways))
    await page.keyboard.press('Escape')
    await sleep(200)
    g = await glyph(page)
    check('Escape abandons the pathway choice, line intact', g.value === 'zzz nothing matches at all')

    // ── beehaviour mode mints nothing implicitly ───────────
    // The unmatched sentence must leave NO tile behind — not from the
    // pathway (which now teaches the word instead of creating), and not
    // from the old unknown-command create-goto built-in. `create` is the
    // only door, and picking the pathway hands you that sentence to press.
    const before = await cellLabels(page)
    await page.keyboard.press('Enter')
    await sleep(400)
    await page.keyboard.press('Enter')          // take the highlighted row
    await sleep(600)
    g = await glyph(page)
    check("the 'create' pathway FILLS the line, never creates",
      g.value === 'create zzz nothing matches at all', JSON.stringify(g.value))
    check('nothing was minted by the pathway',
      (await cellLabels(page)).length === before.length)

    await clearLine(page)
    await page.keyboard.type('zzznotabehaviour')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(700)
    check('an unknown word in command stance mints no tile',
      (await cellLabels(page)).length === before.length,
      JSON.stringify((await cellLabels(page)).slice(-4)))

    // ── the create behaviour: the one door ─────────────────
    await clearLine(page)
    await page.keyboard.type('create harness-made-me')
    await sleep(400)
    g = await glyph(page)
    check("'create' lights as an action, its name is the argument",
      g.actions.includes('create') && g.residue.length === 0, JSON.stringify(g.actions))
    await page.keyboard.press('Enter')
    await sleep(900)
    check('saying create makes the tile',
      (await cellLabels(page)).includes('harness-made-me'),
      JSON.stringify((await cellLabels(page)).slice(-4)))

    // ── the ambiguity: marked, never guessed ───────────────
    // The live census currently has no two-claimant word (the old
    // images-vs-lightbox collision was cleaned up), so the harness injects a
    // scratch provider claiming 'images' — page-local, gone on reload.
    await page.evaluate(() => {
      const d = window.ioc?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone')
      d?.addProvider?.({
        name: 'harness-ambiguity', priority: 10,
        behaviours: [{ name: 'harness-probe', aliases: ['images'], description: 'harness probe claiming the word images' }],
        execute: async () => {},
      })
    })
    await clearLine(page)
    await page.keyboard.type('show me the images')
    await sleep(400)
    g = await glyph(page)
    check("'images' marks as an ambiguity (two claimants)", g.ambiguity.includes('images'), JSON.stringify(g.ambiguity))
    await page.keyboard.press('Enter')
    await sleep(400)
    const claimants = await dropdownRows(page)
    check('Enter surfaces the claimants to choose from', claimants.some(r => r.startsWith('harness-probe')) && claimants.some(r => r.startsWith('lightbox')), JSON.stringify(claimants))
    await page.keyboard.press('Escape')
    await sleep(200)

    // ── punctuation never defeats the reading ──────────────
    await clearLine(page)
    await page.keyboard.type('help?')
    await sleep(400)
    g = await glyph(page)
    check("'help?' still lights help (the '?' stays unlit)", g.actions.includes('help'), JSON.stringify(g.actions))

    // ── destructive words confirm visibly ──────────────────
    await clearLine(page)
    await page.keyboard.type('remove zzz-not-a-real-tile')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(400)
    const confirmRows = await dropdownRows(page)
    check('a destructive reading asks run/cancel instead of arming silently',
      confirmRows.some(r => r.startsWith('run')) && confirmRows.some(r => r.startsWith('cancel')), JSON.stringify(confirmRows))
    await page.keyboard.press('Escape')
    await sleep(200)

    // ── tandem execution ───────────────────────────────────
    await clearLine(page)
    await page.keyboard.type('clear and fit')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(600)
    g = await glyph(page)
    check('a resolved sentence executes and the line clears', g.value === '', JSON.stringify({ value: g.value }))

    // ── Ctrl+Space: show me what there is ──────────────────
    // A blank line offers nothing by design. Ctrl+Space is the deliberate ask
    // that gate exists to tell apart from an accidental one, and typing from
    // there must filter the list rather than start it over.
    await clearLine(page)
    let opened = await dropdownRows(page)
    check('a blank command-stance line still offers nothing', opened.length === 0, JSON.stringify(opened.slice(0, 3)))
    await page.keyboard.press('Control+Space')
    await sleep(400)
    opened = await dropdownRows(page)
    check('Ctrl+Space opens the whole behaviour catalogue', opened.length > 20, 'rows=' + opened.length)
    await page.keyboard.type('provid')
    await sleep(400)
    const filtered = await dropdownRows(page)
    check('typing filters the opened catalogue down',
      filtered.length > 0 && filtered.length < opened.length && filtered.some(r => r.startsWith('providers')),
      JSON.stringify(filtered.slice(0, 3)))

    // ── spoken habits: it adapts to you ────────────────────
    // Nothing is learned from typing — only from running. `fit` is used here
    // because it is inert: no window, no navigation, nothing to undo.
    await clearLine(page)
    await page.keyboard.type('bring up fit')
    await sleep(300)
    await page.keyboard.press('Escape')
    await clearLine(page)
    await page.keyboard.type('bring up ')
    await sleep(400)
    check('a phrasing that was only TYPED teaches nothing',
      (await dropdownRows(page)).length === 0, JSON.stringify(await dropdownRows(page)))

    await clearLine(page)
    await page.keyboard.type('bring up fit')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(700)
    await clearLine(page)
    await page.keyboard.type('bring up ')
    await sleep(500)
    const learned = await dropdownRows(page)
    check('a phrasing that RAN comes back as a completion',
      learned.some(r => r.startsWith('bring up fit')), JSON.stringify(learned.slice(0, 3)))
    check('a learned row admits that it is YOURS',
      learned.some(r => r.startsWith('bring up fit') && r.includes('yours')), JSON.stringify(learned.slice(0, 1)))

    await clearLine(page)
    await page.keyboard.type('bring up f')
    await sleep(400)
    check('the learned phrasing narrows as you keep typing',
      (await dropdownRows(page)).some(r => r.startsWith('bring up fit')))

    // Accepting it must leave the line saying what YOU said, not the canon.
    await page.keyboard.press('Tab')
    await sleep(400)
    g = await glyph(page)
    check('accepting a learned phrasing keeps your words', g.value === 'bring up fit', JSON.stringify(g.value))
    check('and the behaviour in it still lights', g.actions.includes('fit'), JSON.stringify(g.actions))

    // Shift+Delete prunes the row you are looking at — the cure for one bad
    // guess that does not take the good ones with it.
    await clearLine(page)
    await page.keyboard.type('bring up over fit')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(700)
    await clearLine(page)
    await page.keyboard.type('bring up ')
    await sleep(500)
    const both = await dropdownRows(page)
    check('two endings can share one lead-in',
      both.some(r => r.startsWith('bring up fit')) && both.some(r => r.startsWith('bring up over fit')),
      JSON.stringify(both))
    // Highlight the unwanted one, then prune exactly it.
    const target = both.findIndex(r => r.startsWith('bring up over fit'))
    for (let i = 0; i < target; i++) { await page.keyboard.press('ArrowDown'); await sleep(80) }
    await page.keyboard.press('Shift+Delete')
    await sleep(500)
    const pruned = await dropdownRows(page)
    check('Shift+Delete drops the highlighted phrasing',
      !pruned.some(r => r.startsWith('bring up over fit')), JSON.stringify(pruned))
    check('and leaves its sibling alone',
      pruned.some(r => r.startsWith('bring up fit')), JSON.stringify(pruned))

    // The census is not yours to edit — Shift+Delete over a real behaviour
    // must do nothing rather than something surprising.
    await clearLine(page)
    await page.keyboard.press('Control+Space')
    await sleep(400)
    await page.keyboard.type('provid')
    await sleep(400)
    const beforeCensus = await dropdownRows(page)
    await page.keyboard.press('Shift+Delete')
    await sleep(400)
    check('Shift+Delete never prunes a real behaviour',
      JSON.stringify(await dropdownRows(page)) === JSON.stringify(beforeCensus),
      JSON.stringify(await dropdownRows(page)))

    // `forget` is the way out — and bare, it SHOWS rather than wipes.
    await clearLine(page)
    await page.keyboard.type('forget ')
    await sleep(400)
    check("'forget ' lists what has been learned",
      (await dropdownRows(page)).some(r => r.startsWith('bring up')), JSON.stringify(await dropdownRows(page)))
    await clearLine(page)
    await page.keyboard.type('forget bring up')
    await sleep(300)
    await page.keyboard.press('Enter')
    await sleep(700)
    await clearLine(page)
    await page.keyboard.type('bring up ')
    await sleep(500)
    check('forgetting a lead-in takes the phrasing back out',
      (await dropdownRows(page)).length === 0, JSON.stringify(await dropdownRows(page)))

    // ── the way back ───────────────────────────────────────
    await clearLine(page)
    await page.keyboard.type('>')
    await sleep(300)
    g = await glyph(page)
    check("typing '>' returns to tile mode", g.chevron && !g.slash && g.value === '')

    await clickGlyph(page)
    await sleep(300)
    g = await glyph(page)
    check('clicking the glyph walks back into command stance', g.slash && g.tinted)
    await clickGlyph(page)
    await sleep(300)
    g = await glyph(page)
    check('clicking again walks out', g.chevron && !g.tinted)
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
