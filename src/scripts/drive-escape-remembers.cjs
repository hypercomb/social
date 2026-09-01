#!/usr/bin/env node
// drive-escape-remembers — ESCAPE IS A DOOR THAT SWINGS BOTH WAYS.
//
// Escape means "show me the hexagons again" and it always has. What it did NOT
// do was let you take that back: a press you did not mean cost you the panel
// you had open or the selection you had built up, and the only way back was to
// go and open it again by hand.
//
// So the cascade now remembers the last thing it took away, and a press that
// finds nothing left to take gives that thing back. This drives the whole
// swing, on the windows a participant opens by typing a command:
//
//     press  → the hexagons
//     press  → what was up, back exactly as it was
//     press  → the hexagons again
//
// and the same swing on a SELECTION, which is the most expensive thing a
// stray press used to cost.
//
// A SEPARATE BROWSER PROFILE, always. The packed store admits one writer, and
// a second tab on an origin whose hive is already open comes up with a dead
// store — so this never points the in-app browser pane at 4250.
//
//   node scripts/drive-escape-remembers.cjs [--url http://localhost:4250]
//                                           [--out <dir>] [--engine chrome]

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

/** Wait until the runtime is actually there before speaking to it. A dev
 *  server recompiling under the run live-reloads the page, and the bus comes
 *  back undefined for a few seconds — which reads as a failing check when
 *  nothing is wrong. Ask, don't assume. (Same helper as
 *  drive-escape-to-hexagons.cjs, and the same trap.) */
const ready = async (page) => {
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 60000 })
}

const submit = async (page, text) => {
  await ready(page)
  await page.evaluate(t => window.__hypercombEffectBus.emit('command-line:remote-submit', { text: t }), text)
}

const press = async (page) => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

/** Wait for a panel to be there / not be there, rather than sleeping a fixed
 *  amount and hoping. This app repaints a hive under the press, and a flat
 *  wait long enough for the slow case would spend the "immediately after"
 *  window the toggle is being tested for. */
const settle = async (page, id, want, timeout = 1500) => {
  const started = Date.now()
  for (;;) {
    if (((await page.locator(sel(id)).count()) > 0) === want) return true
    if (Date.now() - started >= timeout) return false
    await page.waitForTimeout(100)
  }
}

/** Addressed by `hcDockedPanel` id — that id IS the window's name to the lane
 *  and the session, so a panel that renames its CSS cannot drop out of here. */
