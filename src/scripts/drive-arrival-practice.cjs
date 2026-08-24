#!/usr/bin/env node
// drive-arrival-practice — Jaime's drill: mark the root and a child
// ("behaviors") with default views, keep one child ("plain") on hexagons,
// then PRACTICE SWITCHING between all three and screenshot every beat.
//
//   node scripts/drive-arrival-practice.cjs [--url http://localhost:4253]
//                                           [--out <dir>] [--engine chrome]
//
// The contract under test, in Jaime's words — "dead simple":
//   • a marked layer opens DIRECTLY as its view: no hexagons, no blank,
//     nothing else rendered in between;
//   • view → view navigation swaps face to face the same way;
//   • a grid of hexagons that IS the destination's face shows up without a
//     glitch either — the old view holds until the new grid is painted;
//   • the exits (×, Escape, right-click) still take you OUT to hexagons —
//     the interface must always be reachable.
//
// A page-side sampler polls every 80ms: {mode, covered-class, canvas
// visibility, rendered cell count}. The one global invariant across the
// whole drill: THE CANVAS IS ONLY EVER VISIBLE WHILE THE SURFACE IS
// OFFICIALLY HEXAGONS — tiles never peek out from under any view.

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

const SAMPLER = `(() => {
  if (window.__practice) return
  const log = []
  window.__practice = { log, mark: (m) => log.push({ t: Date.now(), mark: m }) }
  setInterval(() => {
    try {
      const vm = window.ioc?.get?.('@hypercomb.social/ViewMode')
      const sc = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const canvas = document.querySelector('#pixi-host canvas') || document.getElementById('pixi-host')
      log.push({
        t: Date.now(),
        mode: vm?.mode ?? '',
        covered: document.body.classList.contains('hc-view-covered'),
        canvas: canvas ? getComputedStyle(canvas).visibility : 'none',
        cells: sc?.snapshotCells?.().length ?? -1,
      })
    } catch (e) { log.push({ t: Date.now(), err: String(e).slice(0, 80) }) }
  }, 80)
})()`

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/arrival-practice')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const mode = () => page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '')
  const go = (segs) => page.evaluate((s) => {
    window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s)
  }, segs)
  const markBeat = (m) => page.evaluate((x) => window.__practice?.mark(x), m)
  const addTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)

  // Set POST-IT as THIS layer's default via the Beehaviors panel (bulb =
  // deposit, icon = "opens here by default") and VERIFY the mark landed (the
  // icon wears is-default) — a silent miss here would make every later check
  // test an illusion. Post-it deliberately: it is NODE-LOCAL, so the child
  // gets its OWN row (an inherited row refuses the default icon — "managed
  // where it flows from"), and its scope cannot bleed over the plain page
  // the way a hierarchy view's (Brief's) would. Returns '' unless verified.
  async function markLayerDefault() {
    const beeBtn = page.locator('.rail-btn.features-toggle-btn, [aria-label*="eehavior" i]').first()
    if (!(await page.locator('.features-panel').count()) && await beeBtn.count()) {
      await beeBtn.click().catch(() => {})
      await page.waitForTimeout(2000)
    }
    const panel = page.locator('.features-panel')
    if (!(await panel.count())) return ''
    const row = panel.locator('.features-row.view.off:not(.inherited)')
      .filter({ has: page.locator('.feature-name', { hasText: /post/i }) }).first()
    if (await row.count()) {
      await row.click()
      await page.waitForTimeout(3500)
    }
    const named = 'postit'
    // State the intent the panel's icon states — the write side is
    // show-features' features:default handler either way. (The panel icon
    // itself is mid-rework and its clear-vs-set state is scoped wrong at
    // children today; the drill tests ARRIVALS, not the panel.)
    const segs = await page.evaluate(() =>
      (window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String))
    await page.evaluate(({ s }) => {
      window.__hypercombEffectBus?.emit?.('features:default',
        { cell: s.length ? s[s.length - 1] : '/', segments: s, view: 'postit', clear: false })
    }, { s: segs })
    // verify against the layer itself — the mark must be readable back
    for (let attempt = 0; attempt < 8; attempt++) {
      const ok = await page.evaluate(async ({ s }) => {
        const ioc = window.ioc
        const history = ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
        const lineage = ioc?.get?.('@hypercomb.social/Lineage')
        const store = ioc?.get?.('@hypercomb.social/Store')
        if (!history || !store) return false
        try {
          const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => s })
          const layer = await history.currentLayerAt(locSig)
          for (const sig of (layer?.decorations ?? [])) {
            const blob = await store.getResource(sig).catch(() => null)
            if (!blob) continue
            const rec = JSON.parse(await blob.text())
            if (rec?.kind === 'view:default' && rec?.payload?.view === 'postit') return true
          }
        } catch { }
        return false
      }, { s: segs })
      if (ok) return named
      await page.waitForTimeout(1000)
    }
    return ''
  }

  try {
    // ── setup: behaviors (marked), plain (hexagons, with a tile inside) ──
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await addTile('behaviors'); await page.waitForTimeout(2000)
    await addTile('plain'); await page.waitForTimeout(2000)
    await go(['plain']); await page.waitForTimeout(2500)
    await addTile('x'); await page.waitForTimeout(2000)
    await go([]); await page.waitForTimeout(2500)

    const rootView = await markLayerDefault()
    check('the root wears a default view', rootView !== '', rootView)
    await go(['behaviors']); await page.waitForTimeout(3000)
    const childView = await markLayerDefault()
    check('behaviors wears a default view', childView !== '', childView)
    await shot('02-marked')

    // ── the practice: marked ⇄ marked ⇄ hexagons ────────────────────────
    await page.evaluate(SAMPLER)
    const legs = [
      { segs: [], name: 'root', face: 'view' },
      { segs: ['behaviors'], name: 'behaviors', face: 'view' },
      { segs: ['plain'], name: 'plain', face: 'hexagons' },
      { segs: ['behaviors'], name: 'behaviors', face: 'view' },
      { segs: [], name: 'root', face: 'view' },
    ]
    const settled = []
    let i = 0
    for (const leg of legs) {
      i++
      await markBeat(`leg-${i}:go`)
      await go(leg.segs)
      await page.waitForTimeout(300)
      await shot(`1${i}-${leg.name}-early`)
      await page.waitForTimeout(2400)
      const st = await page.evaluate(() => ({
        mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
        cells: window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.().length ?? -1,
      }))
      settled.push({ leg: i, name: leg.name, face: leg.face, ...st })
      await markBeat(`leg-${i}:settled`)
      await shot(`1${i}-${leg.name}-settled`)
    }

    const badSettles = settled.filter(l =>
      l.face === 'view' ? l.mode === 'hexagons' : (l.mode !== 'hexagons' || l.cells < 1))
    check('every leg settles on its OWN face — views as views, plain as its hexagon grid',
      badSettles.length === 0, JSON.stringify(settled))

    const log = await page.evaluate(() => window.__practice.log)
    fs.writeFileSync(path.join(out, 'practice-log.json'), JSON.stringify(log, null, 1))
    const samples = log.filter(s => !s.mark)
    const underView = samples.filter(s => s.canvas === 'visible' && s.mode !== 'hexagons')
    check('THE INVARIANT — the canvas is only ever visible while the surface is hexagons',
      underView.length === 0, underView.length + ' leak(s): ' + JSON.stringify(underView.slice(0, 3)))

    // the plain leg's reveal must be the DESTINATION's grid, never a blank
    const marks = log.map((s, idx) => ({ ...s, idx })).filter(s => s.mark)
    const legWindow = (n) => {
      const a = marks.find(m => m.mark === `leg-${n}:go`)
      const b = marks.find(m => m.mark === `leg-${n}:settled`)
      return log.slice(a.idx + 1, b.idx).filter(s => !s.mark)
    }
    const plainReveal = legWindow(3).find(s => s.canvas === 'visible')
    check('the hexagon reveal is never blank — first visible frame already carries the grid',
      !!plainReveal && plainReveal.cells > 0, JSON.stringify(plainReveal ?? 'never revealed'))

    // ── the way out: the PEEL (Escape / the ×) must reach the interface ──
    // (Right-click is a NAVIGATE now — backing out of a face retraces the
    // lineage; at the root it has nowhere to go and the face holds. The
    // deliberate peels are Escape and the view's × — drive Escape.)
    await markBeat('exit')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(2500)
    await shot('20-after-exit')
    const exit = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      cells: window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.snapshotCells?.().length ?? -1,
      canvas: (() => { const c = document.querySelector('#pixi-host canvas'); return c ? getComputedStyle(c).visibility : 'none' })(),
    }))
    check('the exit takes you OUT — hexagons and the interface are reachable again',
      exit.mode === 'hexagons' && exit.canvas === 'visible' && exit.cells > 0, JSON.stringify(exit))
  } finally {
    const real = errors.filter(e => !/Could not initialize shader|favicon|ResizeObserver/i.test(e))
    if (real.length) console.log('\npage errors:\n  ' + real.slice(0, 8).join('\n  '))
    else console.log('\nno page errors')
    console.log('\nshots in ' + out)
    const failed = results.filter(r => !r.ok).length
    console.log(failed ? failed + ' CHECK(S) FAILED' : 'all ' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed ? 1 : 0
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
