#!/usr/bin/env node
// _shot-chat-template — photographs the two surfaces just changed.
//
//   node scripts/_shot-chat-template.cjs [--chat] [--url http://localhost:4250] [--out <dir>]
//
// Its own Playwright profile, so the hive it boots is a scratch one — it never
// touches the participant's data.
//
// Two headless facts shape this script. Pixi's shaders will not compile
// without a GPU, so the processor's pulse does not reach every drone — the one
// reader's own lifecycle entry point is called directly where the panel needs
// state. And a fresh profile boots onto the first-boot offer, which arrives a
// few seconds in and covers the canvas, so it is dismissed between steps.

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

const URL_ = String(arg('url', 'http://localhost:4250'))
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-template')))
const WANT_CHAT = arg('chat', false) === true

async function typeCommand(page, text) {
  await page.waitForSelector('input.command-input', { timeout: 60000 })
  await page.evaluate((value) => {
    const input = document.querySelector('input.command-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
  }, text)
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}

async function closeChat(page) {
  const close = page.locator('hc-chat-window .chat-close')
  if (await close.count() && await close.first().isVisible()) {
    await close.first().click({ force: true })
    await page.waitForTimeout(600)
  }
}

async function clearOffer(page) {
  const dismiss = page.locator('hc-example-hives-offer .dismiss')
  for (let i = 0; i < 3; i++) {
    if (!(await dismiss.count()) || !(await dismiss.first().isVisible())) break
    await dismiss.first().click({ force: true })
    await page.waitForTimeout(700)
  }
}

/** The template reader publishes on its own heartbeat, which the stalled
 *  processor never reaches here. The same call act() would make. */
const nudge = page => page.evaluate(async () => {
  const drone = window.ioc?.get('@diamondcoreprocessor.com/TemplateAuthorDrone')
  await drone?.heartbeat?.('')
})

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('PixiJS')) errors.push(m.text()) })

  await page.addInitScript((chat) => {
    if (chat) localStorage.setItem('hc:chat-visible', '1')
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
  }, WANT_CHAT)
  await page.goto(URL_ + (URL_.includes('?') ? '&' : '?') + 'claudeBridge=true',
    { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)

  if (WANT_CHAT) {
    // ── the chat window ───────────────────────────────────────────────────
    const bar = page.locator('hc-chat-window .chat-bar')
    await page.screenshot({ path: path.join(OUT, '01-chat.png') })
    const box = await bar.boundingBox()
    if (box) {
      await page.screenshot({
        path: path.join(OUT, '02-chat-rows.png'),
        clip: { x: Math.max(0, box.x + box.width - 460), y: 0, width: 460, height: box.y + box.height + 8 },
      })
    }
    // Folded away — the tool row must survive, with the way back in it.
    await page.locator('hc-chat-window .chat-peek').click()
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(OUT, '03-chat-folded.png') })
    await browser.close()
    console.log(errors.length ? `page errors:\n  ${errors.slice(0, 6).join('\n  ')}` : 'no page errors')
    console.log(`wrote ${OUT}`)
    return
  }

  // ── the layout designer ───────────────────────────────────────────────
  await closeChat(page)
  await clearOffer(page)
  await closeChat(page)
  await typeCommand(page, '/template')
  await page.locator('hc-layout-designer .ld-panel').waitFor({ state: 'visible', timeout: 30000 })
  await nudge(page)
  await page.waitForTimeout(1500)
  await clearOffer(page)
  console.log('layouts in the shelf: ' + await page.locator('hc-layout-designer .ld-asset').count())
  await page.screenshot({ path: path.join(OUT, '04-template-empty.png') })

  const assets = page.locator('hc-layout-designer .ld-asset')
  const count = await assets.count()
  if (!count) { await browser.close(); console.log('no layouts — nothing to shoot'); return }

  // `sidebar` has a FIXED rail, so the division type shows a real measurement
  // rather than "takes the remainder".
  const want = String(arg('layout', 'sidebar'))
  const chip = page.locator(`hc-layout-designer .ld-asset[aria-label="${want}"]`)
  await (await chip.count() ? chip.first() : assets.nth(Math.min(3, count - 1))).click({ force: true })
  await page.waitForTimeout(1200)
  await nudge(page)
  await page.waitForTimeout(1500)
  await clearOffer(page)
  console.log('bound layout: ' + await page.locator('hc-layout-designer .ld-level-layout').innerText().catch(() => 'none'))
  await page.screenshot({ path: path.join(OUT, '05-template-plugged.png') })

  // Press a pane on the properties map — the one slider should follow it.
  const panes = page.locator('hc-layout-designer .ld-map .ld-map-pane')
  console.log('panes on the map: ' + await panes.count())
  const which = Number(arg('pane', 1))
  if (await panes.count() > which) {
    await panes.nth(which).click({ force: true })
    await page.waitForTimeout(700)
  }
  const insp = page.locator('hc-layout-designer .ld-inspector')
  const box = await insp.boundingBox()
  if (box) {
    await page.screenshot({
      path: path.join(OUT, '06-properties.png'),
      clip: { x: box.x, y: Math.max(0, box.y - 30), width: box.width + 4, height: box.height + 30 },
    })
  }

  // Drag the split up — the properties grow, the shelf gives way.
  const g = await page.locator('hc-layout-designer .ld-split').boundingBox()
  if (g) {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y - 170, { steps: 20 })
    await page.mouse.up()
    await page.waitForTimeout(600)
    console.log('inspector height after drag: ' + await insp.evaluate(el => el.style.height))
    await page.screenshot({ path: path.join(OUT, '07-split-dragged.png') })
  }

  console.log(errors.length ? `page errors:\n  ${errors.slice(0, 6).join('\n  ')}` : 'no page errors')
  await browser.close()
  console.log(`wrote ${OUT}`)
}

main().catch(err => { console.error(err); process.exit(1) })
