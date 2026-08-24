#!/usr/bin/env node
// drive-square-tile-brief — the square tile view's DOG-EAR and its LEAF PAGE.
//
// The contract this proves:
//   1. Every plate carries a paper corner, and a plate that carries writing
//      or a behaviour wears it standing (`data-carries`).
//   2. Turning a corner opens the tile's BRIEF — its lists, its notes, the
//      beehaviors it carries, its pheromones — WITHOUT NAVIGATING. The plain
//      click still goes where it always went; reaching what a tile carries
//      never costs you your place.
//   3. Escape takes the card back before it takes the sheet.
//   4. The crest has the same corner, for the page you are standing in.
//   5. A LEAF IS NEVER AN EMPTY PAGE: with nothing behind it, the brief takes
//      the whole sheet, with the row it sits on along the foot.
//   6. The page writes where it reads — the inline composer lands a note at
//      the tile's own address, no navigation.
//
//   node scripts/drive-square-tile-brief.cjs [--url http://localhost:4253]
//                                            [--out <dir>] [--engine chrome]
//
// Needs the 4253 dev server FRESH — the watcher is blind to essentials edits,
// so a stale server serves the old bee and every check below fails honestly.

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
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/square-tile-brief')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png'), fullPage: true })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const go = (segs) => page.evaluate((s) => {
    window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s)
  }, segs)

  // Seeding an empty hive can reload the shell under us; a destroyed context
  // is a race, not a verdict, so the typing is retried once against the page
  // that came back.
  const addTile = async (name) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await typeTile(name) } catch (e) {
        if (!String(e).includes('Execution context was destroyed')) throw e
        await page.waitForLoadState('load').catch(() => {})
        await page.waitForTimeout(6000)
      }
    }
    return false
  }

  const typeTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)

  // Write a note at an explicit address — the bridge's own authoring path, so
  // the drill never depends on a panel being open.
  const writeNote = (parents, label, text, mark) => page.evaluate(async ({ p, l, t, m }) => {
    const notes = window.ioc?.get?.('@diamondcoreprocessor.com/NotesService')
    if (!notes?.addAtSegments) return false
    await notes.addAtSegments(p, l, t, null, m ?? null)
    return true
  }, { p: parents, l: label, t: text, m: mark })

  async function dressLayer(segs, kind, view) {
    await page.evaluate(({ s, k, v }) => {
      const cell = s.length ? s[s.length - 1] : '/'
      window.__hypercombEffectBus?.emit?.('features:enable', { cell, segments: s, kind: k })
      window.__hypercombEffectBus?.emit?.('features:default', { cell, segments: s, view: v, clear: false })
    }, { s: segs, k: kind, v: view })
    for (let attempt = 0; attempt < 8; attempt++) {
      const ok = await page.evaluate(async ({ s, v }) => {
        const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
        const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
        const store = window.ioc?.get?.('@hypercomb.social/Store')
        if (!history || !store) return false
        try {
          const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => s })
          const layer = await history.currentLayerAt(locSig)
          for (const sig of (layer?.decorations ?? [])) {
            const blob = await store.getResource(sig).catch(() => null)
            if (!blob) continue
            const rec = JSON.parse(await blob.text())
            if (rec?.kind === 'view:default' && rec?.payload?.view === v) return true
          }
        } catch { /* not yet */ }
        return false
      }, { s: segs, v: view })
      if (ok) return true
      await page.waitForTimeout(1000)
    }
    return false
  }

  const sheet = () => page.evaluate(() => {
    const host = document.querySelector('.hc-square-tile-view')
    const brief = host?.querySelector('.tb-brief')
    return {
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      here: (window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).join('/'),
      plates: host ? host.querySelectorAll('.wv-plate').length : 0,
      folds: host ? host.querySelectorAll('.wv-plate .wv-fold').length : 0,
      carrying: host ? host.querySelectorAll('.wv-fold[data-carries]').length : 0,
      crestFold: !!host?.querySelector('.wv-crest .wv-fold'),
      brief: !brief ? null : {
        scale: brief.getAttribute('data-scale'),
        name: brief.querySelector('.tb-name')?.textContent ?? '',
        facts: brief.querySelector('.tb-facts')?.textContent ?? '',
        points: [...brief.querySelectorAll('.tb-lists .tb-point-text')].map(n => n.textContent),
        prose: [...brief.querySelectorAll('.tb-prose')].map(n => n.textContent),
        behaviors: [...brief.querySelectorAll('.tb-behavior-name')].map(n => n.textContent),
        acts: [...brief.querySelectorAll('.tb-act-name')].map(n => n.textContent),
        siblings: [...brief.querySelectorAll('.tb-row-name')].map(n => n.textContent),
        composer: !!brief.querySelector('.tb-compose-field'),
        insideGrid: !!brief.closest('.wv-grid'),
      },
    }
  })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }

    await addTile('garden'); await page.waitForTimeout(2200)
    await addTile('stone'); await page.waitForTimeout(2200)

    // `garden` gets writing of both kinds: a marked point (the palette seeds
    // `label` as a heading) and a plain prose note.
    check('a point lands on garden', await writeNote([], 'garden', 'the beds face south', 'label'))
    await page.waitForTimeout(1600)
    check('a prose note lands on garden',
      await writeNote([], 'garden', 'Everything here was planted in the same week.'))
    await page.waitForTimeout(1600)

    check('the root wears the square tile view as its face',
      await dressLayer([], 'visual:square-tile:view', 'square-tile-view'))

    // Arrive at the root THE ARRIVAL WAY. Standing still is not an arrival:
    // the face is resolved when the lineage MOVES, so a `go([])` from the
    // root is a no-op and the hexagons stay up.
    await go(['stone']); await page.waitForTimeout(2500)
    await go([]); await page.waitForTimeout(3500)
    const arrived = await sheet()
    check('the root opens as the square tile view, every plate wearing a corner',
      arrived.mode === 'square-tile-view' && arrived.plates >= 2 && arrived.folds === arrived.plates,
      JSON.stringify({ mode: arrived.mode, plates: arrived.plates, folds: arrived.folds }))
    check('the corner stands on the tile that carries writing', arrived.carrying >= 1,
      'carrying=' + arrived.carrying)
    check('the page has a corner of its own', arrived.crestFold)
    await shot('01-plates-with-corners')

    // ── TURNING A CORNER MUST NOT NAVIGATE ──────────────────────────────
    await page.locator('.wv-plate:has(.wv-caption:text-is("garden")) .wv-fold').first().click()
    await page.waitForTimeout(1600)
    const opened = await sheet()
    check('turning a corner opens the brief IN the page', !!opened.brief && opened.brief.scale === 'spread')
    check('turning a corner does not navigate', opened.here === '' && opened.mode === 'square-tile-view',
      JSON.stringify({ here: opened.here, mode: opened.mode }))
    check('the card opens inside the grid, in the plate\'s own row', !!opened.brief?.insideGrid)
    check('the brief is about the tile whose corner was turned',
      (opened.brief?.name ?? '').toLowerCase().includes('garden'), opened.brief?.name)
    check('the point is on the lists side',
      (opened.brief?.points ?? []).some(t => (t ?? '').includes('face south')),
      JSON.stringify(opened.brief?.points))
    check('the prose is on the notes side',
      (opened.brief?.prose ?? []).some(t => (t ?? '').includes('planted in the same week')),
      JSON.stringify(opened.brief?.prose))
    check('the hexagon band\'s affordances came across to the card',
      (opened.brief?.acts ?? []).length > 0, JSON.stringify(opened.brief?.acts))
    await shot('02-corner-turned')

    // ── ESCAPE TAKES THE CARD BEFORE THE SHEET ──────────────────────────
    await page.keyboard.press('Escape')
    await page.waitForTimeout(900)
    const afterEscape = await sheet()
    check('Escape turns the corner back and leaves the sheet standing',
      !afterEscape.brief && afterEscape.mode === 'square-tile-view',
      JSON.stringify({ brief: !!afterEscape.brief, mode: afterEscape.mode }))

    // ── THE PAGE'S OWN CORNER ───────────────────────────────────────────
    await page.locator('.wv-crest .wv-fold').first().click()
    await page.waitForTimeout(1600)
    const crest = await sheet()
    check('the crest\'s corner briefs the place you are standing in',
      !!crest.brief && !crest.brief.insideGrid, JSON.stringify({ brief: !!crest.brief }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)

    // ── THE LEAF IS NOT AN EMPTY PAGE ───────────────────────────────────
    await go(['stone']); await page.waitForTimeout(3800)
    const leaf = await sheet()
    check('the leaf inherits the face down the branch', leaf.mode === 'square-tile-view', leaf.mode)
    check('the leaf renders its brief as the whole page',
      !!leaf.brief && leaf.brief.scale === 'page', JSON.stringify({ scale: leaf.brief?.scale }))
    check('the leaf page says it is the end of the branch',
      (leaf.brief?.facts ?? '').length > 0, leaf.brief?.facts)
    check('the leaf page carries the row it sits on',
      (leaf.brief?.siblings ?? []).length >= 2, JSON.stringify(leaf.brief?.siblings))
    check('the leaf page offers a line to write on', !!leaf.brief?.composer)
    await shot('03-leaf-page')

    // ── THE PAGE WRITES WHERE IT READS ──────────────────────────────────
    await page.locator('.tb-compose-field').first().fill('quarried from the ridge')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3200)
    const written = await sheet()
    check('a note written on the leaf page lands on the leaf, with no navigation',
      (written.brief?.prose ?? []).some(t => (t ?? '').includes('quarried from the ridge')) &&
      written.here === 'stone',
      JSON.stringify({ prose: written.brief?.prose, here: written.here }))
    await shot('04-written-in-place')

    // ── AND THE ROW IS A WAY OUT ────────────────────────────────────────
    await page.locator('.tb-row-plate:not([data-current])').first().click()
    await page.waitForTimeout(3000)
    const walked = await sheet()
    check('a neighbour on the row is a way onward', walked.here === 'garden', walked.here)

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    const failed = results.filter(r => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close()
    process.exitCode = failed.length ? 1 : 0
  }
}

main().catch(e => { console.error(e); process.exit(1) })
