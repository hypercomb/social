// scripts/drive-update-notice-clear.cjs
//
// THE UPDATE NOTICE IS NEVER UNDER ANYTHING, on a throwaway profile.
//
// On the web shell the "Update available" pill sat in a bottom-centre dock at a
// flat 2.8rem, and a package's empty-hive prompt ("Your hive is empty", z
// 100000) stands on the controls bar at the same spot — so an empty hive hid the
// notice completely on the desktop, and on a phone the pill straddled both the
// prompt and the bar (2026-09-22). Now the dock stands on the bar's own top edge
// and, as a bottom-band member, is folded into `--hc-controls-bottom`, which the
// prompt (old packages' too) already stands on.
//
// For light and dark, at desktop and phone width, with an empty hive and an
// announced update:
//   - the pill and the prompt share no pixel, and neither covers the other;
//   - on a phone the pill clears the controls strip, on the desktop the edit
//     actions;
//   - the pill takes a real click, and it opens Packages.
//
//   node scripts/drive-update-notice-clear.cjs [--url http://localhost:4260/]

const fs = require('fs')
const os = require('os')
const path = require('path')
const H = require('./drive-swarm-connectivity.cjs')
const { chromium } = require('playwright')

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const URL_ = arg('--url', 'http://localhost:4260/')
const SHOTS = arg('--shots', os.tmpdir())
const OLDER = '1'.repeat(64)   // a build this hive certainly does not run

