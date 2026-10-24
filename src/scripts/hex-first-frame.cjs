// THE HEXAGON FIRST-FRAME AUDIT — Step 0 of documentation/performance-plan.md.
//
// How long from "show me the hexagons" to the first settled frame of real
// tiles, on a cold browser, on a real GPU — and whether the pictures inside
// those hexagons are actually there.
//
//   node scripts/hex-first-frame.cjs [url] [--runs 3] [--sw-runs 1] [--accept]
//
// EVERY LOAD IS A NEW BROWSER WITH A NEW PROFILE. A fresh temp user-data-dir
// means a cold shader cache (the hex shader compiles for real every time), no
// storage, no service worker. One browser per load because headless Chromium
// on a real GPU runs out of GL memory (GL_OUT_OF_MEMORY) after ~3 loads in one
// browser — the image atlas alone allocates ~1.25 GiB.
//
// TWO GL STACKS:
//   gpu          --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist — the
//                machine's real GPU through ANGLE/D3D11. requestAnimationFrame
//                runs and the real hex shader compiles. Run at 1x and 4x CPU
//                (CDP throttling), interleaved, --runs times each.
//   swiftshader  --use-angle=swiftshader --enable-unsafe-swiftshader — the
//                software GL a GPU-less visitor gets. The regression check for
//                the blank atlas (one run at 1x by default).
// The GL renderer string is stamped on every row, so a "gpu" row that quietly
// fell back to SwiftShader can never pass as a GPU number.
//
// THE TARGET (2026-10-23). The audit needs a hive with pictures that opens
// without the owner's profile or a dev server. No published door opens
// STRAIGHT onto hexagons with pictures in a fresh profile today:
// business-card renders an empty layer (0 tiles), meetups and jaime-weise
// draw one picture-less tile under their cover, hypercomb.io first-boot is a
// 60 s install by replication before any hexagon. So the default target is
// revolucion.pluginthematrix.com: its site covers the screen (planned arrival,
// no Pixi loaded), then the script names the hexagons — `ViewMode.setMode
// ('hexagons')`, the one act every site exit names (exit button, Escape, the
// site menu's "Hexagon view"; documentation/embedded-sites.md) — and the hive
// arrives on intent (P9): Pixi initialises cold, the shader compiles, the
// layer resolves, 14 pictures decode into the atlas. THE CLOCK STARTS AT THAT
// INTENT, after the page has gone quiet (no request in flight and no long
// task for 500 ms), so it measures the hexagons and nothing else. A door that
// opens straight onto hexagons is measured from navigation instead (the
// script notices which happened; any URL can be passed).
//
// THE CLOCK STOPS on the first `render:cell-count` with settled:true and a
// non-zero count — ShowCellDrone's "every tile is on screen" — stamped in the
// page (performance.now inside the EffectBus listener), so polling never
// blurs it. Also recorded: window.__hcBootMarks, the `[pixi-host]
// Application.init() Nms` line, `[atlas] SLOW loadImage` and any label/bake
// line, long tasks between intent and frame, requests in that window, and
// when the last picture landed in the atlas. hc:verbose=1 is set so the
// production console speaks.
//
// THE ATLAS PIXEL PROBE — what it proves. The image atlas says a picture is
// loaded (`hasImage(sig)`) the moment it has ASKED the renderer to draw it
// into the atlas RenderTexture; nothing checks that pixels arrived. Three
// reads:
//   1. the pixels: the atlas texture read back from the very framebuffer the
//      shader samples (Pixi's resolve target), at the centre and four inner
//      points of each claimed picture's UV rect. painted/claimed.
//   2. the cause: the atlas framebuffer's status AT CREATION, plus whether
//      the context was alive just before and just after, caught by a hook on
//      framebufferRenderbuffer (a handful of calls a page). A lost context
//      reads back zeros for everything and answers checkFramebufferStatus
//      with UNSUPPORTED (client already knows) or 0 (the sync call failed),
//      so a status alone is never proof — the before/after pair is.
//   3. the canvas: one render of the stage, read back — the share of drawn
//      pixels says whether the hex shader ran at all.
// Verdicts: painted · PARTIAL · BLANK (claimed pictures, no pixels, or an
// atlas framebuffer born incomplete on a live context) · LOST-AT-ATLAS (the
// context was alive, the atlas's multisample allocation came back 0 or lost
// it) · CONTEXT-LOST (zeros with no proof why) · NOT-LOADED · PROBE-BLIND
// (the probe could not reach the renderer or atlas — the scoreboard is
// blind, e.g. a field renamed or made #private) · no-pictures. Red = wrong.
// Measured 2026-10-23, headless SwiftShader: allocating the atlas's 8192² ×
// 4-sample RGBA8 renderbuffer (1 GiB) LOSES THE WHOLE CONTEXT — on a blank
// page the same allocation returns status 0 and fires webglcontextlost ~6 ms
// later, while 4096² × 4 samples and 8192² without MSAA are complete. Every
// program linked after that fails ("Could not initialize shader"), and the
// canvas draws 0% — no hexagons at all, not only no pictures.
//
// THE GATE. JSON goes to <os.tmpdir()>/hc-hex-first-frame/<timestamp>.json
// and is compared with latest-<door>.json from the last PASSING run on the
// SAME door (each door keeps its own baseline). Exit 1 when a gpu config's
// median intent→frame time regresses by more than 15% AND more than 150 ms,
// when a gpu run never shows hexagons, or when any gpu run's verdict is red.
// SwiftShader is reported, never gated (its lost atlas is the known bug Wave
// 4 fixes — this is where that fix shows). A failing run does not become the
// baseline unless --accept. The baseline is the last passing run, so a slow
// creep under the threshold run after run is not caught — read the trend in
// the timestamped files.
//
// P5: nothing is sent anywhere. Results stay in the OS temp dir.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')

