#!/usr/bin/env node
// drive-behaviors-lens — a view IS a beehaviour, so the strip is a CHOICE.
//
// The Beehaviors panel's kind filter used to be two independent toggles over a
// set and its subset: three reachable states, one of them ("both dark") empty,
// and a rule to climb back out. Views are a SUBSET of beehaviours, so the strip
// is now two mutually exclusive buttons — Beehaviors is the WHOLE list, views
// included, and Views narrows it to the surfaces. This drives that:
//
//   Beehaviors ⊇ Views, exactly one lit, the lit one is inert.
//
//   node scripts/drive-behaviors-lens.cjs [--url http://localhost:4253]
//                                         [--out <dir>] [--engine chrome]

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

// One read of the strip and the list it narrows.
const SNAP = () => {
  const q = (s) => document.querySelector(s)
  const rows = Array.from(document.querySelectorAll('.features-scroll .features-row'))
  return {
    panel: !!q('.features-panel'),
    behaviorsLit: !!q('.scope-kind.behaviors.on'),
    viewsLit: !!q('.scope-kind.views.on'),
    rows: rows.length,
    views: rows.filter(r => r.classList.contains('view')).length,
    labels: rows.map(r => (r.querySelector('.feature-name')?.textContent ?? '').trim()).slice(0, 60),
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/behaviors-lens')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }

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
    await page.waitForTimeout(400)

    // ── the rail's switch raises the panel, resting on the WHOLE list ──
    // The switch TOGGLES, and the panel's open-ness survives a reload — so a
    // run that lands with it already up must not press it closed.
    if (!(await page.locator('.features-panel').count())) {
      await page.locator('.rail-btn.features-toggle-btn').click()
      await page.waitForTimeout(4000)
    }
    await shot('00-open')

    let s = await page.evaluate(SNAP)
    check('the rail switch raises the panel', s.panel)
    check('it rests on beehaviors', s.behaviorsLit && !s.viewsLit)
    check('the whole list is not empty', s.rows > 0, `rows=${s.rows}`)
    check('and it holds views among the rest', s.views > 0 && s.rows > s.views, `views=${s.views}/${s.rows}`)
    const whole = s.rows
    const viewsInWhole = s.views

    // ── VIEWS NARROWS THE SAME LIST ───────────────────────────────────
    await page.locator('.features-panel .scope-kind.views').click()
    await page.waitForTimeout(1500)
    await shot('05-views')
    s = await page.evaluate(SNAP)
    check('views lit', s.viewsLit)
    check('beehaviors dark beside it', !s.behaviorsLit)
    check('every row in the narrow list is a view', s.rows > 0 && s.views === s.rows, `views=${s.views}/${s.rows}`)
    check('it dropped exactly the non-views', s.rows === viewsInWhole, `${s.rows} of ${whole}`)
    const narrow = s.rows

    // ── the lit one is INERT ──────────────────────────────────────────
    await page.locator('.features-panel .scope-kind.views').click()
    await page.waitForTimeout(1200)
    s = await page.evaluate(SNAP)
    check('clicking the lit button changes nothing', s.viewsLit && !s.behaviorsLit && s.rows === narrow,
      `views=${s.viewsLit} beh=${s.behaviorsLit} rows=${s.rows}`)
    check('the list can never go empty', s.rows > 0)

    // ── BEEHAVIORS IS THE SUPERSET ────────────────────────────────────
    await page.locator('.features-panel .scope-kind.behaviors').click()
    await page.waitForTimeout(1500)
    await shot('10-behaviors')
    s = await page.evaluate(SNAP)
    check('beehaviors lit', s.behaviorsLit)
    check('views dark beside it', !s.viewsLit)
    check('beehaviors is the superset', s.rows === whole && s.rows > narrow, `${s.rows} back from ${narrow}, whole was ${whole}`)
    check('the views are still in it', s.views === narrow && s.views > 0, `views=${s.views}, narrow was ${narrow}`)

    // ── ESCAPE RESTS ON THE WHOLE LIST ────────────────────────────────
    await page.locator('.features-panel .scope-kind.views').click()
    await page.waitForTimeout(1200)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1200)
    s = await page.evaluate(SNAP)
    check('escape widens back to beehaviors before closing', s.panel && s.behaviorsLit && !s.viewsLit,
      `panel=${s.panel} beh=${s.behaviorsLit}`)

    await shot('20-rest')
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
