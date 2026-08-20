// scripts/drive-pheromone-preview.cjs
//
// Proof for POINT AT A MARK, SEE ITS TILES: hovering a pheromone anywhere in
// the chrome (a panel row, a bouquet, a bottom crumb) asks the hive which
// tiles carry it, and the hive answers on itself — the carriers light in the
// mark's own colour, the rest of the page recedes.
//
// The visual is a shader treatment, so this checks it where it actually lives:
//   • the per-tile carrier flag in the aDivergence buffer (3 = carrier — the
//     one value nothing persists), and
//   • the u_markPreview / u_markColor uniforms that ramp the whole treatment.
// A screenshot is written alongside so the LOOK can be judged, not just the
// numbers.
//
//   node scripts/drive-pheromone-preview.cjs [--headed] [--port 4250] [--out shot.png]
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
const OUT = String(arg('out', 'pheromone-preview.png'))
const HEADED = process.argv.includes('--headed')

const TILES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']
const CARRIERS = ['alpha', 'gamma', 'epsilon']
const MARK = 'lit'

const ts = () => new Date().toISOString().slice(11, 23)
const log = (...a) => console.log(`[${ts()}]`, ...a)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

/** The dev server rebuilds whenever ANY session edits watched source, and the
 *  reload lands mid-step as "Execution context was destroyed". That is the
 *  server working, not the app failing — so every page step retries through it
 *  rather than reporting a failure that isn't one. */
async function resilient(label, fn, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn() } catch (err) {
      const reloaded = /Execution context was destroyed|Target closed|navigation/i.test(String(err))
      if (!reloaded || attempt >= tries) throw err
      log(`${label}: page reloaded under us (attempt ${attempt}) — waiting it out`)
      await sleep(2500)
      await waitForReady(page0)
    }
  }
}
let page0 = null

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

/** The rendered mesh's carrier flags + preview uniforms, straight off the GPU
 *  side of the shader. One float per vertex; four vertices per hex. */