const DEFAULT_URL = 'https://revolucion.pluginthematrix.com/'
const OUT_DIR = path.join(os.tmpdir(), 'hc-hex-first-frame')
const STACKS = {
  gpu: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
}
const GATE_PCT = 0.15
const GATE_MS = 150
const CAP_MS = 45_000
const QUIET_MS = 500
const QUIET_CAP_MS = 10_000
// Every red verdict fails the gate on a gpu row: a red row that passes would
// make the colour a lie.
const BAD_VERDICTS = ['BLANK', 'LOST-AT-ATLAS', 'CONTEXT-LOST', 'NOT-LOADED', 'PARTIAL', 'PROBE-BLIND']
const RED = process.stdout.isTTY && !process.env.NO_COLOR ? s => `\x1b[31m${s}\x1b[0m` : s => s
// Only these flags take a value; every other --flag is a switch, so
// `--accept <url>` never swallows the url.
const VALUE_FLAGS = new Set(['runs', 'sw-runs'])

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  if (!VALUE_FLAGS.has(name)) return true
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function positionalUrl() {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (VALUE_FLAGS.has(args[i].slice(2)) && args[i + 1] && !args[i + 1].startsWith('--')) i++; continue }
    return args[i]
  }
  return DEFAULT_URL
}

// One baseline per door: a run on another door must neither be compared with
// nor overwrite this door's numbers.
function baselineName(url) {
  let key = url
  try { const u = new URL(url); key = `${u.host}${u.pathname === '/' ? '' : u.pathname}` } catch { /* not a URL: use it raw */ }
  return `latest-${key.replace(/[^a-z0-9.-]+/gi, '_').replace(/_+$/, '')}.json`
}

// ── in the page ─────────────────────────────────────────────────────────────

