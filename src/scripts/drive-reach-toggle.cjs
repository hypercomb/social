// scripts/drive-reach-toggle.cjs
//
// Proof for the THREE-STAGE REACH TOGGLE: everywhere reach used to be a
// segmented trio (pheromone panel, feedback panel, files panel, the bottom
// tag strip), it is now ONE button that reads out the current reach and steps
// to the next on click — page → children → global, wrapping.
//
// For each surface this walks the full cycle by clicking the single button
// and asserts the glyph readout advances blur_on → account_tree → public →
// blur_on. On the surfaces that broadcast their reach (`tags:filter`,
// `files:reach`) the carried scope is asserted too, so the click is proven to
// CHANGE the reach, not just repaint a glyph.
//
//   node scripts/drive-reach-toggle.cjs [--headed] [--port 4250] [--out reach-toggle.png]
//
// Runs in its own Playwright profile — a fresh, empty hive of its own. It
// never touches the participant's OPFS.

const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

const PORT = String(arg('port', '4250'))
const URL = `http://localhost:${PORT}/`
const OUT = String(arg('out', 'reach-toggle.png'))
const HEADED = process.argv.includes('--headed')

const GLYPHS = ['blur_on', 'account_tree', 'public']

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const suffix = (tag) => OUT.replace(/(\.png)?$/i, `-${tag}.png`)

async function waitForReady(page, timeoutMs = 40000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => !!(
      window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
      && window.ioc?.get?.('@hypercomb.social/Lineage')
      && window.__hypercombEffectBus
    )).catch(() => false)
    if (ok) return true
    await sleep(300)
  }
  return false
}

async function addTile(page, name) {
  await page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) throw new Error('no command line')
    input.focus()
    input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 80))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  }, name)
  await sleep(500)
}

/** Click the surface's single toggle three times; return the glyph before the
 *  first click and after each — a full lap of the cycle. */
async function lap(page, locator) {
  const glyphAt = async () => (await locator.locator('.mat-sym').first().textContent())?.trim()
  const seen = [await glyphAt()]
  for (let i = 0; i < 3; i++) {
    await locator.click()
    await sleep(350)
    seen.push(await glyphAt())
  }
  return seen
}

/** A lap is right when it starts on a known glyph and walks the wheel in
 *  order, arriving back where it began. */
function lapOk(seen) {
  const start = GLYPHS.indexOf(seen[0])
  if (start < 0 || seen.length !== 4) return false
  return seen.every((g, i) => g === GLYPHS[(start + i) % 3])
}

