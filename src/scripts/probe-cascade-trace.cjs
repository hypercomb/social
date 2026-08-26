#!/usr/bin/env node
// probe-cascade-trace — does a REAL participant action duplicate in the
// activity feed? Drives the real create / remove / undo / nested-create paths
// (the command line, and the feed's own undo arrow), records every
// cell:added / cell:removed delivery with its full payload and emit-site
// stack, and counts the rows in <hc-activity-log>.
//
//   node scripts/probe-cascade-trace.cjs [--url http://localhost:4350] [--headed]
//
// Never emits the effect itself except in the clearly-labelled CONTROL phase at
// the end, which exists only to show what the synthetic path looks like next to
// the real one — and the two are NOT the same route. A synthetic emit is
// flag-less, so LayerCommitter's own listener accepts it and the echo arrives
// from `#commit`'s reconcile; a real create carries `viaUpdate`, the listener
// refuses it, and the echo arrives from `#importTree`'s. Same shape, different
// hop. That is exactly why this exists and why the live gate cannot replace
// it: drive-shrink-phase1.cjs can only reach the synthetic path.
//
// KEEP IT. It is the instrument that settled the question, and the only one
// that can re-settle it. Measured on 2026-08-26, before → after the feed was
// made idempotent (announce transitions, not deliveries):
//
//   real create        2 deliveries   2 rows → 1, undo arrow kept
//   real remove        2 deliveries   2 rows → 1, undo arrow kept
//   real undo          2 deliveries   3 rows → 1, arrowless (the phantom
//                                     "added x" twin, still offering to undo
//                                     an already-undone create, is gone)
//   nested create      4 deliveries   4 rows → 2, one per level
//   synthetic control  2 deliveries   2 rows → 1
//
// Re-run it after any change to layer-committer's reconcile, to the feed's
// handlers, or if the gate ever reports `deliveries=1` — that would mean the
// gate's assertion has gone vacuous and this is the way to find out why.

const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const URL = String(arg('url', 'http://localhost:4350'))
const HEADED = process.argv.includes('--headed')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── the recorder, installed in the page ──────────────────────────────────
async function installRecorder(page) {
  return page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    if (!bus?.on) return { ok: false, why: 'no EffectBus on window' }
    const rec = []
    window.__probe = {
      phase: 'boot',
      events: rec,
      reset() { rec.length = 0 },
    }
    let firstAdded = true
    let firstRemoved = true
    const hook = (name, isFirstRef) => bus.on(name, p => {
      const first = isFirstRef()
      rec.push({
        t: Date.now(),
        phase: window.__probe.phase,
        effect: name,
        replayAtSubscribe: first,
        payload: (() => { try { return JSON.parse(JSON.stringify(p ?? null)) } catch { return String(p) } })(),
        // The emit site. Synchronous emits keep the emitter on the stack.
        stack: (new Error().stack || '').split('\n').slice(2, 8).join(' | '),
      })
    })
    hook('cell:added', () => { const v = firstAdded; firstAdded = false; return v })
    hook('cell:removed', () => { const v = firstRemoved; firstRemoved = false; return v })
    return { ok: true }
  })
}

const setPhase = (page, phase) => page.evaluate(p => {
  window.__probe.phase = p
  window.__probe.reset()
}, phase)

const readEvents = page => page.evaluate(() => window.__probe.events.map(e => ({ ...e })))

// Every .activity-entry row, in DOM order, with its text and whether the row
// carries an undo arrow.
const readRows = page => page.evaluate(() => {
  const host = document.querySelector('hc-activity-log')
  if (!host) return { hostPresent: false, panelPresent: false, rows: [] }
  const panel = host.querySelector('.activity-panel')
  const rows = [...host.querySelectorAll('.activity-entry')].map(el => ({
    text: (el.textContent || '').trim(),
    message: (el.querySelector('.entry-message')?.textContent || '').trim(),
    icon: (el.querySelector('.entry-icon')?.textContent || '').trim(),
    hasUndo: !!el.querySelector('.entry-revert'),
    fading: el.classList.contains('fading'),
  }))
  return { hostPresent: true, panelPresent: !!panel, rows }
})

// Wait for the feed to drain (entries expire after 10s + a 200ms fade).
async function waitFeedEmpty(page, label) {
  for (let i = 0; i < 40; i++) {
    const { rows } = await readRows(page)
    if (rows.length === 0) return true
    await sleep(500)
  }
  console.log(`  [warn] feed did not drain before ${label}`)
  return false
}

/** First boot shows the example-hives offer over everything. Dismiss it the
 *  way a participant does — its own "no thanks" button — so the command line
 *  is reachable. */
