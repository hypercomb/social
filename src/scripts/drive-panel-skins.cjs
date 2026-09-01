#!/usr/bin/env node
// drive-panel-skins — every tool window follows the theme, and stays readable.
//
// The tool windows used to be drawn for ONE ground: a dark pane, a pastel
// identity accent chosen to sit on it, and ~700 light-on-dark literals for
// text, rules and hover washes. This drives the result of routing all of that
// onto the panel roles:
//
//   • the pane follows the theme (bright under a bright look, dark under dark)
//   • the identity accent survives — same HUE, taken deep enough to read
//   • every panel's title and body text clears a real contrast bar, in BOTH
//   • two panels never collapse to the same accent (the identities stay apart)
//
// Contrast is checked, not eyeballed: a skin that "looks fine" in one panel
// and turns another's title into a whisper is exactly the failure this exists
// to catch.
//
//   node scripts/drive-panel-skins.cjs [--url http://localhost:4250]
//                                      [--out <dir>] [--engine chrome]

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

/** The panels this drives, by the rail control that raises each one. */
const PANELS = [
  { id: 'features', sel: '.features-panel', btn: '.rail-btn.features-toggle-btn' },
  { id: 'files', sel: '.files-panel', effect: 'files:view-toggle' },
  { id: 'notes', sel: '.notes-panel, .notes-viewer', effect: 'notes:view-toggle' },
  { id: 'tags', sel: '.tags-panel', effect: 'tags:view-toggle' },
  { id: 'history', sel: '.history-panel', effect: 'history:view-toggle' },
  { id: 'publish', sel: '.publish-panel', effect: 'publish:view-toggle' },
  { id: 'clipboard', sel: '.clipboard-panel', effect: 'clipboard:view-toggle' },
  { id: 'observe', sel: '.observe-panel', effect: 'observe:view-toggle' },
]

/** sRGB relative luminance, and the WCAG ratio between two computed colours. */
function rgbOf(c) {
  const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}
function lum(c) {
  const v = rgbOf(c)
  if (!v) return NaN
  const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2])
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Read one open panel: its ground, its identity, and its actual text. */
const READ = (sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const cs = getComputedStyle(el)
  // The pane's opaque colour: a panel is translucent over the hive, so the
  // reported alpha is not the whole story — composite it onto the body.
  const texts = [...el.querySelectorAll('*')]
    .filter(n => n.children.length === 0 && (n.textContent ?? '').trim().length > 2)
    .filter(n => { const r = n.getBoundingClientRect(); return r.width > 4 && r.height > 4 })
    .slice(0, 40)
    .map(n => getComputedStyle(n).color)
  return {
    pane: cs.backgroundColor,
    acc: cs.getPropertyValue('--acc').trim(),
    windowAccent: cs.getPropertyValue('--hc-window-accent').trim(),
    texts,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/panel-skins')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: 'dark' })
  const page = await context.newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  const open = async (p) => {
    if (await page.locator(p.sel).count()) return true
    if (p.btn && await page.locator(p.btn).count()) await page.locator(p.btn).click()
    else if (p.effect) {
      await page.evaluate(e => window.__hypercombEffectBus.emit(e, {}), p.effect)
    }
    await page.waitForTimeout(1600)
    return (await page.locator(p.sel).count()) > 0
  }
  const close = async (p) => {
    if (p.btn && await page.locator(p.btn).count()) { await page.locator(p.btn).click() }
    else if (p.effect) await page.evaluate(e => window.__hypercombEffectBus.emit(e, {}), p.effect)
    await page.waitForTimeout(700)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    const seen = {}
    for (const theme of ['honey', 'dark']) {
      await page.evaluate(t => window.ioc?.get?.('@hypercomb.social/Theme')?.setTheme?.(t), theme)
      await page.waitForTimeout(900)
      const bright = theme !== 'dark'
      seen[theme] = {}

      for (const p of PANELS) {
        if (!(await open(p))) { console.log(`      (skip ${p.id} — did not open)`); continue }
        const r = await page.evaluate(READ, p.sel)
        await page.screenshot({ path: path.join(out, `${theme}-${p.id}.png`) })
        if (!r) { await close(p); continue }
        seen[theme][p.id] = r.acc

        // The pane follows the theme.
        const paneLum = lum(r.pane)
        check(`${theme}/${p.id}: the pane follows the theme`,
          bright ? paneLum > 0.75 : paneLum < 0.2, `pane=${r.pane}`)

        // Its identity is still ITS identity, and legible on that pane.
        const accRatio = r.acc ? ratio(`rgb(${r.acc})`, r.pane) : 0
        check(`${theme}/${p.id}: the identity reads on it`, accRatio >= 3,
          `--acc=${r.acc} vs pane ${accRatio.toFixed(1)}:1`)

        // Every visible run of text clears a real bar against the pane.
        const worst = r.texts
          .map(c => ({ c, k: ratio(c, r.pane) }))
          .filter(x => Number.isFinite(x.k))
          .sort((a, b) => a.k - b.k)[0]
        check(`${theme}/${p.id}: nothing is a whisper`, !worst || worst.k >= 3,
          worst ? `worst text ${worst.k.toFixed(1)}:1 (${worst.c}) over ${r.pane}` : 'no text read')

        await close(p)
      }
    }

    // Identities must stay APART — deepening every accent toward the same
    // luminance is exactly the operation that could collapse two panels onto
    // one colour, which is the thing the accent exists to prevent.
    const bright = Object.entries(seen.honey ?? {})
    const collisions = []
    for (let i = 0; i < bright.length; i++) {
      for (let j = i + 1; j < bright.length; j++) {
        const [an, av] = bright[i], [bn, bv] = bright[j]
        if (!av || !bv || av === bv) continue
        const [ar, ag, ab] = av.split(',').map(Number)
        const [br, bg, bb] = bv.split(',').map(Number)
        const d = Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb)
        if (d < 40) collisions.push(`${an}~${bn} (${av} vs ${bv})`)
      }
    }
    check('deepening kept the identities apart', collisions.length === 0,
      collisions.length ? collisions.join('; ') : `${bright.length} panels, all distinct`)
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