// Runs before any page script. The EffectBus is created by core as
// `globalThis.__hypercombEffectBus ??= new EffectBusImpl()`; a one-shot
// setter catches that instant and subscribes, so every render event carries
// the page's own timestamp. Long tasks are observed from the start too.
function instrument() {
  const hc = window.__hcFrame = { events: [], longTasks: [], lastLongTaskEnd: 0, intentAt: null, contextLost: [], msaaTargets: [] }
  // Capture phase on window: the event is dispatched at the canvas and does
  // not bubble, but every event passes window on the way down.
  addEventListener('webglcontextlost', () => hc.contextLost.push(performance.now()), true)
  // The atlas framebuffer's status AT CREATION. Under software GL the context
  // can die soon after, and a dead context reads back zeros for everything —
  // this one check (a multisampled renderbuffer being attached happens a
  // handful of times per page) keeps the evidence of why.
  const proto = window.WebGL2RenderingContext?.prototype
  if (proto) {
    const storage = proto.renderbufferStorageMultisample
    const attach = proto.framebufferRenderbuffer
    proto.renderbufferStorageMultisample = function (target, samples, format, w, h) {
      this.__hcMsaa = { samples, w, h, lostBefore: this.isContextLost() }
      return storage.apply(this, arguments)
    }
    proto.framebufferRenderbuffer = function () {
      const result = attach.apply(this, arguments)
      const m = this.__hcMsaa
      if (m) {
        this.__hcMsaa = null
        // The status is a sync round trip, so a context the allocation killed
        // is noticed here: 0 (the call failed) or UNSUPPORTED (already known).
        const status = this.checkFramebufferStatus(this.FRAMEBUFFER)
        hc.msaaTargets.push({ t: performance.now(), ...m, status, lostAfter: this.isContextLost() })
      }
      return result
    }
  }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        hc.longTasks.push([Math.round(e.startTime), Math.round(e.duration)])
        hc.lastLongTaskEnd = Math.max(hc.lastLongTaskEnd, e.startTime + e.duration)
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch { /* no long-task timing on this engine */ }
  // The renderer string is read the moment the host is ready: a context that
  // dies later answers getParameter with null, and an unstamped row could be
  // SwiftShader passing as a gpu number.
  const rendererOf = gl => {
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? null
    } catch { return null }
  }
  const watch = bus => {
    for (const name of ['render:cell-count', 'render:host-ready', 'render:unsupported', 'loader:activate']) {
      bus.on(name, p => {
        hc.events.push({ name, t: performance.now(), count: p?.count, settled: p?.settled, loc: p?.locationKey })
        if (name === 'render:host-ready' && p?.renderer?.gl) hc.glRenderer ??= rendererOf(p.renderer.gl)
      })
    }
  }
  Object.defineProperty(globalThis, '__hypercombEffectBus', {
    configurable: true,
    get() { return undefined },
    set(bus) {
      Object.defineProperty(globalThis, '__hypercombEffectBus', { value: bus, writable: true, configurable: true })
      try { watch(bus) } catch { /* a bus without on() is not ours to time */ }
    },
  })
}

