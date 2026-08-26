#!/usr/bin/env node
// drive-chat-context-icon — can you POINT AND CLICK a tile onto the request?
//
//   node scripts/drive-chat-context-icon.cjs [--url http://localhost:4253]
//
// Folding the chat window away lets you go and find the tiles a request should
// carry; this is the affordance for putting them ON the shelf, because the one
// gesture the canvas already owns (drag) is a pan. What is under test:
//
//   1. the icon is OFFERED while folded away and taken away again when the
//      window comes back — an "add to the request" button on a surface with no
//      request behind it is a button that does nothing
//   2. pressing a tile puts it on the shelf WITH ITS SIGNATURE — a reference
//      with no sig contributes nothing to the request
//   3. pressing the same tile again takes it back off
//
// Read through the drone and the shelf's own DOM, never through a screenshot
// of the band: headless has no GPU, Pixi's shaders never compile, and a
// picture would prove nothing either way (see the Playwright/Pixi traps).
// Same reason the band's own `actionsForTile` is NOT the reader here: it
// answers by LABEL, and with no cell drawn the overlay knows no labels, so it
// would answer [] in every state and a green run would mean nothing.
//
// NEW ESSENTIALS FILE — a already-running server will NOT have it. Point this
// at a FRESHLY started one and confirm the marker first:
//   curl -s localhost:<port>/main.js | grep -c ChatContextActionDrone

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

const URL_ = String(arg('url', 'http://localhost:4253'))
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-context-icon')))
const TILE = 'context-target'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const DRONE = '@diamondcoreprocessor.com/ChatContextActionDrone'

/** IS THE ICON OFFERED. Asked of the drone, not of `actionsForTile` — the
 *  band's reader answers by LABEL, and a headless renderer draws no cells, so
 *  the overlay knows no labels and would answer [] in every state. That would
 *  make a green run mean nothing. */
const armed = page => page.evaluate(key => !!window.ioc?.get(key)?.armed, DRONE)

/** Drive the affordance the way the band drives it. */
const press = async (page, label) => {
  await page.evaluate(async ([key, name]) => {
    await window.ioc?.get(key)?.press(name)
  }, [DRONE, label])
  await page.waitForTimeout(1200)
}

const shelf = page => page.$$eval('hc-chat-window .chat-box-name', els => els.map(e => e.textContent))

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  // NOTE: addInitScript runs on EVERY navigation, so nothing that the run
  // itself changes may be set here — only the standing setup flags.
  await page.addInitScript(() => {
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
  })
  await page.goto(URL_ + '?claudeBridge=true', { waitUntil: 'domcontentloaded' })
  // A cold 10MB bundle takes its time; a short wait here reads as "the shell
  // never mounted" and sends you looking for a bug that is not there.
  await page.locator('hc-shell-surfaces').waitFor({ state: 'attached', timeout: 40000 })
  await page.waitForTimeout(6000)
  // A fresh hive opens on the first-boot offer, which covers the canvas.
  // A REAL TILE FIRST — the level roster needs a real signature to resolve,
  // and the hive is where tiles are made. The chat window boots open over the
  // command line, so it goes away for this part.
  await page.locator('hc-chat-window .chat-close').click()
  await page.waitForTimeout(1200)
  const startEmpty = page.locator('text=Start empty')
  if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(1500) }
  const box = page.locator('hc-command-line input, hc-command-line textarea').first()
  await box.click()
  await box.fill(TILE)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)

  // Reopen. The launcher is the honest gesture but it sits in a rail that can
  // still be settling, and a press that misses reads as "the window never
  // opened" — so fall back to the remembered choice rather than re-rolling.
  const panel = page.locator('hc-chat-window .chat-panel')
  await page.locator('.chat-toggle-btn').first().click({ force: true })
  await page.waitForTimeout(2500)
  if (!(await panel.count())) {
    await page.evaluate(() => localStorage.setItem('hc:chat-visible', '1'))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('hc-shell-surfaces').waitFor({ state: 'attached', timeout: 40000 })
  }
  await panel.waitFor({ state: 'attached', timeout: 40000 })
  await page.waitForTimeout(3000)

  check('the icon is NOT offered while the window is up', !(await armed(page)))

  const peek = page.locator('hc-chat-window .chat-peek')
  await peek.click()
  await page.waitForTimeout(900)

  check('the window is folded away',
    await page.locator('hc-chat-window .chat-panel').evaluate(el => el.classList.contains('peeking')))

  // ── 1. offered while folded, taken away when the window comes back ──────
  check('the icon is offered on the tiles while folded away', await armed(page))

  // ── 2. press it ─────────────────────────────────────────────────────────
  check('the shelf starts empty', (await shelf(page)).length === 0, JSON.stringify(await shelf(page)))
  await press(page, TILE)
  let names = await shelf(page)
  check('pressing a tile puts it on the shelf', names.includes(TILE), JSON.stringify(names))

  const sigs = await page.evaluate(() => {
    const el = document.querySelector('hc-chat-window')
    const cmp = el && window.ng?.getComponent?.(el)
    return cmp ? cmp.referencePayload().map(r => r.sig) : 'no-component'
  })
  check('and it carries a SIGNATURE — without one it contributes nothing',
    Array.isArray(sigs) && sigs.length === 1 && /^[0-9a-f]{64}$/.test(sigs[0]), JSON.stringify(sigs))
  await page.screenshot({ path: path.join(OUT, '01-on-shelf.png') })

  // ── 3. and off again ────────────────────────────────────────────────────
  await press(page, TILE)
  names = await shelf(page)
  check('pressing it again takes it back off', !names.includes(TILE), JSON.stringify(names))

  // ── back to 1: unfolding takes the icon away ────────────────────────────
  await peek.click()
  await page.waitForTimeout(900)
  check('unfolding takes the icon off the tiles again', !(await armed(page)))

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed — ${OUT}`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
