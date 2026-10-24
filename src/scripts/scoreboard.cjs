// THE SCOREBOARD — Step 0 of documentation/performance-plan.md: nothing in the
// plan is claimed until it moves a number here. P5 forbids field telemetry, so
// a local lab run is the only feedback loop there is. It measures on this
// machine and sends the results NOWHERE: a JSON file in the OS temp dir and a
// table on stdout.
//
// Every load is a FRESH browser on a fresh temp profile (no HTTP cache, no
// storage, no service worker, no warm process), and the doors are interleaved
// run by run (door A run 1, door B run 1, …) so a deploy landing mid-run, or a
// bad minute on the network, falls on every door alike instead of on one.
//
//   node scripts/scoreboard.cjs                 5 runs × every door × cpu ×1 and ×4
//   node scripts/scoreboard.cjs --quick         2 runs × every door × cpu ×1
//   node scripts/scoreboard.cjs meetups.hypercomb.com https://colony.hypercomb.com/
//   node scripts/scoreboard.cjs --runs 3 --rates 1,6 --no-gate
//
// Options (env twin in brackets):
//   --runs N          [SCOREBOARD_RUNS]     loads per door per rate (default 5; --quick 2)
//   --rates 1,4       [SCOREBOARD_RATES]    CDP Emulation.setCPUThrottlingRate values (default 1,4; --quick 1)
//   --quick           [SCOREBOARD_QUICK=1]  the short run
//   --timeout MS      [SCOREBOARD_TIMEOUT]  a load with no stop signal by then is 'never' (default 60000)
//   --tail MS         [SCOREBOARD_TAIL]     keep listening after the stop for late errors (default 1500)
//   --no-gate         [SCOREBOARD_NO_GATE=1] print the diff, always exit 0
//   --accept                                take this run as the baseline even when the gate fails
//   --regress-pct P   (default 15)          ┐ a door's median stop time regresses when it grows
//   --regress-ms MS   (default 150)         ┘ by more than BOTH
//   --out DIR         [SCOREBOARD_OUT]      default <os.tmpdir()>/hc-scoreboard
//   --gl gpu|software [SCOREBOARD_GL]       gpu (default): this machine's GPU, as a visitor has one.
//                                           software: SwiftShader, what a GPU-less machine gets.
//   doors             [SCOREBOARD_DOORS]    hosts or URLs, positional or comma-separated
//   HC_VERSION / HC_WORKER — as in visitor-cold-load.cjs: every request carries
//     Cloudflare-Workers-Version-Overrides, so a version deployed at 0% is
//     measured before any visitor meets it. A worker sends no version header,
//     so HC_VERSION is also the only worker-version stamp there is.
//
// THE STOP SIGNAL. A view door is up when the body is covered
// (body.hc-view-covered, the visitor cover's own signal). A hexagon door never
// sets it: it is up at the first SETTLED render:cell-count after the arrival
// verdict (view:arrival with view '') — the same pair main.visitor.ts keys its
// loading cover on. Neither within --timeout records 'never'.
//
// THE COVER. Covered is not seen: main.visitor.ts sets it the moment the view
// mode changes and lifts its loading cover (.site-loading) only once the view
// host has mounted and painted. On arkanoid (a postit view, no site host) the
// cover never lifted: covered at 1 s, a blank screen at 30 s. So the lift is
// timed too ('shown'), and a cover still up SHOW_GRACE_MS after the stop is
// 'veiled'.
//
// THE GATE. Each run is diffed, door by door and rate by rate, against the
// baseline in latest.json (a pointer to the last accepted run, carrying its
// summary per door). Each mode keeps its own: latest-quick.json for --quick,
// latest-software[-quick].json for --gl software. Exit 1 when a door's median
// stop time grows by more than BOTH thresholds AND its loads are slower than
// the baseline's beyond chance (below), a door that came up now never does, a
// plan that resolved stops resolving, any SRI (integrity) failure shows, or a
// cover that lifted now stays up.
//
// WHY THE CHANCE TEST. On an unchanged deployment (same package, heads and
// shell, 2026-10-24) two full runs moved colony ×1 +18% and revolucion ×1 +29%
// while jaime-weise ×4 moved −19%: the ×1 spread is the network (one door's
// five loads ran 0.98–2.43 s). Thresholds on medians alone failed the gate on
// noise every time. So a timing regression must also be one the per-run times
// show: a one-sided Mann–Whitney test, exact, p < SLOWER_P. At 5 + 5 runs that
// takes nearly every new load slower than nearly every old one; below 4 runs a
// side it can never pass p < 0.05, so a quick run shows times and gates the rest.
// What no test sees is the machine itself: a baseline taken while it was busier
// or cooler (one session's ×4 jaime-weise loads all ran 7.2–8.4 s, the next
// session's all 5.8–6.9 s) is a different machine. A deploy is best judged
// live against candidate in ONE session (HC_VERSION, interleaved runs).
//
// A passing run advances only the doors it measured; a failing run is written
// but does not become the baseline, --no-gate or not — otherwise a second run
// would pass against the regression itself; --accept overrides.
const { chromium } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DOORS = [
  'meetups.hypercomb.com', 'jaime-weise.hypercomb.com', 'colony.hypercomb.com',
  'hyperdex.hypercomb.com', 'business-card.hypercomb.com',
  'revolucion.pluginthematrix.com', 'arkanoid.pluginthematrix.com',
]
const VALUED = new Set(['runs', 'rates', 'timeout', 'tail', 'regress-pct', 'regress-ms', 'out', 'gl'])
const SWITCHES = new Set(['quick', 'no-gate', 'accept'])
// The full Chromium build in new headless mode, never the headless shell the
// older scripts ran: the shell has no WebGL2 here, so Pixi failed its shader on
// every hexagon door and the numbers timed a broken render.
const GL_ARGS = { gpu: [], software: ['--use-angle=swiftshader'] }
const SIG_PATH = /^\/[0-9a-f]{64}$/
// The runtime's own words for a plan naming bees the package lacks
// (hypercomb-runtime script-preloader.ts #decideArrival).
const PLAN_MISS = 'arrival plan names what this package does not carry'
// Measured 2026-10-24: the cover lifts 0.1–1.2 s after covered (meetups ×4 the
// slowest), so 5 s is a cover that is not coming down.
const SHOW_GRACE_MS = 5000
const SLOWER_P = 0.05
// The fewest runs a side at which p < SLOWER_P can happen (1 / C(8,4) = 0.014).
const MIN_TIMED_RUNS = 4

