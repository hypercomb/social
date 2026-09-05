#!/usr/bin/env node
// drive-toolwindow-contrast — every tool window, every theme, measured.
//
// The complaint this exists to answer: "the portals window is unreadable when
// honey / light / sherbet". The cause is never one panel — it is that a panel
// paints its labels from a LITERAL near-white picked for a dark pane, so the
// theme's bright pane arrives underneath and the text stays white on cream.
//
// So this does not screenshot and squint. It opens each tool window, walks
// every visible text node inside it, composites the real colour over the real
// ground (alpha included, ancestors walked) and reports the WCAG ratio. A
// panel passes when every rung of its text clears 4.5:1 (3:1 for large text).
//
//   node scripts/drive-toolwindow-contrast.cjs [--url http://localhost:4250]
//                                              [--out <dir>] [--engine chrome]
//                                              [--themes light,dark,honey,bloom,sherbet,system-light,system-dark]
//                                              [--allow-missing]

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

// Every docked/floating tool window, with the effect that raises it and the
// selector its pane answers to. Adding a window here is the whole cost of
// covering it.
const WINDOWS = [
  { id: 'portals',    effect: 'aggregate:view-open', payload: { id: 'collections' }, sel: '.ai-panel' },
  { id: 'notes',      effect: 'notes:panel',         payload: { visible: true },     sel: '.cv2-panel, .notes-strip' },
  // `features:open` is the DRONE'S ANSWER and needs a cell — an empty payload
  // is refused by the panel, which left this row "not present" in every theme
  // (a check that could never fail). `features:context-open` is the real door:
  // the panel asks the drone about the loaded layer and raises itself.
  { id: 'behaviors',  effect: 'features:context-open', payload: {},                  sel: '.features-panel' },
  { id: 'files',      effect: 'files:open',          payload: {},                    sel: '.files-panel' },
  { id: 'tags',       effect: 'tags:view-open',      payload: {},                    sel: '.tags-panel' },
  { id: 'history',    effect: 'history:view-open',   payload: {},                    sel: '.history-viewer' },
  { id: 'clipboard',  effect: 'clipboard:panel',     payload: { visible: true },     sel: '.clipboard-panel' },
  { id: 'sequence',   effect: 'sequence:view-open',  payload: {},                    sel: '.sequence-panel, .seq-panel' },
  { id: 'workflow',   effect: 'workflow:view-open',  payload: {},                    sel: '.workflow-panel' },
  { id: 'rewind',     effect: 'rewind:open',         payload: {},                    sel: '.rewind-window, .rewind-panel' },
  { id: 'chat',       effect: 'chat:toggle',         payload: {},                    sel: '.chat-panel' },
  { id: 'feedback',   effect: 'feedback:toggle',     payload: {},                    sel: '.feedback-viewer-panel' },
  { id: 'notesview',  effect: 'notes:open',          payload: {},                    sel: '.viewer-card' },
  { id: 'context',    effect: 'context:tile-changed', payload: {},                   sel: '.ctx-panel' },
  { id: 'publish',    effect: 'publish:render',      payload: {},                    sel: '.publish-panel' },
  { id: 'references', effect: 'references:compose',  payload: {},                    sel: '.ref-panel' },
  { id: 'action',     effect: 'action:hover-show',   payload: {
    label: 'Contrast audit', cmd: 'contrast-audit', kind: 'slash',
    steps: [['Ctrl', 'K']], category: 'audit',
    description: 'Verifies that every readable run clears its contrast target.',
    detail: 'This synthetic reference card exercises its labels, pills, dividers, and examples.',
    usage: '/contrast-audit <theme>', params: ['theme'],
    examples: [{ input: '/contrast-audit honey', result: 'All runs measured.' }],
  }, sel: '.action-card-panel' },
]