async function dismissFirstBootOffer(page) {
  const card = await page.$('hc-example-hives-offer .offer-card, .offer-card')
  if (!card) return { present: false }
  const btn = await page.$('.offer-card .actions button.dismiss')
  if (!btn) return { present: true, dismissed: false, why: 'no .dismiss button' }
  await btn.click()
  await page.waitForSelector('.offer-backdrop', { state: 'detached', timeout: 15000 }).catch(() => {})
  await sleep(1500)
  return { present: true, dismissed: true }
}

async function typeCommand(page, text) {
  const sel = 'hc-command-line input, app-command-line input, input[placeholder*="cell" i], input[type="text"]'
  const handle = await page.$(sel)
  if (!handle) throw new Error('command-line input not found')
  await handle.click({ delay: 40 })
  await handle.fill('')
  await handle.type(text, { delay: 25 })
  await page.keyboard.press('Enter')
}

function report(title, events, rowInfo, extra) {
  console.log('')
  console.log('='.repeat(78))
  console.log(title)
  console.log('='.repeat(78))
  if (extra) console.log(extra)
  console.log(`EFFECT DELIVERIES: ${events.length}`)
  events.forEach((e, i) => {
    const flags = []
    const p = e.payload || {}
    if (p.fromCascade) flags.push('fromCascade')
    if (p.viaUpdate) flags.push('viaUpdate')
    if (p.revive) flags.push('revive')
    if (p.mutationRollback) flags.push('mutationRollback')
    if (e.replayAtSubscribe) flags.push('REPLAY-AT-SUBSCRIBE')
    console.log(`  ${i + 1}. ${e.effect}  flags=[${flags.join(',') || 'none'}]`)
    console.log(`     payload: ${JSON.stringify(e.payload)}`)
    console.log(`     stack:   ${e.stack}`)
  })
  console.log(`ACTIVITY ROWS: ${rowInfo.rows.length}  (panel in DOM: ${rowInfo.panelPresent})`)
  rowInfo.rows.forEach((r, i) => {
    console.log(`  row ${i + 1}: "${r.message}"  icon="${r.icon}"  undoArrow=${r.hasUndo}`)
  })
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await ctx.newPage()

  page.on('pageerror', err => console.log('[pageerror]', String(err).slice(0, 200)))
  page.on('console', m => {
    const t = m.text()
    if (/WebGL|shader|GPU|WEBGL|pixi|PIXI|Unable to create/i.test(t)) return
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console:${m.type()}]`, t.slice(0, 220))
  })

  console.log(`opening ${URL} …`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  // Boot: IoC, EffectBus, the command line, and the activity-log element.
  await page.waitForFunction(() => !!window.ioc && !!window.__hypercombEffectBus, null, { timeout: 60000 })
  await page.waitForSelector('hc-command-line input, app-command-line input, input[type="text"]', { timeout: 60000 })
  await page.waitForFunction(() => !!customElements.get('hc-activity-log'), null, { timeout: 60000 })
  await sleep(3000)

  const boot = await page.evaluate(() => ({
    lineage: (window.ioc.get('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []),
    committer: !!window.ioc.get('@diamondcoreprocessor.com/LayerCommitter'),
    history: !!window.ioc.get('@diamondcoreprocessor.com/HistoryService'),
    activityLogInDom: !!document.querySelector('hc-activity-log'),
    bodyText: document.body.innerText.slice(0, 300),
  }))
  console.log('boot state:', JSON.stringify(boot, null, 2))

  console.log('first-boot offer:', JSON.stringify(await dismissFirstBootOffer(page)))

  const installed = await installRecorder(page)
  console.log('recorder:', JSON.stringify(installed))
  if (!installed.ok) { await browser.close(); process.exit(1) }

  await waitFeedEmpty(page, 'phase 1')

  // ── PHASE 1: REAL CREATE via the command line ─────────────────────────
  await setPhase(page, 'create')
  await typeCommand(page, 'probe-alpha')
  await sleep(4000)
  let events = await readEvents(page)
  let rows = await readRows(page)
  report('PHASE 1 — REAL CREATE (typed "probe-alpha" + Enter in the command line)',
    events, rows)

  await waitFeedEmpty(page, 'phase 2')

  // ── PHASE 2: REAL REMOVE via the command line (~name) ─────────────────
  await setPhase(page, 'remove')
  await typeCommand(page, '~probe-alpha')
  await sleep(4000)
  events = await readEvents(page)
  rows = await readRows(page)
  report('PHASE 2 — REAL REMOVE (typed "~probe-alpha" + Enter)', events, rows)

  await waitFeedEmpty(page, 'phase 3')

  // ── PHASE 3: REAL UNDO of a create — press the feed's own ↩ arrow ─────
  await setPhase(page, 'undo-create:setup')
  await typeCommand(page, 'probe-beta')
  await sleep(4000)
  const setupRows = await readRows(page)
  console.log('')
  console.log('PHASE 3 setup — created "probe-beta"; rows now:',
    JSON.stringify(setupRows.rows.map(r => `${r.message}${r.hasUndo ? ' [↩]' : ''}`)))

  await setPhase(page, 'undo-create')
  const clicked = await page.evaluate(() => {
    const host = document.querySelector('hc-activity-log')
    const rows = [...(host?.querySelectorAll('.activity-entry') ?? [])]
    const target = rows.find(r =>
      (r.querySelector('.entry-message')?.textContent || '').includes('probe-beta')
      && r.querySelector('.entry-revert'))
    if (!target) return { ok: false, why: 'no row for probe-beta with an undo arrow' }
    target.querySelector('.entry-revert').click()
    return { ok: true, text: (target.textContent || '').trim() }
  })
  console.log('PHASE 3 undo click:', JSON.stringify(clicked))
  await sleep(4000)
  events = await readEvents(page)
  rows = await readRows(page)
  report('PHASE 3 — REAL UNDO of a create (clicked the feed row\'s ↩ arrow)',
    events, rows, `undo arrow click: ${JSON.stringify(clicked)}`)

  await waitFeedEmpty(page, 'phase 4')

  // ── PHASE 4: REAL NESTED CREATE — two levels in one importTree ────────
  // The interesting case for "is fromCascade ever the ONLY signal?": the
  // reconcile runs once per affected path, so root, /probe-nest and
  // /probe-nest/leaf each diff their children.
  await setPhase(page, 'nested-create')
  await typeCommand(page, 'probe-nest/leaf')
  await sleep(5000)
  events = await readEvents(page)
  rows = await readRows(page)
  report('PHASE 4 — REAL NESTED CREATE (typed "probe-nest/leaf" + Enter)', events, rows)

  // Is any (effect, cell, segments) triple delivered ONLY with fromCascade?
  const byKey = new Map()
  for (const e of events) {
    const p = e.payload || {}
    const key = `${e.effect}|${p.cell}|${JSON.stringify(p.segments ?? null)}`
    const seen = byKey.get(key) ?? { total: 0, cascade: 0 }
    seen.total++
    if (p.fromCascade) seen.cascade++
    byKey.set(key, seen)
  }
  console.log('')
  console.log('fromCascade-ONLY deliveries in phase 4 (would be LOST by a flag filter):')
  let anyCascadeOnly = false
  for (const [key, v] of byKey) {
    const only = v.total === v.cascade
    if (only) anyCascadeOnly = true
    console.log(`  ${key}  total=${v.total} cascade=${v.cascade}${only ? '   <-- CASCADE-ONLY' : ''}`)
  }
  console.log(`  => cascade-only deliveries present: ${anyCascadeOnly}`)

  await waitFeedEmpty(page, 'control')

  // ── CONTROL: the synthetic emit, for comparison only ──────────────────
  await setPhase(page, 'control-synthetic')
  await page.evaluate(() => window.__hypercombEffectBus.emit('cell:added', { cell: 'probe-control' }))
  await sleep(4000)
  events = await readEvents(page)
  rows = await readRows(page)
  report('CONTROL — synthetic bus.emit(\'cell:added\', { cell: \'probe-control\' }) — NOT a real path',
    events, rows)

  // Final state of the tree, so we know the real ops actually did something.
  const finalTree = await page.evaluate(async () => {
    const history = window.ioc.get('@diamondcoreprocessor.com/HistoryService')
    const lineage = window.ioc.get('@hypercomb.social/Lineage')
    if (!history || !lineage) return { ok: false }
    const segs = lineage.explorerSegments?.() ?? []
    const locSig = await history.sign({ domain: lineage.domain, explorerSegments: () => segs })
    const layer = await history.currentLayerAt(locSig)
    const kids = Array.isArray(layer?.children) ? layer.children : []
    const names = []
    for (const s of kids) { const c = await history.getLayerBySig(String(s)); if (c?.name) names.push(c.name) }
    return { ok: true, segments: segs, childNames: names }
  })
  console.log('')
  console.log('FINAL ROOT CHILDREN:', JSON.stringify(finalTree))

  await browser.close()
}

main().catch(err => { console.error('FAILED:', err); process.exit(1) })
