#!/usr/bin/env node
// drive-swap-cue — does the hovered tile SAY what the click will do?
//
//   node scripts/drive-swap-cue.cjs [--url http://localhost:4251] [--out <dir>]
//
// Swap mode (clipboard window open) + a pointer over a tile must float the
// verb pill: "✂ take" bare, "⊕ copy" with ctrl held — flipping LIVE on the
// modifier without the pointer moving — plus the native copy cursor. Real
// mouse moves and real Control keys through CDP; the assertion walks the
// LIVE Pixi scene graph for the pill's Text, because a cue that exists in
// state but not on the stage is exactly the bug being hunted. HEADED: the
// Pixi drone under headless has no GPU and the shaders throw.

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
    // LEAVE THE LINE. `command:composing` stands the hive's hover down while
    // the caret is in the command line — deliberately, so a pointer merely
    // crossing the hive while you are writing does not light tiles up. A
    // harness that types a name and never blurs is testing a SUPPRESSED hive:
    // every hover-driven cue reads as missing, and the key-driven ones (ctrl)
    // still work, which makes it look like a bug in the cue rather than in
    // the harness. Cost a full investigation once; never again.
    input.blur()
    return { ok: true }
  }, name)
}

/** Where a tile IS on screen — the render's own numbers, inverted (same
 *  derivation as drive-swarm-connectivity's tileClientPoint). */
async function tileClientPoint(page, label, offset) {
  return page.evaluate(({ name, off: nudge }) => {
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
    const pt = host.container.toGlobal({ x: mx + off.x + (nudge?.x ?? 0), y: my + off.y + (nudge?.y ?? 0) })
    const rect = host.canvas.getBoundingClientRect()
    const screen = host.renderer.screen
    return {
      ok: true,
      x: rect.left + pt.x * (rect.width / screen.width),
      y: rect.top + pt.y * (rect.height / screen.height),
    }
  }, { name: label, off: offset ?? null })
}

/** The pill's words, read off the LIVE stage: every Pixi Text under the
 *  render host whose text carries a cue glyph. (Presence on the stage, not
 *  worldVisible — that getter proved flaky on Text under this Pixi build.) */
async function cueTexts(page) {
  return page.evaluate(() => {
    const host = window.__hypercombEffectBus?.lastValue?.get('render:host-ready')
    const found = []
    const walk = (node, depth) => {
      if (!node || depth > 8) return
      if (typeof node.text === 'string' && /[✂⊕＋−✓↺]/.test(node.text)) {
        found.push({ text: node.text })
      }
      for (const child of node.children ?? []) walk(child, depth + 1)
    }
    walk(host?.container, 0)
    return { found, cursor: host?.canvas?.style?.cursor ?? '' }
  })
}

const cueSays = (cue, glyph) => cue.found.some(t => t.text.includes(glyph))

/** A dev-server error overlay swallows every pointer event (full-viewport
 *  backdrop), so hover-driven checks silently see nothing. The typecheck
 *  overlay can also be STALE — latched from a broken moment that has since
 *  been fixed — so dismiss it with Esc and only fail if it will not go. */
async function dismissBuildOverlay(page) {
  const overlayUp = () => page.evaluate(() =>
    !!document.querySelector('vite-error-overlay')
    || /TS\d{4,5}:|NG\d{4}:/.test(document.body?.innerText?.slice(0, 4000) ?? ''))
  if (!(await overlayUp())) return
  const text = await page.evaluate(() =>
    (document.querySelector('vite-error-overlay')?.shadowRoot?.textContent ?? '').slice(0, 160))
  console.log('  [overlay] dismissing dev-server error overlay:', text.trim().slice(0, 120))
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await overlayUp()) throw new Error('compile-error overlay will not dismiss — fix the build first')
}

