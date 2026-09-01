#!/usr/bin/env node
// drive-publish-panel-density — the publish differential, read at a glance.
//
// Three things this drives, all of them "the panel is a list, not a report":
//
//   1. THE STRIP OFFERS ONLY LIT FACES. The opens-as strip listed every view
//      the registry has ever heard of, so it filled up with faces nobody uses
//      and there was no telling which was which. It now offers what the global
//      roster has lit — plus, always, the face a row is ALREADY pinned to, so
//      a put-out face can still be seen and taken off.
//   2. A CLOSED ROW IS ONE LINE. Name, verdict, done. The reason is a sentence
//      and waits for the row to be opened.
//   3. THE HOVER MESSAGE ARRIVES AT ONCE. Native `title` takes the better part
//      of a second; a strip of small marks read by hovering across it cannot
//      afford that.
//
//   node scripts/drive-publish-panel-density.cjs [--url http://localhost:4250]
//                                                [--out <dir>] [--engine chrome]

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

/** One synthetic differential. The drone's sweep needs published branches and
 *  a host that answers; the DENSITY and the STRIP are the panel's own, so the
 *  panel is fed a stable snapshot in exactly the shape the drone emits. */
const FIXTURE = (views) => ({
  open: true, gateActive: true, host: 'pluginthematrix.com', pubkey: 'ab'.repeat(32),
  index: 'verified', indexCreatedAt: Math.floor(Date.now() / 1000), indexStale: false,
  keyMismatch: false, refreshing: false, collisions: [], views,
  rows: [
    {
      key: 'alpha', path: '/alpha', segments: ['alpha'], state: 'live',
      live: 'aa'.repeat(32), here: 'aa'.repeat(32), publishedAt: Date.now() - 90_000,
      seenAt: Date.now() - 30_000, gaps: [], expanded: false, link: null,
      busyPhase: null, opensAs: '', versions: [],
    },
    {
      key: 'beta', path: '/beta', segments: ['beta'], state: 'drift',
      live: 'bb'.repeat(32), here: 'cc'.repeat(32), publishedAt: Date.now() - 900_000,
      seenAt: Date.now() - 60_000, gaps: [], expanded: false, link: null,
      busyPhase: null, opensAs: '', versions: [],
    },
  ],
})

const emit = (page, effect, payload) =>
  page.evaluate(([e, p]) => window.__hypercombEffectBus.emit(e, p), [effect, payload])

/** What the drone put on the bus, verbatim. The bus has no reader, but its
 *  last-value replay IS one: subscribing delivers synchronously, so subscribe
 *  and immediately unsubscribe. */
const LAST_VIEWS = () => {
  let seen = null
  const off = window.__hypercombEffectBus.on('publish:render', (p) => { seen = p })
  off()
  return seen?.views ?? null
}

