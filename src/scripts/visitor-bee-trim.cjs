// Can a published site do without these bees? Loads the site with the named
// bee modules answered by an empty module (they never register), then reports
// what a visitor sees: the words on screen, what a click on the first tile
// changes, and every page error — beside a normal load. Nothing is built or
// deployed; the trim happens at the network.
//   node scripts/visitor-bee-trim.cjs <url> <usage.txt> [drop-pattern ...]
// usage.txt is visitor-bee-usage.cjs output (sig ↔ name). A pattern matches a
// bee's source path by prefix ("assistant/", "games/arkanoid/arkanoid.drone").
// '*' drops every named bee; KEEP=pattern,... protects bees from a drop. SHOT=dir saves screenshots.
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const [url, usageFile, ...drops] = process.argv.slice(2)
const keep = (process.env.KEEP || '').split(',').filter(Boolean)
const shotDir = process.env.SHOT || ''
const steps = (process.env.STEPS || '').split('|').filter(Boolean)

const bees = fs.readFileSync(usageFile, 'utf8').split('\n')
  .map(line => /\s([0-9a-f]{12})\s+BEE (.+)$/.exec(line)).filter(Boolean)
  .map(m => ({ short: m[1], name: m[2].trim() }))
const dropped = bees.filter(b => drops.some(p => p === '*' || b.name.startsWith(p)) && !keep.some(p => b.name.startsWith(p)))
const droppedShort = new Set(dropped.map(b => b.short))

const visit = async (label, trim) => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror ${String(e.message).slice(0, 160)}`))
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes("'integrity' attribute")) errors.push(`console ${m.text().slice(0, 160)}`) })
  let stubbed = 0
  if (trim) {
    await page.route(/\/[0-9a-f]{64}(\.js)?$/, async (route) => {
      const sig = /\/([0-9a-f]{64})/.exec(route.request().url())[1]
      if (droppedShort.has(sig.slice(0, 12)) && route.request().resourceType() === 'script') {
        stubbed++
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export {}' })
      }
      return route.continue()
    })
  }
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const covered = await page.waitForFunction(() => document.body.classList.contains('hc-view-covered'), null, { timeout: 45_000, polling: 50 })
    .then(() => Date.now() - t0).catch(() => null)
  await page.waitForTimeout(3500)
  const words = async () => (await page.evaluate(() => document.body.innerText)).split(/\s+/).filter(Boolean)
  const before = await words()
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-arrive.png`) })
  // STEPS="a[href='/x/journal']|button[aria-label='Exit website']" clicks each selector in turn (a site link, the
  // door to the hive); the words and address after every step are compared.
  const after = []
  const moves = []
  for (const [i, text] of steps.entries()) {
    const target = page.locator(text).first()
    const ok = await target.click({ timeout: 4000 }).then(() => true).catch(() => false)
    await page.waitForTimeout(2500)
    after.push(...(await words()).map(w => `${i}:${w}`))
    moves.push(`${text}${ok ? '' : '(missing)'}→${new URL(await page.evaluate(() => location.href)).pathname}`)
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `${label}-step${i}.png`) })
  }
  await browser.close()
  return { label, covered, stubbed, before, after, moved: moves.join(' '), errors }
}

;(async () => {
  console.log(`dropping ${dropped.length} bees:`, dropped.map(b => b.name).join(' '))
  const base = await visit('base', false)
  const trim = await visit('trim', true)
  for (const r of [base, trim]) {
    console.log(`\n[${r.label}] covered ${r.covered} ms, stubbed ${r.stubbed}, words ${r.before.length}→${r.after.length}, steps ${r.moved}, errors ${r.errors.length}`)
  }
  const diff = (a, b) => a.filter(w => !b.includes(w))
  const lost = [...new Set([...diff(base.before, trim.before), ...diff(base.after, trim.after)])]
  const gained = [...new Set([...diff(trim.before, base.before), ...diff(trim.after, base.after)])]
  console.log(`\nwords lost: ${lost.slice(0, 40).join(' ') || '(none)'}`)
  console.log(`words gained: ${gained.slice(0, 40).join(' ') || '(none)'}`)
  const newErrors = trim.errors.filter(e => !base.errors.includes(e))
  console.log(`new errors (${newErrors.length}):\n  ${newErrors.slice(0, 12).join('\n  ')}`)
  console.log(`\nVERDICT ${trim.covered && base.moved === trim.moved && !lost.length && !newErrors.length ? 'SAME' : 'DIFFERENT'}`)
})().catch(e => { console.error(e); process.exit(1) })
