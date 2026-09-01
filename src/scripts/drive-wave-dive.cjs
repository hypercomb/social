#!/usr/bin/env node
// drive-wave-dive — proves the Alt dive on a live shell.
//
//   node scripts/drive-wave-dive.cjs [--url http://localhost:4253]
//                                    [--out <dir>] [--engine chrome]
//
// Walks a real browser through the gesture:
//
//   1. boot a fresh hive (Start empty) and seed a three-generation branch:
//      alpha → { beta → { gamma }, delta }
//   2. hold Alt over `alpha` — the page renderer paints alpha's children in
//      place (`render:dive-painted` = 2) and the page's own tiles are gone
//   3. Alt+wheel goes a generation deeper (gamma alone), and back up
//   4. Alt+click on `beta` executes it: the page comes back FIRST, then the
//      explorer lands on /alpha/beta
//   5. back at the root, dive again and RELEASE Alt — the page is back,
//      untouched (same labels as before the dive)
//
// Vendor-neutral: Playwright against the dev server, no bridge. `--engine
// chrome` (default) has a GPU; headless chromium cannot initialise Pixi's
// shaders and never leaves the splash.

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
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function until(test, ms = 8000, step = 100) {
  const stop = Date.now() + ms
  while (Date.now() < stop) { if (await test()) return true; await sleep(step) }
  return test()
}

/** Type a line into the command line and press Enter — the canonical way a
 *  participant makes a tile. `a/b/c` makes the whole chain. */
async function addTile(page, name) {
  return page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input')
      || document.querySelector('input[type="text"]')
    if (!input) return { ok: false, reason: 'no command line input' }
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 120))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return { ok: true }
  }, name)
}

/** Where a slot IS on screen — the render's own numbers, inverted (same
 *  derivation as drive-swap-cue's tileClientPoint). */
const clientPointOf = (page, q, r) => page.evaluate(([qq, rr]) => {
  const last = window.__hypercombEffectBus?.lastValue
  const host = last?.get('render:host-ready')
  const off = last?.get('render:mesh-offset') ?? { x: 0, y: 0 }
  const flat = !!(last?.get('render:set-orientation') ?? {}).flat
  if (!host?.container || !host?.canvas || !host?.renderer) return null
  const s = window.ioc?.get?.('@diamondcoreprocessor.com/HexDetector')?.spacing
  if (!s) return null
  const mx = flat ? 1.5 * s * qq : Math.sqrt(3) * s * (qq + rr / 2)
  const my = flat ? Math.sqrt(3) * s * (rr + qq / 2) : s * 1.5 * rr
  const pt = host.container.toGlobal({ x: mx + off.x, y: my + off.y })
  const rect = host.canvas.getBoundingClientRect()
  const screen = host.renderer.screen
  return { x: rect.left + pt.x * (rect.width / screen.width), y: rect.top + pt.y * (rect.height / screen.height) }
}, [q, r])

const sticky = (page, effect) => page.evaluate((e) => {
  const v = window.__hypercombEffectBus?.lastValue?.get(e)
  return v === undefined ? null : JSON.parse(JSON.stringify(v))
}, effect)

const pageLabels = async (page) => (await sticky(page, 'render:cell-count'))?.labels ?? []
const painted = async (page) => (await sticky(page, 'render:dive-painted'))?.count ?? 0
const diveLabels = async (page) => ((await sticky(page, 'render:dive'))?.cells ?? []).map(c => c.label)

async function tileClientPoint(page, label) {
  const cc = await sticky(page, 'render:cell-count')
  const i = (cc?.labels ?? []).indexOf(label)
  if (i < 0) return null
  return clientPointOf(page, cc.coords[i].q, cc.coords[i].r)
}

