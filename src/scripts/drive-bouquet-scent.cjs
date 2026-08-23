#!/usr/bin/env node
// drive-bouquet-scent — the bouquet in hand: shade, click-to-scent, search.
//
//   node scripts/drive-bouquet-scent.cjs [--url http://localhost:4251] [--out <dir>]
//
// The panel rework replaced the painter/collecting-walk with the shaded hive:
// gathering a pheromone (＋, or a bouquet click) arms it, tiles missing the
// set shade out, and a PLAIN CLICK on a shaded tile scents it at once — no
// staging, no Done, and NO MESSAGING (descriptions live on hover only).
// Dragging a pheromone or bouquet shades the same way for the length of the
// drag, and the drop lands the whole set. This drives that loop end to end,
// plus the search field (the panel's one lens) and the inline bouquet row.
// HEADED: the Pixi drone under headless has no GPU and the shaders throw.
// Fresh browser profile → its own OPFS; never the working hive's store.

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, name)
}

/** Where a tile IS on screen — the render's own numbers, inverted (same
 *  derivation as drive-swap-cue's tileClientPoint). */
async function tileClientPoint(page, label) {
  return page.evaluate((name) => {
    const last = window.__hypercombEffectBus?.lastValue
    if (!last) return { ok: false, reason: 'no bus' }
    const host = last.get('render:host-ready')
    const cells = last.get('render:cell-count')
    const off = last.get('render:mesh-offset') ?? { x: 0, y: 0 }
    const flat = !!(last.get('render:set-orientation') ?? {}).flat
    if (!host?.container || !host?.canvas || !host?.renderer) return { ok: false, reason: 'no host' }
    const i = (cells?.labels ?? []).indexOf(name)
    if (i < 0) return { ok: false, reason: 'not rendered', labels: cells?.labels ?? [] }
    const { q, r } = cells.coords[i]
    const s = window.ioc?.get?.('@diamondcoreprocessor.com/HexDetector')?.spacing
    if (!s) return { ok: false, reason: 'no detector' }
    const mx = flat ? 1.5 * s * q : Math.sqrt(3) * s * (q + r / 2)
    const my = flat ? Math.sqrt(3) * s * (r + q / 2) : s * 1.5 * r
    const pt = host.container.toGlobal({ x: mx + off.x, y: my + off.y })
    const rect = host.canvas.getBoundingClientRect()
    const screen = host.renderer.screen
    return {
      ok: true,
      x: rect.left + pt.x * (rect.width / screen.width),
      y: rect.top + pt.y * (rect.height / screen.height),
    }
  }, label)
}

async function dismissBuildOverlay(page) {
  const overlayUp = () => page.evaluate(() =>
    !!document.querySelector('vite-error-overlay')
    || /TS\d{4,5}:|NG\d{4}:/.test(document.body?.innerText?.slice(0, 4000) ?? ''))
  if (!(await overlayUp())) return
  const text = await page.evaluate(() =>
    (document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '').slice(0, 200))
  console.log('  [overlay] dismissing dev-server error overlay:', text.trim().slice(0, 160))
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await overlayUp()) throw new Error('compile-error overlay will not dismiss — fix the build first')
}

const sticky = (page, effect) => page.evaluate(
  (name) => window.__hypercombEffectBus?.lastValue?.get(name) ?? null, effect)

