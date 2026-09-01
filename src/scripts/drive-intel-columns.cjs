#!/usr/bin/env node
// drive-intel-columns — the command line's autocomplete panel is TWO ALIGNED
// COLUMNS that fit inside their own box.
//
// Guards the two defects the panel shipped with:
//   1. descriptions flushed right on EACH row (a ragged staircase) instead of
//      starting on one shared x;
//   2. the option list sized to its longest row's max-content, shoving the
//      detail pane past the panel's viewport cap so `overflow: hidden` ate the
//      kind badge and half the description sentence.
//
//   node scripts/drive-intel-columns.cjs [--url http://localhost:4250] [--type /s]

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

// Read the panel's real geometry out of the page: where each description
// starts, and whether any pane spills past the container's padding box.
const MEASURE = () => {
  const intel = document.querySelector('.command-intel')
  if (!intel) return { ok: false, reason: 'no .command-intel' }
  const box = intel.getBoundingClientRect()
  const rows = [...intel.querySelectorAll('.command-results li')].map(li => {
    const label = li.querySelector('.opt-label')
    const desc = li.querySelector('.slash-desc')
    return {
      name: label?.textContent?.trim() ?? '',
      labelLeft: label ? Math.round(label.getBoundingClientRect().left) : null,
      descLeft: desc ? Math.round(desc.getBoundingClientRect().left) : null,
      descRight: desc ? Math.round(desc.getBoundingClientRect().right) : null,
      descClipped: desc ? desc.scrollWidth > desc.clientWidth + 1 : false,
    }
  })
  const detail = intel.querySelector('.command-detail')
  const kind = intel.querySelector('.detail-kind')
  return {
    ok: true,
    intel: { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) },
    rows,
    detail: detail ? {
      left: Math.round(detail.getBoundingClientRect().left),
      right: Math.round(detail.getBoundingClientRect().right),
    } : null,
    kind: kind ? {
      text: kind.textContent.trim(),
      right: Math.round(kind.getBoundingClientRect().right),
    } : null,
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const typed = String(arg('type', '/s'))
  const out = path.resolve(String(arg('out', 'test-results/intel-columns')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const page = await (await browser.newContext({
    viewport: { width: Number(arg('vw', 1440)), height: Number(arg('vh', 900)) }, deviceScaleFactor: 2,
  })).newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(12000)
    for (const label of ['Start empty', 'Add a tile']) {
      const t = page.getByText(label, { exact: true })
      if (await t.count()) { await t.first().click({ force: true }); await page.waitForTimeout(3000); break }
    }
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)
    await page.keyboard.press('Escape'); await page.waitForTimeout(800)

    // `/theme` reflects onto <html data-theme> and static token CSS does the
    // rest — so the shot can be taken in either look without touching the
    // participant's stored preference.
    const theme = arg('theme', null)
    if (theme) {
      await page.evaluate(t => { document.documentElement.dataset.theme = String(t) }, theme)
      await page.waitForTimeout(600)
    }

    // focus(), not click() — the boot offer's backdrop eats pointer events, and
    // '/' is a global shortcut until the input actually holds focus.
    const input = page.locator('.command-input').first()
    await input.focus()
    await page.waitForTimeout(300)
    // The sigil is a KEY, not a character: '/' switches stance and inserts
    // nothing. Sending it inside a type() string lands it as literal text.
    await page.keyboard.press('Slash')
    await page.waitForTimeout(400)
    await page.keyboard.type(typed, { delay: 120 })
    await page.waitForTimeout(1200)

    // The dev server's compile-error overlay is a shadow-DOM element that
    // covers the panel. It reports pre-existing errors elsewhere in the tree;
    // drop it so the shot shows the surface under test.
    await page.evaluate(() => {
      document.querySelectorAll('vite-error-overlay, .vite-error-overlay, #vite-error-overlay')
        .forEach(el => el.remove())
    })
    await page.screenshot({ path: path.join(out, 'page.png') })
    const present = await page.locator('.command-intel').count()
    console.log('command-intel present:', present, '· input value:', await input.inputValue().catch(() => '?'))
    if (present) await page.locator('.command-intel').screenshot({ path: path.join(out, 'intel.png') })

    const m = await page.evaluate(MEASURE)
    console.log(JSON.stringify(m, null, 2))
    if (!m.ok) throw new Error(m.reason)

    const withDesc = m.rows.filter(r => r.descLeft != null)
    const lefts = [...new Set(withDesc.map(r => r.descLeft))]
    check('descriptions share ONE column x', withDesc.length > 1 && lefts.length === 1,
      `${withDesc.length} described rows, ${lefts.length} distinct left edge(s): ${lefts.join(',')}`)

    const labelLefts = [...new Set(m.rows.map(r => r.labelLeft))]
    check('names share ONE column x', labelLefts.length === 1, `left edge(s): ${labelLefts.join(',')}`)

    const overflow = withDesc.filter(r => r.descRight > m.intel.right)
    check('no row runs past the panel', overflow.length === 0,
      overflow.length ? `${overflow.length} row(s) past ${m.intel.right}` : `panel right ${m.intel.right}`)

    if (m.detail) {
      check('detail pane sits inside the panel', m.detail.right <= m.intel.right,
        `detail right ${m.detail.right} vs panel right ${m.intel.right}`)
      if (m.kind) {
        check('kind badge is not clipped', m.kind.right <= m.intel.right,
          `"${m.kind.text}" right ${m.kind.right}`)
      }
    } else {
      console.log('note: no detail pane in this state')
    }

    const fail = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - fail.length}/${checks.length} passed  ·  shots in ${out}`)
    process.exitCode = fail.length ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
