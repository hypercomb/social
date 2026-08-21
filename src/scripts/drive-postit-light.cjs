#!/usr/bin/env node
// drive-postit-light — a post-it takes a cell over, and what that costs.
//
//   node scripts/drive-postit-light.cjs [--url http://localhost:4251] [--out <dir>]
//
// Three phases, on a fresh hive, no bridge and no OPFS wiping (its own browser
// profile, its own empty hive):
//
//   1. A TAKEOVER IS NOT AN ABSENCE — a layer holding only post-its paints no
//      hexagons, and must NOT announce itself empty.
//   2. …at depth, and without the beehaviors panel raising itself over the
//      notes on arrival.
//   3. THE POOL SWITCH is what takes the note off the glass: light off → the
//      hexagon comes back wearing the ASLEEP mark (it is standing in for a
//      view that has been put out) → light on → the note returns.

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const ASLEEP_TINT = 0x6b7681

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
  // The shell mounts the command line after boot; on a cold, busy machine the
  // fixed wait above is not always enough.
  await page.waitForSelector('input.command-input', { timeout: 60000 })
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

const goTo = (page, segments) => page.evaluate((segs) => {
  window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerReplace?.(segs)
}, segments)

/** What the glass says right now. */
async function surface(page) {
  return page.evaluate(() => {
    const drone = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    return {
      hexes: [...(drone?.renderedCells?.keys?.() ?? [])],
      stickies: document.querySelectorAll('.postit-sticky').length,
      emptyPrompt: document.getElementById('hc-collection-empty-prompt')?.dataset?.variant ?? null,
      emptyPromptUp: !!document.getElementById('hc-collection-empty-prompt'),
      panelUp: !!document.querySelector('hc-features-viewer .features-scroll'),
      globalOn: (() => {
        try { return JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? 'null') }
        catch { return null }
      })(),
    }
  })
}

/** The overlay's icon gates, asked exactly as the renderer asks them. */
async function iconGates(page, label) {
  return page.evaluate((cell) => {
    const registry = window.ioc?.get?.('@hypercomb.social/IconProviderRegistry')
    const byName = new Map((registry?.all?.() ?? []).map(p => [p.name, p]))
    const gate = (name) => {
      const p = byName.get(name)
      if (!p) return null
      return { visible: p.visibleWhen ? !!p.visibleWhen({ label: cell }) : true, tint: p.tintWhen ? p.tintWhen({ label: cell }) : null }
    }
    return { enter: gate('view-enter:postit'), asleep: gate('view-asleep:postit') }
  }, label)
}

const isOn = (s) => Array.isArray(s.globalOn) ? s.globalOn.includes('visual:postit:note') : null

/** The human path to the pool: rail Beehaviors switch, then the lens
 *  (all -> views -> behaviors -> pool). Idempotent. */
async function openPool(page) {
  for (let i = 0; i < 3 && !(await page.locator('.features-mode').count()); i++) {
    await page.click('.rail-btn.features-toggle-btn', { force: true })
    await page.waitForTimeout(2000)
  }
  await page.waitForSelector('.features-mode', { timeout: 20000 })
  for (let i = 0; i < 4 && !(await page.locator('.features-scroll.store').count()); i++) {
    await page.click('.features-mode', { force: true })
    await page.waitForTimeout(1000)
  }
  await page.waitForSelector('.features-scroll.store', { timeout: 20000 })
  await page.waitForTimeout(800)
}

