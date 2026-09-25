// Is every library ONE instance? One full visitor load, watched two ways:
//   · IoC — every key registered more than once (a second instance offered)
//   · modules — every class defined in more than one loaded /<sig> module
//     (code inlined into several bundles instead of shared by import), and
//     every module source loaded under more than one URL
//   node scripts/visitor-duplicates.cjs [url]
// HC_VERSION targets a worker version staged at 0%.
const { chromium } = require('playwright')
const crypto = require('crypto')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
const VERSION = process.env.HC_VERSION || ''

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `pluginthematrix-core="${VERSION}"` } } : {}),
  })
  const page = await context.newPage()
  await page.addInitScript(() => {
    const seen = {}
    window.__iocDup = seen
    let ioc
    Object.defineProperty(window, 'ioc', {
      configurable: true,
      get: () => ioc,
      set: (value) => {
        ioc = value
        const register = value.register.bind(value)
        value.register = (key, instance, ...rest) => {
          const at = (seen[key] ??= { count: 0, distinct: [] })
          at.count++
          if (!at.distinct.includes(instance)) at.distinct.push(instance)
          return register(key, instance, ...rest)
        }
      },
    })
  })
  const sources = new Map()
  page.on('response', async (response) => {
    const u = new URL(response.url())
    if (response.request().resourceType() !== 'script') return
    try { sources.set(u.pathname, await response.text()) } catch { /* body gone */ }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 45_000, polling: 100 }).catch(() => null)
  await page.waitForTimeout(4000)
  const ioc = await page.evaluate(() => Object.entries(window.__iocDup).map(([key, v]) => ({ key, count: v.count, distinct: v.distinct.length })))
  await browser.close()

  const multi = ioc.filter(r => r.distinct > 1).sort((a, b) => b.distinct - a.distinct)
  console.log(`=== ${url}${VERSION ? ` @${VERSION.slice(0, 8)}` : ''}`)
  console.log(`IoC: ${ioc.length} keys, ${multi.length} offered more than one distinct instance`)
  for (const r of multi.slice(0, 25)) console.log(`  ${String(r.distinct).padStart(2)}× ${r.key}`)

  const byHash = new Map()
  const classHomes = new Map()
  for (const [path, text] of sources) {
    const hash = crypto.createHash('sha256').update(text).digest('hex')
    byHash.set(hash, [...(byHash.get(hash) ?? []), path])
    for (const m of text.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]{3,})\b/g)) {
      const homes = classHomes.get(m[1]) ?? new Set()
      homes.add(path)
      classHomes.set(m[1], homes)
    }
  }
  const sameSource = [...byHash.values()].filter(p => p.length > 1)
  const repeated = [...classHomes].filter(([, homes]) => homes.size > 1).sort((a, b) => b[1].size - a[1].size)
  console.log(`\nmodules: ${sources.size} scripts; ${sameSource.length} sources loaded under more than one URL`)
  for (const p of sameSource.slice(0, 10)) console.log(`  ${p.join('  ==  ')}`)
  console.log(`classes defined in more than one loaded script: ${repeated.length}`)
  for (const [name, homes] of repeated.slice(0, 30)) console.log(`  ${String(homes.size).padStart(2)}× ${name}  ${[...homes].slice(0, 3).map(h => h.slice(0, 14)).join(' ')}`)
})().catch(e => { console.error(e); process.exit(1) })