async function main() {
  const browser = await chromium.launch({ headless: !HEADED })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', e => log('PAGE ERROR:', String(e).slice(0, 200)))

  log('open', URL)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  if (!await waitForReady(page)) throw new Error('shell never became ready')
  log('shell ready')

  const dismiss = page.locator('hc-example-hives-offer button.dismiss')
  if (await dismiss.count().catch(() => 0)) {
    await dismiss.first().click({ timeout: 3000 }).catch(() => null)
    log('dismissed the first-boot offer')
  }
  await sleep(600)

  // A couple of tiles and one mark, so the bottom tag strip exists at all.
  for (const name of ['alpha', 'beta']) await addTile(page, name)
  await page.evaluate(() => {
    const bus = window.__hypercombEffectBus
    bus.emit('tags:apply-begin', { tags: ['lit'] })
    bus.emit('tags:apply-paint', { label: 'alpha', add: true })
    bus.emit('tags:apply-commit', {})
  })
  await sleep(2000)

  // Record every reach broadcast so a click is proven to change the reach.
  const ensureLog = () => page.evaluate(() => {
    if (window.__reachLog) return
    window.__reachLog = { filter: [], files: [] }
    window.__hypercombEffectBus.on('tags:filter', p => window.__reachLog.filter.push(p?.scope))
    window.__hypercombEffectBus.on('files:reach', p => window.__reachLog.files.push(p?.reach))
  })
  await ensureLog()

  /** The dev server rebuilds whenever ANY session edits watched source, and the
   *  reload lands mid-step as "Execution context was destroyed". That is the
   *  server working, not the app failing — retry the stage through it. */
  const stage = async (label, fn) => {
    for (let attempt = 1; ; attempt++) {
      try { return await fn() } catch (err) {
        const reloaded = /Execution context was destroyed|Target closed|navigation/i.test(String(err))
        if (!reloaded || attempt >= 3) throw err
        log(`${label}: page reloaded under us (attempt ${attempt}) — waiting it out`)
        await sleep(2500)
        await waitForReady(page)
        await ensureLog()
      }
    }
  }

  const results = {}
  let filterScopes = [], filesReaches = [], stripScopes = []

  // ── 1. pheromone panel ───────────────────────────────────────────────────
  await stage('pheromone panel', async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('tags:view-open', {}))
    const panelBtn = page.locator('.tags-scope .tags-scope-btn')
    await panelBtn.waitFor({ state: 'visible', timeout: 8000 })
    results.panel = await lap(page, panelBtn)
    filterScopes = await page.evaluate(() => window.__reachLog.filter.splice(0))
    log('pheromone panel →', results.panel.join(' → '), '· tags:filter carried', filterScopes.join(', '))
    await page.locator('.tags-panel').screenshot({ path: suffix('panel') }).catch(() => null)
    await page.evaluate(() => window.__hypercombEffectBus.emit('tags:viewer-close', {})).catch(() => null)
  })

  // ── 2. feedback panel ────────────────────────────────────────────────────
  await stage('feedback panel', async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('feedback:toggle', {}))
    const fvBtn = page.locator('.fv-scope .fv-scope-btn')
    await fvBtn.waitFor({ state: 'visible', timeout: 8000 })
    results.feedback = await lap(page, fvBtn)
    log('feedback panel  →', results.feedback.join(' → '))
    await page.locator('.fv-reach').screenshot({ path: suffix('feedback') }).catch(() => null)
    await page.evaluate(() => window.__hypercombEffectBus.emit('feedback:viewer-close', {}))
  })

  // ── 3. files panel ───────────────────────────────────────────────────────
  await stage('files panel', async () => {
    await page.evaluate(() => window.__hypercombEffectBus.emit('files:open', {
      cellLabel: 'alpha', segments: [], files: [], reach: 'local',
    }))
    const filesBtn = page.locator('.files-scope .files-scope-btn')
    await filesBtn.waitFor({ state: 'visible', timeout: 8000 })
    results.files = await lap(page, filesBtn)
    filesReaches = await page.evaluate(() => window.__reachLog.files.splice(0))
    log('files panel     →', results.files.join(' → '), '· files:reach carried', filesReaches.join(', '))
    await page.locator('.files-header').screenshot({ path: suffix('files') }).catch(() => null)
    await page.evaluate(() => window.__hypercombEffectBus.emit('files:viewer-close', {}))
  })

  // ── 4. bottom tag strip, opened out ──────────────────────────────────────
  await stage('tag strip', async () => {
    await page.evaluate(() => window.__reachLog.filter.splice(0))
    const expand = page.locator('.tag-expand')
    await expand.waitFor({ state: 'visible', timeout: 8000 })
    if (!await page.locator('.tag-scope-set .tag-scope-opt').count()) await expand.click()
    const stripBtn = page.locator('.tag-scope-set .tag-scope-opt')
    await stripBtn.waitFor({ state: 'visible', timeout: 8000 })
    results.strip = await lap(page, stripBtn)
    stripScopes = await page.evaluate(() => window.__reachLog.filter.splice(0))
    log('tag strip       →', results.strip.join(' → '), '· tags:filter carried', stripScopes.join(', '))
    await page.locator('.tag-float').screenshot({ path: suffix('strip') }).catch(() => null)
    await page.screenshot({ path: OUT })
  })

  const pass =
    Object.values(results).every(lapOk)
    && String(filterScopes) === 'children,global,local'
    && String(filesReaches) === 'children,global,local'
    && String(stripScopes) === 'children,global,local'
  log(pass ? 'PASS' : 'FAIL', JSON.stringify(results))
  await browser.close()
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