/** Put the panel away, if it is up. */
async function closePanel(page) {
  if (await page.locator('.features-close').count()) {
    await page.click('.features-close', { force: true }).catch(() => {})
    await page.waitForTimeout(1500)
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
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

    // ── 1. the hive root, holding one post-it ──────────────────────────
    await typeCommand(page, 'probe')
    await page.waitForTimeout(1200)
    await typeCommand(page, 'probe@postit Read this before Saturday')
    await page.waitForTimeout(3500)
    await shot('light-01-sticky')

    const lit = await surface(page)
    check('the post-it is the tile’s presence', lit.stickies > 0 && !lit.hexes.includes('probe'), JSON.stringify(lit.hexes))
    check('a hive holding a post-it does not call itself empty', !lit.emptyPromptUp, String(lit.emptyPrompt))

    // ── 2. the same, one layer down, on arrival ────────────────────────
    await typeCommand(page, 'folder')
    await page.waitForTimeout(1500)
    await goTo(page, ['folder'])
    await page.waitForTimeout(3000)
    await typeCommand(page, 'inner')
    await page.waitForTimeout(1500)
    await typeCommand(page, 'inner@postit Doors at 7')
    await page.waitForTimeout(3000)
    // The panel legitimately raised itself when /folder WAS empty (before
    // `inner` existed). Put it away, so what we measure next is the ARRIVAL,
    // not that leftover.
    await closePanel(page)
    // Leave and come back: arriving is what asks the emptiness question.
    await goTo(page, [])
    await page.waitForTimeout(2500)
    await goTo(page, ['folder'])
    await page.waitForTimeout(4000)
    await shot('light-02-inside')

    const inside = await surface(page)
    console.log('  inside ' + JSON.stringify(inside.hexes) + ' stickies=' + inside.stickies
      + ' prompt=' + inside.emptyPrompt + ' panel=' + inside.panelUp)
    check('the layer shows its post-it', inside.stickies > 0, String(inside.stickies))
    check('a layer of post-its is not "No tiles yet"', !inside.emptyPromptUp, String(inside.emptyPrompt))
    check('the beehaviors panel does not raise itself over the notes', !inside.panelUp, String(inside.panelUp))

    // ── 3. the pool switch, and the mark it leaves ─────────────────────
    await goTo(page, [])
    await page.waitForTimeout(3000)
    const gatesLit = await iconGates(page, 'probe')
    console.log('  gates lit ' + JSON.stringify(gatesLit))
    check('while lit, the tile offers the view and wears no asleep mark',
      gatesLit.enter?.visible === true && gatesLit.asleep?.visible === false, JSON.stringify(gatesLit))

    await openPool(page)
    await shot('light-03-pool')

    const postitRow = page.locator('.features-scroll.store .features-row', { hasText: '/postit' }).first()
    check('the Post-it row is in the pool, lit', (await postitRow.count()) > 0
      && (await postitRow.getAttribute('aria-checked')) === 'true',
      String(await postitRow.getAttribute('aria-checked')))

    // the accident: one click anywhere on the row
    await postitRow.click()
    await page.waitForTimeout(3500)
    const dark = await surface(page)
    const gatesDark = await iconGates(page, 'probe')
    console.log('  dark ' + JSON.stringify(dark.hexes) + ' stickies=' + dark.stickies + ' lit=' + isOn(dark))
    console.log('  gates dark ' + JSON.stringify(gatesDark))
    check('the light went out', isOn(dark) === false, String(isOn(dark)))
    check('the sticky left and the plain hexagon came back',
      dark.stickies === 0 && dark.hexes.includes('probe'), JSON.stringify(dark.hexes) + ' / ' + dark.stickies)
    check('the stand-in hexagon wears the asleep mark',
      gatesDark.asleep?.visible === true && gatesDark.enter?.visible === false, JSON.stringify(gatesDark))
    check('the mark is the switched-off colour',
      gatesDark.asleep?.tint === ASLEEP_TINT, '0x' + Number(gatesDark.asleep?.tint ?? 0).toString(16))

    // Put the panel away and hover the stand-in, so the mark can be SEEN.
    // Inside /folder there is exactly ONE tile, so the hexagon is at the
    // canvas centre and the hover cannot land on a neighbour.
    await closePanel(page)
    await goTo(page, ['folder'])
    await page.waitForTimeout(3500)
    await page.mouse.move(720, 450)
    await page.waitForTimeout(1800)
    await shot('light-04-asleep-mark')

    // The mark is a DOOR: clicking it cannot enter a view that renders
    // nothing, so it opens Beehaviors on this tile — where the light is.
    // A real click on the Pixi icon under the pointer, not a synthetic one.
    await page.mouse.click(720, 450)
    await page.waitForTimeout(3000)
    const opened = await page.evaluate(() => ({
      panel: !!document.querySelector('hc-features-viewer .features-scroll'),
      header: (document.querySelector('hc-features-viewer header')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }))
    console.log('  asleep click ' + JSON.stringify(opened))
    check('clicking the mark opens Beehaviors on that tile',
      opened.panel && opened.header.includes('inner'), JSON.stringify(opened))
    await shot('light-05-door')

    await closePanel(page)
    await goTo(page, [])
    await page.waitForTimeout(2500)

    // the cure: click it again
    await openPool(page)
    await postitRow.click()
    await page.waitForTimeout(3500)
    await shot('light-05-back')
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