function config(argv, env) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    // A misspelt gate flag must not pass silently as a measured run.
    if (!VALUED.has(key) && !SWITCHES.has(key)) throw new Error(`unknown option --${key} (see the header of scripts/scoreboard.cjs)`)
    if (!VALUED.has(key)) { flags[key] = true; continue }
    // `--runs` with nothing after it must not quietly become the default.
    const value = inline ?? argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} needs a value`)
    flags[key] = value
  }
  const quick = !!flags.quick || env.SCOREBOARD_QUICK === '1'
  const list = positional.length ? positional
    : env.SCOREBOARD_DOORS ? env.SCOREBOARD_DOORS.split(',').map(s => s.trim()).filter(Boolean) : DOORS
  return {
    quick,
    doors: list.map(doorUrl),
    runs: Number(flags.runs ?? env.SCOREBOARD_RUNS ?? (quick ? 2 : 5)),
    rates: String(flags.rates ?? env.SCOREBOARD_RATES ?? (quick ? '1' : '1,4')).split(',').map(Number).filter(n => n >= 1),
    timeout: Number(flags.timeout ?? env.SCOREBOARD_TIMEOUT ?? 60_000),
    tail: Number(flags.tail ?? env.SCOREBOARD_TAIL ?? 1500),
    gate: !(flags['no-gate'] || env.SCOREBOARD_NO_GATE === '1'),
    accept: !!flags.accept,
    regressPct: Number(flags['regress-pct'] ?? 15),
    regressMs: Number(flags['regress-ms'] ?? 150),
    out: path.resolve(String(flags.out ?? env.SCOREBOARD_OUT ?? path.join(os.tmpdir(), 'hc-scoreboard'))),
    gl: String(flags.gl ?? env.SCOREBOARD_GL ?? 'gpu'),
    version: env.HC_VERSION || '',
    worker: env.HC_WORKER || 'pluginthematrix-core',
  }
}

function doorUrl(door) {
  return /^https?:\/\//.test(door) ? door : `https://${door.replace(/\/+$/, '')}/`
}

