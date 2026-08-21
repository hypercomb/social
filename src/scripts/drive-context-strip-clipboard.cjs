#!/usr/bin/env node
// drive-context-strip-clipboard — are the chat's context boxes the CLIPBOARD?
//
//   node scripts/drive-context-strip-clipboard.cjs [--url http://localhost:4251] [--out <dir>]
//
// The decision under test: the header's context boxes are a VIEW of the
// clipboard — one gathered set. So:
//
//   1. entries landed via `clipboard:take-entries` (the drop/pick path)
//      appear as context boxes in the chat window,
//   2. the window announces the set (`context:active-set`),
//   3. a box's × discards THROUGH the clipboard — `clipboard:changed`
//      reports the smaller set, and the boxes agree.

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

  // 2 — open the chat window: the boxes mirror the clipboard.
  await page.evaluate(() => window.__hypercombEffectBus.emit('chat:open', {}))
  await page.waitForSelector('.chat-box-context', { timeout: 20000 })
  const boxes = await page.$$eval('.chat-box-context', els => els.map(el => el.title))
  check('two context boxes in the header', boxes.length === 2, JSON.stringify(boxes))

  const announced = await page.evaluate(() => new Promise(resolve => {
    window.__hypercombEffectBus.on('context:active-set', p => resolve(p?.paths ?? []))
  }))
  check('window announces the active set', announced.length === 2, JSON.stringify(announced))

  await page.screenshot({ path: path.join(out, 'boxes-two.png') })

  // 3 — × on the first box discards THROUGH the clipboard.
  await page.click('.chat-box-context')
  await page.waitForFunction(() =>
    document.querySelectorAll('.chat-box-context').length === 1, null, { timeout: 20000 })
  const after = await page.evaluate(() => new Promise(resolve => {
    window.__hypercombEffectBus.on('clipboard:changed', p => resolve({
      count: p?.count, labels: (p?.items ?? []).map(i => i.label),
    }))
  }))
  check('box × discarded from the CLIPBOARD (not a local list)', after.count === 1,
    JSON.stringify(after))

  await page.screenshot({ path: path.join(out, 'boxes-one.png') })
  await browser.close()

  const failed = results.filter(r => !r.ok)
  console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
