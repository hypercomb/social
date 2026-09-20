// scripts/drive-acquire-direct.cjs
//
// TAKE A NAMED BUILD, WITH NO PUBLISHER AND NO BRIDGE. The signed index is how
// a build is OFFERED; it is not how a build ARRIVES. `hypercomb.acquire(sig,
// [host])` — the same call the Packages window makes — replicates a named
// package straight from a named host. Nothing is stamped, nothing is uploaded,
// no bridge is running.
//
// This is the route for an instance that is behind and does not want to wait
// for a stamp: it names the build it wants and the host that holds it.
//
//   node scripts/drive-acquire-direct.cjs --sig <64-hex> [--host jwize.com] [--url https://hypercomb.io/]

const H = require('./drive-swarm-connectivity.cjs')
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const URL_ = arg('--url', 'https://hypercomb.io/')
const SIG = arg('--sig', '')
const HOST = arg('--host', 'jwize.com')

const installedSig = (page) => H.evalSafe(() => page.evaluate(() =>
  localStorage.getItem('hc:shim:installed-package') || localStorage.getItem('sentinel.sync-signature')))

const handle = (page) => H.evalSafe(() => page.evaluate(() => {
  const h = window.hypercomb
  return h ? Object.keys(h) : null
}))

const beeCount = (page) => H.evalSafe(() => page.evaluate(() => window.ioc?.list?.().length ?? 0))

;(async () => {
  if (!/^[a-f0-9]{64}$/.test(SIG)) { console.error('need --sig <64-hex>'); process.exit(2) }
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', m => { const t = m.text(); if (/acquire|install|reload/i.test(t) && !/404/.test(t)) console.log('[page]', t.slice(0, 160)) })

  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page)
  await H.installIfNeeded(page, 'io')
  await H.waitForReady(page, 120000)
  await H.settle(page, 3000)

  const before = await installedSig(page)
  const keys = await handle(page)
  H.check('the console handle is installed by boot', Array.isArray(keys) && keys.includes('acquire'), JSON.stringify(keys))
  H.log('before', `installed=${String(before).slice(0, 12)} bees=${await beeCount(page)}`)

  // The one call. No publisher, no stamp, no bridge — a signature and a host.
  const res = await H.evalSafe(() => page.evaluate(async ({ sig, host }) => {
    try { return { ok: true, result: await window.hypercomb.acquire(sig, [host]) } }
    catch (e) { return { ok: false, error: String(e && e.message || e) } }
  }, { sig: SIG, host: HOST }))
  H.log('acquire', JSON.stringify(res).slice(0, 300))

  // A COLD BOOT ALREADY INSTALLS THE PUBLISHED HEAD, so "the instance runs the
  // named build" passes without the acquire doing anything at all — that is
  // how this harness reported 5/5 while every acquire was being refused
  // (2026-09-20). Judge the CALL, and only then the outcome.
  const verdict = res.ok && res.result && res.result.ok === true
  H.check('acquire(sig, [host]) is accepted', !!verdict,
    verdict ? `fetched ${res.result.fetched}, present ${res.result.present}` : `REFUSED: ${(res.result && res.result.error) || res.error}`)
  if (before === SIG) H.log('note', 'the cold boot had already installed this build — the move below proves nothing on its own')

  const moved = await H.waitFor(() => installedSig(page), s => s === SIG, 120000, 1000)
  H.check('the instance now runs the named build', moved.ok && !!verdict, `${String(moved.value).slice(0, 12)} after ${moved.waitedMs}ms`)

  // It must still be a working hive afterwards, not just a moved pointer.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.waitForReady(page, 120000); await H.settle(page, 3000)
  const after = await beeCount(page)
  H.check('it boots onto the taken build with its bees', after > 100, `${after} services registered`)
  H.check('and stays on it across the reload', (await installedSig(page)) === SIG)

  console.log('\n========== acquire direct ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  await browser.close()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