// ── in the page ────────────────────────────────────────────────────────────
// Runs before any page script (addInitScript). Every time is performance.now()
// in the page, so the poll interval from Node never lands in a number.
function pageHook() {
  if (window.top !== window || window.__hcScore) return
  const S = window.__hcScore = {
    coveredAt: null, verdict: null, settledAt: null, settledAfterVerdict: null,
    settledCount: null, cellsAt: null, arrival: null, loaderAt: null, shownAt: null, loaf: [], loafSupported: false, trail: [],
  }
  const now = () => Math.round(performance.now())
  const note = (effect, detail) => { if (S.trail.length < 40) S.trail.push([now(), effect, detail]) }
  const observe = (effect, payload) => {
    if (effect === 'view:arrival') {
      const view = String(payload?.view ?? '')
      note(effect, `${view || '(hexagons)'} @ /${(payload?.segments || []).join('/')}`)
      if (!S.verdict) S.verdict = { view, at: now() }
    } else if (effect === 'render:cell-count') {
      const count = Number(payload?.count ?? 0)
      note(effect, `count=${count}${payload?.settled ? ' settled' : ''}`)
      if (count > 0 && S.cellsAt == null) S.cellsAt = now()
      if (payload?.settled !== true) return
      if (S.settledAt == null) S.settledAt = now()
      if (S.verdict?.view === '' && S.settledAfterVerdict == null) { S.settledAfterVerdict = now(); S.settledCount = count }
    } else if (effect === 'loader:arrival') {
      note(effect, `now=${payload?.now} missing=${(payload?.missing || []).length}`)
      S.arrival = { at: now(), now: payload?.now ?? null, passive: payload?.passive ?? null, missing: [...(payload?.missing || [])].map(String) }
    }
  }
  // The runtime's bus pins itself on globalThis (hypercomb-core effect-bus.ts,
  // `globalThis.__hypercombEffectBus ??= new EffectBusImpl()`). An accessor
  // here sees that assignment and wraps the instance's emit, so each effect is
  // timed the moment it is emitted, not when a late subscriber's replay runs.
  let bus
  const wrapped = new WeakSet()
  Object.defineProperty(globalThis, '__hypercombEffectBus', {
    configurable: true,
    get: () => bus,
    set: value => {
      bus = value
      if (!value || typeof value.emit !== 'function' || wrapped.has(value)) return
      wrapped.add(value)
      const emit = value.emit
      value.emit = function (effect, payload) {
        try { observe(effect, payload) } catch {}
        return emit.call(this, effect, payload)
      }
    },
  })
  const watchBody = () => {
    const body = document.body
    if (!body) return false
    const check = () => { if (S.coveredAt == null && body.classList.contains('hc-view-covered')) S.coveredAt = now() }
    check()
    new MutationObserver(check).observe(body, { attributes: true, attributeFilter: ['class'] })
    return true
  }
  if (!watchBody()) {
    const wait = new MutationObserver(() => { if (watchBody()) wait.disconnect() })
    wait.observe(document, { childList: true, subtree: true })
  }
  // The cover lifts when main.visitor.ts fades it (opacity 0) or removes it.
  // Re-parenting it to <body> is one DOM operation, so it is never seen detached.
  let cover = null
  const lift = new MutationObserver(() => {
    cover ??= document.querySelector('.site-loading')
    if (!cover) return
    S.loaderAt ??= now()
    if (!cover.isConnected || cover.style.opacity === '0') { S.shownAt = now(); lift.disconnect() }
  })
  lift.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
  // Long animation frames: blockingDuration is the part of each frame that
  // kept input waiting.
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) S.loaf.push([Math.round(e.startTime), Math.round(e.duration), Math.round(e.blockingDuration || 0)])
    }).observe({ type: 'long-animation-frame', buffered: true })
    S.loafSupported = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
  } catch {}
}

// Only a settled pass AFTER the hexagons verdict counts. The passes before it
// are the empty hive root (count 0) the visit has not left yet — taking one
// stopped a ×4 business-card load at 3.6 s while its own layer painted at 7.0 s.
function stopReached() {
  const S = window.__hcScore
  return !!S && (S.coveredAt != null || (S.verdict?.view === '' && S.settledAfterVerdict != null))
}

/** The cover has lifted, or this door never had one. */
function coverLifted() {
  const S = window.__hcScore
  return !S || S.shownAt != null || S.loaderAt == null
}

function readPage(withGl) {
  const json = id => { try { return JSON.parse(document.getElementById(id)?.textContent || 'null') } catch { return null } }
  const bundle = [...document.scripts].map(s => s.getAttribute('src') || '').find(src => /(^|\/)main[-.][\w-]*\.js$/.test(src)) || null
  // Which GL the run had: a GPU and SwiftShader are different numbers.
  let gl = null
  if (withGl) {
    try {
      const g = document.createElement('canvas').getContext('webgl2')
      const info = g && g.getExtension('WEBGL_debug_renderer_info')
      gl = g ? String(info ? g.getParameter(info.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) : 'no webgl2'
      g?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch { gl = 'unknown' }
  }
  return {
    gl,
    S: window.__hcScore ? JSON.parse(JSON.stringify(window.__hcScore)) : null,
    timeOrigin: performance.timeOrigin,
    now: performance.now(),
    door: json('hc-door'),
    install: json('hc-install'),
    bundle,
  }
}

// ── in Node ────────────────────────────────────────────────────────────────

/** Where the page asked, from CDP: no 250-entry resource-timing buffer to
 *  overflow, and failed requests count too. */
function watchNetwork(cdp) {
  const requests = new Map()
  let wallOffset = null
  cdp.on('Network.requestWillBeSent', e => {
    if (wallOffset == null && e.wallTime) wallOffset = e.wallTime - e.timestamp
    if (!/^https?:/.test(e.request.url)) return
    const known = requests.get(e.requestId)
    if (known) { known.url = e.request.url; return }
    requests.set(e.requestId, {
      url: e.request.url, type: e.type || '', start: e.timestamp, end: null, bytes: 0, status: 0, failed: '', fromSW: false, headers: null,
      // A navigation's request id is its loader id; the main frame's id is the page's.
      frameId: e.frameId, nav: e.requestId === e.loaderId,
    })
  })
  cdp.on('Network.responseReceived', e => {
    const r = requests.get(e.requestId)
    if (!r) return
    r.status = e.response.status
    r.fromSW = !!e.response.fromServiceWorker
    if (e.type) r.type = e.type
    if (r.type === 'Document' && !r.headers) r.headers = e.response.headers
  })
  cdp.on('Network.loadingFinished', e => {
    const r = requests.get(e.requestId)
    if (r) { r.end = e.timestamp; r.bytes = e.encodedDataLength || 0 }
  })
  cdp.on('Network.loadingFailed', e => {
    const r = requests.get(e.requestId)
    if (r) { r.end = e.timestamp; r.failed = e.blockedReason || e.errorText || 'failed' }
  })
  // CDP stamps are monotonic seconds; the page's are ms from its timeOrigin.
  // Both meet on the wall clock.
  const wallMs = ts => (ts + (wallOffset ?? 0)) * 1000
  return { requests, wallMs }
}

/** Warnings and errors only: the production console is quiet by design, so
 *  anything here is something the runtime chose to say. */
function watchConsole(cdp) {
  const lines = []
  const push = (level, text, at) => {
    const said = String(text).trim()
    if (said && lines.length < 400) lines.push({ level, text: said.slice(0, 300), at })
  }
  const argText = a => a.value !== undefined ? String(a.value) : (a.description || a.type)
  cdp.on('Runtime.consoleAPICalled', e => {
    if (e.type === 'error' || e.type === 'warning' || e.type === 'assert') push(e.type === 'warning' ? 'warn' : 'error', e.args.map(argText).join(' '), e.timestamp)
  })
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' || entry.level === 'warning') push(entry.level === 'warning' ? 'warn' : 'error', `${entry.text}${entry.url ? ` (${entry.url})` : ''}`, entry.timestamp)
  })
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d, timestamp }) => {
    push('error', d.exception?.description || d.text || 'exception', timestamp)
  })
  return lines
}

