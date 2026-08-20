#!/usr/bin/env node
// drive-tool-windows — what is on screen when tool windows open, and how the
// top of them meets the command line.
//
//   node scripts/drive-tool-windows.cjs [--port 4253] [--out tool-windows]
//                                       [--width 1920] [--height 1080]
//
// Two questions, one boot:
//
//   TOP — open the notes desk (fullscreen, which pairs the pheromone palette
//   beside it) and report the exact rects of the command line, each panel, and
//   the reserved inset, plus a crop of the top band. A "formatting issue where
//   the toolwindows meet the command line" is a geometry answer, not a taste
//   one: the numbers say whether a panel overlaps the command line, leaves a
//   gap under it, or fails to yield the inset it claims.
//
//   SET — open several windows in turn and report which ones remain showing.
//   The rule under test: one window at a time, with the pheromone palette
//   allowed alongside whichever window is open.
//
// HEADLESS HAS NO GPU and Pixi never builds its mesh without one, so this
// drives a headed real browser (msedge by default).

const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

/** Every docked tool window on screen, by its id, with its rect. The components
 *  only render the panel root while showing, so the DOM IS the "what is open"
 *  answer — as long as you can SEE every panel.
 *
 *  Two selectors, because one is not enough: a panel that names itself
 *  statically (`hcDockedPanel="notes-strip"`) carries the attribute, but one
 *  that BINDS its id (`[hcDockedPanel]="'aggregate-' + src.id"`) does not —
 *  Angular property bindings never reflect to attributes. Asking only for the
 *  attribute reported the collections window as closed while it was open on
 *  screen, which made a working rule look like it had eaten a window. The
 *  second selector is the directive's own fingerprint: it sets
 *  `--hc-panel-scale` inline on every panel host it drives. */
const PANELS = () => {
  const seen = new Set()
  const out = []
  const hosts = document.querySelectorAll('[hcdockedpanel], [style*="--hc-panel-scale"]')
  for (const el of hosts) {
    if (seen.has(el)) continue
    seen.add(el)
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    out.push({
      id: el.getAttribute('hcdockedpanel') ?? el.tagName.toLowerCase(),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    })
  }
  return out.sort((a, b) => a.x - b.x)
}

// Self-contained: page.evaluate serializes the function, so it may not close
// over anything defined out here.
const TOP_GEOMETRY = () => {
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const panels = () => {
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('[hcdockedpanel], [style*="--hc-panel-scale"]')) {
      if (seen.has(el)) continue
      seen.add(el)
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      out.push({
        id: el.getAttribute('hcdockedpanel') ?? el.tagName.toLowerCase(),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
      })
    }
    return out.sort((a, b) => a.x - b.x)
  }
  const root = document.documentElement
  const cl = document.querySelector('hc-command-line')
  const clInner = cl?.querySelector('form, .cmd-row, .command-row, [class*="row"]') ?? null
  const notes = document.querySelector('hc-notes-strip [hcdockedpanel]')
    ?? document.querySelector('hc-notes-strip')
  const tags = document.querySelector('hc-tags-viewer [hcdockedpanel]')
    ?? document.querySelector('hc-tags-viewer')
  const styles = getComputedStyle(root)
  const numbers = (name) => styles.getPropertyValue(name).trim() || '(unset)'
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    commandLine: rect(cl),
    commandLineInner: rect(clInner),
    commandLineZ: cl ? getComputedStyle(cl).zIndex : null,
    notes: rect(notes),
    notesZ: notes ? getComputedStyle(notes).zIndex : null,
    tags: rect(tags),
    tagsZ: tags ? getComputedStyle(tags).zIndex : null,
    vars: {
      insetRight: numbers('--hc-inset-right'),
      insetLeft: numbers('--hc-inset-left'),
      headerAnchor: numbers('--hc-header-anchor'),
      headerBottom: numbers('--hc-header-bottom'),
    },
    panels: panels(),
  }
}

