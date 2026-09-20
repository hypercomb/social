// scripts/drive-update-notice.cjs — does a hypercomb.io instance light the
// update notice from the signed channel, with no deploy involved?
//
// Fresh throwaway profile (never a tab on anyone's hive). Boot the deployed
// shell, accept its first-run install if it asks, record which package it
// installed and what the followed index says. Then make the installed stamp
// look OLDER, reload, and watch for update:available {source:'channel'} —
// the scout's one announcement. node scripts/drive-update-notice.cjs [--url https://hypercomb.io/]
const H = require('./drive-swarm-connectivity.cjs')
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : 'https://hypercomb.io/' })()

const read = (page) => H.evalSafe(() => page.evaluate(async () => {
  const bus = globalThis.__hypercombEffectBus
  const installed = localStorage.getItem('hc:shim:installed-package') || localStorage.getItem('sentinel.sync-signature')
  const follow = localStorage.getItem('hc:install-follow')
  let announced = null
  const off = bus && bus.on ? bus.on('update:available', p => { announced = p }) : null
  await new Promise(r => setTimeout(r, 300))
  if (off) off()
  return { installed, follow, announced, hasScout: !!window.ioc?.get?.('@diamondcoreprocessor.com/UpdateScoutService'), bees: window.ioc?.list?.().length ?? 0 }
}))

;(async () => {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', m => { const t = m.text(); if (/update|scout|install|acquire|channel/i.test(t) && !/404/.test(t)) console.log('[page]', t.slice(0, 180)) })
  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page)
  console.log('install:', await H.installIfNeeded(page, 'io'))
  await H.waitForReady(page, 120000)
  await H.settle(page, 3000)
  await H.sleep(15000)   // the scout checks ~12 s after paint
  const first = await read(page)
  console.log('after boot:', JSON.stringify(first))
  const index = await H.evalSafe(() => page.evaluate(async () => {
    const r = await fetch('https://content.pluginthematrix.com/hive/eacc0e65aeed6d421d12141b04f4cd47e2926ee470a835505c0a5ad2f1f75a9a')
    const j = await r.json(); const roots = JSON.parse(j.content).roots
    return roots['install:essentials']
  }))
  console.log('channel root now:', index)
  // Make this instance look older than the channel, then reload: the scout must announce.
  await H.evalSafe(() => page.evaluate(() => { localStorage.setItem('hc:shim:installed-package', '1'.repeat(64)) }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.waitForReady(page, 120000); await H.settle(page, 3000)
  const lit = await H.waitFor(() => H.evalSafe(() => page.evaluate(() => {
    const bus = globalThis.__hypercombEffectBus
    return new Promise(res => { let got = null; const off = bus.on('update:available', p => { got = p }); setTimeout(() => { off(); res(got) }, 250) })
  })), v => !!v && v.available !== false, 40000, 1000)
  console.log('after making the stamp older:', JSON.stringify(lit.value), lit.ok ? `(announced after ${lit.waitedMs}ms)` : '(NOT announced)')
  const pill = await H.evalSafe(() => page.evaluate(() => { const el = document.querySelector('hc-upgrade-indicator'); return el ? (el.textContent || '').trim().slice(0, 80) : null }))
  console.log('notice element:', JSON.stringify(pill))
  await browser.close()
  process.exit(lit.ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