const WIDTHS = [
  { label: 'desktop', opts: { viewport: { width: 1440, height: 900 } } },
  { label: 'phone', opts: { viewport: { width: 400, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
]

const measure = () => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null }
  const pill = document.querySelector('hc-upgrade-indicator .upgrade-indicator')
  const promptHost = document.querySelector('#hc-collection-empty-prompt')
  const prompt = promptHost?.firstElementChild ?? null
  const promptButton = prompt?.querySelector('button') ?? null
  const centreOf = (b) => b ? [(b.l + b.r) / 2, (b.t + b.b) / 2] : null
  const pillBox = box(pill)
  const buttonBox = box(promptButton)
  const atPill = pillBox ? document.elementFromPoint(...centreOf(pillBox)) : null
  const atButton = buttonBox ? document.elementFromPoint(...centreOf(buttonBox)) : null
  return {
    theme: document.documentElement.dataset.theme ?? null,
    viewport: { w: innerWidth, h: innerHeight },
    pill: pillBox,
    prompt: box(prompt),
    bar: box(document.querySelector('hc-controls-bar .pill-stage')),
    edit: box(document.querySelector('hc-edit-actions > *')),
    pillOnTop: !!atPill?.closest('hc-upgrade-indicator'),
    promptButtonOnTop: !!atButton && (atButton === promptButton || promptButton.contains(atButton)),
    reservation: getComputedStyle(document.documentElement).getPropertyValue('--hc-controls-bottom').trim(),
  }
}

const overlap = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0
const inside = (a, vp) => !!a && a.l >= 0 && a.t >= 0 && a.r <= vp.w && a.b <= vp.h

;(async () => {
  for (const width of WIDTHS) {
    const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), `hc-notice-${width.label}-`))
    // One app load per browser process: three loads in one headless Chromium
    // exhaust its WebGL, the renderer never settles, and the empty-hive prompt
    // (which waits for a settled empty count) never shows.
    const open = () => chromium.launchPersistentContext(PROFILE, { headless: !H.HEADED, ...width.opts })

    // A cold boot takes a package; the hive it opens on is empty.
    let ctx = await open()
    let page = ctx.pages()[0] ?? await ctx.newPage()
    let ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
    await page.goto(URL_, { waitUntil: 'domcontentloaded' })
    await H.waitForShell(page, 120000)
    const cold = await H.waitFor(() => ask(() => window.hypercomb?.installed?.() ?? null), v => !!v, 180000, 1000)
    H.check(`${width.label}: a cold boot installs a package`, cold.ok, String(cold.value).slice(0, 12))
    await ctx.close()

    for (const theme of ['light', 'dark']) {
      const tag = `${width.label}/${theme}`
      ctx = await open()
      page = ctx.pages()[0] ?? await ctx.newPage()
      ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
      // The state of a hive the moment its channel moves, with the welcome
      // already seen, so the empty-hive prompt is what shows — written from a
      // static file on the origin, so the app boots once, onto it.
      await page.goto(new URL('/favicon.ico', URL_).href, { waitUntil: 'domcontentloaded' })
      await ask(({ older, theme }) => {
        localStorage.setItem('hc:shim:installed-package', older)
        localStorage.setItem('hc:theme', theme)
        localStorage.setItem('hc:example-hives:dismissed', 'true')
      }, { older: OLDER, theme })
      await page.goto(URL_, { waitUntil: 'domcontentloaded' })
      await H.waitForShell(page, 120000)
      const shown = await H.waitFor(() => ask(measure), m => !!m?.pill && !!m?.prompt, 60000, 1000)
      await H.sleep(1500)
      const m = await ask(measure)
      await page.screenshot({ path: path.join(SHOTS, `notice-${width.label}-${theme}.png`) })

      H.check(`${tag}: the notice and the empty-hive prompt both show`, shown.ok && !!m?.pill && !!m?.prompt, `theme=${m?.theme}`)
      H.check(`${tag}: they share no pixel`, !overlap(m?.pill, m?.prompt), JSON.stringify({ pill: m?.pill, prompt: m?.prompt }))
      H.check(`${tag}: nothing covers the notice`, !!m?.pillOnTop)
      H.check(`${tag}: nothing covers the prompt's button`, !!m?.promptButtonOnTop)
      H.check(`${tag}: the notice is on screen`, inside(m?.pill, m?.viewport ?? { w: 0, h: 0 }))
      if (width.label === 'phone') H.check(`${tag}: it clears the controls strip`, !overlap(m?.pill, m?.bar), JSON.stringify(m?.bar))
      else H.check(`${tag}: it clears the edit actions`, !overlap(m?.pill, m?.edit), JSON.stringify(m?.edit))
      H.log('measure', `${tag} reservation=${m?.reservation} pill=${JSON.stringify(m?.pill)} prompt=${JSON.stringify(m?.prompt)}`)

      // A real click, at the pill's centre — the participant's own press.
      if (m?.pill) {
        await page.mouse.click((m.pill.l + m.pill.r) / 2 - 12, (m.pill.t + m.pill.b) / 2)
        const opened = await H.waitFor(() => ask(() => !!document.querySelector('.hd-panel')), v => !!v, 15000, 500)
        H.check(`${tag}: pressing it opens Packages`, opened.ok, `after ${opened.waitedMs}ms`)
      }
      await ctx.close()
    }
    try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* temp dir */ }
  }

  // AN INSTALLED PACKAGE FROM BEFORE 2026-09-11 draws its prompt at a flat
  // `bottom:28px` and reads no reservation. The Aug 31 build (gen 171) is taken
  // through the SELF door with every outside host blocked, so neither the seed
  // nor the floor can move it; its scout follows no publisher, so the
  // announcement is made on the bus the way a scout makes it.
  const crypto = require('crypto')
  const OLD = arg('--old', '13af419bf1aa82f89e2035162cbf26a020c1bef3d1563ef569bc9d5c0e8958f5')
  const POOL = crypto.createHash('sha256').update('host:packages').digest('hex')
  const POOL_DIR = path.join(__dirname, '..', 'hypercomb-web', 'public', 'content', POOL)
  const member = fs.readdirSync(POOL_DIR).filter(name => /^\d{8}$/.test(name))
    .map(name => fs.readFileSync(path.join(POOL_DIR, name)))
    .find(bytes => bytes.toString('utf8').split('\n')[0].trim() === OLD)
  if (!member) H.check('the Aug 31 package is in the local host pool', false, OLD.slice(0, 12))
  for (const [width, theme] of member ? [[WIDTHS[0], 'light'], [WIDTHS[1], 'dark']] : []) {
    const tag = `${width.label}/${theme}, Aug 31 package`
    const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), `hc-notice-old-${width.label}-`))
    const open = async (fakePool) => {
      const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !H.HEADED, ...width.opts })
      await ctx.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return route.abort()
        if (fakePool.on && url.pathname.startsWith(`/content/${POOL}/`)) {
          return url.pathname.endsWith('/00000000')
            ? route.fulfill({ status: 200, contentType: 'text/plain', body: member })
            : route.fulfill({ status: 404, body: '' })
        }
        return route.continue()
      })
      return ctx
    }
    const fake = { on: false }
    let ctx = await open(fake)
    let page = ctx.pages()[0] ?? await ctx.newPage()
    let ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
    await page.goto(URL_, { waitUntil: 'domcontentloaded' })
    await H.waitFor(() => ask(() => typeof window.hypercomb?.acquire === 'function'), v => !!v, 120000, 1000)
    fake.on = true
    const took = await ask(async sig => {
      try { return await window.hypercomb.acquire(sig, [location.host]) } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
    }, OLD)
    fake.on = false
    H.check(`${tag}: it installs through the self door`, took?.ok === true, took?.ok ? '' : String(took?.error))
    await ctx.close()

    ctx = await open(fake)
    page = ctx.pages()[0] ?? await ctx.newPage()
    ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
    await page.goto(new URL('/favicon.ico', URL_).href, { waitUntil: 'domcontentloaded' })
    await ask(theme => { localStorage.setItem('hc:theme', theme); localStorage.setItem('hc:example-hives:dismissed', 'true') }, theme)
    await page.goto(URL_, { waitUntil: 'domcontentloaded' })
    await H.waitForShell(page, 120000)
    const live = await H.waitFor(() => ask(() => window.hypercomb?.installed?.() ?? null), v => v === OLD, 60000, 1000)
    H.check(`${tag}: it is the live package`, live.ok, String(live.value).slice(0, 12))
    const promptUp = await H.waitFor(() => ask(() => !!document.querySelector('#hc-collection-empty-prompt')), v => !!v, 60000, 1000)
    const flat = await ask(() => /bottom:\s*28px/.test(document.querySelector('#hc-collection-empty-prompt')?.getAttribute('style') ?? ''))
    H.check(`${tag}: its empty-hive prompt is the flat 28px one`, promptUp.ok && flat === true)
    // The genesis splash lifts on a SETTLED render, which an Aug 31 package
    // does not report; after its loops it rests on "click to enter".
    const splashGone = () => ask(() => !document.getElementById('hc-splash'))
    let entered = await H.waitFor(splashGone, v => !!v, 40000, 1000)
    if (!entered.ok) {
      await page.mouse.click(width.opts.viewport.width / 2, width.opts.viewport.height / 2)
      entered = await H.waitFor(splashGone, v => !!v, 15000, 500)
    }
    H.check(`${tag}: the splash lets you in`, entered.ok)
    await ask(sig => window.__hypercombEffectBus.emit('update:available', {
      available: true, newCount: 0, newBees: [], packageSig: sig, previous: null, label: '', source: 'channel',
    }), 'c'.repeat(64))
    await H.waitFor(() => ask(measure), m => !!m?.pill, 15000, 500)
    await H.sleep(1500)
    const m = await ask(measure)
    await page.screenshot({ path: path.join(SHOTS, `notice-${width.label}-${theme}-old-package.png`) })
    H.check(`${tag}: the notice and the old prompt share no pixel`, !overlap(m?.pill, m?.prompt), JSON.stringify({ pill: m?.pill, prompt: m?.prompt }))
    H.check(`${tag}: nothing covers the notice`, !!m?.pillOnTop)
    H.check(`${tag}: nothing covers the old prompt's button`, !!m?.promptButtonOnTop)
    if (width.label === 'phone') H.check(`${tag}: the notice clears the controls strip`, !overlap(m?.pill, m?.bar), JSON.stringify(m?.bar))
    H.log('measure', `${tag} reservation=${m?.reservation} pill=${JSON.stringify(m?.pill)} prompt=${JSON.stringify(m?.prompt)}`)
    await ctx.close()
    try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* temp dir */ }
  }

  console.log('\n========== update notice clear ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
