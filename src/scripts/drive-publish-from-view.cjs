#!/usr/bin/env node
// scripts/drive-publish-from-view.cjs
//
// THERE IS ALWAYS A WAY TO PUBLISH FROM A VIEW (jwize 2026-10-10). Inside a
// view the rail is not on screen, so `p` raises the Publish panel on the layer
// the view shows — without leaving the view — and over a view the panel is a
// POPUP: same place, rounded on all four corners, a margin on the right.
//
//   1. a layer whose default view is postit opens AS postit
//   2. `p` raises Publish over the view, and the view stays up
//   3. over the view the panel is a popup — four rounded corners, inset right,
//      and the view keeps its full width under it
//   4. `p` again puts it away
//   5. on the hexagons `p` raises the DOCKED panel — square, flush right
//
// Usage: node scripts/drive-publish-from-view.cjs --url http://localhost:4253
//        [--engine chrome|msedge|chromium] [--out test-results/publish-from-view]

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
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/publish-from-view')))
  fs.mkdirSync(out, { recursive: true })
  const engine = String(arg('engine', 'chrome'))
  const browser = await chromium.launch({ headless: true, ...(engine === 'chromium' ? {} : { channel: engine }) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const mode = () => page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
  const publishUp = () => page.evaluate(() => !!document.querySelector('.publish-panel'))
  const emit = (name, payload) => page.evaluate(({ n, p }) => window.__hypercombEffectBus?.emit?.(n, p), { n: name, p: payload })
  const go = (segs) => page.evaluate((s) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s), segs)
  const pressP = async () => {
    // From the page, never a field — the keymap stands aside for typing.
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur() })
    await page.keyboard.press('p')
  }
  const shape = () => page.evaluate(() => {
    const el = document.querySelector('.publish-panel')
    if (!el) return null
    const cs = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return {
      corners: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
        .map(v => parseFloat(v) || 0),
      gapRight: Math.round(window.innerWidth - box.right),
    }
  })
  const addTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
  const settle = async (ms, until) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await until()) return true
      await page.waitForTimeout(150)
    }
    return until()
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await addTile('page'); await page.waitForTimeout(2000)
    await go(['page']); await page.waitForTimeout(2500)
    await addTile('inner'); await page.waitForTimeout(2000)
    // Light postit here and make it the face (closing the Beehaviors panel
    // after, which holds the hexagons while it shows).
    await emit('features:context-open', {})
    await settle(4000, () => page.evaluate(() => !!document.querySelector('.features-panel')))
    const row = page.locator('.features-panel .features-row.view.off:not(.inherited)')
      .filter({ has: page.locator('.feature-name', { hasText: /post/i }) }).first()
    if (await row.count()) { await row.click(); await page.waitForTimeout(3000) }
    await emit('features:default', { cell: 'page', segments: ['page'], view: 'postit', clear: false })
    await page.waitForTimeout(2500)
    await emit('features:viewer-close', {})
    await page.waitForTimeout(800)
    await go([]); await page.waitForTimeout(2500)

    // 1.
    await go(['page'])
    check('the layer opens as its face (postit)', await settle(6000, async () => (await mode()) === 'postit'), await mode())

    // 2.
    await pressP()
    const up = await settle(4000, publishUp)
    check('`p` raises Publish over the view, and the view stays up',
      up && (await mode()) === 'postit', `panel=${up} mode=${await mode()}`)
    await page.waitForTimeout(600)
    await shot('02-publish-over-view')

    // 3.
    const popup = await shape()
    check('over a view the panel is a popup — four rounded corners, inset from the right',
      !!popup && popup.corners.every(r => r > 0) && popup.gapRight > 0, JSON.stringify(popup))
    const viewRight = await page.evaluate(() =>
      Math.round((document.querySelector('.hc-postit-view')?.getBoundingClientRect().right ?? -1) - window.innerWidth))
    check('the popup reserves no edge — the view keeps its full width under it',
      viewRight === 0, `view right edge − viewport = ${viewRight}px`)

    // 4.
    await pressP()
    const gone = await settle(3000, async () => !(await publishUp()))
    check('`p` again puts it away', gone, `panel=${await publishUp()}`)

    // 5.
    await emit('view:toggle', { view: 'postit', mode: 'off' })
    await settle(3000, async () => (await mode()) === 'hexagons')
    await pressP()
    await settle(4000, publishUp)
    await page.waitForTimeout(600)
    const docked = await shape()
    check('on the hexagons the panel docks — square, flush right',
      !!docked && docked.corners.every(r => r === 0) && docked.gapRight <= 1, JSON.stringify(docked))
    await shot('05-publish-docked')
  } finally {
    const real = errors.filter(e => !/Could not initialize shader|favicon|ResizeObserver/i.test(e))
    if (real.length) console.log('\npage errors:\n  ' + real.slice(0, 8).join('\n  '))
    else console.log('\nno page errors')
    console.log('\nshots in ' + out)
    const failed = results.filter(r => !r.ok).length
    console.log(failed ? failed + ' CHECK(S) FAILED' : 'all ' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed ? 1 : 0
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
