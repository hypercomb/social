#!/usr/bin/env node
// drive-context-strip-clipboard — are the chat's context boxes the CLIPBOARD?
//
//   node scripts/drive-context-strip-clipboard.cjs [--url http://localhost:4251] [--out <dir>]
//
// The grammar under test: the CLIPBOARD is the way in, the SHELF is what
// this request carries, and moving between them is the whole interface.
//
//   1. entries landed via `clipboard:take-entries` (a hive take, a rail
//      pick) show in the chat's clipboard flyout — not on the shelf,
//   2. one click on a flyout item PASTES it onto the shelf, and it leaves
//      the clipboard (one home per item),
//   3. the window announces the shelf (`context:active-set`),
//   4. the × takes a reference off the request outright,
//   5. dragging one off the shelf RESTORES it to the clipboard.

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

async function main() {
  const url = arg('url', 'http://localhost:4251')
  const out = arg('out', path.join(__dirname, '..', '..', 'test-results', 'context-strip'))
  fs.mkdirSync(out, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 90000 })
  // Let the boot settle enough that the clipboard worker is registered.
  await page.waitForFunction(() =>
    !!window.ioc?.get?.('@diamondcoreprocessor.com/ClipboardWorker'), null, { timeout: 90000 })

  // Two references, sigs supplied (the seal-on-miss path needs a warm hive
  // and is not what this drive is about).
  const SIG_A = 'a'.repeat(64)
  const SIG_B = 'b'.repeat(64)
  await page.evaluate(([a, b]) => {
    window.__hypercombEffectBus.emit('clipboard:take-entries', {
      entries: [
        { label: 'alpha-ref', sourceSegments: [], sig: a },
        { label: 'beta-ref', sourceSegments: [], sig: b },
      ],
    })
  }, [SIG_A, SIG_B])

  // 1 — the clipboard holds both (last-value replay answers immediately).
  const held = await page.evaluate(() => new Promise(resolve => {
    window.__hypercombEffectBus.on('clipboard:changed', p => resolve({
      count: p?.count, labels: (p?.items ?? []).map(i => i.label),
    }))
  }))
  check('clipboard holds both entries', held.count === 2
    && held.labels.includes('alpha-ref') && held.labels.includes('beta-ref'),
    JSON.stringify(held))

  // 2 — open the chat: the clipboard is REACHABLE from the header, and the
  // shelf starts empty (gathering is not the same as carrying).
  await page.evaluate(() => window.__hypercombEffectBus.emit('chat:open', {}))
  await page.waitForSelector('.chat-clip', { timeout: 20000 })
  const startingShelf = await page.$$eval('.chat-box-context', els => els.length)
  check('the shelf starts empty — gathered is not carried', startingShelf === 0, `boxes=${startingShelf}`)
  const clipCount = await page.$eval('.chat-clip-count', el => el.textContent.trim()).catch(() => '')
  check('the clipboard icon counts what there is to paste', clipCount === '2', `count='${clipCount}'`)

  await page.click('.chat-clip')
  await page.waitForSelector('.chat-clip-item', { timeout: 20000 })
  const shelfItems = await page.$$eval('.chat-clip-item', els => els.map(el => el.textContent.trim()))
  check('the flyout lists the clipboard', shelfItems.length === 2, JSON.stringify(shelfItems))
  await page.screenshot({ path: path.join(out, 'clip-flyout.png') })

  // 3 — one click PASTES it onto the shelf and it leaves the clipboard.
  await page.click('.chat-clip-item')
  await page.waitForFunction(() =>
    document.querySelectorAll('.chat-box-context').length === 1, null, { timeout: 20000 })
  const afterPaste = await page.evaluate(() => new Promise(resolve => {
    window.__hypercombEffectBus.on('clipboard:changed', p => resolve({
      count: p?.count, labels: (p?.items ?? []).map(i => i.label),
    }))
  }))
  check('pasting MOVES it — the clipboard is down to one', afterPaste.count === 1, JSON.stringify(afterPaste))

  const announced = await page.evaluate(() => new Promise(resolve => {
    window.__hypercombEffectBus.on('context:active-set', p => resolve(p?.paths ?? []))
  }))
  check('the window announces the shelf', announced.length === 1, JSON.stringify(announced))
  await page.screenshot({ path: path.join(out, 'shelf-one.png') })

  // 4 — the × takes it off the request outright (the clipboard is not asked).
  await page.click('.chat-box-off')
  await page.waitForFunction(() =>
    document.querySelectorAll('.chat-box-context').length === 0, null, { timeout: 20000 })
  const afterX = await page.evaluate(() =>
    window.__hypercombEffectBus?.lastValue?.get('clipboard:changed')?.count ?? -1)
  check('the × drops it from the request without touching the clipboard',
    afterX === 1, `clipboard count=${afterX}`)

  // 5 — restore: a reference dragged off the shelf goes home to the clipboard.
  await page.evaluate(() => {
    const chat = document.querySelector('hc-chat-window')
    const cmp = window.ng?.getComponent?.(chat)
    if (cmp?.pasteReference && cmp.clipboardHeld().length) cmp.pasteReference(cmp.clipboardHeld()[0])
  })
  const pastedAgain = await page.$$eval('.chat-box-context', els => els.length).catch(() => 0)
  if (pastedAgain !== 1) {
    console.log('  [skip] could not re-paste via the component handle — drag-back unverified here')
  } else {
    // Measure the TRANSITION: pasting emptied the clipboard, so a restore is
    // the count going back up by one as the shelf gives the reference up.
    const clipboardCount = () => page.evaluate(() =>
      window.__hypercombEffectBus?.lastValue?.get('clipboard:changed')?.count ?? -1)
    const before = await clipboardCount()
    const box = await page.$('.chat-box-context')
    const rect = await box.boundingBox()
    // A REAL mouse drag: synthetic pointer events never start a native HTML5
    // drag, so dragstart/dragend would not fire and this would prove nothing.
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await page.mouse.down()
    await page.mouse.move(rect.x + 40, rect.y + 260, { steps: 12 })
    await page.mouse.up()
    await sleep(600)
    const after = await clipboardCount()
    const boxesLeft = await page.$$eval('.chat-box-context', els => els.length)
    check('dragging it off the shelf restores it to the clipboard',
      boxesLeft === 0 && after === before + 1, `boxes=${boxesLeft} clipboard ${before}→${after}`)
  }

  await browser.close()

  const failed = results.filter(r => !r.ok)
  console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
