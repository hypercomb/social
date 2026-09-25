// Does a published arrival hold up on its plan alone, and how much lighter is
// it? One cold load: time to the cover, module scripts fetched before it and
// in all, what the preloader said, the words on the page, then a step off the
// page into the hive (the approach) — the hive must paint, and the passive
// bees must wake.
//   node scripts/visitor-plan-check.cjs <url> [planSig]
// HC_VERSION targets a worker version staged at 0%. A planSig is injected
// into /site.json (before the publisher has signed one); without it the page
// runs whatever its descriptor says. Keys instead of a signature
// ("@x.com/ViewBee,@x.com/SiteViewDrone") try a plan nothing has published. SHOT=dir saves screenshots.
const { chromium } = require('playwright')
const path = require('path')

const url = process.argv[2] || 'https://revolucion.pluginthematrix.com/'
// A plan is a signature, or a comma list of IoC keys served here as a trial
// plan record (so a plan can be tried before anything is published).
const planArg = process.argv[3] || ''
const trialKeys = /[@,]/.test(planArg) ? planArg.split(',').map(s => s.trim()).filter(Boolean) : null
const trialBody = trialKeys ? JSON.stringify({ arrive: trialKeys }) : ''
const plan = trialKeys ? require('crypto').createHash('sha256').update(trialBody).digest('hex') : planArg
const VERSION = process.env.HC_VERSION || ''
const shotDir = process.env.SHOT || ''
const label = new URL(url).hostname.split('.')[0] + (plan ? '-plan' : '-full')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(VERSION ? { extraHTTPHeaders: { 'Cloudflare-Workers-Version-Overrides': `pluginthematrix-core="${VERSION}"` } } : {}),
  })
  const page = await context.newPage()
  // VERBOSE=1 reopens the production console (hc:verbose) so the preloader speaks.
  if (process.env.VERBOSE) await page.addInitScript(() => { try { localStorage.setItem('hc:verbose', '1') } catch {} })
  const logs = []
  const errors = []
  page.on('console', m => {
    const text = m.text()
    if (/\[script-preloader\] (arrival|approached|find:|.*participant-only)|arrival plan/.test(text)) logs.push(text.slice(0, 200))
    if (m.type() === 'error') errors.push(text.slice(0, 160))
  })
  page.on('pageerror', e => errors.push(`pageerror ${String(e.message).slice(0, 160)}`))
  if (trialKeys) {
    await page.route(`**/content/${plan}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: trialBody }))
  }
  // QUIET="assistant,editor" injects a participant-only snapshot (as a
  // publisher's `features publish` would) and names it in /site.json.
  const quietNames = (process.env.QUIET || '').split(',').map(s => s.trim()).filter(Boolean)
  const quietBody = quietNames.length ? JSON.stringify({ features: [...new Set(quietNames)].sort() }) : ''
  const quiet = quietBody ? require('crypto').createHash('sha256').update(quietBody).digest('hex') : ''
  if (quiet) await page.route(`**/content/${quiet}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: quietBody }))
  if (plan || quiet) {
    await page.route('**/site.json*', async route => {
      const response = await route.fetch()
      const body = { ...(await response.json()), ...(plan ? { plan } : {}), ...(quiet ? { quiet } : {}) }
      await route.fulfill({ response, json: body })
    })
  }
  let covered = null
  const scripts = { before: 0, total: 0, bytesBefore: 0 }
  page.on('requestfinished', async request => {
    if (request.resourceType() !== 'script' || !/\/[0-9a-f]{64}$/.test(new URL(request.url()).pathname)) return
    scripts.total++
    if (covered === null) {
      scripts.before++
      const sizes = await request.sizes().catch(() => null)
      scripts.bytesBefore += sizes?.responseBodySize ?? 0
    }
  })
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  covered = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 45_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => -1)
  const loaderGone = await page.waitForFunction(() => !document.querySelector('.site-loading'), null, { timeout: 30_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => -1)
  await page.waitForTimeout(2500)
  const words = (await page.evaluate(() => document.body.innerText)).split(/\s+/).filter(Boolean).length
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-arrive.png`) })
  const atArrival = scripts.total

  // CLICK="<selector>" presses something on the arrival (a game's start).
  let clicked = ''
  if (process.env.CLICK) {
    const ok = await page.locator(process.env.CLICK).first().click({ timeout: 5000 }).then(() => true).catch(() => false)
    await page.waitForTimeout(2500)
    const after = (await page.evaluate(() => document.body.innerText)).split(/s+/).filter(Boolean).length
    clicked = `${process.env.CLICK} ${ok ? 'clicked' : 'MISSING'} → words ${after}`
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-click.png`) })
  }

  // The approach: off the page, into the hive.
  const exit = page.locator("button[aria-label='Exit website']").first()
  const exited = await exit.click({ timeout: 4000 }).then(() => true).catch(() => false)
  const tExit = Date.now()
  const hive = await page.waitForFunction(() => !document.body.classList.contains('hc-view-covered'), null, { timeout: 10_000, polling: 50 })
    .then(() => Date.now() - tExit).catch(() => -1)
  await page.waitForTimeout(5000)
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    return c ? `${c.width}x${c.height}` : 'none'
  })
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-hive.png`) })
  await browser.close()

  console.log(`=== ${url}${plan ? ` plan ${plan.slice(0, 12)}` : ''}${VERSION ? ` @${VERSION.slice(0, 8)}` : ''}`)
  console.log(`covered ${covered} ms · loader gone ${loaderGone} ms · words ${words}`)
  console.log(`module scripts: ${scripts.before} before cover (${(scripts.bytesBefore / 1024).toFixed(0)} KB), ${atArrival} by arrival settle, ${scripts.total} after the approach`)
  if (clicked) console.log(`click: ${clicked}`)
  console.log(`approach: exit ${exited ? 'clicked' : 'MISSING'} · cover lifted in ${hive} ms · canvas ${canvas}`)
  for (const line of logs) console.log(`  ${line}`)
  console.log(`errors (${errors.length}): ${errors.slice(0, 6).join(' | ')}`)
})().catch(e => { console.error(e); process.exit(1) })
