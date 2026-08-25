#!/usr/bin/env node
// drive-chat-peek — does the chat window FOLD AWAY to a live hive?
//
//   node scripts/drive-chat-peek.cjs [--url http://localhost:4250] [--out <dir>]
//
// What is under test (three claims, all readable as ordinary DOM):
//
//   1. OPEN CLAIMS THE SURFACE. The window is full screen, so it enters the
//      owner-counted `view:active` mode — which is what makes every chrome
//      that hides for a view (post-it stickies, the empty-collection notice)
//      stop drawing over the top of it.
//   2. PEEK RELEASES IT. Folded away, the claim is dropped: the hive beneath
//      is live, and the panel stops taking pointer events so the hexagons get
//      them. The reading half is hidden, not removed.
//   3. UNFOLDING PUTS IT BACK, and Escape unfolds before it closes.
//
// Its own Playwright profile, so the hive it boots is a scratch one — it never
// touches the participant's data, and it needs no bridge.

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
const OUT = String(arg('out', path.join('..', 'test-results', 'chat-peek')))

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

/** The owners of `view:active`, read out of the page's own registry. */
const owners = page => page.evaluate(() =>
  (window.ioc?.get('@diamondcoreprocessor.com/ModeRegistry')?.ownersOf('view:active')) ?? [])

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  // Open on the chat window, and with a bridge configured so the setup wizard
  // is not what we photograph.
  await page.addInitScript(() => {
    localStorage.setItem('hc:chat-visible', '1')
    // Past the first-run checklist — the composer is what we came to look at.
    localStorage.setItem('hc:bridge-setup-done', '1')
    localStorage.setItem('hc:bridge-setup-tools', '1')
  })
  // `?claudeBridge=true` is the supported one-tab opt-in — the setup wizard
  // stands in for the whole window without it, and the composer is what we
  // came to look at.
  await page.goto(URL_ + (URL_.includes('?') ? '&' : '?') + 'claudeBridge=true',
    { waitUntil: 'domcontentloaded' })

  const panel = page.locator('hc-chat-window .chat-panel')
  await panel.waitFor({ state: 'attached', timeout: 30000 })
  await page.waitForTimeout(1500)

  // ── 1. open claims the surface ──────────────────────────────────────────
  check('the open window owns view:active', (await owners(page)).includes('chat-window'),
    JSON.stringify(await owners(page)))
  check('it is not folded to begin with', !(await panel.evaluate(el => el.classList.contains('peeking'))))
  await page.screenshot({ path: path.join(OUT, '01-open.png') })

  // ── 2. peek releases it ─────────────────────────────────────────────────
  const toggle = page.locator('hc-chat-window .chat-peek')
  check('the fold control is in the header', await toggle.count() === 1)
  await toggle.click()
  await page.waitForTimeout(400)

  check('folded away', await panel.evaluate(el => el.classList.contains('peeking')))
  check('the surface claim is released', !(await owners(page)).includes('chat-window'),
    JSON.stringify(await owners(page)))
  check('the panel no longer takes pointer events',
    await panel.evaluate(el => getComputedStyle(el).pointerEvents) === 'none')
  check('the input still does',
    await page.locator('hc-chat-window .chat-foot').evaluate(el => getComputedStyle(el).pointerEvents) === 'auto')

  const hidden = sel => page.locator(`hc-chat-window ${sel}`).evaluate(el => getComputedStyle(el).display === 'none')
  check('the transcript is hidden, not removed', await hidden('.chat-threadwrap'))
  check('the rail is hidden, not removed', await hidden('.chat-rail'))
  check('the rail node survives the fold',
    await page.locator('hc-chat-window .chat-rail').count() === 1)

  // The hive underneath gets the click: whatever is at the middle of the
  // screen must not be the chat panel any more.
  const atCentre = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return el ? el.tagName.toLowerCase() + '.' + (el.className?.toString?.() ?? '') : 'none'
  })
  check('the hive is what the middle of the screen hits', !atCentre.includes('chat-panel'), atCentre)
  await page.screenshot({ path: path.join(OUT, '02-peeking.png') })

  // ── 3. and back ─────────────────────────────────────────────────────────
  await toggle.click()
  await page.waitForTimeout(400)
  check('unfolding brings the conversation back',
    !(await panel.evaluate(el => el.classList.contains('peeking'))))
  check('and re-claims the surface', (await owners(page)).includes('chat-window'))
  await page.screenshot({ path: path.join(OUT, '03-back.png') })

  // Escape unfolds before it closes.
  await toggle.click()
  await page.waitForTimeout(300)
  await panel.press('Escape')
  await page.waitForTimeout(300)
  check('Escape unfolds first, it does not close',
    await page.locator('hc-chat-window .chat-panel').count() === 1
      && !(await panel.evaluate(el => el.classList.contains('peeking'))))

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} passed — ${OUT}`)
  process.exit(failed ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