async function main() {
  const url = arg('url', 'http://localhost:4251')
  const out = arg('out', path.join(__dirname, '..', 'test-results', 'bouquet-scent'))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const settle = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.waitForFunction(() => !!window.__hypercombEffectBus?.lastValue?.get('render:host-ready'), null, { timeout: 90000 })
        await sleep(1500)
        await dismissBuildOverlay(page)
        return
      } catch (err) {
        if (!/context was destroyed|Execution context/i.test(String(err))) throw err
        console.log('  [reload] the page reloaded under us — waiting for it to come back')
        await sleep(2000)
      }
    }
    throw new Error('page never settled — the dev server keeps reloading')
  }
  await settle()

  // Two tiles: one to scent, one to leave alone (it must stay shaded).
  // The tree is being edited by live sessions, so any step here can be cut
  // down by an HMR reload — ride those out exactly like settle() does.
  for (const name of ['scent-a', 'scent-b']) {
    let landed = false
    for (let attempt = 0; attempt < 4 && !landed; attempt++) {
      const typed = await addTile(page, name).catch(err => {
        if (!/context was destroyed|Execution context/i.test(String(err))) throw err
        return { ok: false, reason: 'page reloaded under us' }
      })
      if (!typed.ok) { console.log(`  [addTile] ${name}: ${typed.reason}`); await settle(); continue }
      landed = await page.waitForFunction((n) =>
        (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).includes(n),
        name, { timeout: 12000 }).then(() => true, () => false)
      if (!landed) {
        const state = await page.evaluate(() => ({
          added: window.__hypercombEffectBus?.lastValue?.get('cell:added') ?? null,
          labels: (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).slice(0, 8),
          input: document.querySelector('hc-command-line input')?.value ?? null,
        }))
        console.log(`  [addTile] ${name} did not render (attempt ${attempt + 1})`, JSON.stringify(state))
        await page.keyboard.press('Escape')
        await sleep(800)
      }
    }
    if (!landed) throw new Error(`tile ${name} never rendered`)
    await sleep(400)
  }
  await sleep(600)

  // ── the panel opens with its new furniture ─────────────────────────
  await page.evaluate(() => window.__hypercombEffectBus.emit('tags:view-open', {}))
  await page.waitForSelector('.tags-panel', { timeout: 15000 })
  await sleep(600)

  check('search field renders', await page.$('.tags-search-field') !== null)
  check('no species chips, no tag cloud — just the search', await page.$('.tags-type-btn') === null)
  check('the scent-tiles entry button is GONE', await page.$('.tags-painter-open') === null)
  check('NO MESSAGING: intro, hints and footer are all gone', await page.evaluate(() =>
    !document.querySelector('.tags-intro') && !document.querySelector('.tags-foot')
    && !document.querySelector('.bouquet-hint') && !document.querySelector('.apply-hint')))
  check('the intro lives on hover instead', await page.evaluate(() =>
    (document.querySelector('.tags-heading')?.getAttribute('title') ?? '').length > 0))

  // Two keywords: one to gather (it will LEAVE the loose list once its
  // bouquet is saved — the grouping doctrine), one that stays loose.
  await page.evaluate(async () => {
    const registry = window.ioc?.get?.('@hypercomb.social/TagRegistry')
    await registry?.add('probe-mark', '#4fc08d')
    await registry?.add('loose-extra', '#c0a24f')
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.tags-row .tag-name')].some(b => b.textContent?.trim() === 'probe-mark'),
    null, { timeout: 10000 })

  // ── gathering IS arming ────────────────────────────────────────────
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.tags-row')]
      .find(r => r.querySelector('.tag-name')?.textContent?.trim() === 'probe-mark')
    row?.querySelector('.tag-apply')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(400)

  const armed = await sticky(page, 'tags:apply-pending')
  check('＋ arms the bouquet', armed?.active === true && (armed?.tags ?? []).includes('probe-mark'), JSON.stringify(armed))
  check('the armed payload carries the shade colour', typeof armed?.color === 'string' && armed.color.length > 0, String(armed?.color))
  check('the in-hand strip appears', await page.$('.tags-inhand-section') !== null)

  // ── a plain click on a shaded tile SCENTS it ───────────────────────
  const at = await tileClientPoint(page, 'scent-a')
  check('tile located on screen', at.ok, JSON.stringify(at))
  if (at.ok) {
    await page.mouse.move(at.x, at.y, { steps: 6 })
    await sleep(300)
    await page.mouse.click(at.x, at.y)
    await sleep(1200)

    const changed = await sticky(page, 'tags:changed')
    const landed = (changed?.updates ?? []).some(u => u.cell === 'scent-a' && u.tag === 'probe-mark')
    check('the click landed the mark (tags:changed)', landed, JSON.stringify(changed))

    const worn = await page.evaluate(() => {
      const last = window.__hypercombEffectBus?.lastValue?.get('render:tags')
      return (last?.tags ?? []).find(t => t.name === 'probe-mark')?.count ?? 0
    })
    check('the page aggregation counts it', worn >= 1, `count=${worn}`)

    const still = await sticky(page, 'tags:apply-pending')
    check('the bouquet STAYS in hand after the click', still?.active === true, JSON.stringify(still))

    const here = await page.evaluate(() =>
      window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? null)
    check('the click did NOT navigate', Array.isArray(here) && here.length === 0, JSON.stringify(here))
    await page.screenshot({ path: path.join(out, 'scented.png') })
  }

  // ── name it: a bouquet, listed INLINE ──────────────────────────────
  await page.evaluate(() => document.querySelector('.bouquet-save-open')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await page.waitForSelector('.bouquet-name-input', { timeout: 5000 })
  await page.evaluate(() => {
    const input = document.querySelector('.bouquet-name-input')
    input.value = 'probe-set'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('.bouquet-row', { timeout: 10000 })
  const inline = await page.evaluate(() => {
    const load = document.querySelector('.bouquet-load')
    if (!load) return { ok: false, reason: 'no bouquet-load' }
    const style = getComputedStyle(load)
    const name = load.querySelector('.bouquet-name')
    const mark = load.querySelector('.bouquet-mark')
    const sameLine = name && mark
      && Math.abs(name.getBoundingClientRect().top - mark.getBoundingClientRect().top) < name.getBoundingClientRect().height
    return { ok: true, flexDirection: style.flexDirection, wrap: style.flexWrap, sameLine }
  })
  check('bouquet row flows INLINE (name: marks share the first line)',
    inline.ok && inline.flexDirection === 'row' && inline.wrap === 'wrap' && inline.sameLine,
    JSON.stringify(inline))

  // ── put down ───────────────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('.painter-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await sleep(400)
  const down = await sticky(page, 'tags:apply-pending')
  check('Put down disarms', down?.active === false, JSON.stringify(down))
  check('the strip goes away', await page.$('.tags-inhand-section') === null)

  // ── drag the bouquet onto the hive — the drag itself shades ────────
  // Real mouse from the bouquet row to a tile: mid-drag the marks must be
  // riding `drop:dragging` (show-cell's shade signal), and the release must
  // land the WHOLE set on the tile under the cursor.
  // The earlier scent popped scent-a's pheromone card, which anchors BESIDE
  // the hex — right over scent-b — and deliberately outlives the hover. A
  // release on the card names the CARD's tile (correct behaviour, wrong
  // target for this check), so put the card away first.
  await page.evaluate(() => window.__hypercombEffectBus.emit('pheromone:hover-hide', {}))
  await sleep(400)

  const loadBox = await (await page.$('.bouquet-load'))?.boundingBox()
  const target = await tileClientPoint(page, 'scent-b')
  check('drag endpoints located', !!loadBox && target.ok, JSON.stringify({ loadBox: !!loadBox, target }))
  if (loadBox && target.ok) {
    await page.mouse.move(loadBox.x + loadBox.width / 2, loadBox.y + loadBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(loadBox.x + 60, loadBox.y + 60, { steps: 6 })
    await sleep(250)
    const midDrag = await sticky(page, 'drop:dragging')
    check('the drag carries the marks for the shade',
      midDrag?.active === true && (midDrag?.marks ?? []).includes('probe-mark') && !!midDrag?.color,
      JSON.stringify(midDrag))
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await sleep(300)
    await page.mouse.up()
    await sleep(1200)
    const dropped = await sticky(page, 'tags:changed')
    check('the drop landed the bouquet on the tile',
      (dropped?.updates ?? []).some(u => u.cell === 'scent-b' && u.tag === 'probe-mark'),
      JSON.stringify(dropped))
    const after = await sticky(page, 'tags:apply-pending')
    check('the trailing click did NOT load the bouquet', after?.active !== true, JSON.stringify(after))
    const shadeDown = await sticky(page, 'drop:dragging')
    check('the drag shade stands down on release', shadeDown?.active === false, JSON.stringify(shadeDown))
  }

  // ── search + species chips ─────────────────────────────────────────
  const setQuery = (q) => page.evaluate((value) => {
    const input = document.querySelector('.tags-search-input')
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, q)

  // 'probe-mark' is gathered now, so searching it must surface its BOUQUET
  // (a bouquet matches on any mark it holds) — and hide the loose stranger.
  await setQuery('probe-m')
  await sleep(300)
  const markSearch = await page.evaluate(() => ({
    bouquets: document.querySelectorAll('.bouquet-row').length,
    loose: [...document.querySelectorAll('.tags-list .tag-name')].map(b => b.textContent?.trim()),
  }))
  check('searching a gathered mark surfaces its bouquet',
    markSearch.bouquets >= 1 && !markSearch.loose.includes('loose-extra'),
    JSON.stringify(markSearch))

  await setQuery('loose-ex')
  await sleep(300)
  const looseSearch = await page.evaluate(() => ({
    bouquets: document.querySelectorAll('.bouquet-row').length,
    loose: [...document.querySelectorAll('.tags-list .tag-name')].map(b => b.textContent?.trim()),
  }))
  check('search narrows the loose list',
    looseSearch.loose.includes('loose-extra') && looseSearch.bouquets === 0,
    JSON.stringify(looseSearch))

  await setQuery('zzz-nothing')
  await sleep(300)
  check('an empty search says so', await page.evaluate(() =>
    [...document.querySelectorAll('.tags-empty')].length > 0))

  await setQuery('')
  await sleep(300)

  await page.screenshot({ path: path.join(out, 'panel.png') })

  await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
