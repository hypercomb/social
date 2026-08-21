#!/usr/bin/env node
// drive-postit-open — does a post-it still OPEN?
//
//   node scripts/drive-postit-open.cjs [--url http://localhost:4250] [--out <dir>]
//
// Fresh hive → one tile → mark it with a post-it → the hexagon leaves and a
// sticky arrives → a REAL mouse click on the sticky must mount the post.
// Clicks are proven with elementFromPoint, never `.click()` (a synthetic
// click skips hit-testing and hid this exact class of bug once already).

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

async function typeCommand(page, text) {
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

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await shot('01-hive')

    await typeCommand(page, 'probe')
    await page.waitForTimeout(1500)
    const madeTile = await page.evaluate(() => {
      const drone = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      return [...(drone?.renderedCells?.keys?.() ?? [])]
    })
    check('a tile exists to mark', madeTile.includes('probe'), JSON.stringify(madeTile))

    await typeCommand(page, 'probe@postit Read this before Saturday')
    await page.waitForTimeout(3000)
    await shot('02-marked')

    const after = await page.evaluate(() => {
      const drone = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const notes = [...document.querySelectorAll('.postit-sticky')]
      const rects = notes.map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: n.textContent } })
      return {
        renderedCells: [...(drone?.renderedCells?.keys?.() ?? [])],
        stickies: notes.length,
        rects,
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
      }
    })
    console.log('  state ' + JSON.stringify(after))
    check('the hexagon left the canvas', !after.renderedCells.includes('probe'), JSON.stringify(after.renderedCells))
    check('a sticky arrived', after.stickies > 0, after.stickies + ' sticky/ies')

    if (after.stickies > 0) {
      const r = after.rects[0]
      const cx = Math.round(r.x + r.w / 2), cy = Math.round(r.y + r.h / 2)
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return { tag: el?.tagName, cls: el?.className?.toString?.() ?? '', closest: el?.closest?.('.postit-sticky') ? 'sticky' : 'other' }
      }, [cx, cy])
      console.log('  hit-test at ' + cx + ',' + cy + ' → ' + JSON.stringify(hit))
      check('the sticky is what the pointer lands on', hit.closest === 'sticky', JSON.stringify(hit))

      await page.mouse.click(cx, cy)
      await page.waitForTimeout(2500)
      await shot('03-opened')
      const opened = await page.evaluate(() => ({
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
        post: !!document.querySelector('.hc-postit-view'),
        postHTML: document.querySelector('.hc-postit-view')?.innerHTML?.slice(0, 200) ?? '',
        stickies: document.querySelectorAll('.postit-sticky').length,
      }))
      console.log('  opened ' + JSON.stringify(opened))
      check('the click set the postit mode', opened.mode === 'postit', String(opened.mode))
      check('the post mounted', opened.post, JSON.stringify(opened).slice(0, 200))
    }


    // ── close the post: the hexagons (and the sticky) come back ─────────
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2000)
    const closed = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
      post: !!document.querySelector('.hc-postit-view'),
      stickies: document.querySelectorAll('.postit-sticky').length,
    }))
    console.log('  closed ' + JSON.stringify(closed))
    check('Escape returns to the hexagons with the sticky back', closed.mode === 'hexagons' && !closed.post && closed.stickies > 0, JSON.stringify(closed))

    // ── walk INTO the post-it cell: the standing cell's own sticky ──────
    await page.evaluate(() => {
      const lin = window.ioc?.get?.('@hypercomb.social/Lineage')
      lin?.explorerReplace?.(['probe'])
    })
    await page.waitForTimeout(3500)
    await shot('04-inside')
    const inside = await page.evaluate(() => ({
      segments: [...(window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])],
      stickies: document.querySelectorAll('.postit-sticky').length,
      emptyPrompt: !!document.getElementById('hc-collection-empty-prompt'),
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
    }))
    console.log('  inside ' + JSON.stringify(inside))
    check('the standing cell shows its own sticky', inside.stickies > 0, JSON.stringify(inside))

    if (errors.length) console.log('  page errors: ' + errors.slice(0, 8).join(' | '))
  } finally {
    await browser.close()
  }
  const failed = results.filter(r => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
