// A CPU profile of one cold visitor load, up to the cover, summarised by
// self time per function and per phase. Finds where the main thread goes.
//   node scripts/visitor-cpu-profile.cjs [url] [cpuRate] [untilMs]
// HC_VERSION measures a worker version staged at 0%. KEYS="@x.com/A,@x.com/B"
// injects a trial arrival plan (visitor-plan-check.cjs).
const { chromium } = require('playwright')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
const rate = Number(process.argv[3] || 1)
const VERSION = process.env.HC_VERSION || ''

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `pluginthematrix-core="${VERSION}"` } } : {}),
  })
  const page = await context.newPage()
  if (process.env.KEYS) {
    const body = JSON.stringify({ arrive: process.env.KEYS.split(',').map(s => s.trim()).filter(Boolean) })
    const plan = require('crypto').createHash('sha256').update(body).digest('hex')
    await page.route(`**/content/${plan}`, route => route.fulfill({ status: 200, contentType: 'application/json', body }))
    await page.route('**/site.json*', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), plan } })
    })
  }
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const covered = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 60_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => null)
  const { profile } = await cdp.send('Profiler.stop')
  await browser.close()

  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const dt = new Map()
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]
    dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
  }
  const self = new Map()
  let total = 0
  for (const [id, us] of dt) {
    const n = byId.get(id)
    const cf = n.callFrame
    const file = (cf.url || '').split('/').pop() || ''
    const key = `${cf.functionName || '(anonymous)'}  ${file.slice(0, 20)}:${cf.lineNumber}:${cf.columnNumber}`
    self.set(key, (self.get(key) ?? 0) + us)
    total += us
  }
  const byFile = new Map()
  for (const [id, us] of dt) {
    const cf = byId.get(id).callFrame
    const f = cf.url ? cf.url.split('/').pop().slice(0, 30) : `(${cf.functionName || 'native'})`
    byFile.set(f, (byFile.get(f) ?? 0) + us)
  }
  console.log(`=== ${url} cpu×${rate} — covered at ${covered} ms, sampled ${(total / 1000).toFixed(0)} ms ===`)
  console.log('\n--- top self time by function ---')
  for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`)
  console.log('\n--- self time by script ---')
  for (const [k, us] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`)
})().catch(e => { console.error(e); process.exit(1) })