// Runs after the first settled frame: waits for the pictures, then reads
// the atlas and the canvas back. Restores the framebuffer it found bound.
async function probe() {
  const h = window.__hcFrame
  const bus = window.__hypercombEffectBus
  const show = window.ioc?.get?.('@diamondcoreprocessor.com/ShowCellDrone')
  const host = bus?.lastValue?.get('render:host-ready')
  const renderer = show?.pixiRenderer ?? host?.renderer
  const atlas = show?.imageAtlas
  // A probe that cannot reach what it reads must say so loudly: ShowCellDrone's
  // fields are plain properties today, and a rename or a move to #private
  // would otherwise turn every row into a silent pass.
  if (!renderer?.gl || !atlas || typeof atlas.hasImage !== 'function') {
    const missing = [!show && 'ShowCellDrone', !renderer?.gl && 'renderer', !atlas && 'imageAtlas'].filter(Boolean)
    return {
      glRenderer: h.glRenderer ?? null, contextLost: h.contextLost, atlas: { verdict: 'PROBE-BLIND', missing },
      bootMarks: Array.isArray(window.__hcBootMarks) ? [...window.__hcBootMarks] : null, longTasks: h.longTasks,
    }
  }
  const gl = renderer.gl
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const glRenderer = (info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? h.glRenderer ?? null

  // The frame's own tiles: every label that carries a picture. Its sig is
  // learned asynchronously (cellImageCache), so a label without one yet is
  // still owed — at 4x CPU the first frame lands long before the pictures.
  const owed = () => {
    const frame = bus.lastValue.get('render:cell-count') ?? {}
    const noImage = new Set(frame.noImageLabels ?? [])
    const labels = (frame.labels ?? []).filter(l => !noImage.has(l))
    const sigs = [...new Set(labels.map(l => show.cellImageCache?.get?.(l)).filter(Boolean))]
    return { labels: labels.length, sigs }
  }
  // Settled = every known sig is in the atlas (or failed) AND either every
  // label has its sig or nothing has moved for 2 s (two tiles can share one
  // picture, so labels may outnumber sigs for good).
  const progress = o => `${o.sigs.length}/${o.sigs.filter(s => atlas.hasImage(s)).length}`
  let held = ''
  let heldSince = performance.now()
  let converged = false
  const deadline = performance.now() + 20_000
  while (performance.now() < deadline) {
    const o = owed()
    if (progress(o) !== held) { held = progress(o); heldSince = performance.now() }
    const settled = o.sigs.length > 0 && o.sigs.every(s => atlas.hasImage(s) || atlas.hasFailed(s))
    if (o.labels === 0 || (settled && (o.sigs.length >= o.labels || performance.now() - heldSince > 2000))) { converged = true; break }
    await new Promise(r => setTimeout(r, 50))
  }
  const wanted = owed().sigs
  const claimed = wanted.filter(s => atlas.hasImage(s))
  const lost = gl.isContextLost()

  const glErrors = []
  for (let e = gl.getError(), i = 0; e && i < 8; e = gl.getError(), i++) glErrors.push(`0x${e.toString(16)}`)
  const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  const texture = atlas.getAtlasTexture()
  const W = texture.source.pixelWidth
  const H = texture.source.pixelHeight
  const target = renderer.renderTarget.getGpuRenderTarget(renderer.renderTarget.getRenderTarget(texture))
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
  const drawStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveTargetFramebuffer)
  const readStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  const px = new Uint8Array(4)
  let painted = 0
  for (const sig of claimed) {
    const uv = atlas.getImageUV(sig)
    const points = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]
    const hit = points.some(([fx, fy]) => {
      const x = Math.min(W - 1, Math.floor((uv.u0 + (uv.u1 - uv.u0) * fx) * W))
      const y = Math.min(H - 1, Math.floor((uv.v0 + (uv.v1 - uv.v0) * fy) * H))
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
      return px[3] > 0
    })
    if (hit) painted++
  }

  // The canvas: one real render of the stage, read back in the same task
  // (preserveDrawingBuffer is off, so after the frame is shown it is gone).
  let canvasDrawn = null
  try {
    if (host?.app) {
      renderer.render({ container: host.app.stage })
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      const w = gl.drawingBufferWidth
      const hgt = gl.drawingBufferHeight
      const buf = new Uint8Array(w * hgt * 4)
      gl.readPixels(0, 0, w, hgt, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      let drawn = 0
      let total = 0
      for (let i = 3; i < buf.length; i += 4 * 7) { total++; if (buf[i] > 0) drawn++ }
      canvasDrawn = total ? drawn / total : 0
    }
  } catch { /* a render that throws leaves canvasDrawn unknown, never zero */ }
  gl.bindFramebuffer(gl.FRAMEBUFFER, previous)

  // A lost context reads back zeros whatever the atlas holds, so the readback
  // alone cannot call it blank — the creation record can. The LAST target of
  // the atlas's size is the live atlas (a renderer swap makes a new one).
  // Status 0, or a context alive before the allocation and lost right after
  // it, means the allocation itself took the context down; a non-zero
  // incomplete status on a context that stayed alive is a real incomplete
  // framebuffer.
  const created = h.msaaTargets.findLast(m => m.w === W && m.h === H)
  const killedByAtlas = !!created && !created.lostBefore && (created.status === 0 || created.lostAfter)
  const createdOk = !created || killedByAtlas ? null : created.status === gl.FRAMEBUFFER_COMPLETE
  const pictured = owed().labels
  const verdict = killedByAtlas && pictured > 0 ? 'LOST-AT-ATLAS'
    : lost ? (createdOk === false ? 'BLANK' : 'CONTEXT-LOST')
    : createdOk === false && pictured > 0 ? 'BLANK'
    : pictured === 0 ? 'no-pictures'
    : claimed.length === 0 ? 'NOT-LOADED'
    : painted === 0 ? 'BLANK'
    : painted < claimed.length ? 'PARTIAL'
    : 'painted'
  const msaaBytes = target.msaa ? W * H * 4 * 4 : 0
  return {
    glRenderer,
    contextLost: h.contextLost,
    picturesAt: converged ? heldSince : null,
    canvasDrawn,
    atlas: {
      verdict, pictured, wanted: wanted.length, claimed: claimed.length, painted,
      size: `${W}x${H}`, msaa: !!target.msaa, mib: Math.round((W * H * 4 + msaaBytes) / 1048576),
      createdStatus: created ? `0x${created.status.toString(16)}` : null,
      created: created ? { msAfterIntent: Math.round(created.t - (h.intentAt ?? 0)), samples: created.samples, lostBefore: created.lostBefore, lostAfter: created.lostAfter } : null,
      contextLost: lost,
      drawStatus: `0x${drawStatus.toString(16)}`, readStatus: `0x${readStatus.toString(16)}`, glErrors,
    },
    bootMarks: Array.isArray(window.__hcBootMarks) ? [...window.__hcBootMarks] : null,
    longTasks: h.longTasks,
  }
}

