#!/usr/bin/env node
// drive-back-gesture — does RIGHT-CLICK come back out, everywhere?
//
//   node scripts/drive-back-gesture.cjs [--url http://localhost:4250] [--out <dir>]
//
// Left click goes in, right click comes back out. Three surfaces where the
// browser's own context menu used to answer instead:
//
//   1. ordinary shell chrome sitting over the canvas (the fallback: the
//      lineage comes back one step)
//   2. a takeover view — a post-it mounted full-viewport
//   3. website mode at the site root, which used to be a documented no-op
//
// Real right-clicks through the mouse, never a synthetic event: the whole
// point is that the browser menu no longer wins.

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

const where = (page) => page.evaluate(() => ({
  path: location.pathname,
  mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
}))

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    // ── the one the browser keeps ───────────────────────────────────────
    // Checked in the hive, before any view is up: a view that covers the page
    // claims the whole surface, command line included.
    const kept = await page.evaluate(() => {
      const input = document.querySelector('input.command-input')
      if (!input) return null
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      return { prevented: event.defaultPrevented }
    })
    check('an editable field keeps its own menu', kept && kept.prevented === false, JSON.stringify(kept))

    // ── a place to come back FROM ───────────────────────────────────────
    await typeCommand(page, 'probe')
    await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/Navigation')?.goRaw?.(['probe']))
    await page.waitForTimeout(2500)
    const inside = await where(page)
    check('walked into a tile', inside.path.includes('probe'), JSON.stringify(inside))
    await shot('01-inside')

    // ── 1. shell chrome over the canvas ─────────────────────────────────
    // The controls bar is ordinary DOM, not the Pixi canvas — the surface
    // where a right-click used to raise "Reload / View page source".
    // The custom element itself is a zero-box wrapper — its BUTTONS are the
    // chrome you can actually point at.
    const bar = await page.evaluate(() => {
      const el = document.querySelector('hc-controls-bar')?.querySelector('button')
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!bar) {
      check('the controls bar is on screen to right-click', false, 'no hc-controls-bar box')
    } else {
      const hit = await page.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y)
        return { tag: el?.tagName ?? null, canvas: el?.tagName === 'CANVAS' }
      }, [bar.x, bar.y])
      check('the pointer lands on chrome, not the canvas', !hit.canvas, JSON.stringify(hit))
      await page.mouse.click(bar.x, bar.y, { button: 'right' })
      await page.waitForTimeout(2500)
      const after = await where(page)
      check('right-click on chrome walks the lineage back', !after.path.includes('probe'), JSON.stringify(after))
      await shot('02-back-from-chrome')
    }

    // ── 2. a takeover view: the post-it ─────────────────────────────────
    await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/Navigation')?.goRaw?.(['probe']))
    await page.waitForTimeout(2000)
    await typeCommand(page, 'sticky')
    await typeCommand(page, 'sticky@postit Read this before Saturday')
    await page.waitForTimeout(2500)
    const opened = await page.evaluate(() => {
      const note = document.querySelector('.postit-sticky')
      if (!note) return { sticky: false }
      const r = note.getBoundingClientRect()
      return { sticky: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!opened.sticky) {
      check('a post-it sticky to open', false, 'no .postit-sticky')
    } else {
      await page.mouse.click(opened.x, opened.y)
      await page.waitForTimeout(2500)
      const post = await page.evaluate(() => ({
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
        mounted: !!document.querySelector('.hc-postit-view'),
      }))
      check('the post is mounted', post.mounted && post.mode === 'postit', JSON.stringify(post))
      await shot('03-post-open')

      await page.mouse.click(720, 500, { button: 'right' })
      await page.waitForTimeout(2000)
      const left = await page.evaluate(() => ({
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
        mounted: !!document.querySelector('.hc-postit-view'),
      }))
      check('right-click closes the post', left.mode === 'hexagons' && !left.mounted, JSON.stringify(left))
      await shot('04-post-closed')
    }

    // ── 3. website mode at the site root ────────────────────────────────
    // Entering the mode captures the current cell as the site entry, which is
    // the case that used to do nothing at all.
    await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.setMode?.('website'))
    await page.waitForTimeout(2000)
    const site = await where(page)
    check('website mode is up', site.mode === 'website', JSON.stringify(site))
    await page.mouse.click(720, 500, { button: 'right' })
    await page.waitForTimeout(2500)
    const outOfSite = await where(page)
    check('right-click at the site root leaves the site', outOfSite.mode === 'hexagons', JSON.stringify(outOfSite))
    await shot('05-left-site')

  } finally {
    const failed = results.filter(r => !r.ok)
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed.length ? 1 : 0
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 })
