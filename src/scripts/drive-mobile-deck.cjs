#!/usr/bin/env node
// drive-mobile-deck — screenshot + measure the phone tile close-up's app deck.
//
//   node scripts/drive-mobile-deck.cjs [--port 4253] [--path /] [--tile name]
//                                      [--out mobile-deck.png] [--page 0]
//                                      [--width 375] [--height 812]
//
// Boots the dev shell in a phone-shaped, touch-capable context with the
// mobile-mode override forced ON (localStorage `hc:mobile-mode`), waits for the
// hive to render, opens the tile close-up through its own effect
// (`tile:view-open` — the same one a hold-and-release emits), optionally pages
// the deck, then measures the deck's geometry and writes a PNG.

const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

async function main() {
  const port = Number(arg('port', 4253))
  const route = String(arg('path', '/'))
  const wanted = arg('tile', null)
  const pageIndex = Number(arg('page', 0))
  const out = path.resolve(String(arg('out', 'mobile-deck.png')))
  const width = Number(arg('width', 375))
  const height = Number(arg('height', 812))

  // HEADLESS HAS NO GPU, and without one Pixi never builds its mesh scene, so
  // the render pass that publishes the tile row never happens. A headed real
  // browser (msedge/chrome channel) is the only way to drive a rendered hive.
  const headed = arg('headed', false) === true
  const channel = String(arg('engine', 'msedge'))
  const browser = await chromium.launch({
    headless: !headed,
    ...(channel === 'chromium' ? {} : { channel }),
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    })
    // Forced ON so the deck renders regardless of what the headless context
    // reports for `pointer: coarse`.
    const modeOverride = String(arg('mobile', 'on'))
    await context.addInitScript(mode => {
      try { localStorage.setItem('hc:mobile-mode', mode) } catch { /* ignore */ }
    }, modeOverride)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    // The splash never gets its reveal without a live GL context.
    await page.waitForTimeout(6000)
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('body > div'))) {
        const z = Number(getComputedStyle(el).zIndex || 0)
        if (z >= 100000) el.remove()
      }
    })

    // Empty OPFS on a fresh context lands on the first-boot offer. Take the
    // example hive so there is a row of tiles to open a close-up over.
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await page.waitForTimeout(10000)
    // Seeding happens at the root; the route under test comes after it.
    if (route !== '/') {
      await page.goto(`http://localhost:${port}${route}`, { waitUntil: 'load' })
      await page.waitForTimeout(7000)
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('body > div'))) {
          const z = Number(getComputedStyle(el).zIndex || 0)
          if (z >= 100000) el.remove()
        }
      })
    }
    // Wait for the render pass to publish a row. `lastValue` is the bus's
    // replay map — there is no public `last()`.
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(() =>
        (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
      if (n > 0) break
      await page.waitForTimeout(500)
    }

    const labels = await page.evaluate(() => {
      const last = window.__hypercombEffectBus?.lastValue?.get('render:cell-count') ?? {}
      return {
        all: (last.labels ?? []).map(String),
        branches: (last.branchLabels ?? []).map(String),
      }
    })
    const label = wanted ? String(wanted) : (labels.branches[0] ?? labels.all[0] ?? '')
    if (!label) throw new Error(`no tiles rendered at ${route}: ${JSON.stringify(labels)}`)

    // The example hives carry no viewer decoration, so the "open as" group can
    // only be exercised by lending the overlay one. Stubs the COLLABORATOR,
    // not the deck: the chip travels the real `#overlayChips` path.
    if (arg('fake-viewer', false) === true) {
      await page.evaluate(() => {
        const overlay = window.ioc.get('@diamondcoreprocessor.com/TileOverlayDrone')
        const real = overlay.actionsForTile.bind(overlay)
        overlay.actionsForTile = l => [
          { name: 'view-enter:slides', svgMarkup: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="white"/></svg>', labelKey: 'slides.open' },
          { name: 'view-enter:lightbox', svgMarkup: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="white"/></svg>', labelKey: '' },
          ...real(l),
        ]
      })
    }
    await page.evaluate(l => {
      const segments = window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
      window.__hypercombEffectBus.emit('tile:view-open', { label: l, segments })
    }, label)
    await page.waitForSelector('#hc-tile-view-host', { timeout: 5000 })
    await page.waitForTimeout(900)

    if (pageIndex > 0) {
      await page.evaluate(i => {
        const pager = document.querySelector('#hc-tile-view-host [data-role="deck-pager"]')
        if (pager) pager.scrollLeft = i * pager.clientWidth
      }, pageIndex)
      await page.waitForTimeout(500)
    }

    // Optional: tap one cell by its accessible name, let whatever it opens
    // settle, then re-open the close-up so the deck is measured AFTER the act.
    const tap = arg('tap', null)
    if (tap) {
      const hit = await page.evaluate(name => {
        const cell = Array.from(document.querySelectorAll('#hc-tile-view-host [data-hc-tv-app]'))
          .find(b => b.getAttribute('aria-label') === name)
        if (!cell) return false
        cell.click()
        return true
      }, String(tap))
      console.log(`tap ${tap}: ${hit ? 'hit' : 'MISS'}`)
      await page.waitForTimeout(4000)
      // RELOAD, then re-open. Re-asking for the same label while the card is
      // already up is a no-op by design (it only resumes a suspended one), so
      // a reload is the honest way to see the act's effect — and it proves the
      // decoration survived the round trip.
      await page.reload({ waitUntil: 'load' })
      await page.waitForTimeout(9000)
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll('body > div'))) {
          const z = Number(getComputedStyle(el).zIndex || 0)
          if (z >= 100000) el.remove()
        }
      })
      for (let i = 0; i < 40; i++) {
        const n = await page.evaluate(() =>
          (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
        if (n > 0) break
        await page.waitForTimeout(500)
      }
      await page.evaluate(l => {
        const segments = window.ioc?.get?.('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
        window.__hypercombEffectBus.emit('tile:view-open', { label: l, segments })
      }, label)
      await page.waitForSelector('#hc-tile-view-host', { timeout: 8000 })
      await page.waitForTimeout(1500)
    }

    // Optional: a real touch swipe across the pager. Proves three things at
    // once — the page turns, the trailing click does not fire an icon, and the
    // host's row-walk never sees the drag (the tile must not change).
    if (arg('swipe', false) === true) {
      await page.evaluate(() => {
        window.__hcDeckClicks = 0
        for (const b of document.querySelectorAll('#hc-tile-view-host [data-hc-tv-app]')) {
          b.addEventListener('click', () => { window.__hcDeckClicks++ }, true)
        }
      })
      const before = await page.evaluate(() => ({
        page: document.querySelector('#hc-tile-view-host [data-role="deck-pager"]')?.dataset?.page,
        name: document.querySelector('#hc-tile-view-host [data-role="panel"] > div')?.textContent,
      }))
      const box = await page.locator('#hc-tile-view-host [data-role="deck-pager"]').boundingBox()
      // A REAL TOUCH DRAG, over CDP. A mouse drag does not pan an overflow
      // scroller — only a touch does — and synthetic pointer events do not
      // reproduce a native one either, so neither would prove anything here.
      const cdp = await page.context().newCDPSession(page)
      const y = box.y + box.height / 2
      let x = box.x + box.width - 30
      const touch = (type, px) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: px, y, id: 1 }],
      })
      await touch('touchStart', x)
      for (let i = 1; i <= 12; i++) {
        x -= 22
        await touch('touchMove', x)
        await page.waitForTimeout(16)
      }
      await touch('touchEnd', x)
      await page.waitForTimeout(1400)
      const clicked = await page.evaluate(() => window.__hcDeckClicks ?? 0)
      console.log('icon clicks during swipe:', clicked)
      const after = await page.evaluate(() => ({
        page: document.querySelector('#hc-tile-view-host [data-role="deck-pager"]')?.dataset?.page,
        name: document.querySelector('#hc-tile-view-host [data-role="panel"] > div')?.textContent,
        title: document.querySelector('#hc-tile-view-host [data-role="deck-title"]')?.textContent,
        count: document.querySelector('#hc-tile-view-host [data-role="deck-count"]')?.textContent,
      }))
      console.log('swipe:', JSON.stringify({ before, after }))
    }

    const report = await page.evaluate(() => {
      const host = document.querySelector('#hc-tile-view-host')
      if (!host) return { mounted: false }
      const box = el => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
      }
      const pager = host.querySelector('[data-role="deck-pager"]')
      const grids = pager ? Array.from(pager.children) : []
      const cells = grids[0] ? Array.from(grids[0].querySelectorAll('[data-hc-tv-app]')) : []
      const plate = cells[0]?.firstElementChild
      return {
        mounted: true,
        deck: !!host.querySelector('[data-role="app-deck"]'),
        rail: !!host.querySelector('[data-role="actions"]'),
        title: host.querySelector('[data-role="deck-title"]')?.textContent ?? null,
        count: host.querySelector('[data-role="deck-count"]')?.textContent ?? null,
        pages: grids.length,
        page: pager?.dataset?.page ?? null,
        dots: host.querySelectorAll('[data-hc-tv-dot]').length,
        arrows: Array.from(host.querySelectorAll('[data-hc-tv-page-arrow]'))
          .map(a => ({ dir: a.getAttribute('data-hc-tv-page-arrow'), opacity: a.style.opacity })),
        dock: Array.from(host.querySelectorAll('[data-role="deck-dock"] [data-hc-tv-app]'))
          .map(b => b.getAttribute('aria-label')),
        firstPage: cells.map(c => ({
          name: c.getAttribute('aria-label'),
          tone: /0\.46/.test(c.firstElementChild?.style?.background ?? '') ? 'accent'
            : /214,126,126/.test(c.firstElementChild?.style?.background ?? '') ? 'danger' : 'plain',
        })),
        cellsPerPage: grids.map(g => g.querySelectorAll('[data-hc-tv-app]').length),
        plateBox: box(plate),
        pagerBox: box(pager),
        hexBox: box(host.querySelector('[data-role="hex-frame"]')),
        // Everything below the fold is a scroll away; report the panel's reach.
        panelScroll: (() => {
          const p = host.querySelector('[data-role="panel"]')
          if (!p) return null
          const r = p.getBoundingClientRect()
          return {
            scrollHeight: p.scrollHeight,
            clientHeight: p.clientHeight,
            scrollTop: Math.round(p.scrollTop),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
          }
        })(),
        dockBox: box(host.querySelector('[data-role="deck-dock"]')),
        nameBox: box(host.querySelector('[data-role="panel"] > div')),
        viewport: { w: innerWidth, h: innerHeight },
      }
    })

    console.log(`tile: ${label}`)
    console.log(JSON.stringify(report, null, 2))
    await page.screenshot({ path: out })
    console.log(`wrote ${out}`)
    if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 8).join('\n  ')}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
