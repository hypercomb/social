// scripts/drive-update-take.cjs
//
// THE WHOLE CONSUMER PATH, ON A THROWAWAY PROFILE: notice → Packages → take.
//
// drive-update-notice proves the notice lights. This proves what happens when
// a participant acts on it: the Packages window must SHOW an update mark and
// taking it must move `hc:shim:installed-package` to the announced signature,
// with the bytes coming from the carried hosts. No deploy, no upload.
//
// The instance is made to look older than the followed channel root (the same
// state a real hive is in the moment a publisher stamps a new build), so this
// runs against the LIVE signed index without needing a stamp of its own.
//
//   node scripts/drive-update-take.cjs [--url https://hypercomb.io/]

const H = require('./drive-swarm-connectivity.cjs')
const URL_ = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : 'https://hypercomb.io/' })()
const OLD = '1'.repeat(64)   // a sig this hive certainly does not run

const installedSig = (page) => H.evalSafe(() => page.evaluate(() =>
  localStorage.getItem('hc:shim:installed-package') || localStorage.getItem('sentinel.sync-signature')))

/** Everything the participant can see and press, as text. */
const surface = (page) => H.evalSafe(() => page.evaluate(() => {
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const notice = document.querySelector('hc-upgrade-indicator')
  const panel = document.querySelector('.hd-panel, hc-host-directory, .hosts-panel')
  const marks = [...document.querySelectorAll('.hd-mark')].map(txt)
  const pressable = [...document.querySelectorAll('button, .hd-choose, .hd-section header, [role="button"]')]
    .map(txt).filter(Boolean).slice(0, 40)
  return { notice: notice ? txt(notice) : null, panelOpen: !!panel, marks, pressable }
}))

/** Press the first thing whose text matches — the participant's own click. */
const press = (page, rx) => H.evalSafe(() => page.evaluate((src) => {
  const re = new RegExp(src, 'i')
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim()
  const all = [...document.querySelectorAll('button, .hd-choose, .hd-section header, [role="button"], .hd-mark')]
  const hit = all.find(el => re.test(txt(el)))
  if (!hit) return { ok: false, saw: all.map(txt).filter(Boolean).slice(0, 30) }
  hit.click()
  return { ok: true, pressed: txt(hit) }
}, rx))

;(async () => {
  const la = H.launcherFor('chromium')
  const browser = await la.type.launch({ headless: !H.HEADED })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', m => { const t = m.text(); if (/acquire|install|update|channel|packages/i.test(t) && !/404/.test(t)) console.log('[page]', t.slice(0, 160)) })

  await page.goto(URL_, { waitUntil: 'domcontentloaded' })
  await H.waitForShell(page)
  await H.installIfNeeded(page, 'io')
  await H.waitForReady(page, 120000)
  await H.settle(page, 3000)
  const cold = await installedSig(page)
  H.check('a cold instance installs a package from a carried host', !!cold, String(cold).slice(0, 12))

  // The state a hive is in the instant a publisher stamps a newer build.
  await H.evalSafe(() => page.evaluate((old) => localStorage.setItem('hc:shim:installed-package', old), OLD))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await H.waitForShell(page); await H.waitForReady(page, 120000); await H.settle(page, 3000)

  const lit = await H.waitFor(() => surface(page), s => !!s && !!s.notice && /update/i.test(s.notice), 40000, 1000)
  H.check('the notice appears on its own', lit.ok, JSON.stringify(lit.value && lit.value.notice))

  // The participant presses the notice — the door to Packages.
  const opened = await press(page, 'update')
  H.check('the notice can be pressed', opened.ok, opened.ok ? opened.pressed : JSON.stringify(opened.saw))
  await H.sleep(2500)
  const win = await surface(page)
  H.check('Packages opens', !!win.panelOpen, `marks=${JSON.stringify(win.marks)}`)
  H.check('an update mark is shown', (win.marks || []).some(m => /update/i.test(m)), JSON.stringify(win.marks))
  H.log('packages', 'pressable: ' + JSON.stringify(win.pressable))

  // "Update all" is the control the window offers on the marked domain — press
  // THAT, not the heading (a heading press just collapses the accordion).
  const take = await press(page, '^Update all$')
  H.check('the window offers a control that takes the update', take.ok, take.ok ? take.pressed : JSON.stringify(take.saw))
  await H.sleep(3000)
  H.log('after', JSON.stringify(await surface(page)).slice(0, 400))

  const took = await H.waitFor(() => installedSig(page), s => s && s !== OLD, 60000, 1000)
  H.check('taking it moves the installed package', took.ok, `${String(took.value).slice(0, 12)} after ${took.waitedMs}ms`)

  console.log('\n========== update take ==========')
  for (const r of H.results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
  console.log(`========== ${H.results.filter(r => r.ok).length}/${H.results.length} passed ==========`)
  await browser.close()
  process.exit(H.results.every(r => r.ok) ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })
