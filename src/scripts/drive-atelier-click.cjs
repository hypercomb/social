#!/usr/bin/env node
// drive-atelier-click — Jaime's exact gesture: the ROOT opens as the
// Revolución welcome atelier, the "behaviors" child opens as post-it, and
// clicking the behaviors PLATE from INSIDE the atelier must behave exactly
// like clicking the tile on the canvas: navigate on the one road, and the
// destination's OWN face renders — instantly, with nothing in between.
//
//   node scripts/drive-atelier-click.cjs [--url http://localhost:4253]
//                                        [--out <dir>] [--engine chrome]
//
// This is the click-path contract: THE TILE HAS A CLICK, and the same click
// is used no matter what view it is rendered in. A view may only SUGGEST its
// own child presentation (the room) for a destination that declares no face.

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
        canvas: canvas ? getComputedStyle(canvas).visibility : 'none',
        cells: sc?.snapshotCells?.().length ?? -1,
      })
    } catch (e) { log.push({ t: Date.now(), err: String(e).slice(0, 80) }) }
  }, 60)
})()`

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const out = path.resolve(String(arg('out', 'test-results/atelier-click')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const go = (segs) => page.evaluate((s) => {
    window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s)
  }, segs)
  const addTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)

  // Deposit a behavior kind + make its view the layer's default, all through
  // the same intents the panel states, then VERIFY the mark from the layer.
  async function dressLayer(segs, kind, view) {
    await page.evaluate(({ s, k, v }) => {
      const cell = s.length ? s[s.length - 1] : '/'
      window.__hypercombEffectBus?.emit?.('features:enable', { cell, segments: s, kind: k })
      window.__hypercombEffectBus?.emit?.('features:default', { cell, segments: s, view: v, clear: false })
    }, { s: segs, k: kind, v: view })
    for (let attempt = 0; attempt < 8; attempt++) {
      const ok = await page.evaluate(async ({ s, v }) => {
        const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
        const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
        const store = window.ioc?.get?.('@hypercomb.social/Store')
        if (!history || !store) return false
        try {
          const locSig = await history.sign({ domain: lineage?.domain, explorerSegments: () => s })
          const layer = await history.currentLayerAt(locSig)
          for (const sig of (layer?.decorations ?? [])) {
            const blob = await store.getResource(sig).catch(() => null)
            if (!blob) continue
            const rec = JSON.parse(await blob.text())
            if (rec?.kind === 'view:default' && rec?.payload?.view === v) return true
          }
        } catch { }
        return false
      }, { s: segs, v: view })
      if (ok) return true
      await page.waitForTimeout(1000)
    }
    return false
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await addTile('behaviors'); await page.waitForTimeout(2500)

    check('the root wears the atelier (revolucion-welcome) as its face',
      await dressLayer([], 'visual:revolucion:welcome', 'revolucion-welcome'))
    await go(['behaviors']); await page.waitForTimeout(2500)
    check('behaviors wears post-it as its face',
      await dressLayer(['behaviors'], 'visual:postit:note', 'postit'))

    // land on the root THE ARRIVAL WAY and let the atelier come up
    await go([]); await page.waitForTimeout(3500)
    const atRoot = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      plates: document.querySelectorAll('.hc-welcome-view .wv-plate').length,
    }))
    check('arriving at the root opens the atelier with the behaviors plate on the wall',
      atRoot.mode === 'revolucion-welcome' && atRoot.plates >= 1, JSON.stringify(atRoot))
    await shot('01-atelier')

    // ── THE CLICK — same click as the canvas tile, from inside the view ──
    await page.evaluate(SAMPLER)
    await page.evaluate(() => window.__practice?.mark('click'))
    await page.locator('.hc-welcome-view .wv-plate').first().click()
    await page.waitForTimeout(600)
    await shot('02-just-after-click')
    await page.waitForTimeout(2900)
    await shot('03-settled')

    const after = await page.evaluate(() => ({
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? '',
      segs: window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
      log: window.__practice.log,
    }))
    fs.writeFileSync(path.join(out, 'click-log.json'), JSON.stringify(after.log, null, 1))
    check('the plate click lands at behaviors', JSON.stringify(after.segs) === '["behaviors"]',
      JSON.stringify(after.segs))
    check("behaviors opens as ITS OWN face — the tile's mark wins over the view's room",
      after.mode === 'postit', 'mode=' + after.mode)
    const samples = after.log.filter(s => !s.mark)
    const hexFlash = samples.filter(s => s.mode === 'hexagons')
    check('nothing gets in the way — the surface never touches hexagons across the click',
      hexFlash.length === 0, hexFlash.length + ' hexagon sample(s)')
    const leak = samples.filter(s => s.canvas === 'visible' && s.mode !== 'hexagons')
    check('THE INVARIANT — no tiles peek out from under any view', leak.length === 0,
      leak.length + ' leak(s)')
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
