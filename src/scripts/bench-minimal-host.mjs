#!/usr/bin/env node
// bench-minimal-host — THE PORTING GATE. Moving something from the Angular
// build to the minimal (pure) host must not make loading or running worse.
// This measures both hosts serving the same package, in the same browser,
// and fails when the minimal host is worse than the Angular one beyond a
// small tolerance.
//
//   node scripts/bench-minimal-host.mjs --pure http://localhost:4911/ \
//     --web http://localhost:4912/ --root <package signature> [--rate 4]
//
//   --boots N   warm boots per host for load (default 8)
//   --rounds N  browsers per host for runtime (default 3)
//   --rate N    CPU slowdown, 1 = none, 4 = a mid phone (default 1)
//
// LOAD: warm boots alternate between two live profiles, so drift hits both:
// first frame (render:cell-count), all bees loaded (loader:bees-done), main
// thread blocked during the boot (long tasks), JS heap.
// RUNTIME: one host per browser (two rendering pages in one headless browser
// starve each other's WebGL and frames), settled after one warm reload: frame
// times while dragging and scrolling the hive, and idle blocking over 10 s.
//
// The web shell installs from the default hosts on a cold start; both
// jwize.com and hypercomb.com are answered from the web origin, so both hosts
// install the same bytes. Serve each origin with hypercomb-shim/host/serve.mjs:
// the pure build output (with the package content copied in) and
// hypercomb-web/dist/hypercomb-web/browser.

import { chromium } from 'playwright'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const PURE = arg('pure'), WEB = arg('web'), ROOT = arg('root')
const BOOTS = Number(arg('boots', 8)), ROUNDS = Number(arg('rounds', 3)), RATE = Number(arg('rate', 1))
if (!PURE || !WEB || !/^[0-9a-f]{64}$/.test(ROOT ?? '')) {
  console.error('usage: node scripts/bench-minimal-host.mjs --pure <url> --web <url> --root <package sig> [--boots 8] [--rounds 3] [--rate 1]')
  process.exit(2)
}
// Worse than the Angular host by more than this is a failure.
const TOLERANCE = { ratio: 1.05, ms: 30 }

const HOOK = () => {
  const marks = (window.__hcMarks = {})
  let bus
  Object.defineProperty(globalThis, '__hypercombEffectBus', {
    configurable: true, get: () => bus,
    set: v => { bus = v; const emit = v.emit.bind(v); v.emit = (e, p) => { if (!(e in marks)) marks[e] = performance.now(); return emit(e, p) } },
  })
  window.__hcLong = []
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__hcLong.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true }) } catch {}
}