// ── one load ────────────────────────────────────────────────────────────────

function classify(text, type, lines) {
  if (!text.trim()) return
  // Pixi dumps a failed shader's source line by line ("0: #version 300 es…").
  if (/^\d+: /.test(text)) { lines.shaderDumps++; return }
  if (/Could not initialize shader/.test(text)) lines.shaderFailures++
  if (/^\[pixi-host\]/.test(text)) lines.pixi.push(text.slice(0, 200))
  else if (/^\[atlas\]|\[HexImageAtlas\]/.test(text)) lines.atlas.push(text.slice(0, 200))
  else if (/\blabels?\b|\bbake|\bglyph|\bsdf\b/i.test(text) && !/^\[script-preloader\]/.test(text)) lines.label.push(text.slice(0, 200))
  else if (/^\[nav\] \d+ tiles in/.test(text)) lines.nav.push(text.slice(0, 200))
  const head = text.match(/\[visitor\] opening publication \{head: ([0-9a-f]{6,64})/)
  if (head) lines.stamp.head = head[1]
  const pkg = text.match(/\[ensure-install\] indexed package ([0-9a-f]{6,64})/)
  if (pkg) lines.stamp.package = pkg[1]
  if (type === 'error' && lines.errors.length < 10) lines.errors.push(text.slice(0, 200))
}

// Quiet = no request in flight for QUIET_MS and no long task for QUIET_MS.
async function waitQuiet(page, net) {
  const start = Date.now()
  while (Date.now() - start < QUIET_CAP_MS) {
    const sinceTask = await page.evaluate(() => performance.now() - window.__hcFrame.lastLongTaskEnd)
    if (net.inFlight === 0 && Date.now() - net.last >= QUIET_MS && sinceTask >= QUIET_MS) return Date.now() - start
    await page.waitForTimeout(100)
  }
  return null
}

// Name the hexagons the way every site exit does; a right-click (the live
// shell's site-root exit) only when the ViewMode service is not there.
async function showHexagons(page) {
  const how = await page.evaluate(() => {
    const mode = window.ioc?.get?.('@hypercomb.social/ViewMode')
    window.__hcFrame.intentAt = performance.now()
    if (typeof mode?.setMode !== 'function') return null
    mode.setMode('hexagons')
    return 'view-mode'
  })
  if (how) return how
  await page.mouse.click(640, 400, { button: 'right' })
  return 'right-click'
}

function firstFrame(page) {
  return page.waitForFunction(() => {
    const h = window.__hcFrame
    if (h.events.some(e => e.name === 'render:unsupported')) return { unsupported: true }
    const at = h.intentAt ?? 0
    const e = h.events.find(x => x.name === 'render:cell-count' && x.settled && x.count > 0 && x.t >= at)
    return e ? { ...e } : null
  }, null, { timeout: CAP_MS, polling: 50 }).then(r => r.jsonValue()).catch(() => null)
}

function pixiInitMs(lines, marks) {
  for (const text of [...lines.pixi, ...(marks ?? [])]) {
    const m = text.match(/Application\.init\(\)(?: done \()? ?(\d+)ms/)
    if (m) return Number(m[1])
  }
  return null
}

function windowStats(longTasks, from, to) {
  const inside = longTasks.filter(([start, dur]) => start + dur >= from && start <= to)
  return {
    count: inside.length,
    totalMs: inside.reduce((s, [, d]) => s + d, 0),
    blockingMs: inside.reduce((s, [, d]) => s + Math.max(0, d - 50), 0),
    maxMs: inside.reduce((m, [, d]) => Math.max(m, d), 0),
  }
}

async function oneLoad(url, stack, rate, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-hex-profile-'))
  const row = { stack, rate, run, url, intentMs: null }
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, args: STACKS[stack],
  })
  try {
    await context.addInitScript(instrument)
    await context.addInitScript(() => { try { localStorage.setItem('hc:verbose', '1') } catch { /* storage blocked */ } })
    const page = context.pages()[0] ?? await context.newPage()
    await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate })
    const lines = { pixi: [], atlas: [], label: [], nav: [], errors: [], stamp: {}, shaderFailures: 0, shaderDumps: 0 }
    page.on('console', m => classify(m.text(), m.type(), lines))
    page.on('pageerror', e => { if (lines.errors.length < 10) lines.errors.push(`pageerror ${String(e).slice(0, 190)}`) })
    const net = { inFlight: 0, last: Date.now(), finished: [] }
    page.on('request', () => { net.inFlight++; net.last = Date.now() })
    const settle = () => { net.inFlight = Math.max(0, net.inFlight - 1); net.last = Date.now(); net.finished.push(Date.now()) }
    page.on('requestfinished', settle)
    page.on('requestfailed', settle)

    const t0 = Date.now()
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CAP_MS }).catch(() => null)
    row.stamp = { etag: response?.headers()?.etag ?? null }
    row.opening = await page.waitForFunction(() => {
      if (document.body?.classList.contains('hc-view-covered')) return 'covered'
      return window.__hcFrame.events.some(e => e.name === 'render:cell-count' && e.settled && e.count > 0) ? 'hexagons' : null
    }, null, { timeout: CAP_MS, polling: 50 }).then(r => r.jsonValue()).catch(() => 'never')
    row.openedMs = Date.now() - t0

    let intentWall = t0
    if (row.opening === 'covered') {
      row.quietMs = await waitQuiet(page, net)
      intentWall = Date.now()
      row.intent = await showHexagons(page)
    }
    const frame = row.opening === 'never' ? null : await firstFrame(page)
    if (frame?.unsupported) row.unsupported = true
    if (frame && !frame.unsupported) {
      const intentAt = await page.evaluate(() => window.__hcFrame.intentAt ?? 0)
      row.frame = { loc: frame.loc, count: frame.count }
      row.navToFrameMs = Math.round(frame.t)
      row.intentMs = Math.round(frame.t - intentAt)
      const p = await page.evaluate(probe)
      const events = await page.evaluate(() => window.__hcFrame.events)
      const hostReady = events.find(e => e.name === 'render:host-ready' && e.t >= intentAt)
      row.hostReadyMs = hostReady ? Math.round(hostReady.t - intentAt) : null
      row.picturesMs = p.picturesAt != null ? Math.round(p.picturesAt - intentAt) : null
      row.longTasks = windowStats(p.longTasks ?? [], intentAt, frame.t)
      row.requestsInWindow = net.finished.filter(t => t >= intentWall && t <= intentWall + row.intentMs).length
      row.glRenderer = p.glRenderer
      row.contextLostMs = (p.contextLost ?? []).map(t => Math.round(t - intentAt))
      row.atlas = p.atlas
      row.canvasDrawn = p.canvasDrawn
      row.bootMarks = p.bootMarks
    }
    row.pixiInitMs = pixiInitMs(lines, row.bootMarks)
    row.shaderFailures = lines.shaderFailures
    row.stamp = { ...row.stamp, ...lines.stamp }
    row.lines = { pixi: lines.pixi, atlas: lines.atlas.slice(0, 40), label: lines.label.slice(0, 20), nav: lines.nav }
    row.errors = lines.errors
  } finally {
    await context.close().catch(() => {})
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  return row
}

