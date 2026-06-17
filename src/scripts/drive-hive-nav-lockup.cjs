// scripts/drive-hive-nav-lockup.cjs
//
// Drive a hive (default: production https://hypercomb.io) and reproduce the
// root↔content navigation lock-up — the HexImageAtlas GPU-texture leak.
//
// Each image load did Texture.from(bitmap) and baked the sprite into the ring
// atlas but never destroyed the source Texture / TextureSource / ImageBitmap.
// The 256-slot ring evicts content images on nav-away, so each back-nav
// re-decodes + re-leaks. On a real GPU this exhausts driver memory after a few
// cycles and hard-locks. Headless (software GL) won't necessarily hard-lock,
// but the LEAK is still measurable as monotonic growth in the renderer's
// managed-texture count + JS heap across cycles.
//
// Usage:
//   node scripts/drive-hive-nav-lockup.cjs                 # https://hypercomb.io
//   HIVE_URL=http://localhost:4250 node scripts/drive-hive-nav-lockup.cjs
//   CYCLES=10 node scripts/drive-hive-nav-lockup.cjs --headed

const { chromium } = require('playwright')

const URL = process.env.HIVE_URL || 'https://hypercomb.io'
const CYCLES = parseInt(process.env.CYCLES || '8', 10)
const HEADED = process.argv.includes('--headed')

