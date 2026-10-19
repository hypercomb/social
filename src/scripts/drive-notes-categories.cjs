#!/usr/bin/env node
// drive-notes-categories — the category tree beside the notes, by hand.
//
//   node scripts/drive-notes-categories.cjs [--url http://localhost:4251/] [--headed] [--out cats.png]
//
// Boots the dev shell in its own browser profile (never the participant's —
// one writer per hive), takes the first-boot example hive, writes a handful
// of notes on its tile and then works the tree the way a participant does:
// names two categories with `+`, files a note into each with the `sell`
// button, picks a label and expects only that branch beside it, picks
// Unsorted and expects the rest, reloads and expects the tree back, renames
// one by double-click, removes it and expects its note unsorted again, and
// asks for suggestions with no AI set up and expects to be told so.

const path = require('node:path')
const { chromium } = require('playwright')

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const URL_ = String(arg('url', 'http://localhost:4251/'))
const OUT = path.resolve(String(arg('out', 'notes-categories.png')))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`) }

const NOTES = [
  'ATP is made in the mitochondria',
  'DNA is a double helix',
  'Glycolysis splits glucose into pyruvate',
  'Genes are read by RNA polymerase',
]

async function waitFor(fn, ok, ms = 20000, step = 400) {
  const t0 = Date.now()
  let v
  while (Date.now() - t0 < ms) {
    try { v = await fn() } catch { v = undefined }
    if (ok(v)) return { ok: true, value: v }
    await sleep(step)
  }
  return { ok: false, value: v }
}

;(async () => {
  const browser = await chromium.launch({ headless: arg('headed', false) !== true, args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const boot = async () => {
    await page.goto(URL_, { waitUntil: 'load' })
    await waitFor(() => page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/NoteCategories')), v => v, 40000)
  }
  await boot()
  // The first-boot card offers the example hive; it paints after the bees.
  const took = (await waitFor(() => page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Add +')
    if (btn) btn.click()
    return !!btn
  }), v => v, 30000, 800)).ok
  if (took) await sleep(8000)
  const labels = await waitFor(() => page.evaluate(() => (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).map(String)), v => v?.length > 0, 40000)
  const tile = labels.value?.[0]
  check('a tile to write on', !!tile, tile)

  for (const text of NOTES) {
    await page.evaluate(({ tile, text }) => window.__hypercombEffectBus.emit('note:commit', { cellLabel: tile, text, mark: null }), { tile, text })
    await sleep(700)
  }

  const openDesk = async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('notes:panel', { visible: true }))
    return waitFor(() => page.evaluate(() => !!document.querySelector('.cv2-cats')), v => v, 15000)
  }
  check('the tree stands to the left of the notes', (await openDesk()).ok)
  const side = await page.evaluate(() => {
    const cats = document.querySelector('.cv2-cats')?.getBoundingClientRect()
    const list = document.querySelector('.cv2-ledger .cv2-list')?.getBoundingClientRect()
    return cats && list ? { cats: Math.round(cats.right), list: Math.round(list.left) } : null
  })
  check('…beside the notes column, not above it', side && side.cats <= side.list + 1, JSON.stringify(side))

  // Name two categories with `+`.
  await page.click('.cv2-cats-tool[aria-label="New category"]')
  await page.waitForFunction(() => document.activeElement?.classList.contains('cv2-cat-input'), null, { timeout: 5000 })
  await page.keyboard.type('Energy'); await page.keyboard.press('Enter'); await sleep(900)
  await page.keyboard.type('Genetics'); await page.keyboard.press('Enter'); await sleep(900)
  await page.keyboard.press('Escape'); await sleep(300)
  const names = () => page.evaluate(() => Array.from(document.querySelectorAll('.cv2-cat-row .cv2-cat .cv2-cat-name')).map(n => n.textContent.trim()))
  check('two categories, named by hand', (await waitFor(names, v => v?.join() === 'Energy,Genetics')).ok, JSON.stringify(await names()))

  // File a note: read it in the pane, then `sell` on the label.
  const fileInto = async (noteText, category) => {
    await page.evaluate((t) => {
      const row = Array.from(document.querySelectorAll('.cv2-list .cv2-note')).find(r => (r.innerText || '').includes(t))
      row?.querySelector('.cv2-note-body')?.click()
    }, noteText)
    await sleep(400)
    const row = page.locator('.cv2-cat-row', { has: page.locator('.cv2-cat-name', { hasText: category }) }).first()
    await row.hover()
    await row.locator('.cv2-cat-act[aria-label="File the note you are reading here"]').click()
    await sleep(1200)
  }
  // The example tile may already carry a note of its own; count from it.
  const base = Number(await page.evaluate(() => document.querySelector('.cv2-cat-all .cv2-cat-count')?.textContent?.trim())) - NOTES.length
  await fileInto(NOTES[0], 'Energy')
  await fileInto(NOTES[1], 'Genetics')
  const counts = () => page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('.cv2-cat')).map(b => [b.querySelector('.cv2-cat-name')?.textContent.trim(), b.querySelector('.cv2-cat-count')?.textContent.trim()])))
  const c1 = await waitFor(counts, v => v?.Energy === '1' && v?.Genetics === '1' && Number(v?.Unsorted) === 2 + base)
  check('each note filed where it was put; the rest unsorted', c1.ok, JSON.stringify(c1.value))
  if (!c1.ok) {
    console.log(JSON.stringify(await page.evaluate(() => ({
      cats: !!document.querySelector('.cv2-cats'),
      plate: document.querySelector('.cv2-plate-name')?.textContent?.trim(),
      strip: !!document.querySelector('.notes-strip'),
      editing: !!document.querySelector('.cv2-reading-editor, .cv2-form'),
      tab: document.querySelector('.cv2-tab.is-active')?.textContent?.trim(),
    }))))
    await page.screenshot({ path: OUT })
  }

  // A label shows its branch, and wears the check.
  const shown = () => page.evaluate(() => Array.from(document.querySelectorAll('.cv2-list .cv2-note .cv2-note-text')).map(n => n.textContent.trim()))
  // A label is clicked where a person aims: its name, from the left.
  await page.locator('.cv2-cat', { has: page.locator('.cv2-cat-name', { hasText: 'Energy' }) }).first().click({ position: { x: 14, y: 12 } })
  const branch = await waitFor(shown, v => v?.length === 1)
  check('Energy shows only its note', branch.ok && branch.value[0] === NOTES[0], JSON.stringify(branch.value))
  const glyph = await page.evaluate(() => document.querySelector('.cv2-cat.is-on .cv2-cat-glyph')?.textContent.trim())
  check('the picked label wears the check', glyph === 'check_circle', glyph)
  await page.locator('.cv2-cat-unsorted').click()
  const rest = await waitFor(shown, v => v?.length === 2 + base && !v.includes(NOTES[0]) && !v.includes(NOTES[1]))
  check('Unsorted shows the other two', rest.ok, JSON.stringify(rest.value))
  await page.locator('.cv2-cat-all').click()
  check('All notes shows every note again', (await waitFor(shown, v => v?.length >= NOTES.length)).ok)
  await page.screenshot({ path: OUT })

  // It is kept: on the tile's layer, so a reload brings it back.
  await boot()
  await openDesk()
  const kept = await waitFor(counts, v => v?.Energy === '1' && v?.Genetics === '1')
  check('the tree survives a reload', kept.ok, JSON.stringify(kept.value))

  // Rename by double-click.
  await page.locator('.cv2-cat', { has: page.locator('.cv2-cat-name', { hasText: 'Genetics' }) }).first().dblclick({ position: { x: 14, y: 12 } })
  await page.waitForFunction(() => document.activeElement?.classList.contains('cv2-cat-input'), null, { timeout: 5000 })
  await page.keyboard.type('Heredity'); await page.keyboard.press('Enter')
  check('a double-click renames', (await waitFor(names, v => v?.includes('Heredity') && !v.includes('Genetics'))).ok, JSON.stringify(await names()))

  // Remove: the category goes, its note is unsorted again, nothing is lost.
  const her = page.locator('.cv2-cat-row', { has: page.locator('.cv2-cat-name', { hasText: 'Heredity' }) }).first()
  await her.hover()
  await her.locator('.cv2-cat-act[aria-label^="Remove this category"]').click()
  const after = await waitFor(counts, v => v && !('Heredity' in v) && Number(v.Unsorted) === 3 + base)
  check('removing a category unsorts its note and loses none', after.ok, JSON.stringify(after.value))
  const all = await page.evaluate(() => document.querySelector('.cv2-cat-all .cv2-cat-count')?.textContent.trim())
  check('every note still on the tile', Number(all) >= NOTES.length, all)

  // No AI set up: suggesting says so, plainly.
  await page.click('.cv2-cats-tool[aria-label="Suggest categories with your AI"]')
  const said = await waitFor(() => page.evaluate(() => document.querySelector('.cv2-cats-msg')?.textContent.trim() ?? ''), v => !!v, 8000)
  check('with no AI, suggesting says how to get one', /providers/i.test(said.value ?? ''), said.value)

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n========== ${results.filter(r => r.ok).length}/${results.length} passed ==========  (${OUT})`)
  await browser.close()
  process.exit(results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