const CASES = [
  { command: '/tutorial', id: 'tutorials-window', name: 'tutorials' },
  { command: '/tags', id: 'tags-viewer', name: 'tags' },
  { command: '/sequence', id: 'sequence-viewer', name: 'arrangements' },
]
const sel = (id) => `[hcdockedpanel="${id}"]`

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/escape-remembers')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()

  const checks = []
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    for (let i = 0; i < 8; i++) {
      if (!(await page.locator('.offer-backdrop').count())) break
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) await startEmpty.first().click({ force: true }).catch(() => {})
      const dismiss = page.locator('hc-example-hives-offer .dismiss')
      if (await dismiss.count()) await dismiss.first().click({ force: true }).catch(() => {})
      await page.waitForTimeout(900)
    }
    await press(page)

    for (const c of CASES) {
      await submit(page, c.command)
      await page.waitForSelector(sel(c.id), { timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(500)
      if (!(await page.locator(sel(c.id)).count())) {
        check(`${c.name}: opens with ${c.command}`, false, 'never appeared — skipped')
        continue
      }

      // ONE press. Not "eventually gone after a few" — the window is up, the
      // key means show me the tiles, and the whole screen goes at once. Its
      // inner state is not lost by skipping the old ladder: the sweep parks.
      await press(page)
      const gone = await settle(page, c.id, false)
      check(`${c.name}: ONE press puts the hexagons back`, gone)
      if (!gone) {
        await page.screenshot({ path: path.join(out, `stuck-${c.name}.png`) })
        await submit(page, c.command)
        await page.waitForTimeout(1200)
        continue
      }

      await press(page)
      const back = await settle(page, c.id, true)
      check(`${c.name}: the next press brings it back`, back)

      await press(page)
      const goneAgain = await settle(page, c.id, false)
      check(`${c.name}: and the one after takes it away again`, goneAgain)
      if (!goneAgain) {
        await page.screenshot({ path: path.join(out, `stuck-again-${c.name}.png`) })
        await submit(page, c.command)
        await page.waitForTimeout(1200)
      }
    }

    // ── IMMEDIATELY, AND ONLY THEN ────────────────────────────────────
    // The put-back is for the press you make because the last one was a
    // mistake. A press that comes after a pause, or after you have done
    // anything else at all, is about something else and must find nothing.
    const late = CASES[0]
    await submit(page, late.command)
    await page.waitForSelector(sel(late.id), { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(500)
    if (await page.locator(sel(late.id)).count()) {
      await press(page)
      await settle(page, late.id, false)
      await page.waitForTimeout(4000)
      await press(page)
      check('a press that comes late gives nothing back',
        !(await settle(page, late.id, true, 900)))

      await submit(page, late.command)
      await settle(page, late.id, true)
      await press(page)
      await settle(page, late.id, false)
      await page.mouse.click(700, 500)          // anything else at all
      await page.waitForTimeout(150)
      await press(page)
      check('a press after you have done something else gives nothing back',
        !(await settle(page, late.id, true, 900)))
    } else {
      check('a press that comes late gives nothing back', false, `${late.name} never reopened`)
    }

    // ── the selection swings too ──────────────────────────────────────
    // Seeded through the service the cascade itself asks, which is the whole
    // path under test: clear on the way out, put back by name on the way in.
    await ready(page)
    const seed = ['alpha-tile', 'beta-tile']
    const count = () => page.evaluate(() =>
      window.ioc?.get('@diamondcoreprocessor.com/SelectionService')?.count ?? -1)
    const names = () => page.evaluate(() =>
      [...(window.ioc?.get('@diamondcoreprocessor.com/SelectionService')?.selected ?? [])])

    await page.evaluate(labels => {
      const svc = window.ioc?.get('@diamondcoreprocessor.com/SelectionService')
      svc?.clear()
      for (const l of labels) svc?.add(l)
    }, seed)
    await page.waitForTimeout(300)
    check('a selection is standing', (await count()) === seed.length, String(await count()))

    await press(page)
    check('Escape clears it', (await count()) === 0)

    await press(page)
    const backNames = await names()
    check('the next press gives it back, tile for tile',
      backNames.length === seed.length && seed.every(s => backNames.includes(s)),
      backNames.join(',') || 'nothing')

    await press(page)
    check('and the one after clears it again', (await count()) === 0)

    // ── and the slot is SPENT, not sticky ─────────────────────────────
    // One press back, not every press after. The last put-back emptied the
    // slot, so a press that finds nothing taken must leave the hive alone —
    // the selection is dropped HERE by hand, not by this key, precisely so
    // the press below has nothing of its own to remember.
    await press(page)                                   // gives it back, slot spent
    await page.evaluate(() => window.ioc?.get('@diamondcoreprocessor.com/SelectionService')?.clear())
    await page.waitForTimeout(300)
    await press(page)
    const panels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[hcdockedpanel]')).map(el => el.getAttribute('hcdockedpanel')))
    check('a press with an empty slot leaves the hexagons alone',
      (await count()) === 0 && panels.length === 0, panels.join(',') || 'no windows')

    await page.screenshot({ path: path.join(out, 'hexagons.png') })
  } catch (err) {
    check('run completed', false, String(err && err.message ? err.message : err))
  } finally {
    const failed = checks.filter(c => !c.ok)
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
    console.log(`shots → ${out}`)
    await browser.close()
    process.exit(failed.length ? 1 : 0)
  }
}

main()
