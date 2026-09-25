// If bees woke only when a stream they listen to carries something, which
// bees would a published site's arrival wake? One ordinary visitor load with
// the EffectBus watched: every effect emitted before the cover is up, and
// every bee module (by the /<sig> in its subscribe stack) listening to it.
//   node scripts/visitor-effect-demand.cjs [url] [usage.txt]
// usage.txt (visitor-bee-usage.cjs output) names the modules.
const { chromium } = require('playwright')
const fs = require('fs')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
const names = new Map()
if (process.argv[3]) {
  for (const line of fs.readFileSync(process.argv[3], 'utf8').split('\n')) {
    const m = /\s([0-9a-f]{12})\s+(.+)$/.exec(line)
    if (m) names.set(m[1], m[2].trim())
  }
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(() => {
    const log = { emits: [], subs: [] }
    window.__effectDemand = log
    let bus
    Object.defineProperty(globalThis, '__hypercombEffectBus', {
      configurable: true,
      get: () => bus,
      set: (value) => {
        bus = value
        const emit = value.emit.bind(value)
        const on = value.on.bind(value)
        value.emit = (effect, payload) => {
          const covered = document.body?.classList.contains('hc-view-covered') ?? false
          log.emits.push({ effect, covered, at: performance.now() })
          return emit(effect, payload)
        }
        value.on = (effect, handler) => {
          const stack = new Error().stack || ''
          const sig = (/\/([0-9a-f]{64})(?::\d+)/.exec(stack) || [])[1] || '(shell)'
          log.subs.push({ effect, sig })
          return on(effect, handler)
        }
      },
    })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 45_000, polling: 50 })
  await page.waitForTimeout(3000)
  const log = await page.evaluate(() => window.__effectDemand)
  await browser.close()

  const before = new Set(log.emits.filter(e => !e.covered).map(e => e.effect))
  const all = new Set(log.emits.map(e => e.effect))
  const woken = new Map()
  for (const s of log.subs) {
    if (!before.has(s.effect) || s.sig === '(shell)') continue
    const list = woken.get(s.sig) ?? new Set()
    list.add(s.effect)
    woken.set(s.sig, list)
  }
  const subscribers = new Set(log.subs.map(s => s.sig))
  console.log(`=== ${url}`)
  console.log(`effects emitted before cover: ${before.size} (all: ${all.size}); modules subscribing to anything: ${subscribers.size}`)
  console.log(`modules an effect-demand arrival would wake: ${woken.size}`)
  const byEffect = new Map()
  for (const [sig, effects] of woken) for (const e of effects) byEffect.set(e, [...(byEffect.get(e) ?? []), sig])
  for (const [effect, sigs] of [...byEffect].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(sigs.length).padStart(4)}  ${effect.padEnd(34)} ${sigs.slice(0, 6).map(s => (names.get(s.slice(0, 12)) ?? s.slice(0, 12)).replace(/^BEE /, '').split('/').pop()).join(' ')}${sigs.length > 6 ? ' …' : ''}`)
  }
})().catch(e => { console.error(e); process.exit(1) })
