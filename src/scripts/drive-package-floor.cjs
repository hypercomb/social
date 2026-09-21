// scripts/drive-package-floor.cjs
//
// THE FLOOR, end to end (hypercomb-web/src/setup/package-floor.ts).
//
// A throwaway profile is given an Aug 31 package on the CURRENT web shell and
// must reach the seed's head without anyone touching it. The default package,
// gen 171 13af419b…, has what a Mac was stuck on (2026-09-21): it imports
// ATOMIZER_IOC_PREFIX, its CanvasBackground has no setPreview, nothing in it
// answers `packages:open`, and it loads no attester.
//
//   1. Cold boot with every non-local host blocked, so the seed cannot install
//      a current package first.
//   2. The local shell offers ONLY the old package: its host pool is faked so
//      the head member is the old one. `hypercomb.acquire` takes it through the
//      SELF door, exactly as an origin takes its own build.
//   3. Unblock and reload. The old package boots, answers no door, and the
//      floor must take the seed head and reload onto it.
//   4. Reopen the profile in a FRESH browser process: the moved-to package
//      stays, the floor stays quiet, and all of it runs, down to the world-mode
//      share toggles. (Three loads in one headless Chromium exhaust its WebGL —
//      GL_OUT_OF_MEMORY — and a renderer that cannot start registers no icons,
//      which would read as missing code.)
//
//   node scripts/drive-package-floor.cjs [--url http://localhost:4260/] [--old <64-hex>]

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const H = require('./drive-swarm-connectivity.cjs')

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const URL_ = arg('--url', 'http://localhost:4260/')
const OLD = arg('--old', '13af419bf1aa82f89e2035162cbf26a020c1bef3d1563ef569bc9d5c0e8958f5')
const POOL = crypto.createHash('sha256').update('host:packages').digest('hex')
const BEES = crypto.createHash('sha256').update('bees').digest('hex')
const POOL_DIR = path.join(__dirname, '..', 'hypercomb-web', 'public', 'content', POOL)

const memberFor = (sig) => {
  for (const name of fs.readdirSync(POOL_DIR)) {
    if (!/^\d{8}$/.test(name)) continue
    const bytes = fs.readFileSync(path.join(POOL_DIR, name))
    if (bytes.toString('utf8').split('\n')[0].trim() === sig) return bytes
  }
  return null
}

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1'