function stopOf(S) {
  if (S?.verdict?.view === '' && S.settledAfterVerdict != null) return { signal: 'cells', ms: S.settledAfterVerdict }
  if (S?.coveredAt != null) return { signal: 'covered', ms: S.coveredAt }
  return { signal: 'never', ms: null }
}

/** What the arrival plan came to: 'resolved' (every name found), 'missing',
 *  'unread' (the door names a plan the runtime never applied), or 'none'. */
function planOf(door, S, consoleLines) {
  const warned = consoleLines.some(l => l.text.includes(PLAN_MISS))
  const named = /^[0-9a-f]{64}$/i.test(String(door?.plan ?? ''))
  const arrival = S?.arrival
  if (arrival) {
    const missing = arrival.missing || []
    return { state: missing.length || warned ? 'missing' : arrival.now > 0 ? 'resolved' : 'empty', now: arrival.now, passive: arrival.passive, missing }
  }
  return { state: warned ? 'missing' : named ? 'unread' : 'none', now: null, passive: null, missing: [] }
}

async function measure(context, url, rate, cfg) {
  const page = context.pages()[0] ?? await context.newPage()
  await context.addInitScript(pageHook)
  const cdp = await context.newCDPSession(page)
  const net = watchNetwork(cdp)
  const consoleLines = watchConsole(cdp)
  await Promise.all(['Network.enable', 'Log.enable', 'Runtime.enable'].map(m => cdp.send(m)))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  const mainFrame = (await cdp.send('Page.getFrameTree')).frameTree.frame.id
  const started = Date.now()
  await page.goto(url, { waitUntil: 'commit', timeout: cfg.timeout }).catch(() => {})
  const left = Math.max(1, cfg.timeout - (Date.now() - started))
  const stopped = await page.waitForFunction(stopReached, null, { timeout: left, polling: 100 }).then(() => true, () => false)
  const atStop = await page.evaluate(readPage, false).catch(() => null)
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => null)
  if (stopped) await page.waitForFunction(coverLifted, null, { timeout: SHOW_GRACE_MS, polling: 100 }).catch(() => {})
  if (cfg.tail > 0) await page.waitForTimeout(cfg.tail)
  const atEnd = await page.evaluate(readPage, true).catch(() => null) ?? atStop
  return record(url, rate, { atStop, atEnd, heap, net, consoleLines, mainFrame }, cfg)
}

