// scripts/drive-uncontrolled-shim.cjs
//
// A PAGE THE WORKER DOES NOT CONTROL STILL BOOTS. Every atom a bee imports
// resolves through the import map to /opfs/, which only the service worker
// answers. On a page it does not control — a hard reload, DevTools "bypass for
// network", a browser without workers — the shim mints self-typed blob URLs
// from its verified OPFS bytes (hypercomb-shim/src/import-map.ts), never
// caches that session-bound map, reloads ONCE keyed on the state, and boots on
// the late blob map when it stays uncontrolled (hypercomb-shim/src/main.ts).
//
// Drives the built shim through all three states in a fresh Chromium profile,
// using the CDP switch that IS DevTools "bypass for network" (a Ctrl+Shift+R
// sent to an embedded pane is not a real hard reload):
//
//   S0  replicate the host's package into OPFS — a controlled boot on the
//       worker-served /opfs/ map, cached for the early script
//   S1  Network.setBypassServiceWorker(true) + reload — uncontrolled: the map
//       is 593 blob: URLs, the guard is 'uncontrolled', exactly one reload,
//       the cache still holds the /opfs/ map, no further reload afterwards
//   S2  bypass off + reload — controlled: the cached /opfs/ map applies early,
//       no reload at all
//
//   npm run build:shim && node hypercomb-shim/host/serve.mjs hypercomb-shim/dist 4270
//   node scripts/drive-uncontrolled-shim.cjs [--url http://localhost:4270/]
//
// Prints one JSON report and exits 1 when any state is not what the doctrine
// says. The spec of the same shape: hypercomb-shim/src/uncontrolled-page.spec.ts.

const { chromium } = require('playwright')

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const URL_ = arg('--url', 'http://localhost:4270/')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const state = page => page.evaluate(() => {
  const maps = [...document.querySelectorAll('script[type=importmap]')].map(s => {
    const v = Object.values(JSON.parse(s.textContent).imports)
    return { n: v.length, blob: v.filter(u => u.startsWith('blob:')).length, opfs: v.filter(u => u.startsWith('/opfs/')).length }
  })
  const cached = localStorage.getItem('hc:importmap') || ''
  const guard = sessionStorage.getItem('hc:importmap') || ''
  return {
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    guard: guard === 'uncontrolled' ? guard : guard ? `map(${guard.length})` : '',
    cachedHasOpfs: cached.includes('/opfs/'), cachedHasBlob: cached.includes('blob:'), cachedLen: cached.length,
    aliasMap: globalThis.__hypercombAliasMap ? globalThis.__hypercombAliasMap.size : null,
    maps,
    installed: !!localStorage.getItem('hc:shim:installed-package'),
    marks: (window.__hcBootMarks || []).filter(m => /import map|bees loaded|first pulse|surfaces/.test(m)),
  }
})

const settle = async (pred, ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { if (await pred()) return true } catch { /* mid-navigation */ }
    await sleep(500)
  }
  return false
}

const findReplicate = () => {
  const all = (root, out = []) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) all(el.shadowRoot, out); if (el.tagName === 'BUTTON') out.push(el) } return out }
  return all(document).find(b => (b.textContent || '').trim() === 'Replicate') || null
}

;(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader'] })
  const context = await browser.newContext()
  const page = await context.newPage()
  const log = []
  let loads = 0
  page.on('console', m => {
    const t = m.text()
    if (/\[shim\]|does not control|reloading once|Failed to load module|MIME|Expected a JavaScript/.test(t)) log.push(`[${m.type()}] ${t.slice(0, 160)}`)
  })
  page.on('load', () => loads++)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')

  // S0 — replicate, then a controlled boot on the worker-served map.
  await page.goto(URL_)
  if (!await settle(() => page.evaluate(`(${findReplicate})() !== null`), 30000)) throw new Error('no Replicate button on the host panel')
  await page.evaluate(`(${findReplicate})().click()`)
  const booted = s => s.marks.some(m => /first pulse/.test(m))
  const installedOk = await settle(async () => { const s = await state(page); return s.installed && s.aliasMap > 0 && s.controlled && s.maps[0]?.opfs > 0 && booted(s) }, 120000)
  await sleep(2000)
  const s0 = await state(page)
  log.push(`--- S0 controlled install (ok=${installedOk}, loads=${loads})`)

  // S1 — bypass the worker: uncontrolled, blob map, one reload, then stable.
  await page.evaluate(() => sessionStorage.removeItem('hc:importmap'))
  await cdp.send('Network.setBypassServiceWorker', { bypass: true })
  const loadsBefore = loads
  await page.reload()
  const uncontrolledOk = await settle(async () => { const s = await state(page); return s.guard === 'uncontrolled' && booted(s) && loads - loadsBefore >= 2 }, 60000)
  await sleep(3000)
  const s1 = await state(page)
  const s1loads = loads - loadsBefore
  log.push(`--- S1 uncontrolled (ok=${uncontrolledOk}, boots since bypass=${s1loads})`)
  await sleep(5000)
  const s1loadsLater = loads - loadsBefore

  // S2 — controlled again: the cached /opfs/ map applies early, no reload.
  await cdp.send('Network.setBypassServiceWorker', { bypass: false })
  const loadsBefore2 = loads
  await page.reload()
  await settle(async () => booted(await state(page)), 60000)
  await sleep(3000)
  const s2 = await state(page)
  const s2loads = loads - loadsBefore2
  await browser.close()

  const moduleErrors = log.filter(l => /Failed to load module|MIME|Expected a JavaScript/.test(l)).length
  const checks = {
    s0_controlled_opfs_map_cached: s0.controlled && s0.maps[0]?.opfs > 0 && s0.maps[0]?.blob === 0 && s0.cachedHasOpfs,
    s1_uncontrolled_blob_map: !s1.controlled && s1.maps[0]?.blob > 0 && s1.maps[0]?.opfs === 0 && s1.aliasMap === s1.maps[0]?.blob,
    s1_guard_is_the_state: s1.guard === 'uncontrolled',
    s1_blob_map_never_cached: s1.cachedHasOpfs && !s1.cachedHasBlob && s1.cachedLen === s0.cachedLen,
    s1_reloads_once_never_loops: s1loads === 2 && s1loadsLater === 2,
    s1_boots: booted(s1),
    s2_controlled_cached_map_no_reload: s2.controlled && s2.maps[0]?.opfs > 0 && s2.maps[0]?.blob === 0 && s2loads === 1,
    no_module_script_errors: moduleErrors === 0,
  }
  const ok = Object.values(checks).every(Boolean)
  console.log(JSON.stringify({ ok, checks, s0, s1, s1loads, s1loadsLater, s2, s2loads, log }, null, 2))
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
