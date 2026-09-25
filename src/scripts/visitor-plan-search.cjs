// Find the smallest arrival plan that still opens a published site. Starting
// from the named faces, delta-debugging adds bee classes from the package
// (by the class names in its layer docs) until the arrival works — each trial
// is a cold load with the plan injected at /site.json, judged by one
// selector appearing. Prints the plan, as IoC-style names, when it settles.
//   node scripts/visitor-plan-search.cjs <url> <success-selector> <dist-dir> [Face,...]
// HC_VERSION targets a worker version staged at 0% (it must carry the arrival
// preloader). <dist-dir> is the essentials build the visitor ships.
const { chromium } = require('playwright')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const [url, success, distDir, facesArg = ''] = process.argv.slice(2)
const VERSION = process.env.HC_VERSION || ''
const WAIT = Number(process.env.WAIT || 15000)

const classes = new Set()
for (const f of fs.readdirSync(distDir)) {
  if (!/^[0-9a-f]{64}$/.test(f)) continue
  const full = path.join(distDir, f)
  if (fs.statSync(full).isDirectory()) continue
  const bytes = fs.readFileSync(full)
  if (bytes[0] !== 0x7b) continue
  try {
    const layer = JSON.parse(bytes)
    for (const doc of Object.values(layer?.docs?.bees ?? {})) if (doc?.className) classes.add(doc.className)
  } catch { /* not a layer */ }
}
const faces = facesArg.split(',').map(s => s.trim()).filter(Boolean)
const pool = [...classes].filter(c => !faces.includes(c)).sort()

let trials = 0
const works = async (names) => {
  trials++
  const body = JSON.stringify({ arrive: names })
  const plan = crypto.createHash('sha256').update(body).digest('hex')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `pluginthematrix-core="${VERSION}"` } } : {}),
    })
    const page = await context.newPage()
    await page.route(`**/content/${plan}`, route => route.fulfill({ status: 200, contentType: 'application/json', body }))
    await page.route('**/site.json*', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), plan } })
    })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    return await page.locator(success).first().waitFor({ state: 'visible', timeout: WAIT }).then(() => true, () => false)
  } finally {
    await browser.close()
  }
}

// ddmin over the pool: the smallest subset S such that works(need ∪ S).
const minimal = async (need, candidates) => {
  if (await works([...need])) return []
  if (candidates.length === 1) return candidates
  const half = Math.ceil(candidates.length / 2)
  const a = candidates.slice(0, half)
  const b = candidates.slice(half)
  if (await works([...need, ...a])) return minimal(need, a)
  if (await works([...need, ...b])) return minimal(need, b)
  const fromA = await minimal([...need, ...b], a)
  const fromB = await minimal([...need, ...fromA], b)
  return [...fromA, ...fromB]
}

;(async () => {
  console.log(`${url} — ${faces.length} faces, ${pool.length} classes in the pool`)
  if (!(await works([...faces, ...pool]))) {
    console.log('the whole package does not pass the check — fix the selector or the build first')
    process.exit(1)
  }
  const added = await minimal(faces, pool)
  const plan = [...faces, ...added]
  console.log(`\nsettled after ${trials} trials — ${plan.length} classes:`)
  console.log(JSON.stringify(plan.map(c => `@diamondcoreprocessor.com/${c}`)))
})().catch(e => { console.error(e); process.exit(1) })
