#!/usr/bin/env node
// scripts/drive-publish-groups-live.cjs
//
// A GROUP REALLY PUBLISHES (jwize 2026-10-13: "the whole idea is that we can
// publish groups"). Against a real host — the content host's own worker,
// served from this machine over in-memory storage — not the "no host"
// refusal every other driver meets:
//
//   1. a page with a group of two (one, two) and a tile outside it (three)
//   2. with no domain on for the page, publishing says where the switch is
//   3. the participant's own host (host-sync on); switch it on for the page
//      in the Publish panel
//   4. `groups publish blog` → "Published Blog"
//   5. the HOST's signed index names one and two — and not three
//   6. the model may say it: the census offers `groups` to a machine
//
// Needs the host running first:
//   node scripts/local-content-host.mjs 4291 http://localhost:4253
// Usage: node scripts/drive-publish-groups-live.cjs --url http://localhost:4253 [--host localhost:4291]
//        [--engine chrome|msedge|chromium] [--out test-results/publish-groups-live]

const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}
const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''))
}

async function main() {
  const url = String(arg('url', 'http://localhost:4253'))
  const host = String(arg('host', 'localhost:4291'))
  const out = path.resolve(String(arg('out', 'test-results/publish-groups-live')))
  fs.mkdirSync(out, { recursive: true })
  const engine = String(arg('engine', 'chrome'))
  const browser = await chromium.launch({ headless: true, ...(engine === 'chromium' ? {} : { channel: engine }) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  // Toasts survive reloads (naming your own host re-boots the hive): every
  // load re-attaches the listener and keeps what it heard in sessionStorage.
  await context.addInitScript(() => {
    const kept = () => { try { return JSON.parse(sessionStorage.getItem('__live') || '[]') } catch { return [] } }
    Object.defineProperty(window, '__live', { value: { get toasts() { return kept() } }, configurable: true })
    const hook = setInterval(() => {
      const bus = window.__hypercombEffectBus
      if (!bus?.on) return
      clearInterval(hook)
      bus.on('toast:show', p => { const t = kept(); t.push(p); sessionStorage.setItem('__live', JSON.stringify(t)) })
    }, 50)
  })
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  /** Wait until the page has gone `quiet` ms without navigating. */
  const steady = async (quiet = 10000, cap = 60000) => {
    const end = Date.now() + cap
    let seen = navigations
    let since = Date.now()
    while (Date.now() < end) {
      await page.waitForTimeout(500)
      if (navigations !== seen) { seen = navigations; since = Date.now() }
      else if (Date.now() - since >= quiet) break
    }
    await settle(30000, () => page.evaluate(() => !!window.__hypercombEffectBus && !!window.ioc?.get?.('@hypercomb.social/Navigation')).catch(() => false))
  }
  const clearToasts = () => page.evaluate(() => sessionStorage.setItem('__live', '[]'))

  const hostState = async () => (await fetch(`http://${host}/__state`)).json()
  /** Every publisher's signed index this host holds — the worker keeps them
   *  in the `hive:indexes` pool as `<pool>/<pubkey>` (worker.js). */
  const hostIndexes = async () => {
    const pool = require('node:crypto').createHash('sha256').update('hive:indexes').digest('hex')
    const keys = (await hostState()).content.filter(k => k.startsWith(pool + '/'))
    const out = []
    for (const key of keys) {
      const event = await (await fetch(`http://${host}/${key}`)).json()
      out.push(typeof event.content === 'string' ? JSON.parse(event.content) : event.content)
    }
    return out
  }
  const emit = (name, payload) => page.evaluate(({ n, p }) => window.__hypercombEffectBus?.emit?.(n, p), { n: name, p: payload })
  const go = (segs) => page.evaluate((s) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s), segs)
  const select = (labels) => page.evaluate((ls) => {
    const sel = window.ioc?.get?.('@diamondcoreprocessor.com/SelectionService')
    sel?.clear?.()
    for (const l of ls) sel?.add?.(l)
  }, labels)
  const say = (line) => page.evaluate(async (text) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, line)
  const settle = async (ms, until) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await until()) return true
      await page.waitForTimeout(250)
    }
    return until()
  }
  const toastAbout = (re) => page.evaluate((src) => {
    const r = new RegExp(src)
    return window.__live.toasts.find(t => r.test(String(t.title ?? '') + ' ' + String(t.message ?? ''))) ?? null
  }, re.source)
  const stripUp = () => page.evaluate(() => {
    const el = document.querySelector('hc-publish-groups')
    return !!el && !el.hidden && el.querySelectorAll('.hc-pg-btn[data-meaning]').length > 0
  })

  try {
    const before = await hostState().catch(() => null)
    check('the host answers', !!before, before ? `${before.content.length} objects, ${Object.keys(before.hives).length} hive(s)` : 'start scripts/local-content-host.mjs first')
    if (!before) return

    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await say('site'); await page.waitForTimeout(2000)
    await go(['site']); await page.waitForTimeout(2500)
    for (const t of ['one', 'two', 'three']) { await say(t); await page.waitForTimeout(1500) }
    const globallyOn = () => page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('hc:behavior-global-on') || '[]').includes('publish:groups') } catch { return false }
    })
    if (!(await globallyOn())) {
      await emit('features:lens', { lens: 'global' })
      await settle(4000, () => page.evaluate(() => !!document.querySelector('.features-panel')))
      await page.locator('.features-panel .features-row').filter({ hasText: 'Publish groups' }).first().click()
      await page.waitForTimeout(1200)
      await emit('features:viewer-close', {})
    }
    await clearToasts()

    // 1.
    await say('/groups on'); await settle(6000, stripUp)
    await select(['one', 'two'])
    await say('/groups new Blog')
    check('a page with a group of two, and a tile outside it', await settle(8000, stripUp))
    await select([])

    // 2.
    await say('/groups publish blog')
    const hint = await settle(20000, async () => !!(await toastAbout(/Turn on a domain for this page/)))
    check('with no domain on for the page, publishing says where the switch is', hint, JSON.stringify(await toastAbout(/Blog/)))

    // 3. The participant's own host, with host-sync on — the setup a hive
    //    that publishes runs (a fresh profile has neither: host-sync is inert
    //    until both are set, host-sync.service.ts). Carried, and own.
    await emit('hosts:add', { zone: host })
    await emit('hosts:own-host', { host })
    await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/HostSyncService')?.enable?.()).catch(() => {})
    // Naming your own host re-boots the hive onto it — ride the reloads.
    await steady()
    await go(['site'])
    await page.waitForTimeout(3000)
    const hostSyncOn = await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/HostSyncService')?.isEnabled?.() === true)
    if (!hostSyncOn) {
      await page.evaluate(() => window.ioc.get('@diamondcoreprocessor.com/HostSyncService')?.enable?.())
      await page.waitForTimeout(1500)
    }
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur() })
    await page.keyboard.press('p')
    await settle(5000, () => page.evaluate(() => !!document.querySelector('.publish-panel')))
    const door = page.locator('.publish-panel .pdoor').filter({ hasText: host }).first()
    const listed = await settle(8000, async () => (await door.count()) > 0)
    // Pressing it names the page's domain (its host marks) — and, the page
    // not being live yet, publishes the page too; the switch lights when
    // THAT lands, which is the page's publish, not the group's.
    if (listed) await door.click()
    const pressed = await settle(10000, () => page.evaluate(() => {
      const r = window.__hypercombEffectBus?.lastValue?.get?.('publish:render')
      const row = r?.rows?.find?.(x => x.key === r.currentKey)
      return Array.isArray(row?.doors) && row.doors.length > 0
    }))
    check('the host is carried, made your own, and switched on for the page', listed && pressed, `listed=${listed} doors=${pressed}`)
    await shot('03-door-on')
    await page.locator('.publish-panel .publish-header button').last().click().catch(() => {})

    // 4.
    await clearToasts()
    await say('/groups publish blog')
    const done = await settle(240000, async () => !!(await toastAbout(/^(Published Blog|Blog: \d+ not published)/)))
    const toast = await toastAbout(/Blog/)
    check('`groups publish blog` → Published Blog', done && /^Published Blog/.test(String(toast?.title ?? '')), JSON.stringify(toast))

    // 5.
    const after = await hostState()
    const indexes = await hostIndexes()
    const roots = Object.assign({}, ...indexes.map(i => i.roots ?? {}))
    const doors = Object.assign({}, ...indexes.map(i => i.doors ?? {}))
    const onDoor = (label) => (doors[`site/${label}`] ?? []).includes(host)
    check("the host's signed index names one and two, on the page's domain — and not three",
      !!roots['site/one'] && !!roots['site/two'] && !roots['site/three'] && onDoor('one') && onDoor('two'),
      `roots=${JSON.stringify(Object.keys(roots))} doors=${JSON.stringify(doors)} objects ${before.content.length}→${after.content.length}`)
    fs.writeFileSync(path.join(out, 'host-indexes.json'), JSON.stringify(indexes, null, 1))

    // How the PAGE's own publish (the switch press) ended — reported, not
    // gated: it is the page's publish, outside the group.
    await settle(150000, () => page.evaluate(() => window.__live.toasts.some(t =>
      !/Blog|groups|Group/.test(String(t.title ?? '') + String(t.message ?? ''))
      && /publish|upload|host/i.test(String(t.title ?? '') + ' ' + String(t.message ?? '')))))
    console.log("  info  the page's own publish:", JSON.stringify(await page.evaluate(() =>
      window.__live.toasts.filter(t => !/Blog|groups|Group/.test(String(t.title ?? '') + String(t.message ?? '')))
        .map(t => `${t.type}: ${t.title ?? ''} ${t.message ?? ''}`.trim()).slice(-3))))

    // 6.
    const machine = await page.evaluate(() => {
      const entries = window.ioc.get('@diamondcoreprocessor.com/SlashBehaviourDrone')?.entries?.() ?? []
      const g = entries.find(e => e.name === 'groups')
      return g?.machine ? { reach: g.machine.reach, scope: g.machine.scope, example: g.machine.example } : null
    })
    check('the model may say it — the census offers `groups` to a machine', machine?.scope === 'network'
      && machine?.reach === 'editing', JSON.stringify(machine))
  } finally {
    const real = errors.filter(e => !/Could not initialize shader|favicon|ResizeObserver/i.test(e))
    if (real.length) console.log('\npage errors:\n  ' + real.slice(0, 8).join('\n  '))
    else console.log('\nno page errors')
    console.log('\nshots in ' + out)
    const failed = results.filter(r => !r.ok).length
    console.log(failed ? failed + ' CHECK(S) FAILED' : 'all ' + results.length + ' checks passed')
    await browser.close()
    process.exitCode = failed ? 1 : 0
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