const launch = () => chromium.launch({
  args: ['--enable-precise-memory-info'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})

const open = async (browser, label, url) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(HOOK)
  await ctx.route(/^https:\/\/(content\.)?(hypercomb|jwize)\.com\//, async route => {
    const path = new URL(route.request().url()).pathname
    try {
      const r = await fetch(new URL(path, WEB))
      await route.fulfill({ status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: { 'access-control-allow-origin': '*', 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' } })
    } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  const page = await ctx.newPage()
  await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: RATE })
  await page.goto(url, { waitUntil: 'load' })
  if (label === 'pure') {
    await page.waitForFunction(() => !!document.querySelector('hc-shim-hosts'), null, { timeout: 120000 })
    const ok = await page.evaluate(async r => (await window.ioc.get('@hypercomb.social/Install').acquire(r, [location.host])).ok, ROOT)
    if (!ok) throw new Error('the pure host could not install the package')
  }
  await page.waitForTimeout(20000)
  return page
}

const ready = page => page.waitForFunction(() => 'render:cell-count' in (window.__hcMarks ?? {}) && 'loader:bees-done' in window.__hcMarks, null, { timeout: 120000, polling: 50 })

const drag = async page => {
  const box = await page.evaluate(() => { const c = document.querySelector('#pixi-host canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  if (!box) return null
  await page.evaluate(() => { window.__hcFrames = []; let last = performance.now(); const tick = t => { window.__hcFrames.push(t - last); last = t; if (window.__hcFrames.length < 1000) requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await page.mouse.move(box.x, box.y); await page.mouse.down()
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(box.x + Math.sin(i / 8) * 260, box.y + Math.cos(i / 8) * 160, { steps: 2 })
    if (i % 20 === 0) await page.mouse.wheel(0, i % 40 ? 120 : -120)
  }
  await page.mouse.up()
  return page.evaluate(() => window.__hcFrames.slice(2))
}

const median = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null }

// ── load ─────────────────────────────────────────────────────────────────────
const load = { pure: [], web: [] }
{
  const browser = await launch()
  const pages = { pure: await open(browser, 'pure', PURE), web: await open(browser, 'web', WEB) }
  for (const page of Object.values(pages)) { await page.reload({ waitUntil: 'load' }); await ready(page).catch(() => {}); await page.waitForTimeout(6000) }
  for (let i = 0; i < BOOTS; i++) {
    for (const [label, page] of Object.entries(pages)) {
      await page.reload({ waitUntil: 'load' })
      const ok = await ready(page).then(() => true, () => false)
      await page.waitForTimeout(1500)
      load[label].push({ ok, ...await page.evaluate(() => ({
        frame: window.__hcMarks['render:cell-count'], bees: window.__hcMarks['loader:bees-done'],
        long: window.__hcLong.reduce((n, [, d]) => n + d, 0), heap: performance.memory?.usedJSHeapSize ?? null,
      })) })
    }
  }
  await browser.close()
}

// ── runtime ──────────────────────────────────────────────────────────────────
const run = { pure: { frames: [], idle: [] }, web: { frames: [], idle: [] } }
for (let round = 0; round < ROUNDS; round++) {
  for (const [label, url] of round % 2 ? [['web', WEB], ['pure', PURE]] : [['pure', PURE], ['web', WEB]]) {
    const browser = await launch()
    const page = await open(browser, label, url)
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(15000)
    const t0 = await page.evaluate(() => performance.now())
    await page.waitForTimeout(10000)
    run[label].idle.push(await page.evaluate(t => window.__hcLong.filter(([s]) => s >= t).reduce((n, [, d]) => n + d, 0), t0))
    for (let k = 0; k < 3; k++) {
      const frames = await drag(page)
      if (frames) run[label].frames.push(...frames)
      else console.warn(`[bench] ${label}: no hive canvas to drag (round ${round + 1})`)
      await page.waitForTimeout(1000)
    }
    await browser.close()
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
const rows = [
  ['first frame (ms)', h => median(load[h].map(r => r.frame))],
  ['all bees loaded (ms)', h => median(load[h].map(r => r.bees))],
  ['boot blocking (ms)', h => median(load[h].map(r => r.long))],
  ['JS heap (MB)', h => median(load[h].map(r => r.heap)) / 1048576],
  ['drag frame p95 (ms)', h => pct(run[h].frames, 0.95)],
  ['janky frames (%)', h => run[h].frames.length ? 100 * run[h].frames.filter(f => f > 50).length / run[h].frames.length : null],
  ['idle blocking /10 s (ms)', h => median(run[h].idle)],
]
console.log(`\nminimal host vs Angular — CPU ${RATE}x, ${BOOTS} warm boots, ${ROUNDS} runtime rounds, package ${ROOT.slice(0, 12)}…\n`)
console.log('                            minimal     Angular')
let worse = 0
for (const [name, of] of rows) {
  const pure = of('pure'), web = of('web')
  const bad = pure != null && web != null && pure > web * TOLERANCE.ratio + (name.includes('%') ? 1 : name.includes('MB') ? 2 : TOLERANCE.ms)
  if (bad) worse++
  const f = v => v == null ? '—' : v.toFixed(v < 10 ? 1 : 0)
  console.log(`${name.padEnd(26)} ${f(pure).padStart(9)} ${f(web).padStart(11)}${bad ? '   WORSE' : ''}`)
}
const failedBoots = Object.entries(load).map(([h, r]) => [h, r.filter(x => !x.ok).length]).filter(([, n]) => n)
for (const [h, n] of failedBoots) console.log(`[bench] ${h}: ${n} boot(s) never reached first frame and all bees`)
if (!run.pure.frames.length || failedBoots.some(([h]) => h === 'pure')) worse++
console.log(worse ? `\nFAIL — the minimal host is worse on ${worse} measure(s)` : '\nPASS — the minimal host is not worse on any measure')
process.exit(worse ? 1 : 0)
