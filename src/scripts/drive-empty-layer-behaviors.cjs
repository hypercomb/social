#!/usr/bin/env node
// drive-empty-layer-behaviors — proves the two halves of "beehaviors belong
// to where you stand":
//
//   1. NO `features` icon on a tile. The overlay's action list for a held
//      tile must not contain it, in any profile — the puzzle-piece is gone
//      from the hover band, the close-up's faces and the phone deck with it.
//   2. AN EMPTY LAYER OFFERS THE PANEL, IT NEVER RAISES IT. A window opens
//      only when the participant asks for it: walk into a childless tile and
//      the empty card shows, the Beehaviors panel stays down.
//   3. The card's Beehaviors button is the door — the click opens the panel
//      on THIS layer, the one the icon used to aim at.
//
//   node scripts/drive-empty-layer-behaviors.cjs [--url http://localhost:4250]
//                                                [--out <dir>] [--engine chrome]
//
// Vendor-neutral: Playwright against the dev server, no bridge, no renderer to
// attach to. `--engine chrome` is the one that has a GPU: headless chromium
// cannot initialize Pixi's shaders and never leaves the splash.

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
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  — ' + detail : ''))
}

const TILE = 'quiet-room'

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)

    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click()
      await page.waitForTimeout(2500)
    }

    // ── a tile to stand on ─────────────────────────────────────────────
    await page.keyboard.press('Escape')
    const input = page.locator('.command-input, input.shell-input, [role="combobox"]').first()
    await input.fill(TILE)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await shot('01-tile-made')

    const labels = await page.evaluate(() =>
      window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')?.labels?.() ?? null)

    // ── 1. the icon is gone ────────────────────────────────────────────
    const actions = await page.evaluate((tile) => {
      const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
      try { return (overlay?.actionsForTile?.(tile) ?? []).map(a => a.name) } catch { return null }
    }, TILE)
    check('the overlay answers with an action list', Array.isArray(actions) && actions.length > 0,
      JSON.stringify(actions) + (labels ? ' · labels ' + JSON.stringify(labels) : ''))
    check('no `features` icon on the tile', Array.isArray(actions) && !actions.includes('features'),
      JSON.stringify(actions))

    const panelBefore = await page.locator('.features-panel').count()
    check('the panel is NOT up while tiles are on screen', panelBefore === 0, panelBefore + ' found')

    // ── 2. the empty layer stays quiet ─────────────────────────────────
    await page.evaluate((tile) => {
      window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.([tile])
    }, TILE)
    await page.waitForTimeout(6000)
    await shot('02-empty-layer')

    const segs = await page.evaluate(() =>
      window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
    check('we are standing inside the tile', Array.isArray(segs) && segs.join('/') === TILE,
      JSON.stringify(segs))

    const card = page.locator('#hc-collection-empty-prompt')
    check('the empty card shows', (await card.count()) > 0)
    check('the empty layer did NOT open the Beehaviors panel',
      (await page.locator('.features-panel').count()) === 0)

    // ── 3. the card's Beehaviors button is the door ────────────────────
    const door = page.locator('#hc-collection-empty-prompt [data-role="behaviors"]').first()
    check('the card offers a Beehaviors button', (await door.count()) > 0)
    if (await door.count()) {
      await door.click()
      await page.waitForTimeout(2500)
      const panel = page.locator('.features-panel')
      check('the button opens the Beehaviors panel', (await panel.count()) > 0)
      const subject = await page.evaluate(() => {
        const el = document.querySelector('.features-panel')
        return el ? (el.textContent ?? '').slice(0, 160) : null
      })
      check('the panel names THIS layer as its subject',
        typeof subject === 'string' && subject.toLowerCase().includes(TILE), String(subject))
    }
    await shot('03-door-opened')
  } finally {
    await browser.close()
  }

  const bad = results.filter(r => !r.ok)
  console.log('\n' + (results.length - bad.length) + '/' + results.length + ' checks passed')
  if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 8).join('\n  '))
  process.exit(bad.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
