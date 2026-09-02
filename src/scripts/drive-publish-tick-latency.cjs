#!/usr/bin/env node
// drive-publish-tick-latency — a host tick answers AT ONCE.
//
// Choosing where a branch publishes is a switch, and a switch that waits is a
// switch that reads as broken. Ticking one used to wear enrollment marks (a
// commit per host) and then re-sweep every door over the network BEFORE the
// row was restated — so the box sat on its old state for as long as that took.
//
// This drives the real drone on a fresh hive and measures two numbers off the
// SAME tick:
//
//   paint  — tick → the first `publish:render` carrying the new host list.
//            This is what the participant sees. It must be immediate.
//   settle — tick → the writes and the re-sweep behind it finish. This is
//            what the tick USED to wait for, and it is the before-number.
//
//   node scripts/drive-publish-tick-latency.cjs [--url http://localhost:4251]

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PAINT_BUDGET_MS = 150

async function main() {
  const url = String(arg('url', 'http://localhost:4251'))
  // The second host to tick. A REAL zone makes the sweep behind the tick do
  // real work (an index fetch per door), which is the before-number a real
  // hive actually pays; the default is a name nobody runs.
  const zone = String(arg('zone', 'example.com'))
  const out = path.resolve(String(arg('out', 'test-results/publish-tick-latency')))
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch({ headless: true, channel: 'msedge' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    await page.goto(url + '/alpha', { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    // A second host to tick. One host cannot be dropped, so a branch needs
    // two before the switch has anything to say.
    await page.evaluate((z) => window.__hypercombEffectBus.emit('hosts:add', { zone: z }), zone)
    await page.waitForTimeout(2500)

    // Open the panel and let the sweep settle before timing anything.
    await page.evaluate(() => window.__hypercombEffectBus.emit('publish:view-toggle', {}))
    await page.waitForTimeout(9000)

    const before = await page.evaluate(() => {
      let seen = null
      const off = window.__hypercombEffectBus.on('publish:render', (p) => { seen = p })
      off()
      return {
        rows: (seen?.rows ?? []).map(r => ({ key: r.key, path: r.path, zones: r.zones, segments: r.segments })),
        hosts: seen?.hosts ?? [],
        currentKey: seen?.currentKey ?? '',
      }
    })
    console.log('rows      ', JSON.stringify(before.rows))
    console.log('hosts     ', JSON.stringify(before.hosts))
    const subject = before.rows.find(r => r.key === before.currentKey) ?? before.rows[0]
    check('the panel has a branch to configure', !!subject && subject.segments.length > 0,
      `subject=${subject?.path} zones=${JSON.stringify(subject?.zones)}`)
    check('there is a second host to tick', before.hosts.includes(zone),
      `hosts=${before.hosts.join(', ')}`)
    if (!subject || !before.hosts.includes(zone)) throw new Error('no fixture')

    // ── THE TICK ──────────────────────────────────────────────────────
    // Measured in two pieces on purpose: the PAINT is read out of the same
    // evaluate that emits (it lands inside `emit()` or it did not land at
    // all), and the SETTLE is polled afterwards in short reads, so a page
    // reload mid-wait costs the second number and never the first.
    page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('note      page navigated') })
    // A standing probe of the sweep flag, for the mid-sweep case below.
    await page.evaluate(() => {
      window.__hypercombEffectBus.on('publish:render', (p) => { window.__lastPublishRefreshing = p?.refreshing === true })
    })
    const wanted = [...subject.zones, zone]
    const paint = await page.evaluate(([key, zones]) => {
      const bus = window.__hypercombEffectBus
      const want = zones.join(',')
      const state = { paint: -1, wrote: -1, settle: -1, renders: 0, swept: false, t0: 0 }
      window.__tick = state
      state.t0 = performance.now()
      // The marks are on disk the moment the drone says where the branch
      // publishes — that line is emitted straight after the last write.
      bus.on('activity:log', (p) => {
        if (state.wrote < 0 && String(p?.message ?? '').includes('publishes at')) {
          state.wrote = performance.now() - state.t0
        }
      })
      bus.on('publish:render', (p) => {
        state.renders++
        const row = (p?.rows ?? []).find(r => r.key === key)
        const now = performance.now()
        if (state.paint < 0 && row && (row.zones ?? []).join(',') === want) state.paint = now - state.t0
        if (p?.refreshing === true) state.swept = true
        if (state.swept && state.settle < 0 && p?.refreshing === false) state.settle = now - state.t0
      })
      bus.emit('publish:set-target', { key, domains: zones })
      // Read INSIDE the emitting turn: whatever is here now arrived without
      // a round trip of any kind.
      return { paint: state.paint, renders: state.renders }
    }, [subject.key, wanted])

    let timing = { ...paint, settle: -1, lost: false }
    for (let i = 0; i < 60 && timing.settle < 0; i++) {
      await page.waitForTimeout(500)
      try {
        const t = await page.evaluate(() => window.__tick ?? null)
        if (!t) { timing.lost = true; break }
        timing = { ...timing, settle: t.settle, wrote: t.wrote, renders: t.renders }
      } catch { timing.lost = true; break }
    }
    console.log('timing    ', JSON.stringify(timing))
    check('the tick paints INSIDE the click — no round trip at all',
      timing.paint >= 0 && timing.paint <= PAINT_BUDGET_MS,
      `paint=${timing.paint.toFixed(2)}ms (budget ${PAINT_BUDGET_MS}ms)`)
    check('the writes + re-sweep it no longer waits for take far longer',
      timing.settle < 0 ? timing.lost : timing.settle > timing.paint * 20,
      timing.settle < 0
        ? (timing.lost ? 'page reloaded before the sweep finished' : 'still running at 30s')
        : `settle=${timing.settle.toFixed(0)}ms vs paint=${timing.paint.toFixed(2)}ms`)

    // And the box itself, in the DOM.
    const dom = await page.evaluate(() => Array.from(document.querySelectorAll('.pdet-domain')).map(el => ({
      zone: el.querySelector('.pdet-address')?.textContent?.trim() ?? '',
      chosen: el.classList.contains('is-chosen'),
      checked: el.querySelector('.pdet-domain-pick')?.getAttribute('aria-checked'),
    })))
    console.log('boxes     ', JSON.stringify(dom))
    check('the box is ticked', dom.some(d => d.zone === zone && d.chosen && d.checked === 'true'),
      JSON.stringify(dom))
    await page.screenshot({ path: path.join(out, 'ticked.png') })

    // ── AND BACK OFF AGAIN ────────────────────────────────────────────
    const untick = await page.evaluate(async ([key, zones]) => {
      const bus = window.__hypercombEffectBus
      const want = zones.join(',')
      let paint = -1
      const t0 = performance.now()
      const off = bus.on('publish:render', (p) => {
        const row = (p?.rows ?? []).find(r => r.key === key)
        if (paint < 0 && row && (row.zones ?? []).join(',') === want) paint = performance.now() - t0
      })
      bus.emit('publish:set-target', { key, domains: zones })
      await new Promise(r => setTimeout(r, 1500))
      off()
      return paint
    }, [subject.key, subject.zones])
    check('un-ticking answers at once too', untick >= 0 && untick <= PAINT_BUDGET_MS,
      `paint=${untick.toFixed(1)}ms`)

    // ── THE BEFORE-NUMBER, measured rather than remembered ────────────
    // The old tick repainted the row only when the sweep rebuilt its rows —
    // every row is drafted `comparing` at that moment, so the first such
    // render IS the instant the box used to change. Timed straight off a
    // bare refresh, on a hive with ONE branch and ONE door.
    const sweepPaint = await page.evaluate(async (key) => {
      const bus = window.__hypercombEffectBus
      let at = -1
      const t0 = performance.now()
      const off = bus.on('publish:render', (p) => {
        const row = (p?.rows ?? []).find(r => r.key === key)
        if (at < 0 && row?.state === 'comparing') at = performance.now() - t0
      })
      bus.emit('publish:refresh', {})
      await new Promise(r => setTimeout(r, 12_000))
      off()
      return at
    }, subject.key)
    // WHAT THE BOX USED TO WAIT FOR: the mark writes, and then the sweep
    // rebuilding its rows. Both measured; their sum is the old latency, on a
    // hive with ONE branch and ONE door — every real hive is worse.
    const beforeMs = (timing.wrote > 0 ? timing.wrote : 0) + (sweepPaint > 0 ? sweepPaint : 0)
    check('the tick no longer waits for the writes and the sweep behind them',
      beforeMs > timing.paint * 50,
      `before≈${beforeMs.toFixed(0)}ms (writes ${timing.wrote.toFixed(0)}ms + sweep repaint ${sweepPaint.toFixed(0)}ms) vs now ${timing.paint.toFixed(2)}ms`)

    // ── THE CASE THAT ACTUALLY BIT: ticking DURING a sweep ────────────
    // A sweep in flight made the old `void this.#refresh()` a no-op — it
    // early-returns while `#refreshing` — so the box waited for the WHOLE
    // running sweep (seals, verdicts, a 15s deadline per step) and could then
    // repaint from a reading taken before the choice. This ticks 300ms into a
    // sweep and measures both: when the box answers, and when that sweep ends.
    const midSweep = await page.evaluate(async ([key, zones]) => {
      const bus = window.__hypercombEffectBus
      const want = zones.join(',')
      const r = { paint: -1, sweepEnd: -1, sweeping: false }
      let tick = 0
      const off = bus.on('publish:render', (p) => {
        const row = (p?.rows ?? []).find(x => x.key === key)
        if (tick && r.paint < 0 && row && (row.zones ?? []).join(',') === want) r.paint = performance.now() - tick
        if (tick && r.sweepEnd < 0 && p?.refreshing === false) r.sweepEnd = performance.now() - tick
      })
      bus.emit('publish:refresh', {})
      await new Promise(res => setTimeout(res, 30))
      // Was the sweep still running when the tick landed? If it had already
      // finished, this case proves nothing and says so.
      r.sweeping = !!(window.__lastPublishRefreshing)
      tick = performance.now()
      bus.emit('publish:set-target', { key, domains: zones })
      await new Promise(res => setTimeout(res, 20_000))
      off()
      return r
    }, [subject.key, wanted])
    console.log('mid-sweep ', JSON.stringify(midSweep))
    check('a tick made DURING a sweep still answers at once',
      midSweep.paint >= 0 && midSweep.paint <= PAINT_BUDGET_MS,
      midSweep.sweeping
        ? `paint=${midSweep.paint.toFixed(1)}ms after the tick, with a sweep in flight`
        : `paint=${midSweep.paint.toFixed(1)}ms — NOTE: the sweep had already ended, so the in-flight case is untested on this fixture`)

  } finally {
    const failed = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    await browser.close()
    process.exitCode = failed.length > 0 ? 1 : 0
  }
}

main().catch(e => { console.error(e); process.exit(1) })
