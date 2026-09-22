#!/usr/bin/env node
// drive-site-exit-peel — proves the site exit's second meaning and the chrome
// corner, on a live shell.
//
//   node scripts/drive-site-exit-peel.cjs [--url http://localhost:4250]
//                                         [--out <dir>] [--engine chrome]
//
// The trap: a cell whose `view:default` is its website opens AS the site the
// moment you walk in, and every exit returns to the spawn — the parent. So the
// cell's own hexagons were unreachable, and with them the rail's ctrl-click
// that clears the default: once set, a site could not be un-defaulted.
//
//   1. a REAL default mark (`features:default`) + a REAL walk in = arrival
//   2. the chrome corner: the host publishes its vars, reserves the end of the
//      scroll, a footer's right-hand link and a fixed widget clear the button,
//      and the button sits off the host's scrollbar
//   3. Ctrl held over the exit → it wears the hexagon; released → site glyph
//   4. Ctrl-click → THIS page's hexagons, and the default does not reopen it
//   5. the rail's ctrl-click on the site icon clears the default; walking back
//      in now lands on the hexagons
//   6. a plain click still closes an arrival-opened site to the parent
//
// Playwright with its OWN browser profile: its OPFS is empty and separate, so
// it never contends with a hive open in someone's browser on the same origin.
// The page read is stubbed in THIS throwaway context only (HistoryService
// .currentLayerAt → a `website` slot; Store.getResource → the test page).

