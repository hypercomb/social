#!/usr/bin/env node
// drive-mobile-scroller — prove THE FEED: `/scroller` on a branch gives every
// child one full-height section, and one flick advances exactly one.
//
//   node scripts/drive-mobile-scroller.cjs [--port 4254] [--out mobile-scroller] [--engine msedge]
//
// Boots the dev shell phone-shaped (390×844) with the mobile override forced
// ON, seeds the example hive, walks into `honey-garden`, drops two picture
// links into it through `link:intake`, opens the scroller FOR that branch
// (`view:open-for-tile {view:'scroller'}`) and checks:
//
//   1. the viewer host is up on the scroller surface, with the top-left back
//      plate thumb-sized;
//   2. there are at least as many sections as the branch has children — every
//      child owns one, the counter never lies;
//   3. every section is exactly the scroller's height (one screen each);
//   4. a REAL touch flick (CDP Input.dispatchTouchEvent) advances scrollTop by
//      exactly one clientHeight — mandatory snap, one flick = one section;
//   5. the back plate leaves the feed.
//
// HEADLESS HAS NO GPU and Pixi never builds its mesh without one, so this
// drives a headed real browser (msedge by default). PASS exit 0, FAIL 1,
// crash 2.

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
const BRANCH = 'honey-garden'
// Two DIFFERENT last path segments: a link's tile name derives from its last
// segment (`picsum 400`), and a layer holds one tile per name — a second
// `…/600/400.jpg` would fold into the first instead of becoming a child.
const LINKS = [
  'https://picsum.photos/id/1015/600/400.jpg',
  'https://picsum.photos/id/1016/640/480.jpg',
]

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

/** Everything the page knows about the feed, in one read. */
const FEED = () => {
  const host = document.getElementById('hc-slides-view-host')
  if (!host) return { host: false }
  const sections = Array.from(host.querySelectorAll('[data-index]'))
  const scroller = sections[0]?.parentElement ?? null
  const back = host.querySelector('[data-role="back"]')
  const backBox = back ? back.getBoundingClientRect() : null
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return {
    host: true,
    surface: host.dataset.surface ?? null,
    sections: sections.length,
    heights: sections.map(s => s.getBoundingClientRect().height),
    clientHeight: scroller ? scroller.clientHeight : 0,
    scrollTop: scroller ? scroller.scrollTop : -1,
    snap: scroller ? getComputedStyle(scroller).scrollSnapType : '',
    mounted: sections.map(s => s.childElementCount > 0),
    cards: sections.filter(s => s.querySelector('[data-card]')).length,
    pictures: sections.filter(s => Array.from(s.querySelectorAll('div')).some(d => (d.style.backgroundImage || '').includes('picsum'))).length,
    back: backBox ? { w: backBox.width, h: backBox.height, x: backBox.x, y: backBox.y, minPx: 2.75 * rem } : null,
    counter: Array.from(host.children).map(c => c.textContent || '').find(t => /^\d+ \/ \d+/.test(t)) ?? '',
    viewActive: window.__hypercombEffectBus?.lastValue?.get('view:active') ?? null,
  }
}

async function touchFlick(cdp, from, to, steps = 8) {
  const point = (x, y) => ({ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from.x, from.y)] })
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps
    const y = from.y + ((to.y - from.y) * i) / steps
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x, y)] })
    await new Promise(r => setTimeout(r, 12))
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