function record(url, rate, { atStop, atEnd, heap, net, consoleLines, mainFrame }, cfg) {
  const host = new URL(url).host
  const all = [...net.requests.values()]
  // Every time is measured from the FIRST navigation's start. A page that
  // reloads itself (the participant shell does, once, on a cold map) starts a
  // second document whose own clock would hide the first one.
  const documents = all.filter(r => r.nav && r.frameId === mainFrame && r.status > 0).sort((a, b) => a.start - b.start)
  const stopOrigin = atStop?.timeOrigin ?? 0
  const navStart = documents.length > 1 ? net.wallMs(documents[0].start) : stopOrigin
  const stop = stopOf(atStop?.S)
  // A load that never stopped is cut where it was read.
  const stopWall = stopOrigin + (stop.ms ?? atStop?.now ?? Infinity)
  const fromStart = (ms, origin) => (ms == null ? null : Math.round(ms + origin - navStart))
  const done = all.filter(r => r.end != null)
  const before = done.filter(r => net.wallMs(r.end) <= stopWall)
  const modules = list => new Set(list.filter(r => r.type === 'Script' && SIG_PATH.test(new URL(r.url).pathname)).map(r => new URL(r.url).pathname)).size
  const doc = documents.find(r => new URL(r.url).host === host) ?? documents[0]
  const headers = Object.fromEntries(Object.entries(doc?.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
  const S = atEnd?.S
  const endOrigin = atEnd?.timeOrigin ?? stopOrigin
  const loaf = S?.loaf || []
  const loafBefore = loaf.filter(([start]) => endOrigin + start <= stopWall)
  const errors = consoleLines.filter(l => l.level === 'error')
  const sri = errors.filter(l => /integrity|valid digest/i.test(l.text))
  const packageSig = String(atEnd?.install?.text ?? '').split('\n')[0].trim().toLowerCase() || null
  return {
    door: host, url, rate,
    stop: { signal: stop.signal, ms: fromStart(stop.ms, stopOrigin), ...(stop.signal === 'never' ? { timeoutMs: cfg.timeout } : {}) },
    // What the visitor saw: the loading cover lifting. 'veiled' = it was still
    // up SHOW_GRACE_MS after the stop; 'cover: false' = this door has none.
    shown: S?.loaderAt == null ? { ms: null, veiled: false, cover: false }
      : { ms: fromStart(S.shownAt, endOrigin), veiled: S.shownAt == null, cover: true },
    documents: documents.length,
    marks: {
      covered: fromStart(S?.coveredAt, endOrigin),
      verdict: S?.verdict ? { view: S.verdict.view, at: fromStart(S.verdict.at, endOrigin) } : null,
      firstCells: fromStart(S?.cellsAt, endOrigin),
      // Any settled pass, the empty root's included; the door's own pass is the stop.
      firstSettled: fromStart(S?.settledAt, endOrigin),
      doorCellCount: S?.settledCount ?? null,
      arrival: fromStart(S?.arrival?.at, endOrigin),
    },
    requests: before.length,
    bytes: before.reduce((n, r) => n + r.bytes, 0),
    moduleScripts: modules(before),
    total: { requests: done.length, bytes: done.reduce((n, r) => n + r.bytes, 0), moduleScripts: modules(done) },
    // The spread between runs is mostly the network: the slowest requests say
    // which one stalled this time.
    slowest: [...before].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 3)
      .map(r => `${Math.round((r.end - r.start) * 1000)} ms ${new URL(r.url).pathname.slice(0, 80)}`),
    failedRequests: all.filter(r => r.failed || r.status >= 400).map(r => `${r.failed || r.status} ${new URL(r.url).pathname.slice(0, 80)}`).slice(0, 20),
    thirdParty: [...new Set(all.map(r => new URL(r.url).host).filter(h => h !== host))],
    servedBySW: all.filter(r => r.fromSW).length,
    plan: planOf(atEnd?.door, S, consoleLines),
    sriErrors: sri.map(l => l.text),
    consoleErrors: [...new Set(errors.map(l => l.text))].slice(0, 20),
    consoleWarnings: [...new Set(consoleLines.filter(l => l.level === 'warn').map(l => l.text))].slice(0, 20),
    loaf: {
      supported: !!S?.loafSupported,
      count: loafBefore.length,
      blockingMs: loafBefore.reduce((n, [, , b]) => n + b, 0),
      blockingTotalMs: loaf.reduce((n, [, , b]) => n + b, 0),
      longestMs: loaf.reduce((n, [, d]) => Math.max(n, d), 0),
    },
    heapMB: heap ? +(heap.usedSize / 1048576).toFixed(1) : null,
    stamps: {
      workerVersion: cfg.version || Object.entries(headers).find(([k]) => /version/.test(k))?.[1] || null,
      packageSig,
      doorHead: atEnd?.door?.layer ?? null,
      plan: atEnd?.door?.plan ?? null,
      publishedAt: atEnd?.door?.publishedAt ?? null,
      shellBundle: atEnd?.bundle ?? null,
      shellEtag: headers.etag ?? null,
      edge: String(headers['cf-ray'] ?? '').split('-')[1] || null,
      status: doc?.status ?? null,
      gl: atEnd?.gl ?? null,
    },
    trail: (S?.trail ?? []).map(([at, effect, detail]) => [fromStart(at, endOrigin), effect, detail]),
  }
}

/** A load the browser could not even make still counts — as a 'never' — so a
 *  door whose every load fails cannot drop out of the summary and pass the gate. */
function failedLoad(url, rate, error, cfg) {
  const said = String(error?.message || error).split('\n')[0]
  return {
    door: new URL(url).host, url, rate, error: said,
    stop: { signal: 'never', ms: null, timeoutMs: cfg.timeout }, shown: { ms: null, veiled: false, cover: false }, documents: 0, marks: {},
    requests: 0, bytes: 0, moduleScripts: 0, total: { requests: 0, bytes: 0, moduleScripts: 0 },
    slowest: [], failedRequests: [], thirdParty: [], servedBySW: 0,
    plan: { state: 'none', now: null, passive: null, missing: [] },
    sriErrors: [], consoleErrors: [said], consoleWarnings: [],
    loaf: { supported: false, count: 0, blockingMs: 0, blockingTotalMs: 0, longestMs: 0 }, heapMB: null,
    stamps: { workerVersion: cfg.version || null, packageSig: null, doorHead: null, plan: null, publishedAt: null, shellBundle: null, shellEtag: null, edge: null, status: null, gl: null },
    trail: [],
  }
}

/** One load, one browser, one profile — removed again whatever happens. */
async function load(url, rate, cfg) {
  const dir = fs.mkdtempSync(path.join(cfg.out, 'profile-'))
  live.dir = dir
  const context = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Cloudflare's Report-To/NEL headers ask the browser to report failures
    // to a.nel.cloudflare.com — a third party (P4). It never resolves here.
    args: ['--host-resolver-rules=MAP *.nel.cloudflare.com ~NOTFOUND', ...GL_ARGS[cfg.gl]],
    ...(cfg.version ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `${cfg.worker}="${cfg.version}"` } } : {}),
  })
  try { return await measure(context, url, rate, cfg) }
  finally {
    await context.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    live.dir = null
  }
}
const live = { dir: null }

