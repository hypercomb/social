#!/usr/bin/env node
// drive-el-bar — walks into EL BAR with Playwright and goes shopping.
//
// Vendor-neutral: no bridge, no running renderer to attach to. It opens the
// built preview lounge, walks through the bar-door print (the pick event the
// canvas raycast dispatches), stakes the purse through the same claim API the
// oche pays through, buys a lounge good and an upgrade off the shelves, and
// reads back the ledger + decor switches the page wrote.
//
//   node scripts/drive-el-bar.cjs [--page site-preview/revolucion-lounge.html]
//                                 [--engine chromium|msedge|chrome]
//                                 [--shots dir] [--keep]
//
// Build the page first: npx tsx scripts/intel-build-revolucion-site.ts --preview site-preview

const path = require('node:path')
const fs = require('node:fs')
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
    case 'chrome': return { type: chromium, opts: { channel: 'chrome' } }
    default: return { type: chromium, opts: {} }
  }
}

const pass = []
const fail = []
function check(name, ok, detail) {
  ;(ok ? pass : fail).push(detail ? `${name} — ${detail}` : name)
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`)
}

async function frames(page, n) {
  // step the room deterministically — rAF may be running too, this just
  // guarantees motion regardless of compositing
  await page.evaluate(count => {
    for (let i = 0; i < count; i++) window.RevLounge3D?.frame()
  }, n)
}

async function shot(page, dir, name) {
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  // page.screenshot stalls waiting on a renderer that redraws every frame —
  // read the canvas back instead (same trick the lounge has always been
  // verified with: force one frame, then toDataURL in the same task)
  const dataUrl = await page.evaluate(() => {
    window.RevLounge3D.frame()
    const canvas = document.querySelector('#lounge3d canvas')
    return canvas ? canvas.toDataURL('image/png') : null
  })
  if (!dataUrl) { console.log(`       shot SKIPPED (no canvas) — ${name}`); return }
  fs.writeFileSync(path.join(dir, name), Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'))
  console.log(`       shot → ${path.join(dir, name)}`)
}

async function main() {
  const pageFile = String(arg('page', 'site-preview/revolucion-lounge.html'))
  const shotsDir = arg('shots', '') ? String(arg('shots', '')) : ''
  const url = 'file:///' + path.resolve(pageFile).replace(/\\/g, '/')
  const { type, opts } = launcherFor(arg('engine', 'chromium'))
  const browser = await type.launch({ headless: !arg('keep', false), ...opts })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(url, { waitUntil: 'load' })

  // the room boots off an idle callback
  await page.waitForFunction(() => !!window.RevLounge3D, null, { timeout: 20000 }).catch(() => {})
  const booted = await page.evaluate(() => !!window.RevLounge3D)
  check('the room boots', booted)
  if (!booted) {
    console.log(errors.length ? 'page errors:\n  ' + errors.join('\n  ') : '(no page errors)')
    await browser.close()
    process.exit(1)
  }
  check('it boots into the lounge', await page.evaluate(() => window.RevLounge3D.roomName() === 'lounge'))

  // ── stake the purse the way the room does: a claim into the ledger ────
  const staked = await page.evaluate(() => {
    window.RevEmbers.claim('harness:stake', 900, 'the harness stakes you')
    return window.RevEmbers.balance()
  })
  check('the ledger takes the stake', staked >= 900, `balance ${staked}`)

  // ── look at the door: gallery view, the bar print at the wall's end ───
  await page.evaluate(() => { window.__loungeWalkIn(); window.RevLounge3D.view('gallery') })
  await frames(page, 90)
  await shot(page, shotsDir, '01-gallery-with-bar-door.png')

  // ── walk through it — the pick the canvas raycast dispatches ──────────
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: 'bar' } }))
  })
  await frames(page, 30)
  check('the bar print walks you into EL BAR',
    await page.evaluate(() => window.RevLounge3D.roomName() === 'bar'))
  await frames(page, 60)
  await shot(page, shotsDir, '02-el-bar.png')

  // ── the shelves ───────────────────────────────────────────────────────
  await page.evaluate(() => window.RevLounge3D.view('shelves'))
  await frames(page, 90)
  await shot(page, shotsDir, '03-the-shelves.png')

  // a REAL click on the case wall — the raycast path itself, not the event.
  // Twice, because the FIRST synthetic click after a boot is eaten by
  // OrbitControls' setPointerCapture (the documented trap); a real trusted
  // click never was. Aimed at a display card on the lower tier.
  const plateOpened = await (async () => {
    const box = await page.evaluate(() => {
      const canvas = document.querySelector('#lounge3d canvas')
      const r = canvas.getBoundingClientRect()
      return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.6 }
    })
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.mouse.click(box.x, box.y, { delay: 40 })
      await page.waitForTimeout(150)
      if (await page.evaluate(() => !!document.querySelector('[data-bar-take]'))) return true
    }
    return false
  })()
  check('a click on the case opens a buy plate', plateOpened)
  await shot(page, shotsDir, '04-buy-plate.png')
  if (plateOpened) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(80)
    check('Escape closes the plate (and stays in the room)',
      await page.evaluate(() => !document.querySelector('[data-bar-take]')
        && window.RevLounge3D.roomName() === 'bar'))
  }

  // ── buy a lounge good: the drinks cart ────────────────────────────────
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: 'shop:slot-cart' } }))
  })
  await page.waitForTimeout(80)
  const cartButton = await page.evaluate(() => {
    const b = document.querySelector('[data-bar-take]')
    return b ? { disabled: b.disabled, text: b.textContent } : null
  })
  check('the cart’s plate quotes a live price', !!cartButton && !cartButton.disabled, cartButton && cartButton.text)
  await page.click('[data-bar-take]')
  await page.waitForTimeout(120)
  const afterCart = await page.evaluate(() => ({
    owned: window.RevEmbers.owned('slot-cart'),
    balance: window.RevEmbers.balance(),
    button: document.querySelector('[data-bar-take]').textContent,
    decorOn: (JSON.parse(localStorage.getItem('rev:lounge:decor') || '{}'))['slot-cart'] === true,
  }))
  check('buying writes the ledger', afterCart.owned && afterCart.balance === staked - 180,
    `balance ${afterCart.balance}`)
  check('the plate flips to YOURS', /Yours/i.test(afterCart.button), afterCart.button.trim())
  check('a lounge good arrives switched on', afterCart.decorOn)
  await page.keyboard.press('Escape')

  // ── buy an upgrade: the chesterfields replace the wingbacks ───────────
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: 'shop:slot-chesterfields' } }))
  })
  await page.waitForTimeout(80)
  const upgradeNote = await page.evaluate(() => {
    const card = document.querySelector('[data-bar-take]').closest('div').parentNode
    return card.textContent
  })
  check('the upgrade plate says what steps aside', /step aside/i.test(upgradeNote))
  await page.click('[data-bar-take]')
  await page.waitForTimeout(120)
  check('the chesterfields are bought and switched on', await page.evaluate(() =>
    window.RevEmbers.owned('slot-chesterfields')
      && (JSON.parse(localStorage.getItem('rev:lounge:decor') || '{}'))['slot-chesterfields'] === true))
  await page.keyboard.press('Escape')

  // ── buy a bar fitting: the beer engines stand up where you stand ──────
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: 'shop:slot-bar-engines' } }))
  })
  await page.waitForTimeout(80)
  await page.click('[data-bar-take]')
  await page.waitForTimeout(120)
  check('a bar fitting is bought', await page.evaluate(() => window.RevEmbers.owned('slot-bar-engines')))
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.RevLounge3D.view('counter'))
  await frames(page, 90)
  await shot(page, shotsDir, '05-counter-with-engines.png')

  // ── the lounge print walks you back, wearing what you bought ──────────
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('lounge3d:pick', { detail: { id: 'lounge' } }))
  })
  await frames(page, 30)
  check('the lounge print walks you back',
    await page.evaluate(() => window.RevLounge3D.roomName() === 'lounge'))
  await frames(page, 60)
  await shot(page, shotsDir, '06-lounge-with-chesterfields.png')

  // the oche API survives the round trip (it reads the live room)
  check('the oche is still answering after the round trip',
    await page.evaluate(() => typeof window.RevLounge3D.oche.state() === 'object'))

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  console.log(`\n${pass.length} ok, ${fail.length} failed`)
  await browser.close()
  process.exit(fail.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