async function divedClientPoint(page, label) {
  const dive = await sticky(page, 'render:dive')
  const cell = (dive?.cells ?? []).find(c => c.label === label)
  if (!cell) return null
  return clientPointOf(page, cell.q, cell.r)
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }

  try {
    await page.goto(url, { waitUntil: 'load' })
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      await page.waitForTimeout(3000)
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
      ready = await page.evaluate(() =>
        !!window.ioc?.get?.('@diamondcoreprocessor.com/WaveViewDrone')
        && !!window.__hypercombEffectBus?.lastValue?.get('render:host-ready'))
    }
    check('the shell booted with the wave view registered', ready)
    if (!ready) throw new Error('the shell never finished booting')

    // ── 1. seed alpha → { beta → { gamma }, delta } ──────────────────────
    const lineage = () => page.evaluate(() => [...(window.ioc.get('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])])
    await page.evaluate(() => window.ioc.get('@hypercomb.social/Lineage')?.explorerReplace?.([]))
    await sleep(800)
    for (const line of ['alpha/beta/gamma', 'alpha/delta']) {
      const typed = await addTile(page, line)
      if (!typed.ok) throw new Error('could not type into the command line: ' + typed.reason)
      await sleep(1500)
      await page.evaluate(() => window.ioc.get('@hypercomb.social/Lineage')?.explorerReplace?.([]))
      await sleep(800)
    }
    const seeded = await until(async () => {
      const cc = await sticky(page, 'render:cell-count')
      return (cc?.labels ?? []).includes('alpha') && (cc?.branchLabels ?? []).includes('alpha')
    }, 15000, 250)
    const before = await pageLabels(page)
    check('the root shows alpha as a branch', seeded, 'labels=' + before.join(','))
    if (!seeded) throw new Error('seeding failed')
    await shot('01-root')

    // ── 2. hold Alt over alpha ─────────────────────────────────────────────
    const alpha = await tileClientPoint(page, 'alpha')
    check('alpha has a screen position', !!alpha, JSON.stringify(alpha))
    await page.mouse.move(alpha.x, alpha.y)
    await sleep(250)
    await page.keyboard.down('Alt')
    const dived = await until(async () => (await painted(page)) === 2, 10000)
    const gen1 = await diveLabels(page)
    check('Alt over a branch dives: the page renderer paints alpha\'s two children in place',
      dived, `painted=${await painted(page)} cells=${gen1.join(',')}`)
    check('the dive holds beta and delta', gen1.includes('beta') && gen1.includes('delta'), gen1.join(','))
    await sleep(300)
    await shot('02-dive-children')

    // ── 3. Alt+wheel: deeper, then back up ────────────────────────────────
    await page.mouse.wheel(0, -120)
    const deeper = await until(async () => (await diveLabels(page)).join(',') === 'gamma', 8000)
    check('Alt+wheel dives a generation deeper: gamma alone', deeper, (await diveLabels(page)).join(','))
    await sleep(300)
    await shot('03-dive-grandchildren')
    await page.mouse.wheel(0, 120)
    const back = await until(async () => (await diveLabels(page)).length === 2, 8000)
    check('…and wheel the other way rises back to the children', back, (await diveLabels(page)).join(','))

    // ── 4. Alt+click on beta executes it ──────────────────────────────────
    const beta = await divedClientPoint(page, 'beta')
    check('beta has a screen position in the dive', !!beta, JSON.stringify(beta))
    await page.mouse.move(beta.x, beta.y)
    await sleep(200)
    const hovered = await sticky(page, 'render:dive-hover')
    check('the dived tile under the pointer is the hovered one', hovered?.label === 'beta', JSON.stringify(hovered))
    await page.mouse.down()
    await page.mouse.up()
    const landed = await until(async () => (await lineage()).join('/') === 'alpha/beta', 8000)
    check('Alt+click on a dived tile enters it — the explorer stands on /alpha/beta', landed, (await lineage()).join('/'))
    check('the dive was given back before travelling', (await painted(page)) === 0, 'painted=' + await painted(page))
    await page.keyboard.up('Alt')
    await sleep(1200)
    check('…and the destination painted its own tiles (gamma)', (await pageLabels(page)).includes('gamma'), (await pageLabels(page)).join(','))
    await shot('04-after-click')

    // ── 5. release restores the page untouched ────────────────────────────
    await page.evaluate(() => window.ioc.get('@hypercomb.social/Lineage')?.explorerReplace?.([]))
    await until(async () => (await pageLabels(page)).includes('alpha'), 8000)
    await sleep(500)
    const alpha2 = await tileClientPoint(page, 'alpha')
    await page.mouse.move(alpha2.x, alpha2.y)
    await sleep(250)
    await page.keyboard.down('Alt')
    await until(async () => (await painted(page)) === 2, 10000)
    await page.keyboard.up('Alt')
    const restored = await until(async () => (await painted(page)) === 0, 5000)
    await sleep(400)
    const after = await pageLabels(page)
    check('releasing Alt gives the page back', restored, 'painted=' + await painted(page))
    check('…untouched: the same tiles as before the dive', after.join(',') === before.join(','), `${before.join(',')} → ${after.join(',')}`)
    check('…and the explorer never moved', (await lineage()).length === 0, (await lineage()).join('/'))
    await shot('05-restored')

    const faults = errors.filter(e => !/404/.test(e))
    check('no page errors', faults.length === 0, faults.slice(0, 3).join(' | '))
  } catch (err) {
    check('run completed', false, String(err && err.message ? err.message : err))
    await shot('99-failure').catch(() => undefined)
  } finally {
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
  console.log('shots → ' + out)
  process.exit(failed.length ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
