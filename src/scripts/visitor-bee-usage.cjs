// Which bees does a published site actually USE? One cold visitor load under
// V8 precise coverage: every /<sig> module that ran nothing beyond its own
// top level and constructor was loaded for nothing. Names come from the
// essentials build cache (sig → source file).
//   node scripts/visitor-bee-usage.cjs [url] [settleMs]
// HC_VERSION measures a worker version staged at 0%. INTERACT=1 also wheels,
// drags and clicks once the cover is up, so gesture bees count as used.
const { chromium } = require('playwright')
const path = require('path')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
const settle = Number(process.argv[3] || 4000)
const VERSION = process.env.HC_VERSION || ''

const cache = require(path.join(__dirname, '../hypercomb-essentials/.build-cache.json'))
const names = new Map()
for (const kind of ['bees', 'namespaces', 'atoms']) {
  for (const [name, entry] of Object.entries(cache[kind] ?? {})) if (entry.outputSig) names.set(entry.outputSig, `${kind === 'bees' ? 'BEE' : 'dep'} ${name}`)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `pluginthematrix-core="${VERSION}"` } } : {}),
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const covered = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 60_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => null)
  await page.waitForTimeout(settle)
  if (process.env.INTERACT) {
    await page.mouse.move(640, 400)
    await page.mouse.wheel(0, -300); await page.waitForTimeout(400)
    await page.mouse.wheel(0, 300); await page.waitForTimeout(400)
    await page.mouse.down(); await page.mouse.move(700, 450, { steps: 5 }); await page.mouse.up()
    await page.mouse.click(640, 400); await page.waitForTimeout(1500)
  }
  const { result } = await cdp.send('Profiler.takePreciseCoverage')
  await browser.close()

  const rows = []
  for (const script of result) {
    const m = /\/([0-9a-f]{64})(?:\.js)?(?:\?|$)/.exec(script.url)
    if (!m) continue
    const sig = m[1]
    // functions[0] is the module's top level. Count every other function
    // that ran at least once; a bee that ran only its constructor and
    // registration shows one or two.
    const ran = script.functions.slice(1).filter(f => f.ranges[0]?.count > 0)
    const size = script.functions[0]?.ranges[0]?.endOffset ?? 0
    rows.push({ sig, name: names.get(sig) ?? '?', ran: ran.length, total: script.functions.length - 1, size })
  }
  rows.sort((a, b) => a.ran - b.ran || b.size - a.size)
  const bees = rows.filter(r => r.name.startsWith('BEE'))
  console.log(`=== ${url} — covered at ${covered} ms, ${rows.length} modules (${bees.length} bees) ===`)
  for (const r of rows) console.log(`${String(r.ran).padStart(4)}/${String(r.total).padEnd(4)} ${(r.size / 1024).toFixed(0).padStart(5)} KB  ${r.sig.slice(0, 12)}  ${r.name}`)
})().catch(e => { console.error(e); process.exit(1) })