// ── the scoreboard ──────────────────────────────────────────────────────────

function median(xs) {
  const s = xs.filter(x => x != null).sort((a, b) => a - b)
  if (!s.length) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}

function summarize(rows) {
  const configs = {}
  for (const row of rows) {
    const key = `${row.stack}@${row.rate}x`
    const c = configs[key] ||= { stack: row.stack, rate: row.rate, intentMs: [], picturesMs: [], blockingMs: [], verdicts: [] }
    c.intentMs.push(row.intentMs)
    c.picturesMs.push(row.picturesMs)
    c.blockingMs.push(row.longTasks?.blockingMs ?? null)
    c.verdicts.push(row.atlas?.verdict ?? 'never')
  }
  for (const c of Object.values(configs)) {
    c.medianIntentMs = median(c.intentMs)
    c.medianPicturesMs = median(c.picturesMs)
    c.medianBlockingMs = median(c.blockingMs)
  }
  return configs
}

function cell(v, w, red = false) {
  const s = String(v ?? '—').padStart(w)
  return red ? RED(s) : s
}

function verdictText(atlas, unsupported) {
  if (!atlas) return unsupported ? 'UNSUPPORTED' : 'NEVER'
  if (atlas.painted == null) return `${atlas.verdict}${atlas.missing?.length ? ` (${atlas.missing.join(',')})` : ''}`
  return `${atlas.verdict} ${atlas.painted}/${atlas.claimed}`
}

