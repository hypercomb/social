#!/usr/bin/env node
// drive-behaviors-title — the Beehaviors header names its SUBJECT.
//
// `Beehaviors / <tile>` on a layer, `Beehaviors / global` in the pool (which
// is attached to no tile), and just `Beehaviors` at the hive root, which has
// no name to give — a separator with nothing after it read as `Beehaviors //`.
// Never three segments: hanging the scope word off the app AND the name read
// `Beehaviors / local / behaviors` on a tile named for what it holds.
//
//   node scripts/drive-behaviors-title.cjs [--url http://localhost:4253]

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

const TITLE = () => {
  const t = document.querySelector('.features-title')
  if (!t) return null
  return {
    text: t.textContent.replace(/\s+/g, ' ').trim(),
    app: t.querySelector('.features-title-app')?.textContent?.trim() ?? '',
    cell: t.querySelector('.features-title-cell')?.textContent?.trim() ?? '',
    scope: t.querySelector('.features-title-scope')?.textContent?.trim() ?? '',
    seps: t.querySelectorAll('.features-title-sep').length,
  }
}

const TILE = 'atelier'

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/behaviors-title')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    // a tile to stand on
    const input = page.locator('.command-input, input.shell-input, [role="combobox"]').first()
    await input.click(); await input.fill(TILE)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3000)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)

    // ── THE HIVE ROOT — no name to give ───────────────────────────────
    await page.locator('.rail-btn.features-toggle-btn').click()
    await page.waitForTimeout(4000)
    let t = await page.evaluate(TITLE)
    console.log('\nroot: ' + JSON.stringify(t))
    check('the root shows the app word alone', t && t.app && !t.cell && !t.scope && t.seps === 0, t?.text)

    // ── THE POOL — attached to no tile ────────────────────────────────
    await page.locator('.features-panel .scope-toggle').click()
    await page.waitForTimeout(2500)
    t = await page.evaluate(TITLE)
    console.log('pool: ' + JSON.stringify(t))
    check('the pool says global', t && /global/i.test(t.scope), t?.text)
    check('the pool names no tile', t && !t.cell, t?.text)
    check('two segments, never three', t && t.seps === 1, `${t?.seps} separators`)
    await page.screenshot({ path: path.join(out, '10-pool.png') })

    // ── A TILE — its own name ─────────────────────────────────────────
    await page.locator('.features-panel .scope-toggle').click()
    await page.waitForTimeout(2000)
    await page.evaluate((t2) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.([t2]), TILE)
    await page.waitForTimeout(6000)
    t = await page.evaluate(TITLE)
    console.log('tile: ' + JSON.stringify(t))
    check('the layer is named by its own name', t && t.cell === TILE, t?.text)
    check('the scope word steps aside for it', t && !t.scope, t?.text)
    check('still two segments', t && t.seps === 1, `${t?.seps} separators`)
    await page.screenshot({ path: path.join(out, '20-tile.png') })
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
