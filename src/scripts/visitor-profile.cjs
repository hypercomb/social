// One cold visitor load, profiled: boot marks, where the requests go, and
// what the main thread is busy with until the site covers the screen.
//   node scripts/visitor-profile.cjs [url] [cpuRate]
const { chromium } = require('playwright')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
const rate = Number(process.argv[3] || 1)

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const VERSION = process.env.HC_VERSION || ''
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': 'pluginthematrix-core="' + VERSION + '"' } } : {}) })
  // The production console is quiet; hc:verbose=1 reopens the [boot] trail.
  if (process.env.VERBOSE) await context.addInitScript(() => { try { localStorage.setItem('hc:verbose', '1') } catch {} })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })

  const t0 = Date.now()
  const reqs = []
  page.on('requestfinished', async (req) => {
    const timing = req.timing()
    let size = 0
    try { size = (await req.sizes()).responseBodySize } catch {}
    reqs.push({ url: req.url(), type: req.resourceType(), dest: req.headers()['sec-fetch-dest'] || '', start: timing.startTime - t0, end: Date.now() - t0, size })
  })
  const boot = []
  page.on('console', m => {
    const t = m.text()
    if (/^\[boot\]|script-preloader|\[acquire\]|\[visitor\]|ensure-install|hc:ready|\[hypercomb\]|hive-visit|view:|site-view/.test(t)) boot.push(`${String(Date.now() - t0).padStart(6)}ms  ${t.slice(0, 170)}`)
  })

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const covered = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 60_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => null)
  await page.waitForTimeout(1500)

  console.log(`\n=== ${url} cpu×${rate} — covered at ${covered} ms ===\n`)
  console.log('--- boot trail ---')
  for (const line of boot) console.log(line)

  const until = covered ?? Infinity
  const before = reqs.filter(r => r.end <= until)
  const groups = {}
  for (const r of before) {
    const u = new URL(r.url)
    const kind = /^\/[0-9a-f]{64}$/.test(u.pathname) ? `flat-sig (${r.dest || r.type})`
      : /^\/content\/[0-9a-f]{64}$/.test(u.pathname) ? `content-sig (${r.dest || r.type})`
      : /^\/@resource\//.test(u.pathname) ? 'resource'
      : u.pathname.startsWith('/content/') ? 'content-other'
      : /^\/[0-9a-f]{64}\/[0-9a-f]{64}$/.test(u.pathname) ? 'hive-index'
      : /^\/[0-9a-f]{64}\/([0-9]{8})?$/.test(u.pathname) ? 'door'
      : u.protocol === 'blob:' ? 'blob'
      : `shell ${r.type}`
    const g = groups[kind] ||= { n: 0, bytes: 0, first: Infinity, last: 0 }
    g.n++; g.bytes += r.size; g.first = Math.min(g.first, r.start); g.last = Math.max(g.last, r.end)
  }
  console.log(`\n--- requests finished before cover (${before.length} of ${reqs.length}) ---`)
  for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${k.padEnd(34)} ${String(g.n).padStart(5)} req  ${(g.bytes / 1024).toFixed(0).padStart(7)} KB  ${String(Math.round(g.first)).padStart(6)}→${String(Math.round(g.last)).padStart(6)} ms`)
  }
  if (process.env.TIMELINE) {
    console.log('\n--- FETCH TIMELINE ---')
    const content = before
      .filter(r => /^\/[0-9a-f]{64}(\/|$)/.test(new URL(r.url).pathname) && (r.dest || r.type) !== 'script')
      .sort((a, b) => a.start - b.start)
    for (const r of content) {
      console.log(`${String(Math.round(r.start)).padStart(6)}→${String(Math.round(r.end)).padStart(6)}  ${String(r.size).padStart(7)}  ${new URL(r.url).pathname.slice(1)}`)
    }
  }
  const big = [...before].sort((a, b) => b.size - a.size).slice(0, 6)
  console.log('\n--- biggest ---')
  for (const r of big) console.log(`${(r.size / 1024).toFixed(0).padStart(7)} KB  ${String(Math.round(r.end)).padStart(6)} ms  ${r.url.slice(0, 110)}`)
  await browser.close()
})().catch(e => { console.error(e); process.exit(1) })