function printRows(rows) {
  console.log(`\n${'config'.padEnd(16)} run  intent→frame  pictures  pixi-init  blocking  long  reqs  atlas (painted/claimed)   canvas  shader`)
  for (const r of rows) {
    const verdict = verdictText(r.atlas, r.unsupported)
    const bad = !r.atlas || BAD_VERDICTS.includes(r.atlas.verdict)
    console.log(
      `${`${r.stack}@${r.rate}x`.padEnd(16)} ${cell(r.run, 3)}  ${cell(r.intentMs != null ? `${r.intentMs} ms` : 'NEVER', 12, r.intentMs == null)}`
      + `  ${cell(r.picturesMs != null ? `${r.picturesMs} ms` : null, 8)}  ${cell(r.pixiInitMs != null ? `${r.pixiInitMs} ms` : null, 9)}`
      + `  ${cell(r.longTasks ? `${r.longTasks.blockingMs} ms` : null, 8)}  ${cell(r.longTasks?.count, 4)}  ${cell(r.requestsInWindow, 4)}`
      + `  ${cell(verdict, 22, bad)}   ${cell(r.canvasDrawn != null ? `${(r.canvasDrawn * 100).toFixed(1)}%` : null, 6, r.canvasDrawn === 0)}`
      + `  ${cell(r.shaderFailures ? `${r.shaderFailures} FAILED` : 'ok', 8, r.shaderFailures > 0)}`,
    )
  }
}