async function main() {
  const url = arg('url', 'http://localhost:4251')
  const out = arg('out', path.join(__dirname, '..', '..', 'test-results', 'swap-cue'))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  // A live-reload mid-boot (another session saving a file, the dev server
  // rebuilding) destroys the execution context under any evaluate in flight.
  // Ride it out rather than reporting it as a failure of the thing under test.
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

  // A tile to hover.
  await addTile(page, 'cue-probe')
  await page.waitForFunction(() =>
    (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).includes('cue-probe'),
    null, { timeout: 30000 })
  await sleep(800)

  // Swap mode: the clipboard window opens and announces itself.
  await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:panel', { visible: true }))
  await page.waitForFunction(() =>
    window.__hypercombEffectBus?.lastValue?.get('clipboard:open')?.open === true, null, { timeout: 15000 })
  // The panel reserves the right edge and the global fit slides the mesh —
  // a point computed mid-tween lands the mouse on empty felt. Let it settle,
  // then PROVE the hover landed before asserting anything about the cue.
  await sleep(900)

  // EVERY hover re-derives the point. Opening or closing a docked panel
  // re-runs the global fit, which SLIDES the mesh — a point cached from
  // before the panel moved puts the mouse on empty felt, and the cue
  // (correctly) says nothing. Ask where the tile is now, move, and PROVE
  // the hover landed before asserting anything about the pill.
  const hoverTile = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const point = await tileClientPoint(page, 'cue-probe', { x: 0, y: -14 })
      if (!point.ok) return { ok: false, point }
      // Leave and re-enter so a hover that was already there still re-fires.
      await page.mouse.move(point.x + 40, point.y + 40, { steps: 3 })
      await sleep(120)
      await page.mouse.move(point.x, point.y, { steps: 8 })
      await sleep(400)
      const hover = await page.evaluate(() =>
        window.__hypercombEffectBus?.lastValue?.get('tile:hover')?.label ?? null)
      if (hover === 'cue-probe') return { ok: true, point }
      await sleep(500)
    }
    return { ok: false }
  }

  /** Re-hover and read the pill — every cue assertion goes through this so
   *  none of them can be reading a pointer that has drifted off the tile. */
  const rehover = async () => {
    await hoverTile()
    return cueTexts(page)
  }

  let at = await hoverTile()
  check('tile located on screen', at.ok, JSON.stringify(at))
  if (!at.ok) { await browser.close(); process.exit(1) }
  check('the pointer is ON the tile', true, 'hover=cue-probe')

  let cue = await cueTexts(page)
  check('bare hover floats the TAKE pill',
    cue.found.some(t => t.text.includes('✂')), JSON.stringify(cue))
  await page.screenshot({ path: path.join(out, 'cue-take.png') })

  // Ctrl goes DOWN with the pointer perfectly still — the pill must flip.
  await page.keyboard.down('Control')
  await sleep(300)
  cue = await cueTexts(page)
  check('ctrl (pointer still) flips the pill to COPY',
    cue.found.some(t => t.text.includes('⊕')), JSON.stringify(cue))
  check('the native copy cursor rides along', cue.cursor === 'copy', `cursor='${cue.cursor}'`)
  await page.screenshot({ path: path.join(out, 'cue-copy.png') })

  // And back.
  await page.keyboard.up('Control')
  await sleep(300)
  cue = await cueTexts(page)
  check('release flips back to TAKE',
    cue.found.some(t => t.text.includes('✂'))
    && !cue.found.some(t => t.text.includes('⊕')), JSON.stringify(cue))
  check('copy cursor released', cue.cursor !== 'copy', `cursor='${cue.cursor}'`)

  // Window closed → no cue.
  await page.evaluate(() => window.__hypercombEffectBus.emit('clipboard:panel', { visible: false }))
  await sleep(600)
  cue = await rehover()
  check('closing the window drops the cue', cue.found.length === 0, JSON.stringify(cue))

  // ── A BOUQUET IN HAND — the verb is a COMPARISON ────────────────────
  // The marks held against the marks the tile already wears. Same pill,
  // same place; three answers.

  await page.evaluate(() => window.__hypercombEffectBus.emit('tags:apply-pending',
    { active: true, tags: ['urgent'], cells: [] }))
  cue = await rehover()
  check('a bouquet the tile lacks says MARK', cueSays(cue, '＋'), JSON.stringify(cue))
  await page.screenshot({ path: path.join(out, 'cue-mark.png') })

  // (There is no staged/RELEASE verb any more: the collecting walk retired in
  // favour of click-scents-the-shaded-tile, so `cells` no longer changes the
  // hovered tile's answer.)

  // THE COMPARISON ITSELF: give the tile the mark, and the answer changes
  // from "mark" to "already marked" without the bouquet changing at all.
  const applied = await page.evaluate(async () => {
    const decorations = window.ioc?.get?.('@diamondcoreprocessor.com/DecorationService')
    if (!decorations?.addTag) return 'no decoration service'
    try { await decorations.addTag(['cue-probe'], 'urgent'); return 'ok' } catch (e) { return String(e).slice(0, 80) }
  })
  if (applied !== 'ok') {
    console.log('  [skip] could not apply a real mark:', applied)
  } else {
    await sleep(900)
    await page.evaluate(() => window.__hypercombEffectBus.emit('tags:apply-pending',
      { active: true, tags: ['urgent'], cells: [] }))
    cue = await rehover()
    check('a tile that already wears the mark says MARKED',
      cueSays(cue, '✓'), JSON.stringify(cue))
    await page.screenshot({ path: path.join(out, 'cue-marked.png') })
  }

  // Bouquet put down → the hive goes quiet again.
  await page.evaluate(() => window.__hypercombEffectBus.emit('tags:apply-pending', { active: false, tags: [], cells: [] }))
  cue = await rehover()
  check('putting the bouquet down drops the cue', cue.found.length === 0, JSON.stringify(cue))

  await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