const fs = require('node:fs')
const path = require('node:path')
const { chromium, firefox, webkit } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function launcherFor(name) {
  switch (String(name)) {
    case 'firefox': return { type: firefox, opts: {} }
    case 'webkit': return { type: webkit, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chromium': return { type: chromium, opts: {} }
    default: return { type: chromium, opts: { channel: 'chrome' } }
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

const PARENT = ['peel-test']
const SITE = ['peel-test', 'site']

// A Dolphin-shaped page: tall content, a space-between footer whose last link
// sits in the bottom-right, and a fixed widget that honours the standard.
const PAGE = `<!doctype html><html><head><style>
body{margin:0;font-family:system-ui,sans-serif;background:#101820;color:#dde6ee}
main{padding:2rem}
.tall{height:1400px;border:1px dashed #345}
.foot{border-top:1px solid #345;margin-top:40px}
.foot .wrap{display:flex;justify-content:space-between;align-items:center;padding:30px 2rem;font-size:.86rem}
#chat{position:fixed;right:1rem;bottom:calc(1rem + var(--hc-site-chrome-bottom, 0px));width:3rem;height:3rem;border-radius:50%;background:#c84}
</style></head><body><main><h1>Peel test</h1><div class="tall"></div></main>
<footer class="foot"><div class="wrap"><span>Brand</span><span>Tagline</span><a id="last-link" href="#top">Back to the field ↑</a></div></footer>
<div id="chat"></div></body></html>`

const STUB = async ({ site, page }) => {
  const ioc = window.ioc
  const history = ioc.get('@diamondcoreprocessor.com/HistoryService')
  const store = ioc.get('@hypercomb.social/Store')
  const pageSig = 'ab'.repeat(32)
  const target = await history.sign({ explorerSegments: () => site })
  const layerAt = history.currentLayerAt.bind(history)
  history.currentLayerAt = async (sig) => {
    const layer = await layerAt(sig)
    return sig === target ? { ...(layer ?? {}), website: [pageSig] } : layer
  }
  // view.bee reads the warm cursor's head by layer sig once the cell has a
  // real layer (the default mark gives it one) — give that read the page too.
  const cursor = ioc.get('@diamondcoreprocessor.com/HistoryCursorService')
  const layerBySig = history.getLayerBySig.bind(history)
  history.getLayerBySig = async (sig) => {
    const layer = await layerBySig(sig)
    const ours = layer && cursor?.state?.locationSig === target && cursor?.currentLayerSig === sig
    return ours ? { ...layer, website: [pageSig] } : layer
  }
  const getResource = store.getResource.bind(store)
  store.getResource = async (sig) => sig === pageSig ? new Blob([page], { type: 'text/html' }) : getResource(sig)
  return { target }
}

const here = () => page.evaluate(() => [...(window.ioc.get('@hypercomb.social/Lineage').explorerSegments?.() ?? [])])
const mode = () => page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').mode)
const goto = (segments) => page.evaluate((s) => window.ioc.get('@hypercomb.social/Lineage').explorerReplace(s), segments)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let page

// The first-boot welcome (example hives) can come back up over an empty hive.
async function dismissOffer() {
  const startEmpty = page.getByText('Start empty', { exact: true })
  if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(1500) }
}

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(150) }
  return false
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }) }
  // A close-up of the exit's corner, where the glyph change is legible.
  const shotCorner = async (name) => {
    const box = await page.locator('#hc-site-exit').boundingBox()
    if (box) await page.screenshot({ path: path.join(out, name + '.png'), clip: { x: Math.max(0, box.x - 260), y: Math.max(0, box.y - 120), width: 320, height: 170 } })
  }

  try {
    await page.goto(url, { waitUntil: 'load' })
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      await page.waitForTimeout(3000)
      const startEmpty = page.getByText('Start empty', { exact: true })
      if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }
      ready = await page.evaluate(() => !!window.ioc?.get?.('@diamondcoreprocessor.com/SiteViewDrone')
        && !!window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService'))
    }
    check('the shell is up', ready)
    if (!ready) throw new Error('the shell never finished booting')
    await page.evaluate(STUB, { site: SITE, page: PAGE })

    // ── 1. a real default mark, a real walk in ─────────────────────────────
    // The parent must be a REAL layer: view.bee never latches on a cold read,
    // so walking out to a layer-less cell would leave the latch on the site
    // and walking back in would not count as an arrival. In a live hive the
    // parent of a site always exists; here an explicit `hexagons` mark (the
    // opt-out, terminal for the parent alone) gives it one.
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons'))
    await goto(PARENT)
    await page.evaluate((s) => globalThis.__hypercombEffectBus.emit('features:default',
      { cell: s[s.length - 1], segments: s, view: 'hexagons', silent: true }), PARENT)
    await page.waitForTimeout(1200)
    await goto(SITE)
    await page.waitForTimeout(1200)
    await page.evaluate((s) => globalThis.__hypercombEffectBus.emit('features:default',
      { cell: s[s.length - 1], segments: s, view: 'website', silent: true }), SITE)
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons'))
    await goto(PARENT)
    await page.waitForTimeout(1500)
    await goto(SITE)
    const arrived = await waitFor(async () => (await mode()) === 'website'
      && await page.evaluate(() => !!document.querySelector('#hc-site-view-host #last-link')))
    check('1. walking into the marked cell opens the site (arrival)', arrived, 'mode=' + await mode())
    if (!arrived) {
      console.log('    rail →', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.view-toggle-btn')]
        .map(b => b.title + (b.classList.contains('is-default') ? ' [default]' : '') + (b.classList.contains('on') ? ' [on]' : '')))),
        'at', JSON.stringify(await here()),
        'host', await page.evaluate(() => !!document.getElementById('hc-site-view-host')))
      await shot('00-no-arrival')
      throw new Error('no arrival — nothing to peel from')
    }
    await dismissOffer()
    await page.waitForTimeout(800)

    // ── 2. the chrome corner ───────────────────────────────────────────────
    const corner = await page.evaluate(() => {
      const host = document.getElementById('hc-site-view-host')
      host.scrollTop = host.scrollHeight
      const btn = document.getElementById('hc-site-exit')
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } }
      const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
      const kids = [...host.children].filter(el => !/^(SCRIPT|STYLE|LINK)$/.test(el.tagName))
      const exit = r(btn), link = r(document.getElementById('last-link')), chat = r(document.getElementById('chat'))
      const hb = host.getBoundingClientRect()
      return {
        varBottom: getComputedStyle(host).getPropertyValue('--hc-site-chrome-bottom').trim(),
        reserveLast: kids[kids.length - 1]?.hasAttribute('data-hc-site-chrome-reserve') ?? false,
        linkHit: hits(link, exit), chatHit: hits(chat, exit),
        gap: Math.round(exit.t - link.b),
        scrollbar: host.offsetWidth - host.clientWidth,
        offThumb: exit.r <= hb.left + host.clientWidth + 0.5,
      }
    })
    console.log('    corner →', JSON.stringify(corner))
    check('2a. the host publishes --hc-site-chrome-bottom', !!corner.varBottom, corner.varBottom)
    check('2b. the corner is reserved after the page\'s last child', corner.reserveLast)
    check('2c. the footer\'s right-hand link clears the exit at the end of the scroll', !corner.linkHit, 'gap=' + corner.gap + 'px')
    check('2d. a fixed widget on the standard clears the exit', !corner.chatHit)
    check('2e. the exit sits off the host\'s scrollbar', corner.offThumb, 'scrollbar=' + corner.scrollbar + 'px')
    await shot('01-site-scrolled-to-end')

    // ── 3. Ctrl over the exit wears the hexagon ────────────────────────────
    const exit = page.locator('#hc-site-exit')
    await shotCorner('01b-corner-at-rest')
    const siteGlyph = (await exit.textContent())?.trim()
    await exit.hover()
    await page.keyboard.down('Control')
    await page.waitForTimeout(150)
    const peekGlyph = (await exit.textContent())?.trim()
    await shotCorner('02-ctrl-over-exit')
    await page.keyboard.up('Control')
    await page.waitForTimeout(150)
    const backGlyph = (await exit.textContent())?.trim()
    check('3a. Ctrl held over the exit → hexagon glyph', peekGlyph === 'hexagon', `${siteGlyph} → ${peekGlyph}`)
    check('3b. Ctrl released → the site glyph again', backGlyph === siteGlyph, backGlyph)

    // ── 4. Ctrl-click = this page's hexagons, and it stays ─────────────────
    await exit.click({ modifiers: ['Control'] })
    await page.waitForTimeout(300)
    const peeled = { mode: await mode(), at: await here() }
    check('4a. Ctrl-click shows the hexagons', peeled.mode === 'hexagons', 'mode=' + peeled.mode)
    check('4b. …of THIS page, not the parent', same(peeled.at, SITE), 'at=' + JSON.stringify(peeled.at))
    await page.waitForTimeout(2500)
    const held = { mode: await mode(), at: await here() }
    check('4c. the default does not reopen the site under you', held.mode === 'hexagons' && same(held.at, SITE),
      JSON.stringify(held))
    await shot('03-peeled-to-hexagons')

    // ── 5. the rail's ctrl-click clears the default ────────────────────────
    const railBtn = page.locator('.view-toggle-btn.is-default')
    const marked = await railBtn.count()
    check('5a. on the hexagons the rail shows the site icon as the default', marked === 1, 'count=' + marked)
    if (marked) {
      await dismissOffer()
      await railBtn.first().click({ modifiers: ['Control'] })
      await page.waitForTimeout(1500)
      const still = await page.locator('.view-toggle-btn.is-default').count()
      check('5b. ctrl-click on it clears the default', still === 0, 'count=' + still)
      await goto(PARENT)
      await page.waitForTimeout(1500)
      await goto(SITE)
      await page.waitForTimeout(2500)
      check('5c. walking back in now lands on the hexagons', (await mode()) === 'hexagons', 'mode=' + await mode())
    }

    // ── 6. a plain click still closes an arrival to the parent ─────────────
    await page.evaluate((s) => globalThis.__hypercombEffectBus.emit('features:default',
      { cell: s[s.length - 1], segments: s, view: 'website', silent: true }), SITE)
    await page.waitForTimeout(1200)
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons'))
    await goto(PARENT)
    await page.waitForTimeout(1500)
    await goto(SITE)
    const again = await waitFor(async () => (await mode()) === 'website')
    if (again) {
      await page.locator('#hc-site-exit').click()
      await page.waitForTimeout(400)
      const closed = { mode: await mode(), at: await here() }
      check('6. a plain click closes the site back to the parent', closed.mode === 'hexagons' && same(closed.at, PARENT),
        JSON.stringify(closed))
    } else check('6. a plain click closes the site back to the parent', false, 're-arrival did not open')

    const faults = errors.filter(e => !/404/.test(e))
    check('no page errors', faults.length === 0, faults.slice(0, 3).join(' | '))
  } finally {
    await shot('04-final')
    await browser.close()
  }

  const failed = results.filter(r => !r.ok)
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
  process.exit(failed.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