function compare(previous, configs) {
  const failures = []
  console.log(`\n${'config'.padEnd(16)} median intent→frame   previous   change     pictures   blocking`)
  for (const [key, c] of Object.entries(configs)) {
    const before = previous?.configs?.[key]?.medianIntentMs ?? null
    const now = c.medianIntentMs
    const delta = before != null && now != null ? now - before : null
    const regressed = delta != null && delta > GATE_MS && delta > before * GATE_PCT
    const gated = c.stack === 'gpu'
    if (gated && regressed) failures.push(`${key} intent→frame ${before} → ${now} ms (+${delta} ms, +${Math.round(delta / before * 100)}%)`)
    if (gated && c.intentMs.some(x => x == null)) failures.push(`${key} a run never showed hexagons`)
    for (const v of BAD_VERDICTS) {
      if (!gated || !c.verdicts.includes(v)) continue
      failures.push(v === 'PROBE-BLIND' ? `${key} the probe could not reach the atlas (PROBE-BLIND) — fix the probe before trusting a pass` : `${key} the atlas read back ${v} on a GPU`)
    }
    const change = delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta} ms (${delta >= 0 ? '+' : ''}${Math.round(delta / before * 100)}%)`
    console.log(`${key.padEnd(16)} ${cell(now != null ? `${now} ms` : 'NEVER', 19, now == null)}   ${cell(before != null ? `${before} ms` : null, 8)}   ${cell(change, 16, gated && regressed)}`
      + `  ${cell(c.medianPicturesMs != null ? `${c.medianPicturesMs} ms` : null, 8)}  ${cell(c.medianBlockingMs != null ? `${c.medianBlockingMs} ms` : null, 8)}${gated ? '' : '   (reported, not gated)'}`)
  }
  return failures
}

// How busy the machine is in the second before a load, while nothing of ours
// runs. Other work on the box slows every number alike and the gate cannot
// tell that from a regression (measured 2026-10-23: at ~45% busy, 1x went
// 1011 → 1451 ms with no code change) — so every row carries it.
async function machineBusyPct(ms = 1000) {
  const snap = () => os.cpus().reduce((a, c) => {
    a.total += Object.values(c.times).reduce((s, v) => s + v, 0)
    a.idle += c.times.idle
    return a
  }, { total: 0, idle: 0 })
  const before = snap()
  await new Promise(r => setTimeout(r, ms))
  const after = snap()
  const total = after.total - before.total
  return total > 0 ? Math.round(100 * (1 - (after.idle - before.idle) / total)) : null
}

function readPrevious(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

async function main() {
  const url = positionalUrl()
  const runs = Number(arg('runs', 3))
  const swRuns = Number(arg('sw-runs', 1))
  const accept = arg('accept', false) === true
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const latestFile = path.join(OUT_DIR, baselineName(url))
  // The first version kept one latest.json for every door; read it only when
  // it was this door's, so its numbers carry over without leaking across.
  const legacy = readPrevious(path.join(OUT_DIR, 'latest.json'))
  const previous = readPrevious(latestFile) ?? (legacy?.url === url ? legacy : null)

  // Interleaved: 1x, 4x, 1x, 4x… so drift (host, network) lands on both.
  const plan = []
  for (let run = 1; run <= runs; run++) for (const rate of [1, 4]) plan.push(['gpu', rate, run])
  for (let run = 1; run <= swRuns; run++) plan.push(['swiftshader', 1, run])

  console.log(`hex first frame — ${url} — ${plan.length} cold loads, one browser each`)
  const rows = []
  for (const [stack, rate, run] of plan) {
    const busy = await machineBusyPct()
    const row = await oneLoad(url, stack, rate, run)
    row.machineBusyPct = busy
    rows.push(row)
    const verdict = row.atlas ? verdictText(row.atlas) : 'no frame'
    console.log(`  ${stack}@${rate}x run ${run}: ${row.intentMs != null ? `${row.intentMs} ms` : RED('NEVER')} · atlas ${BAD_VERDICTS.includes(row.atlas?.verdict) ? RED(verdict) : verdict} · machine ${busy ?? '?'}% busy before · ${row.glRenderer ?? 'renderer unknown'}`)
  }

  const mismatch = rows.filter(r => r.stack === 'gpu' && r.glRenderer && /swiftshader/i.test(r.glRenderer))
  const configs = summarize(rows)
  printRows(rows)
  const failures = compare(previous, configs)
  if (mismatch.length) failures.push(`the gpu flags reached SwiftShader on ${mismatch.length} run(s) — no GPU numbers on this machine`)
  const machineBusy = median(rows.map(r => r.machineBusyPct))
  const previousBusy = previous?.machineBusyPct ?? null

  const report = {
    at: new Date().toISOString(), url, stacks: STACKS, gate: { pct: GATE_PCT, ms: GATE_MS },
    previous: previous?.at ?? null, machineBusyPct: machineBusy, failures, configs, rows,
  }
  const file = path.join(OUT_DIR, `${report.at.replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`\nwrote ${file}`)
  if (!failures.length || accept) {
    fs.writeFileSync(latestFile, JSON.stringify(report, null, 2))
    console.log(`baseline ${previous ? 'advanced' : 'written'}: ${latestFile}`)
  }
  console.log(`machine busy before loads: median ${machineBusy ?? '?'}%${previousBusy != null ? ` (baseline ${previousBusy}%)` : ''}`)
  if (failures.length) {
    console.log(`\n${RED('GATE FAILED')}\n  ${failures.join('\n  ')}`)
    const timing = failures.some(f => / intent→frame /.test(f))
    if (timing && machineBusy != null && machineBusy > 20 && machineBusy > (previousBusy ?? 0) + 10) {
      console.log(`  (the machine was ${machineBusy}% busy before the loads — rerun on a quiet machine before believing a timing regression)`)
    }
    if (!accept) process.exit(1)
  } else {
    console.log('\ngate passed')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