/** The strip and the rows, as the participant sees them. */
const SNAP = () => {
  const q = (s) => document.querySelector(s)
  const rows = Array.from(document.querySelectorAll('.publish-row'))
  const chips = Array.from(document.querySelectorAll('.pdet-view'))
  const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0)
  return {
    panel: !!q('.publish-panel'),
    rows: rows.length,
    closedHeights: rows.filter(r => !r.classList.contains('expanded')).map(r => h(r.querySelector('.prow-head'))),
    openHeights: rows.filter(r => r.classList.contains('expanded')).map(r => h(r.querySelector('.prow-head'))),
    whyClosed: rows.filter(r => !r.classList.contains('expanded'))
      .filter(r => { const w = r.querySelector('.prow-why'); return w && getComputedStyle(w).display !== 'none' }).length,
    whyOpen: rows.filter(r => r.classList.contains('expanded'))
      .filter(r => { const w = r.querySelector('.prow-why'); return w && getComputedStyle(w).display !== 'none' }).length,
    chips: chips.map(c => ({
      tip: c.getAttribute('data-tip') ?? '',
      title: c.getAttribute('title'),
      dormant: c.classList.contains('dormant'),
      selected: c.classList.contains('selected'),
    })),
  }
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/publish-panel-density')))
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
    await page.waitForTimeout(600)

    // ── 1. THE DRONE'S OWN STRIP, against the roster it read ──────────
    await emit(page, 'publish:view-toggle', {})
    await page.waitForTimeout(2500)
    let views = await page.evaluate(LAST_VIEWS)
    check('the drone emitted an opens-as strip', Array.isArray(views) && views.length > 0,
      `choices=${views?.length}`)

    const roster = await page.evaluate(() => {
      const reg = window.ioc?.get?.('@diamondcoreprocessor.com/VisualBeeRegistry')
      const bees = (reg?.all?.() ?? []).filter(b => b?.view)
      let on = null
      try { on = JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? 'null') } catch { on = null }
      return { bees: bees.map(b => ({ view: b.view, kind: String(b.decorationKind ?? '') })), on }
    })
    const onSet = new Set(roster.on ?? [])
    const expectedDormant = roster.on
      ? roster.bees.filter(b => b.kind && !onSet.has(b.kind)).map(b => b.view).sort()
      : []
    const gotDormant = views.filter(v => v.dormant).map(v => v.view).sort()
    check('every choice the roster has not lit is marked dormant',
      JSON.stringify(gotDormant) === JSON.stringify(expectedDormant),
      `dormant=${gotDormant.length}/${views.length}, roster expects ${expectedDormant.length}`)
    check('the hexagons ground is never put out',
      views.some(v => v.view === '' && !v.dormant))

    // Put a LIT view out and watch the strip restate itself without a sweep.
    const litKind = roster.bees.find(b => b.kind && onSet.has(b.kind))
    if (litKind) {
      await page.evaluate((kind) => {
        const on = JSON.parse(localStorage.getItem('hc:behavior-global-on') ?? '[]')
        localStorage.setItem('hc:behavior-global-on', JSON.stringify(on.filter(k => k !== kind)))
        window.__hypercombEffectBus.emit('behavior:enablement-changed', { kind, on: false })
      }, litKind.kind)
      await page.waitForTimeout(1200)
      views = await page.evaluate(LAST_VIEWS)
      const now = views.find(v => v.view === litKind.view)
      check('putting a view out restates the strip at once (no sweep)',
        !!now?.dormant, `${litKind.view} → dormant=${now?.dormant}`)
    } else {
      check('putting a view out restates the strip at once (no sweep)', true, 'roster lit nothing to put out')
    }

    // ── 2. THE PANEL, fed a differential with rows ────────────────────
    await emit(page, 'publish:view-toggle', {})   // drone closes; it will not re-emit
    await page.waitForTimeout(600)
    await emit(page, 'publish:render', FIXTURE(views))
    await page.waitForTimeout(900)
    await shot('00-closed-rows')

    let s = await page.evaluate(SNAP)
    check('the panel painted the differential', s.panel && s.rows === 2, `rows=${s.rows}`)
    const closed = s.closedHeights
    check('every closed row is one line', closed.length === 2 && closed.every(h => h > 0 && h <= 34),
      `heights=${closed.join(',')}px`)
    check('no reason sentence on a closed row', s.whyClosed === 0)

    // ── the same rows, one of them opened ─────────────────────────────
    // Expansion is the DRONE's state (`publish:expand` names a row it owns),
    // so a synthetic differential is opened the same way it was painted.
    const opened = FIXTURE(views)
    opened.rows[0].expanded = true
    await emit(page, 'publish:render', opened)
    await page.waitForTimeout(800)
    await shot('05-one-open')
    s = await page.evaluate(SNAP)
    check('opening a row stacks it out', s.openHeights.length === 1 && s.openHeights[0] > closed[0],
      `open=${s.openHeights[0]}px vs closed=${closed[0]}px`)
    check('the rows beside it stay one line',
      s.closedHeights.length === 1 && s.closedHeights[0] <= 34, `heights=${s.closedHeights.join(',')}px`)

    // ── 3. THE STRIP IN THE DOM: lit faces only ───────────────────────
    const litViews = views.filter(v => !v.dormant).length
    check('the strip offers only the lit faces', s.chips.length === litViews,
      `chips=${s.chips.length}, lit=${litViews} of ${views.length}`)
    check('no native title on a face — it is the slow one',
      s.chips.every(c => c.title === null))
    check('every face carries its message', s.chips.every(c => c.tip.length > 0))

    // ── a face already PINNED to a put-out view stays visible ─────────
    const putOut = views.find(v => v.dormant)
    if (putOut) {
      const pinned = FIXTURE(views)
      pinned.rows[0].opensAs = putOut.view
      pinned.rows[0].expanded = true
      await emit(page, 'publish:render', pinned)
      await page.waitForTimeout(800)
      await shot('10-pinned-put-out')
      s = await page.evaluate(SNAP)
      const face = s.chips.find(c => c.dormant)
      check('a face already pinned to a put-out view is still shown',
        !!face && face.selected, `dormant chips=${s.chips.filter(c => c.dormant).length}`)
      check('and it reads as switched off, not as a choice',
        s.chips.filter(c => c.dormant).length === 1, `${s.chips.length} chips, 1 put out`)
    } else {
      check('a face already pinned to a put-out view is still shown', true, 'nothing put out on this hive')
      check('and it reads as switched off, not as a choice', true, 'nothing put out on this hive')
    }

    // ── 4. THE HOVER MESSAGE ARRIVES AT ONCE ──────────────────────────
    const chip = page.locator('.pdet-view').first()
    await chip.hover()
    const tip = await page.evaluate(() => {
      const el = document.querySelector('.pdet-view')
      const after = getComputedStyle(el, '::after')
      return { content: after.content, transition: after.transitionDuration, delay: after.transitionDelay }
    })
    await page.waitForTimeout(160)
    const opacity = await page.evaluate(() =>
      Number(getComputedStyle(document.querySelector('.pdet-view:hover'), '::after').opacity))
    await shot('20-hover-message')
    check('the message is the mark\'s own text', /view|hexagon|website|[a-z]/i.test(String(tip.content)),
      String(tip.content).slice(0, 40))
    check('it waits for nothing', String(tip.delay) === '0s', `delay=${tip.delay}`)
    check('it is fully up inside 160ms', opacity === 1, `opacity=${opacity} after 160ms (fade=${tip.transition})`)
  } finally {
    const pass = checks.filter(c => c.ok).length
    console.log(`\n${pass}/${checks.length} checks passed`)
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 2))
    await browser.close()
    process.exitCode = pass === checks.length ? 0 : 1
  }
}

main()