;(async () => {
  const member = memberFor(OLD)
  if (!member) { console.error(`no member of the local host pool names ${OLD.slice(0, 12)}…`); process.exit(2) }

  const la = H.launcherFor('chromium')
  const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-floor-'))
  const open = () => la.type.launchPersistentContext(PROFILE, { headless: !H.HEADED })
  let ctx = await open()
  let offline = true
  let fakePool = false
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url())
    if (offline && !isLocal(url.hostname)) return route.abort()
    if (fakePool && url.pathname.startsWith(`/content/${POOL}/`)) {
      const entry = url.pathname.slice(`/content/${POOL}/`.length)
      if (entry === '00000000') return route.fulfill({ status: 200, contentType: 'text/plain', body: member })
      return route.fulfill({ status: 404, body: '' })
    }
    return route.continue()
  })

  const lines = []
  const watch = (p) => p.on('console', m => {
    const t = m.text()
    lines.push(t)
    if (/package-floor|ensure-install|acquire\]|shell-surfaces|dependency-loader\] failed/.test(t)) H.log('page', t.slice(0, 200))
  })
  let page = ctx.pages()[0] ?? await ctx.newPage()
  watch(page)

  const ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
  const installed = () => ask(() => window.hypercomb?.installed?.() ?? null)
  const doorAnswered = () => ask(() => window.__hypercombEffectBus?.listens?.('packages:open') ?? null)
  const waitFor = async (what, fn, ms) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const v = await fn().catch(() => null)
      if (v) return v
      await H.sleep(1000)
    }
    H.log('wait', `${what}: timed out after ${Math.round(ms / 1000)}s`)
    return null
  }

  // 1. Cold boot, seed unreachable.
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  const handle = await waitFor('console handle', () => ask(() => typeof window.hypercomb?.acquire === 'function'), 120000)
  H.check('cold boot with the seed blocked reaches the shell', !!handle)
  H.check('nothing current was installed first', (await installed()) === null, String(await installed()))

  // 2. Take the old package from this origin.
  fakePool = true
  const took = await ask(async sig => {
    try { return await window.hypercomb.acquire(sig, [location.host]) } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }, OLD)
  fakePool = false
  H.check('the Aug 31 package installs through the self door', took?.ok === true, took?.ok ? '' : String(took?.error))

  // 3. Unblock and boot it.
  offline = false
  lines.length = 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  // The handle is published by the App constructor, after bootstrap — wait for
  // it, not for the shell services, or the question lands on a page with none.
  const live = await waitFor('the booted package', installed, 120000)
  H.check('the old package is the live one', live === OLD, String(live).slice(0, 12))
  await H.sleep(6000)
  H.check('its core imports resolve on this shell', !lines.some(t => /does not provide an export named/.test(t)))
  H.check('one broken surface no longer blocks the rest', !lines.some(t => /failed to load shell surfaces/.test(t)))
  H.check('nothing in it answers the update door', (await doorAnswered()) === false, String(await doorAnswered()))

  // The floor runs 15s after runtime-ready, acquires, waits for quiet, reloads.
  const moved = await waitFor('floor move', async () => {
    const now = await installed()
    return now && now !== OLD ? now : null
  }, 240000)
  H.check('the floor moved it off the old package by itself', !!moved, String(moved).slice(0, 12))
  await waitFor('shell after the move', () => H.waitForShell(page, 5000), 120000)
  await H.sleep(8000)
  H.check('the moved-to package answers the update door', (await doorAnswered()) === true, String(await doorAnswered()))
  // A module that throws on evaluation logs "[store] failed to import"; the
  // loader's own `failed` count also includes side-effect modules that
  // register no Bee (assistant/breaks.ts), so it is not the measure.
  H.check('no module of the moved-to package throws on this shell', !lines.some(t => /\[store\] failed to import|does not provide an export named/.test(t)))
  H.check('nothing is held in the brood', !lines.some(t => /held in the brood/.test(t)))

  const record = await ask(() => { try { return JSON.parse(localStorage.getItem('hc:install:floor') ?? 'null') } catch { return null } })
  H.check('the move is recorded with where it came from', record?.from === OLD && record?.to === moved, JSON.stringify(record)?.slice(0, 160))

  const oldBeeKept = await ask(async ({ bees, sig }) => {
    const manifest = await (await fetch(`/content/manifest.json`)).json()
    const bee = manifest.packages?.[sig]?.bees?.[0]
    if (!bee) return 'no bee listed'
    const root = await navigator.storage.getDirectory()
    const pool = await root.getDirectoryHandle(bees, { create: false })
    try { await pool.getFileHandle(`${bee}.js`, { create: false }); return true } catch { return `missing ${bee.slice(0, 12)}` }
  }, { bees: BEES, sig: OLD })
  H.check("the old package's bytes are kept (nothing deleted)", oldBeeKept === true, String(oldBeeKept))

  // 4. A fresh browser on the same profile.
  await ctx.close()
  ctx = await open()
  page = ctx.pages()[0] ?? await ctx.newPage()
  watch(page)
  lines.length = 0
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  const after = await waitFor('the package after reopening', installed, 120000)
  H.check('reopening the profile keeps the moved-to package', after === moved, String(after).slice(0, 12))
  // The overlay registers its icons on `render:host-ready`.
  const rendered = await waitFor('renderer', () => ask(() => {
    let seen = false
    window.__hypercombEffectBus.on('render:host-ready', () => { seen = true })()
    return seen || null
  }), 60000)
  H.check('the renderer starts on the moved-to package', !!rendered, lines.find(t => /WebGL\/WebGPU unavailable/.test(t))?.slice(0, 120) ?? '')
  const world = await waitFor('world-mode share toggles', () => ask(() => {
    let pool = null
    window.__hypercombEffectBus.on('overlay:pool-icons', p => { pool = p })()
    const names = (pool?.registry ?? []).filter(e => e.profile === 'world').map(e => e.name)
    return ['make-public', 'make-branch-public'].every(n => names.includes(n)) ? names : null
  }), 60000)
  H.check('the share toggles are on offer in world mode', !!world, JSON.stringify(world))
  await H.sleep(12000)
  H.check('and the floor stays quiet on it', !lines.some(t => /\[package-floor\]/.test(t)))

  await ctx.close()
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* temp dir */ }
  await H.finish([])
})().catch(error => { console.error('[fatal]', error); process.exit(1) })
