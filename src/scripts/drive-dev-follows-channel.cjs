// scripts/drive-dev-follows-channel.cjs
//
// THE DEV SHELL FOLLOWS THE CHANNEL, on a throwaway profile.
//
// The dev shell runs its working tree and never installs a package, so its
// scout used to read "nothing recorded" as genesis and stay silent forever:
// a publish never reached it. Now it is offered each published revision like
// any hive (update-scout.service.ts), and the Packages window's one act on a
// source shell takes it (host-directory.view.ts) — the revision is recorded,
// the code stays source.
//
//   1. A fresh dev hive has nothing recorded, and the notice appears anyway,
//      naming the followed channel's signed root.
//   2. Pressing it opens Packages with the update on offer.
//   3. Taking it records the root as this hive's package.
//   4. After the restart the notice stays quiet — and the source note stays.
//
//   node scripts/drive-dev-follows-channel.cjs [--url http://localhost:4250/]

const H = require('./drive-swarm-connectivity.cjs')
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : 'http://localhost:4250/' })()
const PUBLISHER = require('../hypercomb-essentials/src/sharing/install-publisher.json')

const channelRoot = async () => {
  for (const host of PUBLISHER.hosts) {
    try {
      const event = await (await fetch(`https://${host}/hive/${PUBLISHER.pubkey}`)).json()
      const root = JSON.parse(event.content).roots?.[`install:${PUBLISHER.channel || 'essentials'}`]
      if (/^[a-f0-9]{64}$/.test(root ?? '')) return root
    } catch { /* next host */ }
  }
  return null
}

const stamp = (page) => H.evalSafe(() => page.evaluate(() => localStorage.getItem('hc:shim:installed-package')))

/** Everything the participant can see and press, as text. */
const surface = (page) => H.evalSafe(() => page.evaluate(() => {
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const notice = document.querySelector('hc-upgrade-indicator')
  const panel = document.querySelector('.hd-panel')
  const pressable = [...document.querySelectorAll('button, [role="button"]')].map(txt).filter(Boolean).slice(0, 40)
  const notes = [...document.querySelectorAll('.hd-note, .hd-updates')].map(txt)
  const running = document.querySelectorAll('.hd-row:not(.off)').length
  return { notice: notice ? txt(notice) : null, panelOpen: !!panel, pressable, notes, running }
}))

const press = (page, rx) => H.evalSafe(() => page.evaluate((src) => {
  const re = new RegExp(src, 'i')
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('button, [role="button"]')]
  const hit = all.find(el => re.test(txt(el)))
  if (!hit) return { ok: false, saw: all.map(txt).filter(Boolean).slice(0, 30) }
  hit.click()
  return { ok: true, pressed: txt(hit) }
}, rx))

;(async () => {
  const root = await channelRoot()
  H.check('the followed channel names a root', !!root, String(root).slice(0, 12))

  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', m => { const t = m.text(); if (/acquire\]|update-scout|packages/i.test(t) && !/404/.test(t)) console.log('[page]', t.slice(0, 160)) })

  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page, 120000)
  H.check('a fresh dev hive has nothing recorded', (await stamp(page)) === null)

  // 1. The scout runs 12s after boot.
  const lit = await H.waitFor(() => surface(page), s => !!s && !!s.notice && /update/i.test(s.notice), 60000, 1000)
  H.check('the notice appears on the dev shell', lit.ok, JSON.stringify(lit.value && lit.value.notice))
  const announced = await H.evalSafe(() => page.evaluate(() => {
    let last = null
    window.__hypercombEffectBus.on('update:available', p => { last = p })()
    return last ? { source: last.source, sig: last.packageSig } : null
  }))
  H.check("it names the followed channel's signed root", announced?.source === 'channel' && announced?.sig === root, JSON.stringify(announced)?.slice(0, 120))

  // 2. Press it — the door to Packages.
  const opened = await press(page, '^update available')
  H.check('the notice can be pressed', opened.ok, opened.ok ? opened.pressed : JSON.stringify(opened.saw))
  const win = await H.waitFor(() => surface(page), s => !!s && s.panelOpen && s.pressable.some(p => /^Update all$/i.test(p)), 90000, 1000)
  const zones = await H.evalSafe(() => page.evaluate(() => {
    let last = null
    window.__hypercombEffectBus.on('hosts:render', p => { last = p })()
    return last?.zones ?? null
  }))
  H.check('Packages opens with the update on offer', win.ok, `after ${win.waitedMs}ms, carried ${JSON.stringify(zones)} ` + JSON.stringify(win.value && { notes: win.value.notes }))

  // 3. Take it.
  const take = await press(page, '^Update all$')
  H.check('the window takes it', take.ok, take.ok ? take.pressed : JSON.stringify(take.saw))
  const took = await H.waitFor(() => stamp(page), s => s === root, 120000, 1000)
  H.check('taking it records the root as this hive’s package', took.ok, `${String(took.value).slice(0, 12)} after ${took.waitedMs}ms`)

  // 4. After the restart: quiet, and still a source shell.
  await H.sleep(3000)
  await H.waitForShell(page, 120000)
  await H.sleep(16000)
  const after = await surface(page)
  H.check('after the restart the notice is quiet', !after?.notice || !/update/i.test(after.notice), JSON.stringify(after?.notice))
  H.check('the record survives the restart', (await stamp(page)) === root)
  H.check('and the window still says the code comes from source', (after?.notes ?? []).some(n => /from source/i.test(n)) || !after?.panelOpen, JSON.stringify(after?.notes))
  H.check('nothing reads as running a package', (after?.running ?? 0) === 0, String(after?.running))

  console.log('\n========== dev follows the channel ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  await browser.close()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
