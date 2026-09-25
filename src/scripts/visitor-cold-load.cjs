// THE COLD-LOAD AUDIT — run it on every deploy (jwize 2026-09-24: "give me a
// little audit on the startup whenever we're deploying things").
//
// A fresh browser profile per run (no cache, no storage, no service worker),
// the clock stopped when the published site covers the screen
// (body.hc-view-covered — the visitor cover's own signal), at this machine's
// CPU and at 4x slower (about a phone).
//
//   node scripts/visitor-cold-load.cjs [url...]
//   HC_VERSION=<worker version id> node scripts/visitor-cold-load.cjs [url...]
//
// HC_VERSION measures a version uploaded but not yet serving: deploy it at 0%
// beside the live one (`wrangler versions deploy <live>@100% <new>@0%`) and
// every request here carries `Cloudflare-Workers-Version-Overrides`, so no
// visitor meets it before it is measured. HC_WORKER names the worker
// (default pluginthematrix-core).
const { chromium } = require('playwright')

const URLS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['https://arkanoid.pluginthematrix.com/', 'https://revolucion.pluginthematrix.com/']
const VERSION = process.env.HC_VERSION || ''
const WORKER = process.env.HC_WORKER || 'pluginthematrix-core'
const RATES = [1, 4]
const RUNS = 2
const CAP_MS = 60_000

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const failed = []
  for (const rate of RATES) {
    for (const url of URLS) {
      const times = []
      for (let run = 1; run <= RUNS; run++) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `${WORKER}="${VERSION}"` } } : {}),
        })
        const page = await context.newPage()
        await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate })
        let requests = 0
        page.on('requestfinished', () => { requests++ })
        const t0 = Date.now()
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
        const ms = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: CAP_MS, polling: 50 })
          .then(() => Date.now() - t0).catch(() => null)
        times.push(ms)
        if (ms == null) failed.push(`${url} cpu×${rate}`)
        console.log(`cpu×${rate} ${url.padEnd(44)} run ${run}: ${ms == null ? `NEVER (${CAP_MS / 1000} s)` : `${(ms / 1000).toFixed(2)} s`} · ${requests} requests`)
        await context.close()
      }
    }
  }
  await browser.close()
  if (failed.length) {
    console.log(`\nFAILED — the site never came up: ${failed.join(', ')}`)
    process.exit(1)
  }
})()