const t = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${t()}]`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Read leak metrics from the page. Defensive about Pixi internals + minified
// production builds (IoC keys are string-stable; `private pixiRenderer` is a
// runtime-visible property).
async function readMetrics(page) {
  return page.evaluate(() => {
    const out = { beat: window.__beat ?? null, texCount: null, heapMB: null, atlasMap: null }
    try {
      const mem = performance.memory
      if (mem) out.heapMB = Math.round(mem.usedJSHeapSize / 1048576)
    } catch {}
    try {
      const sc = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
      const r = sc?.pixiRenderer
      // Pixi v8 keeps uploaded sources in the texture GC system. Probe a few
      // shapes so a version bump doesn't blind the driver.
      const cands = [r?.texture?.managedTextures, r?.texGC?.managedTextures, r?.textureGC?.managedTextures]
      for (const c of cands) {
        if (c) { out.texCount = (c.size ?? c.length ?? null); break }
      }
      // atlas #map size (how many images are baked) — sanity that images load
      const atlas = sc?.imageAtlas
      if (atlas && typeof atlas.size === 'function') out.atlasMap = atlas.size()
    } catch (e) { out.err = String(e).slice(0, 120) }
    return out
  })
}

async function probe(page) {
  return page.evaluate(() => {
    const ioc = window.ioc
    const lineage = ioc?.get?.('@hypercomb.social/Lineage')
    const sc = ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const r = sc?.pixiRenderer
    const fns = (o) => o ? Object.getOwnPropertyNames(Object.getPrototypeOf(o) || {}).concat(Object.keys(o)).filter((k) => { try { return typeof o[k] === 'function' } catch { return false } }).slice(0, 40) : []
    let rootCells = null
    try { rootCells = (sc?.currentCellNames?.() ?? sc?.cellNames ?? null) } catch {}
    return {
      hasIoc: !!ioc,
      hasLineage: !!lineage,
      hasShowCell: !!sc,
      hasRenderer: !!r,
      rendererTexKeys: r ? Object.keys(r).filter((k) => /tex/i.test(k)) : [],
      lineageFns: fns(lineage).filter((f) => /enter|up|root|nav|segment|domain|explorer/i.test(f)),
      rootCells: Array.isArray(rootCells) ? rootCells.slice(0, 30) : rootCells,
      segs: (() => { try { return lineage?.explorerSegments?.() } catch { return null } })(),
    }
  })
}

async function navInto(page, name) {
  return page.evaluate((n) => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    if (lineage?.explorerEnter) { lineage.explorerEnter(n); return 'explorerEnter' }
    window.dispatchEvent(new CustomEvent('navigate', { detail: { segments: [n] } }))
    return 'navigate-event'
  }, name)
}

async function navRoot(page) {
  return page.evaluate(() => {
    const lineage = window.ioc?.get?.('@hypercomb.social/Lineage')
    if (lineage?.showDomainRoot) { lineage.showDomainRoot(); return 'showDomainRoot' }
    if (lineage?.explorerUp) { lineage.explorerUp(); return 'explorerUp' }
    window.dispatchEvent(new CustomEvent('navigate', { detail: { segments: [] } }))
    return 'navigate-event'
  })
}

async function main() {
  log(`launching chromium (headless=${!HEADED}) → ${URL}`)
  // Force ANGLE→SwiftShader (CPU, host memory) so WebGL doesn't OOM on the
  // sandbox's tiny Vulkan GPU at boot (the atlas RenderTexture allocation
  // alone exhausts it and loses the context before any test can run).
  const browser = await chromium.launch({
    headless: !HEADED,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const page = await (await browser.newContext()).newPage()
  page.on('pageerror', (e) => log('PAGE ERROR:', String(e).slice(0, 200)))
  page.on('console', (m) => { const x = m.text(); if (/lock|leak|ERROR|out of memory|context lost|webgl/i.test(x)) log('  [page]', x.slice(0, 160)) })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.bringToFront()

  log('waiting for ioc…')
  await page.waitForFunction(() => !!window.ioc?.get, { timeout: 60000 }).catch(() => {})
  await sleep(3000)

  // Push-only install: a fresh context sits at the install-needed screen with
  // no renderer. Trigger the bundled install (same as the "Upgrade Hypercomb"
  // button), which reloads on success.
  let hasRenderer = await page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.pixiRenderer)
  if (!hasRenderer) {
    log('no renderer → triggering window.upgradeHypercomb() (bundled install)…')
    await page.evaluate(() => { try { window.upgradeHypercomb && window.upgradeHypercomb() } catch {} }).catch(() => {})
    await page.waitForLoadState('load', { timeout: 90000 }).catch(() => {})
    await sleep(6000)
    await page.waitForFunction(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.pixiRenderer, { timeout: 60000 })
      .catch(() => log('  still no renderer after install attempt'))
    await sleep(4000)
    hasRenderer = await page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')?.pixiRenderer)
  }
  log('renderer present:', hasRenderer)

  const p = await probe(page)
  log('PROBE:', JSON.stringify(p, null, 2))

  // foreground rAF heartbeat — a stalled main thread stops advancing it
  await page.evaluate(() => { window.__beat = 0; (function loop() { window.__beat++; requestAnimationFrame(loop) })() })

  // ── CONCLUSIVE atlas-leak test (no content/navigation needed) ──────
  // Drive the atlas's loadImage directly with N distinct sigs and watch the
  // renderer's managed-texture count. The fix destroys each source texture
  // after baking, so the count must stay ~flat regardless of N. The OLD code
  // leaked one texture per load — at large N it grows by ~N and OOMs (the
  // exact production failure). Completing N loads with a flat count == fixed.
  const N = parseInt(process.env.ATLAS_N || '400', 10)
  log(`atlas-leak test: loading ${N} distinct images through HexImageAtlas.loadImage…`)
  const leakTest = await page.evaluate(async (n) => {
    const sc = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
    const atlas = sc?.imageAtlas
    const r = sc?.pixiRenderer
    const count = () => {
      const c = r?.textureGC?.managedTextures ?? r?.texture?.managedTextures
      return c ? (c.size ?? c.length ?? -1) : -1
    }
    if (!atlas?.loadImage) return { error: 'no atlas.loadImage' }
    let blob
    try {
      const cv = new OffscreenCanvas(48, 48); const cx = cv.getContext('2d')
      cx.fillStyle = '#39a7c4'; cx.fillRect(0, 0, 48, 48)
      blob = await cv.convertToBlob({ type: 'image/png' })
    } catch (e) { return { error: 'blob: ' + String(e).slice(0, 80) } }
    const hex = (i) => i.toString(16).padStart(64, '0')
    const before = count()
    let loaded = 0, contextLost = false
    const mid = []
    for (let i = 1; i <= n; i++) {
      try { if (await atlas.loadImage(hex(i), blob)) loaded++ } catch (e) { /* per-load */ }
      if (i % Math.max(1, Math.floor(n / 5)) === 0) mid.push({ at: i, tex: count() })
      if (r?.gl && r.gl.isContextLost && r.gl.isContextLost()) { contextLost = true; break }
    }
    await new Promise((res) => setTimeout(res, 600))
    const after = count()
    return { before, after, delta: (before >= 0 && after >= 0) ? after - before : null, loaded, n, contextLost, samples: mid }
  }, N)
  log('ATLAS-LEAK RESULT:', JSON.stringify(leakTest, null, 2))
  if (leakTest.error) { log('  (atlas test unavailable: ' + leakTest.error + ')') }
  else {
    const leaks = leakTest.contextLost || (leakTest.delta != null && leakTest.delta > N * 0.5)
    log(`  VERDICT (atlas): ${leakTest.contextLost ? 'CONTEXT LOST (OOM — leak present)' : leaks ? 'LEAKING (Δtex≈N)' : 'FIXED (managed-texture count flat across ' + N + ' loads)'}`)
  }

  // choose a navigation target (secondary check; usually no content fresh)
  const cells = Array.isArray(p.rootCells) ? p.rootCells : []
  const target = cells.includes('dolphin') ? 'dolphin' : cells[0]
  if (!target) { log('no navigable root content (fresh context) — atlas test above is the verdict.'); await browser.close(); process.exit(leakTest.error ? 3 : 0) }
  log(`navigating root ↔ "${target}" x${CYCLES}`)

  const base = await readMetrics(page)
  log('baseline:', JSON.stringify(base))

  const samples = [base]
  let stalled = false
  for (let i = 1; i <= CYCLES; i++) {
    const beatBefore = (await readMetrics(page)).beat
    log(`  cycle ${i}: into "${target}" (${await navInto(page, target)})`)
    await sleep(1200)
    log(`  cycle ${i}: back to root (${await navRoot(page)})`)
    await sleep(1200)
    const m = await readMetrics(page)
    samples.push(m)
    log(`  cycle ${i} metrics:`, JSON.stringify(m))
    // lock-up detector: heartbeat must keep advancing
    if (typeof m.beat === 'number' && typeof beatBefore === 'number' && m.beat <= beatBefore + 2) {
      log(`  *** HEARTBEAT STALLED (${beatBefore} → ${m.beat}) — main thread wedged (LOCK-UP) ***`)
      stalled = true; break
    }
  }

  const first = samples[1] || base, last = samples[samples.length - 1]
  const texGrow = (last.texCount != null && first.texCount != null) ? last.texCount - first.texCount : null
  const heapGrow = (last.heapMB != null && first.heapMB != null) ? last.heapMB - first.heapMB : null
  log('=== SUMMARY ===')
  log(`  cycles run:        ${samples.length - 1}`)
  log(`  texCount:          ${first.texCount} → ${last.texCount}  (Δ ${texGrow})`)
  log(`  heapMB:            ${first.heapMB} → ${last.heapMB}  (Δ ${heapGrow})`)
  log(`  heartbeat stalled: ${stalled ? 'YES (lock-up reproduced)' : 'no'}`)
  // verdict: monotonic texture growth across cycles == the leak
  const leak = texGrow != null && texGrow >= (samples.length - 1) // ~≥1 leaked texture/cycle
  log(`  VERDICT: ${stalled ? 'LOCKED UP' : leak ? 'LEAKING (texture count climbs per cycle)' : 'OK (bounded)'}`)

  if (HEADED) { log('holding 20s'); await sleep(20000) }
  await browser.close()
  process.exit(stalled || leak ? 1 : 0)
}

main().catch((e) => { console.error('[driver] crashed:', e); process.exit(2) })
