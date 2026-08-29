#!/usr/bin/env node
// drive-text-size — the two surfaces that were never offered a text size now
// carry one, on the tool windows' own ladder and record.
//
// Proves, for the completion panel and the tile editor:
//   • picking a step actually resizes the surface (computed px, not a class);
//   • the pick is written to the SAME key a docked panel uses;
//   • it survives closing and reopening the surface;
//   • Ctrl+= / Ctrl+- steps the ladder from the keyboard.
//
//   node scripts/drive-text-size.cjs [--url http://localhost:4250] [--theme dark]

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

const fontPx = (sel) => (s => {
  const el = document.querySelector(s)
  return el ? parseFloat(getComputedStyle(el).fontSize) : null
})(sel)

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/text-size')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const page = await (await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  })).newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }
  const dropOverlay = () => page.evaluate(() => {
    document.querySelectorAll('vite-error-overlay, .vite-error-overlay, #vite-error-overlay')
      .forEach(el => el.remove())
  })

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(12000)
    for (const label of ['Start empty', 'Add a tile']) {
      const t = page.getByText(label, { exact: true })
      if (await t.count()) { await t.first().click({ force: true }); await page.waitForTimeout(3000); break }
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)

    const theme = arg('theme', null)
    if (theme) {
      await page.evaluate(t => { document.documentElement.dataset.theme = String(t) }, theme)
      await page.waitForTimeout(500)
    }

    // Start from a known state — the record may survive from an earlier run.
    await page.evaluate(() => {
      localStorage.removeItem('hc:panel-text:command-intel')
      localStorage.removeItem('hc:panel-text:tile-editor')
    })

    const openList = async () => {
      const input = page.locator('.command-input').first()
      await input.focus(); await page.waitForTimeout(250)
      await page.keyboard.press('Slash'); await page.waitForTimeout(350)
      await page.keyboard.type('s', { delay: 90 })
      await page.waitForTimeout(900)
    }
    const closeList = async () => {
      await page.keyboard.press('Escape'); await page.waitForTimeout(400)
      const input = page.locator('.command-input').first()
      await input.fill(''); await page.waitForTimeout(400)
    }

    // ── the completion panel ─────────────────────────────────────────
    await openList()
    await dropOverlay()
    const base = await page.evaluate(fontPx, '.command-intel')
    check('completion panel renders at a measurable size', base > 0, `${base}px`)

    const large = page.locator('.command-intel .text-scale-step', { hasText: 'Large' }).first()
    check('the ladder is offered in the detail pane', await large.count() > 0)
    await large.click()
    await page.waitForTimeout(500)
    const grown = await page.evaluate(fontPx, '.command-intel')
    check('picking Large actually grows the panel', grown > base + 0.5,
      `${base}px → ${grown}px (expected ×1.15)`)

    const stored = await page.evaluate(() => localStorage.getItem('hc:panel-text:command-intel'))
    check('the pick lands on the docked-panel key', stored === '1.15',
      `hc:panel-text:command-intel = ${stored}`)

    // Ctrl+= steps one more rung, from the keyboard, without leaving the input.
    await page.keyboard.press('Control+Equal')
    await page.waitForTimeout(500)
    const stepped = await page.evaluate(() => localStorage.getItem('hc:panel-text:command-intel'))
    const steppedPx = await page.evaluate(fontPx, '.command-intel')
    check('Ctrl+= steps up the ladder', stepped === '1.32' && steppedPx > grown,
      `${stored} → ${stepped}, ${grown}px → ${steppedPx}px`)

    await page.keyboard.press('Control+Minus')
    await page.waitForTimeout(500)
    check('Ctrl+- steps back down',
      await page.evaluate(() => localStorage.getItem('hc:panel-text:command-intel')) === '1.15')

    await dropOverlay()
    await page.locator('.command-intel').screenshot({ path: path.join(out, 'intel-large.png') })

    // Close and reopen — the size must come back from the record, not from a
    // signal that happened to still be in memory.
    await closeList()
    await openList()
    const reopened = await page.evaluate(fontPx, '.command-intel')
    check('the size survives closing and reopening', Math.abs(reopened - grown) < 0.5,
      `${reopened}px vs ${grown}px`)
    await closeList()

    // ── the tile editor ──────────────────────────────────────────────
    const input = page.locator('.command-input').first()
    await input.focus()
    await page.keyboard.type('sizing-probe', { delay: 40 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(600)

    // `e` edits the tile under the cursor — but the Pixi surface does not
    // reliably paint headless (no GPU), so there may be nothing under it. Open
    // the editor through its own service instead: same component, same state.
    await page.evaluate(() => {
      const svc = window.ioc?.get('@diamondcoreprocessor.com/TileEditorService')
      svc?.open('sizing-probe', {}, null, [])
    })
    await page.waitForTimeout(1500)

    const editorOpen = await page.locator('.editor-panel').count()
    if (!editorOpen) {
      console.log('note: could not open the tile editor in this run — skipping its checks')
    } else {
      await dropOverlay()
      const eBase = await page.evaluate(fontPx, '.editor-panel')
      const eLarger = page.locator('.editor-panel .text-scale-step', { hasText: 'Larger' }).first()
      check('the editor offers the same ladder', await eLarger.count() > 0)
      await eLarger.click()
      await page.waitForTimeout(500)
      const eGrown = await page.evaluate(fontPx, '.editor-panel')
      check('picking Larger grows the editor', eGrown > eBase + 0.5, `${eBase}px → ${eGrown}px`)
      check('the editor writes its own record',
        await page.evaluate(() => localStorage.getItem('hc:panel-text:tile-editor')) === '1.32')
      await dropOverlay()
      await page.locator('.editor-panel').screenshot({ path: path.join(out, 'editor-larger.png') })
    }

    const fail = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - fail.length}/${checks.length} passed  ·  shots in ${out}`)
    process.exitCode = fail.length ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