async function probe(page) {
  return page.evaluate(() => {
    const app = window.__pixiDebug?.app
    if (!app) return { ok: false, why: 'no __pixiDebug.app' }
    let mesh = null
    const walk = (o) => {
      if (mesh || !o) return
      const g = o.geometry
      const attr = g?.getAttribute?.('aDivergence') ?? g?.attributes?.aDivergence
      if (attr) { mesh = o; return }
      for (const c of (o.children ?? [])) walk(c)
    }
    walk(app.stage)
    if (!mesh) return { ok: false, why: 'no mesh carrying aDivergence' }
    const g = mesh.geometry
    const attr = g.getAttribute?.('aDivergence') ?? g.attributes.aDivergence
    const data = attr.buffer?.data ?? attr.data
    const perCell = []
    for (let i = 0; i < data.length; i += 4) perCell.push(data[i])
    const u = mesh.shader?.resources?.uniforms?.uniforms ?? {}
    return {
      ok: true,
      perCell,
      carriers: perCell.filter(v => v === 3).length,
      markPreview: u.u_markPreview ?? null,
      markColor: u.u_markColor ? Array.from(u.u_markColor).map(n => Math.round(n * 255)) : null,
      labels: window.__hypercombEffectBus?.lastValue?.get('render:cell-count')?.labels ?? null,
    }
  })
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

  // First boot offers the example hives. Dismiss it — this run builds its own.
  const dismiss = page.locator('hc-example-hives-offer button.dismiss')
  if (await dismiss.count().catch(() => 0)) {
    await dismiss.first().click({ timeout: 3000 }).catch(() => null)
    log('dismissed the first-boot offer')
  }
  await sleep(600)

  page0 = page
  for (const name of TILES) await resilient(`add ${name}`, () => addTile(page, name))
  log('tiles added:', TILES.join(', '))
  await sleep(1200)

  // Put the mark on three of them through the real write path — the painter's
  // arm → stage → commit triple, exactly what a tap on a picked selection fires.
  await page.evaluate(async ({ mark, carriers }) => {
    const bus = window.__hypercombEffectBus
    bus.emit('tags:apply-begin', { tags: [mark] })
    for (const label of carriers) bus.emit('tags:apply-paint', { label, add: true })
    bus.emit('tags:apply-commit', {})
  }, { mark: MARK, carriers: CARRIERS })
  await sleep(2500)

  const counted = await page.evaluate((mark) => {
    const tags = window.__hypercombEffectBus?.lastValue?.get('render:tags')?.tags ?? []
    return tags.find(t => t.name === mark)?.count ?? 0
  }, MARK)
  log(`page says "${MARK}" is on ${counted} tile(s) (expected ${CARRIERS.length})`)

  await page.evaluate(() => window.__hypercombEffectBus.emit('tags:view-open', {}))
  await sleep(900)

  const row = page.locator('.tags-row', { hasText: new RegExp(`^\\s*${MARK}`) }).first()
  await row.waitFor({ state: 'visible', timeout: 8000 })

  // The same patch of hive, idle and hovered — the pair is the only honest way
  // to judge "prominent", since a lit tile is only lit RELATIVE to its page.
  const CLIP = { x: 120, y: 230, width: 940, height: 520 }
  const suffix = (tag) => OUT.replace(/(\.png)?$/i, `-${tag}.png`)
  await page.screenshot({ path: suffix('idle'), clip: CLIP })

  const before = await probe(page)
  log('before hover   →', JSON.stringify({ carriers: before.carriers, markPreview: before.markPreview, why: before.why }))

  await row.hover()
  await sleep(700)
  const during = await probe(page)
  log('while hovering →', JSON.stringify({
    carriers: during.carriers, markPreview: during.markPreview, markColor: during.markColor,
  }))
  if (during.labels && during.perCell) {
    const lit = during.labels.filter((_, i) => during.perCell[i] === 3)
    log('lit tiles      →', lit.join(', '))
  }
  await page.screenshot({ path: OUT })
  await page.screenshot({ path: suffix('hover'), clip: CLIP })
  log('screenshots →', OUT, '·', suffix('idle'), '·', suffix('hover'))

  // ── The mark's OWN colour, and the OTHER surface marks are shown on ──────
  // Recolour the mark and point at its crumb in the bottom strip instead. Same
  // question, same answer: one behaviour wherever a mark appears, painted in
  // whatever colour that mark is wearing today.
  await page.evaluate(async (mark) => {
    const reg = window.ioc?.get?.('@hypercomb.social/TagRegistry')
    await reg?.add?.(mark, '#e0553f')
  }, MARK)
  await sleep(800)
  let crumbCarriers = null
  let crumbColor = null
  const crumb = page.locator('.tag-crumb', { hasText: new RegExp(`^\s*${MARK}\s*$`) }).first()
  if (await crumb.count().catch(() => 0)) {
    await crumb.hover()
    await sleep(700)
    const viaCrumb = await probe(page)
    crumbCarriers = viaCrumb.carriers
    crumbColor = viaCrumb.markColor
    log('crumb hover    →', JSON.stringify({ carriers: crumbCarriers, markColor: crumbColor }))
    await page.screenshot({ path: suffix('crumb'), clip: CLIP })
  } else {
    log('crumb hover    → no crumb in the strip (skipped)')
  }

  // Off the row: the treatment fades out and every flag goes back.
  await page.mouse.move(700, 60)
  await sleep(1200)
  const after = await probe(page)
  log('after leaving  →', JSON.stringify({ carriers: after.carriers, markPreview: after.markPreview }))

  const pass =
    (crumbCarriers === null || (crumbCarriers === CARRIERS.length && String(crumbColor) === '224,85,63'))
    && before.carriers === 0
    && during.carriers === CARRIERS.length
    && during.markPreview > 0.9
    && after.carriers === 0
    && after.markPreview === 0
  log(pass ? 'PASS' : 'FAIL')
  await browser.close()
  process.exit(pass ? 0 : 1)
}

main().catch(err => { console.error(err); process.exit(1) })
