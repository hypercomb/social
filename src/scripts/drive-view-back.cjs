#!/usr/bin/env node
// drive-view-back — prove the hardware/browser BACK button LEAVES A VIEW on a
// phone instead of moving the lineage under it.
//
//   node scripts/drive-view-back.cjs [--port 4254] [--engine msedge] [--view slides|lightbox] [--out view-back]
//
// Boots the dev shell phone-shaped (390×844, mobile override ON, the example
// hive seeded — the same recipe as drive-mobile-rails.cjs), walks into the
// example hive's first container, opens a view over it IN PLACE
// (`view:open-for-tile`), presses BACK (`history.back()`), and checks:
//
//   1. the view's host is GONE and `view:active` is off;
//   2. the lineage did not move — explorerSegments() is still the page the
//      view was opened on;
//   3. the trap left the stack as it found it — the NEXT press walks the
//      lineage (out of the page), so no press is ever absorbed by a stale
//      entry.
//
// HEADLESS HAS NO GPU (Pixi never builds its mesh), so this drives a headed
// real browser. PASS exit 0, FAIL 1, crash 2.

const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORTRAIT = { width: 390, height: 844 }
/** Both slides and the lightbox are surfaces of the slides engine; one host. */
const HOST = '#hc-slides-view-host'

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const STATE = () => {
  const bus = window.__hypercombEffectBus
  const host = document.querySelector('#hc-slides-view-host')
  const modes = window.ioc?.get?.('@diamondcoreprocessor.com/ModeRegistry')
  return {
    hostUp: !!host && host.isConnected,
    viewActive: bus?.lastValue?.get('view:active') ?? null,
    owners: modes?.ownersOf?.('view:active') ?? [],
    mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode ?? null,
    segments: window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [],
    trap: window.ioc?.get?.('@diamondcoreprocessor.com/ViewBack')?.armed ?? null,
    state: history.state,
    mobile: window.ioc?.get?.('@diamondcoreprocessor.com/MobileMode')?.active ?? null,
    stamp: document.documentElement.dataset.hcMobile ?? null,
  }
}

async function main() {
  const port = Number(arg('port', 4254))
  const out = String(arg('out', 'view-back'))
  const channel = String(arg('engine', 'msedge'))
  const wanted = String(arg('view', 'slides'))
  const browser = await chromium.launch({
    headless: false,
    ...(channel === 'chromium' ? {} : { channel }),
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({
      viewport: { ...PORTRAIT },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
    await context.addInitScript(() => {
      try {
        localStorage.setItem('hc:mobile-mode', 'on')
        localStorage.removeItem('hc:hex-orientation')
        localStorage.removeItem('hc:rails')
        localStorage.removeItem('hc:lane-count')
      } catch { /* ignore */ }
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    const clearSplash = () => page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('body > div'))) {
        const z = Number(getComputedStyle(el).zIndex || 0)
        if (z >= 100000) el.remove()
      }
    })
    const settle = async (ms) => { await page.waitForTimeout(ms); await clearSplash() }
    const waitForTiles = async () => {
      for (let i = 0; i < 60; i++) {
        const n = await page.evaluate(() =>
          (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
        if (n > 0) return n
        await page.waitForTimeout(500)
      }
      return 0
    }
    const until = async (predicate, ms = 8000) => {
      const started = Date.now()
      while (Date.now() - started < ms) {
        const s = await page.evaluate(STATE)
        if (predicate(s)) return s
        await page.waitForTimeout(150)
      }
      return page.evaluate(STATE)
    }

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    await settle(6000)

    // Empty OPFS lands on the first-boot offer; take the example hive.
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await settle(10000)

    const rootCount = await waitForTiles()
    console.log(`tiles rendered at the root: ${rootCount}`)
    if (!rootCount) throw new Error('no tiles rendered')
    await settle(1500)

    const hive = await page.evaluate(() => {
      const last = window.__hypercombEffectBus.lastValue.get('render:cell-count')
      return (last?.branchLabels ?? last?.labels ?? [])[0] ?? null
    })
    if (!hive) throw new Error('no hive tile to walk into')
    await page.evaluate(label => {
      window.__hypercombEffectBus.emit('tile:enter-request', { label })
    }, hive)
    await settle(4000)
    const count = await waitForTiles()
    console.log(`tiles rendered inside "${hive}": ${count}`)
    await settle(1000)

    const before = await page.evaluate(STATE)
    console.log('\nBEFORE', JSON.stringify(before))
    check('mobile mode is on', before.mobile === true)
    // The <html> stamp is MobileModeService's (documentation/mobile-rails-projection.md
    // §9); it is pinned by mobile-mode.spec.ts. Reported, not judged, here: a dev
    // server frozen at an older essentials revision serves the trap without it.
    console.log(`note  data-hc-mobile=${before.stamp} (expected 'on'; null = the served bundle predates the stamp)`)
    check('nothing is up before the view opens', !before.hostUp && before.owners.length === 0 && before.trap === false, JSON.stringify({ owners: before.owners, trap: before.trap }))
    const segments = before.segments

    // ── open a view in place over this page ────────────────────────────
    const open = async (view) => {
      await page.evaluate(({ view, segments }) => {
        window.__hypercombEffectBus.emit('view:open-for-tile', { view, segments })
      }, { view, segments })
      return until(s => s.hostUp && s.owners.length > 0, 12000)
    }
    let view = wanted
    let up = await open(view)
    if (!up.hostUp && view === 'slides') {
      console.log('slides mounted nothing here; trying the lightbox')
      view = 'lightbox'
      up = await open(view)
    }
    console.log(`\nVIEW (${view})`, JSON.stringify(up))
    check(`the ${view} view is up in place`, up.hostUp && up.viewActive?.active === true, JSON.stringify(up.owners))
    check('the lineage is where the view was opened', JSON.stringify(up.segments) === JSON.stringify(segments), JSON.stringify(up.segments))
    check('the BACK trap is armed', up.trap === true && typeof up.state?.hcView === 'string', JSON.stringify(up.state))
    await page.screenshot({ path: path.resolve(`${out}-view.png`) })

    // ── the hardware BACK button ───────────────────────────────────────
    await page.evaluate(() => history.back())
    const after = await until(s => !s.hostUp && s.owners.length === 0, 10000)
    console.log('\nAFTER BACK', JSON.stringify(after))
    check('BACK closed the view — the host is gone', !after.hostUp, `host=${after.hostUp}`)
    check('view:active is off and no owner remains', after.viewActive?.active === false && after.owners.length === 0, JSON.stringify(after.owners))
    check('the lineage did not move', JSON.stringify(after.segments) === JSON.stringify(segments), JSON.stringify(after.segments))
    check('the trap is down', after.trap === false, `trap=${after.trap}`)
    await page.screenshot({ path: path.resolve(`${out}-after.png`) })

    // ── the stack is as we found it: the next press leaves the page ────
    await page.evaluate(() => history.back())
    const moved = await until(s => JSON.stringify(s.segments) !== JSON.stringify(segments), 6000)
    console.log('\nAFTER SECOND BACK', JSON.stringify(moved))
    check('with no view up, BACK walks the lineage — no stale entry absorbed it',
      JSON.stringify(moved.segments) !== JSON.stringify(segments) && !moved.hostUp, JSON.stringify(moved.segments))

    if (errors.length) console.log('\npage errors:', errors.slice(0, 8))
    const failed = checks.filter(c => !c.ok)
    console.log(`\nRESULT: ${failed.length ? 'FAIL' : 'PASS'} — ${checks.length - failed.length}/${checks.length}`)
    process.exitCode = failed.length ? 1 : 0
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(2)
})