async function main() {
  const port = Number(arg('port', 4254))
  const out = String(arg('out', 'mobile-scroller'))
  const channel = String(arg('engine', 'msedge'))
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
        // The link-drop verification card is a reporting overlay; it would sit
        // over the feed. Off for the drive — it never gates the drop.
        localStorage.setItem('hc:link-drop:verify-card', 'off')
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
      // Belt and braces: a link card that slipped through gets its OK pressed.
      document.querySelector('.hc-link-card [data-role="accept"]')?.click()
      // A CONCURRENT session's compile error raises the dev server's overlay
      // over the whole page (it ate the flick on the first run: the finger
      // landed on `vite-error-overlay`). The served bundle is the last good
      // build — dismiss the overlay and drive that.
      document.querySelector('vite-error-overlay')?.remove()
    })
    const settle = async (ms) => { await page.waitForTimeout(ms); await clearSplash() }
    const labels = () => page.evaluate(() =>
      (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).map(String))
    const waitForTiles = async () => {
      for (let i = 0; i < 60; i++) {
        const n = (await labels()).length
        if (n > 0) return n
        await page.waitForTimeout(500)
      }
      return 0
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

    // Walk into the branch. honey-garden when it is here; else the first
    // branch tile the render reports.
    const rootLabels = await labels()
    const branch = rootLabels.includes(BRANCH)
      ? BRANCH
      : await page.evaluate(() => {
          const last = window.__hypercombEffectBus.lastValue.get('render:cell-count')
          return (last?.branchLabels ?? last?.labels ?? [])[0] ?? null
        })
    if (!branch) throw new Error('no branch to walk into')
    await page.evaluate(label => {
      window.__hypercombEffectBus.emit('tile:enter-request', { label })
    }, branch)
    await settle(4000)
    const before = await waitForTiles()
    console.log(`children inside "${branch}" before the drops: ${before}`)

    // Two picture links, dropped through the command line's own intake — each
    // becomes a child of the branch we are standing in. A drop is a whole
    // gesture (safety check, card read, picture fetch, commit); wait for the
    // child to actually appear before the next, up to 20 s each.
    for (const url of LINKS) {
      const was = (await labels()).length
      await page.evaluate(u => { window.__hypercombEffectBus.emit('link:intake', { url: u }) }, url)
      for (let i = 0; i < 40; i++) {
        await settle(500)
        if ((await labels()).length > was) break
      }
      await settle(1500)
    }
    const after = (await labels()).length
    console.log(`children inside "${branch}" after the drops: ${after}`)
    check('both picture links became children', after >= before + 2, `${before} → ${after}`)
    await page.screenshot({ path: path.resolve(`${out}-branch.png`) })

    // ── open the feed FOR the branch ──────────────────────────────────
    await page.evaluate(label => {
      window.__hypercombEffectBus.emit('view:open-for-tile', { view: 'scroller', segments: [label] })
    }, branch)
    await settle(3000)

    const feed = await page.evaluate(FEED)
    console.log('\nFEED', JSON.stringify({ ...feed, heights: undefined, mounted: feed.mounted }))
    check('the viewer host is up on the scroller surface', feed.host && feed.surface === 'scroller', String(feed.surface))
    check('mode says scroller', await page.evaluate(() => window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode) === 'scroller')
    check('view:active is held by the viewer', feed.viewActive?.active === true, JSON.stringify(feed.viewActive))
    check('every child owns a section', feed.sections >= after, `${feed.sections} sections / ${after} children`)
    check('the counter counts the children', new RegExp(`/ ${feed.sections}$`).test(feed.counter), feed.counter)
    check('every section is one screen tall',
      feed.clientHeight > 0 && feed.heights.every(h => Math.abs(h - feed.clientHeight) < 1.5),
      `clientHeight=${feed.clientHeight} heights=${[...new Set(feed.heights.map(h => h.toFixed(1)))].join(',')}`)
    check('mandatory vertical snap', /y mandatory/.test(feed.snap), feed.snap)
    check('the first section has resolved its content', feed.mounted[0] === true)
    check('the back plate is thumb-sized, top-left',
      !!feed.back && feed.back.w >= feed.back.minPx - 0.5 && feed.back.h >= feed.back.minPx - 0.5 && feed.back.x < 40 && feed.back.y < 60,
      JSON.stringify(feed.back))
    check('the feed starts at the top', feed.scrollTop === 0, `scrollTop=${feed.scrollTop}`)
    await page.screenshot({ path: path.resolve(`${out}-feed.png`) })

    // ── one real flick = exactly one section ─────────────────────────
    const cdp = await context.newCDPSession(page)
    const cx = PORTRAIT.width / 2, cy = PORTRAIT.height / 2
    // Diagnostics: what is under the finger, and did anything cancel the
    // touch stream (a `touchmove` preventDefault kills native scrolling; a
    // `pointercancel` on the scroller means the browser TOOK the gesture).
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      const scroller = document.querySelector('#hc-slides-view-host [data-index]')?.parentElement
      window.__flick = {
        under: el ? `${el.tagName.toLowerCase()}#${el.id}.${el.className}` : null,
        inHost: !!el?.closest?.('#hc-slides-view-host'),
        touchstart: 0, touchmove: 0, touchmoveCancelled: 0, pointercancel: 0,
      }
      window.addEventListener('touchstart', () => { window.__flick.touchstart++ })
      window.addEventListener('touchmove', e => { window.__flick.touchmove++; if (e.defaultPrevented) window.__flick.touchmoveCancelled++ })
      scroller?.addEventListener('pointercancel', () => { window.__flick.pointercancel++ })
    }, [cx, cy + 160])
    await touchFlick(cdp, { x: cx, y: cy + 160 }, { x: cx, y: cy - 160 })
    await page.waitForTimeout(1600)
    const flicked = await page.evaluate(FEED)
    const diag = await page.evaluate(() => window.__flick)
    console.log('FLICK', JSON.stringify(diag))
    check('one flick advances exactly one section',
      Math.abs(flicked.scrollTop - feed.clientHeight) < 1.5,
      `scrollTop=${flicked.scrollTop} clientHeight=${feed.clientHeight}`)
    check('the counter followed the flick', /^2 \//.test(flicked.counter), flicked.counter)
    check('the section arrived at has content', flicked.mounted[1] === true)
    await page.screenshot({ path: path.resolve(`${out}-flicked.png`) })

    // ── the picture sections painted the pictures ─────────────────────
    // The two dropped links are somewhere in the order; scroll the feed to
    // its end so every section has neared the viewport and resolved.
    await page.evaluate(() => {
      const s = document.querySelector('#hc-slides-view-host [data-index]')?.parentElement
      if (s) s.scrollTo({ top: s.scrollHeight })
    })
    await page.waitForTimeout(2500)
    const painted = await page.evaluate(FEED)
    check('both dropped pictures paint as picture sections', painted.pictures >= 2, `${painted.pictures} picsum sections, ${painted.cards} cards`)

    // ── the back plate leaves ─────────────────────────────────────────
    await page.evaluate(() => { document.querySelector('#hc-slides-view-host [data-role="back"]')?.click() })
    await settle(1500)
    const gone = await page.evaluate(() => ({
      host: !!document.getElementById('hc-slides-view-host'),
      mode: window.ioc?.get?.('@hypercomb.social/ViewMode')?.mode,
    }))
    check('the back plate leaves the feed', !gone.host && gone.mode === 'hexagons', JSON.stringify(gone))

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
