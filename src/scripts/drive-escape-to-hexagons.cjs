#!/usr/bin/env node
// drive-escape-to-hexagons — ESCAPE MEANS "SHOW ME THE HEXAGONS AGAIN".
//
// Escape has one owner (shared/ui/tool-windows.ts) and it used to route
// purely by FOCUS: "Escape acts on the window the focus is in. Nothing else."
// A window opened by a SLASH COMMAND leaves the focus on <body>, so that rule
// answered "no window is involved" for exactly the windows most likely to be
// covering the hive — you pressed Escape over an open panel and nothing at
// all happened, not even the cascade's own rungs, because there was no editor
// and no selection to clear.
//
// It now falls back to the newest showing tool window when the focus is in
// none of them. This drives that across every window reachable by a command,
// and checks the half that must NOT change: with no panel open, Escape still
// belongs to the canvas.
//
//   node scripts/drive-escape-to-hexagons.cjs [--url http://localhost:4250]
//                                             [--out <dir>] [--engine chrome]

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

/** Wait until the runtime is actually there before speaking to it.
 *
 *  A dev server recompiling under the run live-reloads the page, and
 *  `__hypercombEffectBus` comes back undefined for a few seconds — which
 *  reads as a failing check when nothing is wrong with the code. Ask, don't
 *  assume. */
const ready = async (page) => {
  await page.waitForFunction(() => !!window.__hypercombEffectBus, null, { timeout: 60000 })
}

const submit = async (page, text) => {
  await ready(page)
  await page.evaluate(t => window.__hypercombEffectBus.emit('command-line:remote-submit', { text: t }), text)
}

/** Every docked tool window on screen, by its host tag. */
const PANELS = () => Array.from(document.querySelectorAll('[hcdockedpanel], [data-hc-window]'))
  .map(el => el.getAttribute('hcdockedpanel') || el.getAttribute('data-hc-window'))
  .filter(Boolean)

/** The windows this run drives, each by the command a participant would type.
 *  Addressed by the `hcDockedPanel` id rather than by a root class: that id IS
 *  the window's name to the lane, the session and the settings group, so a
 *  panel that renames its CSS cannot quietly drop out of this sweep. */
const CASES = [
  { command: '/tutorial', id: 'tutorials-window', name: 'tutorials' },
  { command: '/files', id: 'files-viewer', name: 'files' },
  { command: '/tags', id: 'tags-viewer', name: 'tags' },
  { command: '/sequence', id: 'sequence-viewer', name: 'arrangements' },
  { command: '/context', id: 'context-window', name: 'context' },
  { command: '/publish', id: 'publish-panel', name: 'publish' },
]
const sel = (id) => `[hcdockedpanel="${id}"]`

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', 'test-results/escape-to-hexagons')))
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
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    for (const c of CASES) {
      await submit(page, c.command)
      await page.waitForSelector(sel(c.id), { timeout: 6000 }).catch(() => {})
      await page.waitForTimeout(500)
      if (!(await page.locator(sel(c.id)).count())) {
        check(`${c.name}: opens with ${c.command}`, false, 'never appeared — skipped')
        continue
      }

      // WHERE THE FOCUS LANDED IS NOT THE POINT — that Escape is answered
      // either way is. Most windows leave it on <body> (the case the old
      // focus-only rule could not serve); a few autofocus a field of their
      // own and land inside themselves. Both are legal; both must end with
      // the hexagons back.
      const active = await page.evaluate(() => {
        const el = document.activeElement
        const panel = el?.closest?.('[hcdockedpanel]')
        return `${el?.tagName ?? 'none'}${panel ? ' (inside the window)' : ''}`
      })
      check(`${c.name}: opens with ${c.command}`, true, `focus: ${active}`)

      // Press Escape WITHOUT touching the window. Several times: a window is
      // allowed its own inner rungs first (a search, a drill-down), and the
      // claim is that it ends up gone, not that it goes in one press.
      let gone = false
      for (let press = 0; press < 4 && !gone; press++) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        gone = (await page.locator(sel(c.id)).count()) === 0
      }
      check(`${c.name}: Escape puts the hexagons back`, gone)
      if (!gone) {
        await page.screenshot({ path: path.join(out, `stuck-${c.name}.png`) })
        await submit(page, c.command) // toggle it away so the next case is clean
        await page.waitForTimeout(1200)
      }
    }

    // ── the half that must NOT change ─────────────────────────────────
    // With no panel showing, Escape belongs to the canvas: the rung answers
    // false and the press falls through to the selection clear and the
    // InputGate recovery, exactly as if no panel had ever existed.
    await ready(page)
    const anyPanel = await page.evaluate(PANELS)
    check('no window is left showing after the sweep', anyPanel.length === 0, anyPanel.join(',') || 'none')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const alive = await page.evaluate(() => ({
      canvas: !!document.querySelector('canvas'),
      bus: !!window.__hypercombEffectBus,
    }))
    check('Escape over a bare hive is harmless', alive.canvas && alive.bus)
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