// ── summary, table, diff ───────────────────────────────────────────────────

const median = xs => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** Nearest rank: with 5 runs p90 is the slowest. */
const p90 = xs => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(0.9 * xs.length) - 1] : null
const distinct = xs => [...new Set(xs.filter(x => x != null))]
const mostCommon = xs => {
  const counts = new Map()
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const finite = n => (Number.isFinite(n) ? n : null)

/** The chance that loads as slow as `now`, against `was`, come from nothing
 *  changing: a one-sided Mann–Whitney test, exact. U counts the (new, old)
 *  pairs where the new load was slower (a tie counts half). ways(n, m, k)
 *  counts the orderings of n new and m old loads with exactly k such pairs:
 *  the slowest load of all is either a new one (beating all m old) or an old
 *  one (beating none). */
function slowerChance(was, now) {
  let u = 0
  for (const x of now) for (const y of was) u += x > y ? 1 : x === y ? 0.5 : 0
  const memo = new Map()
  const ways = (n, m, k) => {
    if (k < 0) return 0
    if (n === 0 || m === 0) return k === 0 ? 1 : 0
    const key = `${n},${m},${k}`
    if (!memo.has(key)) memo.set(key, ways(n - 1, m, k - m) + ways(n, m - 1, k))
    return memo.get(key)
  }
  let atLeast = 0
  let all = 0
  for (let k = 0; k <= now.length * was.length; k++) {
    const w = ways(now.length, was.length, k)
    all += w
    if (k >= u) atLeast += w
  }
  return all ? atLeast / all : 1
}

function summarize(runs) {
  const groups = new Map()
  for (const r of runs) {
    const key = `${r.door} x${r.rate}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const summary = {}
  for (const [key, rs] of groups) {
    // A 'never' is slower than anything — it sorts last, so a door that
    // mostly never comes up has a 'never' median, not a flattering one.
    const times = rs.map(r => r.stop.ms ?? Infinity)
    const states = distinct(rs.map(r => r.plan.state))
    summary[key] = {
      door: rs[0].door, rate: rs[0].rate, n: rs.length,
      never: rs.filter(r => r.stop.signal === 'never').length,
      signal: mostCommon(rs.map(r => r.stop.signal)),
      median: finite(median(times)), p90: finite(p90(times)),
      // Per run, for the gate's chance test; a 'never' is stored as null.
      times: times.map(finite),
      min: finite(Math.min(...times)), max: finite(Math.max(...times)),
      shown: finite(median(rs.filter(r => r.shown?.cover).map(r => r.shown.ms ?? Infinity))),
      veiled: rs.filter(r => r.shown?.veiled).length,
      requests: median(rs.map(r => r.requests)),
      kb: Math.round(median(rs.map(r => r.bytes)) / 1024),
      moduleScripts: median(rs.map(r => r.moduleScripts)),
      blockingMs: median(rs.map(r => r.loaf.blockingMs)),
      heapMB: median(rs.map(r => r.heapMB).filter(x => x != null)),
      plan: states.length === 1 ? states[0] : `mixed(${states.join('/')})`,
      missing: distinct(rs.flatMap(r => r.plan.missing)),
      sriErrors: rs.reduce((n, r) => n + r.sriErrors.length, 0),
      consoleErrors: distinct(rs.flatMap(r => r.consoleErrors)).length,
      thirdParty: distinct(rs.flatMap(r => r.thirdParty)),
      stamps: {
        workerVersion: distinct(rs.map(r => r.stamps.workerVersion)),
        packageSig: distinct(rs.map(r => r.stamps.packageSig)),
        doorHead: distinct(rs.map(r => r.stamps.doorHead)),
        plan: distinct(rs.map(r => r.stamps.plan)),
        shellBundle: distinct(rs.map(r => r.stamps.shellBundle)),
        gl: distinct(rs.map(r => r.stamps.gl)),
      },
      reloaded: rs.filter(r => r.documents > 1).length,
    }
  }
  return summary
}

const secs = ms => (ms == null ? 'never' : `${(ms / 1000).toFixed(2)} s`)
const short = sig => (sig ? sig.slice(0, 8) : '-')

function table(summary) {
  const rows = [['door', 'cpu', 'n', 'stop', 'median', 'p90', 'shown', 'req', 'KB', 'mods', 'block', 'heap', 'plan', 'sri', 'err']]
  for (const s of Object.values(summary)) {
    rows.push([
      s.door, `x${s.rate}`, String(s.n), s.never ? `${s.signal} (${s.never} never)` : s.signal,
      secs(s.median), secs(s.p90), s.veiled ? `VEILED ${s.veiled}/${s.n}` : s.shown == null ? '-' : secs(s.shown),
      String(Math.round(s.requests)), String(s.kb), String(Math.round(s.moduleScripts)),
      `${Math.round(s.blockingMs)}ms`, s.heapMB == null ? '-' : `${Math.round(s.heapMB)}MB`,
      s.missing.length ? `${s.plan}:${s.missing.length}` : s.plan, String(s.sriErrors), String(s.consoleErrors),
    ])
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)))
  return rows.map(r => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n')
}

function stampLines(summary) {
  const seen = new Set()
  const lines = []
  for (const s of Object.values(summary)) {
    if (seen.has(s.door)) continue
    seen.add(s.door)
    const st = s.stamps
    const many = xs => (xs.length > 1 ? ` (CHANGED MID-RUN: ${xs.map(short).join(' → ')})` : '')
    lines.push(`${s.door.padEnd(32)} package ${short(st.packageSig[0])}${many(st.packageSig)} · head ${short(st.doorHead[0])}${many(st.doorHead)} · plan ${short(st.plan[0])} · shell ${st.shellBundle[0] || '-'}${s.thirdParty.length ? ` · THIRD PARTY ${s.thirdParty.join(',')}` : ''}`)
  }
  return lines.join('\n')
}

/** Door by door against the baseline; returns the reasons the gate fails. */
function diff(prev, cur, cfg) {
  const reasons = []
  const lines = []
  for (const [key, c] of Object.entries(cur)) {
    if (c.sriErrors) reasons.push(`${key}: ${c.sriErrors} SRI failure(s)`)
    const p = prev?.[key]
    if (!p) { lines.push(`${key.padEnd(36)} new — no baseline`); continue }
    const was = p.median ?? (p.never ? Infinity : null)
    const now = c.median ?? (c.never ? Infinity : null)
    let note = ''
    if (was != null && now != null && Number.isFinite(was) && Number.isFinite(now)) {
      const delta = now - was
      const pct = (delta / was) * 100
      note = `${secs(was)} → ${secs(now)}  (${delta >= 0 ? '+' : ''}${Math.round(delta)} ms, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`
      const regressed = delta > cfg.regressMs && pct > cfg.regressPct
      // A 'never' is slower than any time (JSON keeps it as null).
      const times = s => s.times?.map(t => t ?? Infinity)
      const chance = p.times ? slowerChance(times(p), times(c)) : null
      if (regressed && chance != null && chance < SLOWER_P) reasons.push(`${key}: median ${secs(was)} → ${secs(now)} (p=${chance.toFixed(3)})`)
      else if (regressed) note += chance == null ? '  (over the line; the baseline has no per-run times to test)' : `  (over the line, but p=${chance.toFixed(2)}: within the noise)`
    } else {
      note = `${secs(finite(was))} → ${secs(finite(now))}`
      if (Number.isFinite(was) && !Number.isFinite(now)) reasons.push(`${key}: came up before, never does now`)
    }
    // An older baseline carries no `veiled`: only a cover seen lifting can regress.
    if (p.veiled === 0 && c.veiled > 0) reasons.push(`${key}: the loading cover stayed up in ${c.veiled}/${c.n} loads`)
    if (p.plan === 'resolved' && c.plan !== 'resolved') reasons.push(`${key}: plan stopped resolving (${c.plan}${c.missing.length ? `: ${c.missing.join(', ')}` : ''})`)
    if (p.plan !== c.plan) note += `  plan ${p.plan} → ${c.plan}`
    if (p.stamps?.packageSig?.[0] !== c.stamps.packageSig[0]) note += `  package ${short(p.stamps?.packageSig?.[0])} → ${short(c.stamps.packageSig[0])}`
    if (p.stamps?.doorHead?.[0] !== c.stamps.doorHead[0]) note += `  head ${short(p.stamps?.doorHead?.[0])} → ${short(c.stamps.doorHead[0])}`
    if (p.stamps?.shellBundle?.[0] !== c.stamps.shellBundle[0]) note += `  shell ${p.stamps?.shellBundle?.[0]} → ${c.stamps.shellBundle[0]}`
    lines.push(`${key.padEnd(36)} ${note}`)
  }
  return { reasons, lines }
}

/** A quick run (2 loads at ×1) against a full one is noise against signal —
 *  the first quick-vs-full diff failed the gate on noise alone — and a GPU
 *  against SwiftShader is two machines: each mode keeps its own baseline. */
const pointerFile = cfg => path.join(cfg.out, `latest${cfg.gl === 'gpu' ? '' : `-${cfg.gl}`}${cfg.quick ? '-quick' : ''}.json`)

/** The pointer carries the baseline summary door by door, so a run over a few
 *  doors advances only those and every other door keeps its own. */
function readBaseline(cfg) {
  try { return JSON.parse(fs.readFileSync(pointerFile(cfg), 'utf8')) } catch { return null }
}

function writeBaseline(cfg, baseline, file, at, summary) {
  const mine = Object.fromEntries(Object.entries(summary).map(([key, s]) => [key, { ...s, from: file }]))
  fs.writeFileSync(pointerFile(cfg), JSON.stringify({ file, at, summary: { ...baseline?.summary, ...mine } }, null, 1))
}

function progress(r, run, cfg) {
  const plan = r.plan.state + (r.plan.missing.length ? `:${r.plan.missing.length}` : '')
  const shown = r.shown.veiled ? 'VEILED' : r.shown.cover ? `shown ${secs(r.shown.ms)}` : 'no cover'
  return `run ${run}/${cfg.runs} cpu×${r.rate} ${r.door.padEnd(32)} ${r.stop.signal.padEnd(7)} ${secs(r.stop.ms).padStart(8)} · ${shown} · ${String(r.requests).padStart(4)} req ${String(Math.round(r.bytes / 1024)).padStart(6)} KB · ${String(r.moduleScripts).padStart(3)} mods · block ${r.loaf.blockingMs} ms · plan ${plan}${r.sriErrors.length ? ` · SRI ${r.sriErrors.length}` : ''}${r.consoleErrors.length ? ` · ${r.consoleErrors.length} err` : ''}${r.documents > 1 ? ` · RELOADED (${r.documents} documents)` : ''}`
}

async function main() {
  const cfg = config(process.argv.slice(2), process.env)
  if (!cfg.runs || !cfg.rates.length || !cfg.doors.length) throw new Error('nothing to measure: check --runs, --rates and the door list')
  if (!GL_ARGS[cfg.gl]) throw new Error(`--gl is gpu or software, not ${cfg.gl}`)
  const numbers = { timeout: cfg.timeout, tail: cfg.tail, 'regress-pct': cfg.regressPct, 'regress-ms': cfg.regressMs }
  for (const [name, n] of Object.entries(numbers)) if (!(n >= 0)) throw new Error(`--${name} must be a number ≥ 0, not ${n}`)
  fs.mkdirSync(cfg.out, { recursive: true })
  const startedAt = new Date()
  console.log(`scoreboard: ${cfg.doors.length} doors × ${cfg.runs} runs × cpu ${cfg.rates.map(r => `×${r}`).join(' ')} — fresh browser per load${cfg.version ? ` — worker ${cfg.worker}="${cfg.version}"` : ''}\n`)
  const runs = []
  // Interleaved: run 1 of every door at every rate, then run 2, …
  for (let run = 1; run <= cfg.runs; run++) {
    for (const rate of cfg.rates) {
      for (const url of cfg.doors) {
        const r = await load(url, rate, cfg).catch(error => failedLoad(url, rate, error, cfg))
        if (r.error) console.log(`run ${run}/${cfg.runs} cpu×${rate} ${r.door}: LOAD FAILED — ${r.error}`)
        r.run = run
        runs.push(r)
        if (!r.error) console.log(progress(r, run, cfg))
      }
    }
  }
  const summary = summarize(runs)
  const file = path.join(cfg.out, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`)
  const result = {
    at: startedAt.toISOString(), finishedAt: new Date().toISOString(), host: os.hostname(),
    config: { ...cfg, out: undefined }, summary, runs,
  }
  fs.writeFileSync(file, JSON.stringify(result, null, 1))
  console.log(`\n${table(summary)}\n\n${stampLines(summary)}`)
  console.log(`\nworker version: ${cfg.version || 'not observable from a door (no header); set HC_VERSION to stamp it'}`)
  console.log(`gl: ${distinct(runs.map(r => r.stamps.gl)).join(' | ') || '-'}`)
  console.log(`written: ${file}`)

  const baseline = readBaseline(cfg)
  const { reasons, lines } = diff(baseline?.summary, summary, cfg)
  console.log(baseline ? `\nvs ${pointerFile(cfg)} (last advanced ${baseline.at})\n${lines.join('\n')}` : `\nno baseline in ${pointerFile(cfg)} yet`)
  const failed = reasons.length > 0
  // Measured 2026-10-24: one door's ×1 loads spread 0.98–2.43 s across five
  // runs (network, not CPU), and a quick run on an unchanged deployment moved
  // four doors' medians +29–50%: a median of two is a smoke check, not a gate.
  if (cfg.runs < MIN_TIMED_RUNS) console.log(`\n(${cfg.runs} run${cfg.runs > 1 ? 's' : ''} per door: too few to tell a slower door from network noise — times are shown, not gated)`)
  const veiled = Object.entries(summary).filter(([, s]) => s.veiled).map(([key, s]) => `${key} ${s.veiled}/${s.n}`)
  if (veiled.length) console.log(`\nVEILED — covered, but the loading cover never lifted within ${SHOW_GRACE_MS / 1000} s: ${veiled.join(', ')}`)
  if (failed) console.log(`\nGATE FAIL${cfg.gate ? '' : ' (not gating: --no-gate)'}:\n  ${reasons.join('\n  ')}`)
  else console.log('\ngate: pass')
  // --no-gate only spares the exit code: a failing run never becomes the
  // baseline unless --accept says so.
  if (!failed || cfg.accept) {
    writeBaseline(cfg, baseline, file, result.at, summary)
    console.log(`baseline → ${file}`)
  } else {
    console.log(`baseline kept: ${baseline?.file ?? 'none yet'} (--accept takes this run instead)`)
  }
  process.exitCode = failed && cfg.gate ? 1 : 0
}

process.on('SIGINT', () => {
  if (live.dir) fs.rmSync(live.dir, { recursive: true, force: true })
  process.exit(130)
})

main().catch(error => { console.error(error); process.exit(2) })