// Walk one open panel and measure every visible text run in it. Runs entirely
// in the page: reading a composited colour needs the live cascade.
const MEASURE = (sel) => {
  const panel = document.querySelector(sel)
  if (!panel) return { present: false }

  const parse = (c) => {
    let m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(c || '')
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    // Chromium serializes color-mix() as color(srgb …). Skipping those runs
    // made themed accent labels disappear from the audit entirely.
    m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i.exec(c || '')
    if (!m) return null
    return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : +m[4]]
  }
  const over = (fg, bg) => {
    const a = fg[3]
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
  }
  const lum = (c) => {
    const f = (v) => { v /= 255; return v > 0.03928 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92 }
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
  }
  const ratio = (a, b) => {
    const pair = [lum(a), lum(b)].sort((p, q) => q - p)
    return (pair[0] + 0.05) / (pair[1] + 0.05)
  }
  // The ground a run of text actually sits on: walk out until something is
  // opaque, compositing each translucent layer on the way back down.
  const groundOf = (el) => {
    const stack = []
    for (let n = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor)
      if (bg && bg[3] > 0) { stack.unshift(bg); if (bg[3] >= 0.999) break }
      if (n === document.documentElement) break
    }
    let base = [255, 255, 255, 1]
    for (const layer of stack) base = over(layer, base)
    return base
  }

  const rows = []
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || '').trim()
    if (!text) continue
    const el = node.parentElement
    if (!el || seen.has(el)) continue
    seen.add(el)
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    const fg = parse(cs.color)
    if (!fg) continue
    const ground = groundOf(el)
    const ink = over(fg, ground)
    const px = parseFloat(cs.fontSize) || 12
    const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700
    const large = px >= 24 || (px >= 18.66 && bold)
    const need = large ? 3 : 4.5
    const r = ratio(ink, ground)
    rows.push({
      text: text.slice(0, 28),
      cls: (el.className && String(el.className).split(/\s+/)[0]) || el.tagName.toLowerCase(),
      color: cs.color,
      ground: 'rgb(' + ground.slice(0, 3).map(function (v) { return Math.round(v) }).join(', ') + ')',
      px: +px.toFixed(1), ratio: +r.toFixed(2), need: need, pass: r >= need,
    })
  }
  return { present: true, rows: rows }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const outDir = path.resolve(String(arg('out', 'test-results/toolwindow-contrast')))
  const themes = String(arg('themes', 'light,dark,honey,bloom,sherbet,system-light,system-dark')).split(',').map(s => s.trim()).filter(Boolean)
  const allowMissing = arg('allow-missing', false) === true
  fs.mkdirSync(outDir, { recursive: true })

  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const report = []
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 30000 })
    await page.waitForTimeout(2500)

    for (const theme of themes) {
      const systemScheme = /^system-(light|dark)$/.exec(theme)?.[1]
      if (systemScheme) await page.emulateMedia({ colorScheme: systemScheme })
      await page.evaluate((t) => window.ioc && window.ioc.get && window.ioc.get('@hypercomb.social/Theme') && window.ioc.get('@hypercomb.social/Theme').setTheme(t), systemScheme ? 'system' : theme)
      await page.waitForTimeout(400)

      for (const w of WINDOWS) {
        // The dev server rebuilds under us mid-run; a reload destroys the
        // execution context and every evaluate after it throws. Re-settle and
        // retry once rather than losing the whole sweep.
        const settle = async () => {
          await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 60000 })
          await page.waitForTimeout(1200)
        }
        const attempt = async () => {
          await page.evaluate((a) => window.__hypercombEffectBus.emit(a[0], a[1]), [w.effect, w.payload])
          await page.waitForTimeout(650)
          return page.evaluate(MEASURE, w.sel)
        }
        let res
        try { res = await attempt() }
        catch { await settle(); await page.evaluate((t) => window.ioc.get('@hypercomb.social/Theme').setTheme(t), systemScheme ? 'system' : theme); await page.waitForTimeout(300); res = await attempt() }
        if (!res.present) { report.push({ theme, window: w.id, present: false }); continue }
        const fails = res.rows.filter(r => !r.pass)
        report.push({
          theme, window: w.id, present: true, runs: res.rows.length, fails: fails.length,
          worst: res.rows.length ? Math.min.apply(null, res.rows.map(r => r.ratio)) : null,
          failing: fails.slice(0, 14),
        })
        if (fails.length) {
          const el = await page.$(w.sel)
          if (el) await el.screenshot({ path: path.join(outDir, theme + '-' + w.id + '.png') }).catch(() => {})
        }
        // Put it away so the next window is measured alone.
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
      }
    }
  } finally {
    await browser.close()
  }

  fs.writeFileSync(path.join(outDir, 'contrast.json'), JSON.stringify(report, null, 2))
  let bad = 0
  let missing = 0
  for (const r of report) {
    if (!r.present) {
      missing += 1
      console.log(' MISS ' + r.theme.padEnd(8) + ' ' + r.window.padEnd(11) + ' (not present)')
      continue
    }
    const mark = r.fails ? 'FAIL' : ' ok '
    if (r.fails) bad += r.fails
    console.log('  ' + mark + '  ' + r.theme.padEnd(8) + ' ' + r.window.padEnd(11) + ' ' + String(r.runs).padStart(3) + ' runs, ' + String(r.fails).padStart(3) + ' under target, worst ' + r.worst + ':1')
    for (const f of (r.failing || [])) console.log('           .' + f.cls + ' "' + f.text + '" ' + f.ratio + ':1 (needs ' + f.need + ') ' + f.color + ' on ' + f.ground)
  }
  console.log('\n' + bad + ' text runs under target; ' + missing + ' surfaces not exercised. Report: ' + path.join(outDir, 'contrast.json'))
  process.exit(bad || (missing && !allowMissing) ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(1) })