async function main() {
  const port = Number(arg('port', 4253))
  const out = String(arg('out', 'tool-windows'))
  const width = Number(arg('width', 1920))
  const height = Number(arg('height', 1080))
  const channel = String(arg('engine', 'msedge'))
  const browser = await chromium.launch({
    headless: false,
    ...(channel === 'chromium' ? {} : { channel }),
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  })
  try {
    const context = await browser.newContext({ viewport: { width, height } })
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

    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
    await page.waitForTimeout(6000)
    await clearSplash()
    const took = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '').trim() === 'Add +')
      if (!btn) return false
      btn.click()
      return true
    })
    if (took) await page.waitForTimeout(10000)
    await clearSplash()
    for (let i = 0; i < 40; i++) {
      const n = await page.evaluate(() =>
        (window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? []).length)
      if (n > 0) break
      await page.waitForTimeout(500)
    }

    const emit = (name, payload) => page.evaluate(
      ([n, p]) => window.__hypercombEffectBus.emit(n, p),
      [name, payload ?? undefined],
    )

    // ── TOP: the notes desk beside the pheromone palette ──────────────
    await emit('notes:panel', { visible: true })
    await page.waitForTimeout(1200)
    const clicked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('hc-notes-strip button'))
        .find(b => (b.textContent || '').includes('open_in_full'))
      if (!btn) return false
      btn.click()
      return true
    })
    console.log(`fullscreen desk: ${clicked ? 'opened' : 'BUTTON NOT FOUND'}`)
    await page.waitForTimeout(1800)

    const top = await page.evaluate(TOP_GEOMETRY)
    console.log('\nTOP GEOMETRY')
    console.log(JSON.stringify(top, null, 2))
    await page.screenshot({
      path: path.resolve(`${out}-top.png`),
      clip: { x: 0, y: 0, width, height: 240 },
    })
    await page.screenshot({ path: path.resolve(`${out}-desk.png`) })

    // ── SET: which windows survive opening another ────────────────────
    await emit('notes:panel', { visible: false })
    await page.waitForTimeout(600)
    await emit('tags:view-close')
    await page.waitForTimeout(600)

    // A concurrent session editing watched source reloads the page under the
    // probe — the dev server rebuilds and pushes. That is a fact of this repo,
    // not a failure of the run: wait for the reload and ask again.
    const step = async (label, name, payload) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await emit(name, payload)
          await page.waitForTimeout(900)
          const panels = await page.evaluate(PANELS)
          console.log(`\nafter ${label}: [${panels.map(p => p.id).join(', ') || 'none'}]`)
          return panels
        } catch (err) {
          if (!String(err).includes('context was destroyed')) throw err
          console.log(`  (page reloaded under the probe — retrying ${label})`)
          await page.waitForTimeout(8000)
          await clearSplash().catch(() => {})
        }
      }
      throw new Error(`could not measure after ${label}`)
    }

    console.log('\nWINDOW SET')
    await step('history:view-open', 'history:view-open')
    await step('sequence:view-open', 'sequence:view-open')
    await step('aggregate:view-open (collections)', 'aggregate:view-open', { id: 'collections' })
    await step('tags:view-open (pheromones)', 'tags:view-open')
    const final = await step('notes:panel visible', 'notes:panel', { visible: true })
    await page.screenshot({ path: path.resolve(`${out}-set.png`) })

    const ids = final.map(p => p.id)
    const others = ids.filter(id => id !== 'tags-viewer')
    const ok = others.length <= 1
    console.log(`\nRULE: one window at a time (+ pheromones) → ${ok ? 'PASS' : 'FAIL'}`)
    console.log(`  showing: [${ids.join(', ')}]`)

    if (errors.length) console.log('\npage errors:', errors.slice(0, 8))
    process.exitCode = ok ? 0 : 1
  } finally {
    await browser.close()
  }
}

main().catch(err => { console.error(err); process.exit(2) })
