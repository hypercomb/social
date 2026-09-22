// scripts/drive-package-floor-stranded.cjs
//
// THE FLOOR, after a move was cut short (hypercomb-web/src/setup/package-floor.ts).
//
// What a hypercomb.io tab looked like on 2026-09-22 after a reload landed
// mid-move: an install known only by the bundled install's old stamp
// (`sentinel.sync-signature`, no `hc:shim:installed-package`), no dependency
// bag, and the head's atoms left behind in the pools. Its bag-less import map
// loads every dependency the pool holds, so the head's Packages window answers
// the update door beside a package that never had one, and no hosts drone is
// there to open it. The floor used to read that as "the package answers the
// door" and stand aside for good.
//
//   1. Cold boot: the seed installs its head, so every head atom is held.
//   2. With the seed blocked, take the Aug 31 package through the SELF door.
//   3. Make it the old kind of install: the stamp moves to the old key and the
//      bags go, as an install from before 2026-08-31 never had them.
//   4. Reload with the seed reachable. The door answers, `hosts:open` does not,
//      and the floor must still move the install to the seed head.
//
//   node scripts/drive-package-floor-stranded.cjs [--url http://localhost:4260/] [--old <64-hex>]

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const H = require('./drive-swarm-connectivity.cjs')

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const URL_ = arg('--url', 'http://localhost:4260/')
const OLD = arg('--old', '13af419bf1aa82f89e2035162cbf26a020c1bef3d1563ef569bc9d5c0e8958f5')
const sign = (meaning) => crypto.createHash('sha256').update(meaning).digest('hex')
const POOL = sign('host:packages')
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
  const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-floor-stranded-'))
  const ctx = await la.type.launchPersistentContext(PROFILE, { headless: !H.HEADED })
  let offline = false
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
  const page = ctx.pages()[0] ?? await ctx.newPage()
  page.on('console', m => {
    const t = m.text()
    lines.push(t)
    if (/package-floor|ensure-install|acquire\]/.test(t)) H.log('page', t.slice(0, 200))
  })

  const ask = (fn, a) => H.evalSafe(() => page.evaluate(fn, a))
  const installed = () => ask(() => window.hypercomb?.installed?.() ?? null)
  const listeners = (effect) => ask(name => {
    const handlers = window.__hypercombEffectBus?.handlers
    const set = handlers instanceof Map ? handlers.get(name) : handlers?.[name]
    return set ? (set.size ?? set.length ?? 1) : 0
  }, effect)
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

  // 1. Cold boot, seed reachable: the head's atoms land in the pools.
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  const head = await waitFor('cold install of the seed head', async () => {
    const sig = await installed()
    return sig && sig !== OLD ? sig : null
  }, 240000)
  H.check('a cold boot installs the seed head', !!head, String(head).slice(0, 12))

  // 2. The Aug 31 package through the self door, seed blocked.
  offline = true
  fakePool = true
  const took = await ask(async sig => {
    try { return await window.hypercomb.acquire(sig, [location.host]) } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }, OLD)
  fakePool = false
  H.check('the Aug 31 package installs through the self door', took?.ok === true, took?.ok ? '' : String(took?.error))

  // 3. The old kind of install: known by the old stamp only, and no bags.
  const made = await ask(async ({ bees, deps, old }) => {
    localStorage.setItem('sentinel.sync-signature', old)
    localStorage.removeItem('hc:shim:installed-package')
    const root = await navigator.storage.getDirectory()
    const dropped = []
    for (const meaning of [bees, deps]) {
      const pool = await root.getDirectoryHandle(meaning, { create: false })
      const bags = []
      for await (const [name, handle] of pool.entries()) {
        if (handle.kind === 'directory' && /^[a-f0-9]{64}$/.test(name)) bags.push(name)
      }
      for (const name of bags) { await pool.removeEntry(name, { recursive: true }); dropped.push(name.slice(0, 8)) }
    }
    return dropped
  }, { bees: sign('bees'), deps: sign('dependencies'), old: OLD })
  H.check('the install is known by the old stamp only, with no bags', Array.isArray(made), JSON.stringify(made))

  // 4. Reload with the seed reachable.
  offline = false
  lines.length = 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  const live = await waitFor('the old package booting', async () => ((await installed()) === OLD ? OLD : null), 120000)
  H.check('the old package is the live one', live === OLD, String(live).slice(0, 12))
  await H.sleep(6000)
  const door = await listeners('packages:open')
  const opener = await listeners('hosts:open')
  H.check("the head's Packages window answers the door beside it", door > 0, `packages:open listeners ${door}`)
  H.check('and nothing opens that window — the stranded shape', opener === 0, `hosts:open listeners ${opener}`)

  // The floor runs 15s after runtime-ready, acquires, waits for quiet, reloads.
  const moved = await waitFor('floor move', async () => {
    const now = await installed()
    return now && now !== OLD ? now : null
  }, 240000)
  H.check('the floor moves it anyway', !!moved, String(moved).slice(0, 12))
  H.check('onto the seed head', moved === head, `${String(moved).slice(0, 12)} vs ${String(head).slice(0, 12)}`)
  await waitFor('shell after the move', () => H.waitForShell(page, 5000), 120000)
  await H.sleep(8000)
  const stamp = await ask(() => localStorage.getItem('hc:shim:installed-package'))
  H.check('the move is stamped under the shared key', stamp === moved, String(stamp).slice(0, 12))
  const record = await ask(() => { try { return JSON.parse(localStorage.getItem('hc:install:floor') ?? 'null') } catch { return null } })
  H.check('the move is recorded with where it came from', record?.from === OLD && record?.to === moved, JSON.stringify(record)?.slice(0, 160))
  H.check('the door now leads somewhere', (await listeners('packages:open')) > 0 && (await listeners('hosts:open')) > 0)

  await ctx.close()
  try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { /* temp dir */ }
  await H.finish([])
})().catch(error => { console.error('[fatal]', error); process.exit(1) })
