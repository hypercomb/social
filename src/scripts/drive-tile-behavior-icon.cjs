// scripts/drive-tile-behavior-icon.cjs
//
// THE PER-TILE FEATURES ICON — earned, never standing.
//
// Beehaviours belong to where you STAND, so no tile carries a puzzle piece
// just for existing (that cost a slot in every hover band and asked the
// behaviour question about the wrong tile). What DOES earn one is a
// behaviour created for THAT tile: a view applied to it, or a kind bound to
// its location. That is what makes a tile added from a swarm able to show
// the features it arrived carrying — click it in, it paints in full, and its
// own behaviours say so on its own hexagon.
//
// This harness proves both halves against a live shell, through the public
// band API (TileOverlayDrone.actionsForTile — the same list the hover band
// renders):
//   1. a fresh tile carries NO features icon
//   2. `/website here` inside it binds visual:website:page to that location,
//      and the icon appears on the tile — with nothing else changed
//
// Usage:
//   node scripts/drive-tile-behavior-icon.cjs                 # dev 4250
//   node scripts/drive-tile-behavior-icon.cjs --url https://hypercomb.io/
//   node scripts/drive-tile-behavior-icon.cjs --headed --keep
//
// Its own browser context = its own OPFS, so it never touches your hive.

const { chromium } = require('playwright')

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const URL_ = arg('url', 'http://localhost:4250/')
const HEADED = process.argv.includes('--headed')
const KEEP = process.argv.includes('--keep')
const TILE = 'behaviour-icon-check'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
function check(what, ok, detail = '') {
  results.push({ what, ok })
  console.log(`[check] ${ok ? '✓ PASS' : '✗ FAIL'}  ${what}${detail ? '  — ' + detail : ''}`)
}

/** The shell fires several router navigations in the first seconds of boot,
 *  and each one destroys the evaluate context mid-call. IoC-ready is not
 *  drive-ready: retry rather than read a crash as a failure. */
async function evalSafe(fn, tries = 6) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try { return await fn() }
    catch (err) {
      lastErr = err
      if (!/context was destroyed|Target closed|navigation/i.test(String(err))) throw err
      await sleep(700)
    }
  }
  throw lastErr
}

/** Type into the command line — the participant's own way in. */
async function submit(page, text) {
  return page.evaluate(async (line) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = line
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, text)
}

async function goTo(page, segments) {
  return page.evaluate((segs) => {
    window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(segs)
  }, segments)
}

/** The hover band this tile would show, by name — plus what the page thinks
 *  is on screen, so a miss says "nothing rendered" instead of "no icon". */
async function bandFor(page, label) {
  return page.evaluate((name) => {
    const overlay = window.ioc?.get?.('@diamondcoreprocessor.com/TileOverlayDrone')
    const cc = window.__hypercombEffectBus?.lastValue?.get('render:cell-count')
    let bound = {}
    try { bound = JSON.parse(localStorage.getItem('hc:behavior-bound') ?? '{}') } catch { /* private-browsing */ }
    return {
      band: (overlay?.actionsForTile?.(name) ?? []).map(a => a.name),
      rendered: cc?.labels ?? null,
      bound,
    }
  }, label)
}

;(async () => {
  const browser = await chromium.launch({ headless: !HEADED })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.ioc?.get, null, { timeout: 60000 })
  await sleep(6000)

  await evalSafe(() => submit(page, TILE)); await sleep(2500)
  const before = await evalSafe(() => bandFor(page, TILE))
  check('a fresh tile carries no features icon',
    Array.isArray(before.band) && before.band.length > 0 && !before.band.includes('features'),
    JSON.stringify(before))

  // /website here names this location a site root — which ALWAYS binds
  // (commands/website-binding.ts), so the tile now has a behaviour of its own.
  await evalSafe(() => goTo(page, [TILE])); await sleep(2000)
  await evalSafe(() => submit(page, '/website here')); await sleep(2500)
  await evalSafe(() => goTo(page, [])); await sleep(2500)

  const after = await evalSafe(() => bandFor(page, TILE))
  const boundHere = (after.bound?.['visual:website:page'] ?? []).map(b => b?.path)
  check('the behaviour bound to this tile', boundHere.includes('/' + TILE), JSON.stringify(after.bound))
  check('a tile with a behaviour of its own shows the features icon',
    Array.isArray(after.band) && after.band.includes('features'), JSON.stringify(after.band))
  check('and nothing else in the band changed',
    Array.isArray(after.band) && Array.isArray(before.band)
      && after.band.filter(n => n !== 'features').join(',') === before.band.join(','),
    `${JSON.stringify(before.band)} → ${JSON.stringify(after.band)}`)

  const passed = results.filter(r => r.ok).length
  console.log(`\n========== ${URL_} ==========`)
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.what}`)
  console.log(`========== ${passed}/${results.length} passed ==========`)

  if (!KEEP) await browser.close()
  process.exit(passed === results.length ? 0 : 1)
})().catch(err => { console.error(err); process.exit(1) })
