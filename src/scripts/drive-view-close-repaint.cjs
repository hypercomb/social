#!/usr/bin/env node
// drive-view-close-repaint — closing a view must REVEAL the tiles, not a void.
//
// The claim (Jaime, 2026-08-24): "when you close the view it's a blank screen".
// The design says the escape back to hexagons needs no repaint because the mesh
// was painted under the covered canvas all along (show-cell's ARRIVAL GATE:
// "paints anyway ... the mesh is what the escape back to hexagons reveals").
// If that mesh is missing — or the canvas stays suppressed — you get ink.
//
// So this walks the whole loop on a hive with real tiles and samples the CANVAS
// ITSELF at each step: how much of the frame is not background.
//
//   node scripts/drive-view-close-repaint.cjs [--url http://localhost:4253]
//                                             [--view tree] [--out <dir>]

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

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** How busy is the frame? A screenshot of an empty ink field compresses to
 *  almost nothing; a field of tiles does not. Byte length of the PNG is a
 *  crude but completely reliable "is there anything there" signal, and it
 *  needs no GPU readback (which a WebGL canvas will not give us anyway). */
async function frame(page, out, name) {
  const file = path.join(out, name + '.png')
  await page.screenshot({ path: file })
  const buf = fs.readFileSync(file)
  if (!buf.subarray(0, 4).equals(PNG_SIG)) throw new Error('not a png')
  return { file, bytes: buf.length }
}

const STATE = () => {
  const body = document.body
  const show = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
  const vm = window.ioc?.get?.('@hypercomb.social/ViewMode')
  const canvas = document.querySelector('canvas')
  const cs = canvas ? getComputedStyle(canvas) : null
  return {
    viewClasses: [...body.classList].filter(c => c.startsWith('hc-view-')),
    mode: vm?.mode ?? '(no ViewMode)',
    painted: show?.paintedLocationKey ?? '(none)',
    canvas: canvas ? { w: canvas.width, h: canvas.height, opacity: cs.opacity, visibility: cs.visibility, display: cs.display } : null,
    // Anything painted OVER the canvas that would hide it.
    covers: [...document.querySelectorAll('body > *, .hc-shell-surfaces > *')]
      .filter(e => {
        const s = getComputedStyle(e)
        return (s.position === 'fixed' || s.position === 'absolute')
          && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.5
          && e.getBoundingClientRect().width > window.innerWidth * 0.8
          && e.getBoundingClientRect().height > window.innerHeight * 0.8
      })
      .map(e => e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ').slice(0, 2).join('.'))
      .slice(0, 6),
  }
}

async function type(page, text) {
  const input = page.locator('.command-input, input.shell-input, [role="combobox"]').first()
  await input.click()
  await input.fill(text)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const wantView = String(arg('view', 'tree'))
  const out = path.resolve(String(arg('out', 'test-results/view-close')))
  fs.mkdirSync(out, { recursive: true })
  const { type: engine, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await engine.launch({ headless: true, ...opts })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    // ── a hive with something to look at ──────────────────────────────
    for (const name of ['alpha', 'beta', 'gamma']) await type(page, name)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(3000)

    const hexagons = await frame(page, out, '00-hexagons')
    let s = await page.evaluate(STATE)
    console.log('\nhexagons: ' + JSON.stringify(s))
    console.log('  frame bytes: ' + hexagons.bytes)
    check('the hive paints its tiles first', hexagons.bytes > 40_000, `${hexagons.bytes} bytes`)
    // The HEALTHY hexagon surface has full-screen elements of its own (the
    // pixi host's wrapper). Only something NOT in this baseline can be called
    // a leftover cover.
    const baseCovers = new Set(s.covers)

    // ── turn the view on here, then enter it ──────────────────────────
    await page.locator('.rail-btn.features-toggle-btn').click()
    await page.waitForTimeout(4000)
    const idx = await page.evaluate((v) => Array.from(document.querySelectorAll('.features-scroll .features-row'))
      .findIndex(li => (li.querySelector('.feature-cmd')?.textContent ?? '').trim() === '/' + v), wantView)
    if (idx < 0) {
      console.log(`(no /${wantView} row — available:)`)
      console.log(await page.evaluate(() => Array.from(document.querySelectorAll('.features-scroll .features-row .feature-cmd')).map(e => e.textContent).join(' ')))
      throw new Error('no such view row')
    }
    await page.locator('.features-scroll .features-row').nth(idx).click()
    await page.waitForTimeout(5000)
    await page.keyboard.press('Escape')   // close the panel
    await page.waitForTimeout(1500)

    // The rail grew a button for the view — that is the way in.
    const railView = page.locator('.rail-btn.view-toggle-btn, .rail-btn[class*="view"]').first()
    if (await railView.count()) { await railView.click() } else { await type(page, '/' + wantView) }
    await page.waitForTimeout(6000)

    const inView = await frame(page, out, '10-in-view')
    s = await page.evaluate(STATE)
    console.log('\nin the view: ' + JSON.stringify(s))
    console.log('  frame bytes: ' + inView.bytes)
    check('the view took the surface', s.viewClasses.includes('hc-view-covered') || s.mode !== 'hexagons',
      `mode=${s.mode} classes=${s.viewClasses.join(',')}`)

    // ── CLOSE IT — the whole point ────────────────────────────────────
    await page.keyboard.press('Escape')
    await page.waitForTimeout(5000)

    const closed = await frame(page, out, '20-closed')
    s = await page.evaluate(STATE)
    console.log('\nafter close: ' + JSON.stringify(s))
    console.log('  frame bytes: ' + closed.bytes)

    check('the canvas is no longer suppressed', !s.viewClasses.includes('hc-view-covered'),
      `classes=${s.viewClasses.join(',')}`)
    const strays = s.covers.filter(c => !baseCovers.has(c))
    check('nothing full-screen is left covering it', strays.length === 0, strays.join(' ') || '(only the baseline chrome)')
    check('show-cell still holds a painted location', s.painted && s.painted !== '(none)', String(s.painted))
    check('THE TILES ARE BACK', closed.bytes > hexagons.bytes * 0.6,
      `${closed.bytes} vs ${hexagons.bytes} on the way in`)
  } finally {
    if (errors.length) { console.log('\npage errors:'); for (const e of errors.slice(0, 8)) console.log('  ' + e) }
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
