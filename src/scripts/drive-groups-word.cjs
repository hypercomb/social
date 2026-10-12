#!/usr/bin/env node
// scripts/drive-groups-word.cjs
//
// THE WORD FOR PUBLISH GROUPS — `groups` (every act has a word). Typed into
// the real command line, line by line, and checked against the strip and the
// layer data:
//
//   1. completion offers the sub-words
//   2. `groups on` lights the strip here — without popping the Beehaviors panel
//   3. `groups new Blog` with tiles selected → a group holding them
//   4. `groups add blog three` / `groups drop blog three`
//   5. `groups color blog green`, `groups icon blog star`, `groups rename blog Notes`
//   6. bare `groups` lists the groups and who is in them
//   7. `groups publish notes` runs the group (and NOT the `publish` word itself)
//   8. unknown group / unknown tile / unknown sub-word are said, never guessed
//   9. `groups ungroup notes`, then `groups off` puts the strip out
//
// Usage: node scripts/drive-groups-word.cjs --url http://localhost:4253
//        [--engine chrome|msedge|chromium] [--out test-results/groups-word]

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
  const out = path.resolve(String(arg('out', 'test-results/groups-word')))
  fs.mkdirSync(out, { recursive: true })
  const engine = String(arg('engine', 'chrome'))
  const browser = await chromium.launch({ headless: true, ...(engine === 'chromium' ? {} : { channel: engine }) })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))

  const emit = (name, payload) => page.evaluate(({ n, p }) => window.__hypercombEffectBus?.emit?.(n, p), { n: name, p: payload })
  const go = (segs) => page.evaluate((s) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.(s), segs)
  const select = (labels) => page.evaluate((ls) => {
    const sel = window.ioc?.get?.('@diamondcoreprocessor.com/SelectionService')
    sel?.clear?.()
    for (const l of ls) sel?.add?.(l)
  }, labels)
  const strip = () => page.evaluate(() => {
    const host = document.querySelector('hc-publish-groups')
    if (!host || host.hidden) return null
    return [...host.querySelectorAll('.hc-pg-btn[data-meaning]')].map(b => ({
      title: b.title.split(' — ')[0],
      icon: b.querySelector('.mat-sym')?.textContent ?? '',
      color: b.style.getPropertyValue('--pg'),
      count: Number(b.querySelector('.hc-pg-count')?.textContent ?? 0),
    }))
  })
  /** One line through the real command line, exactly as typed. */
  const say = (line) => page.evaluate(async (text) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, line)
  const addTile = (name) => say(name)
  const settle = async (ms, until) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await until()) return true
      await page.waitForTimeout(150)
    }
    return until()
  }
  const toasts = () => page.evaluate(() => window.__gw.toasts.map(t => String(t.message ?? t.title ?? '')))
  const lastToast = async () => (await toasts()).slice(-1)[0] ?? ''

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) {
      await startEmpty.first().click({ timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(2500)
    }
    await addTile('site'); await page.waitForTimeout(2000)
    await go(['site']); await page.waitForTimeout(2500)
    for (const t of ['one', 'two', 'three']) { await addTile(t); await page.waitForTimeout(1500) }

    // The behaviour arrives dark: the pool light is the participant's own act.
    await emit('features:lens', { lens: 'global' })
    await settle(4000, () => page.evaluate(() => !!document.querySelector('.features-panel')))
    await page.waitForTimeout(800)
    // A fresh profile may already have it lit (the census seed) — the row is a
    // toggle, so press it only when it is dark.
    const globallyOn = () => page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('hc:behavior-global-on') || '[]').includes('publish:groups') } catch { return false }
    })
    const poolRow = page.locator('.features-panel .features-row').filter({ hasText: 'Publish groups' }).first()
    if (!(await globallyOn()) && await poolRow.count()) { await poolRow.click(); await page.waitForTimeout(1200) }
    check('Publish groups is lit in the pool', await globallyOn())
    await emit('features:viewer-close', {})
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      window.__gw = { toasts: [] }
      window.__hypercombEffectBus.on('toast:show', p => window.__gw.toasts.push(p))
    })

    // 1. completion
    const offers = await page.evaluate(() => {
      const q = window.ioc.get('@diamondcoreprocessor.com/GroupsQueenBee')
      return { first: q?.slashComplete?.('pu'), all: q?.slashComplete?.('').length }
    })
    check('completion offers the sub-words', JSON.stringify(offers.first) === '["publish "]' && offers.all === 10, JSON.stringify(offers))

    // 2. on
    await say('/groups on')
    const lit = await settle(6000, async () => (await strip()) !== null)
    const panelPopped = await page.evaluate(() => !!document.querySelector('.features-panel'))
    check('`groups on` lights the strip here — the Beehaviors panel stays shut', lit && !panelPopped,
      `strip=${lit} panel=${panelPopped}`)

    // 3. new with a selection
    await select(['one', 'two'])
    await say('/groups new Blog')
    const made = await settle(6000, async () => ((await strip()) ?? []).some(g => g.title.startsWith('Blog') && g.count === 2))
    check('`groups new Blog` with tiles selected → a group holding them', made, JSON.stringify(await strip()))
    await select([])

    // 4. add / drop
    await say('/groups add blog three')
    const added = await settle(6000, async () => (await strip())?.[0]?.count === 3)
    await say('/groups drop blog three')
    const dropped = await settle(6000, async () => (await strip())?.[0]?.count === 2)
    check('`groups add blog three` / `groups drop blog three` — any case finds the group', added && dropped,
      `added=${added} dropped=${dropped}`)

    // 5. look
    await say('/groups color blog green')
    await settle(5000, async () => (await strip())?.[0]?.color === '#3ddc84')
    await say('/groups icon blog star')
    await settle(5000, async () => (await strip())?.[0]?.icon === 'star')
    await say('/groups rename blog Notes')
    await settle(5000, async () => (await strip())?.[0]?.title.startsWith('Notes'))
    const look = (await strip())?.[0]
    check('`color`, `icon`, `rename` change the look — members stay', !!look && look.color === '#3ddc84'
      && look.icon === 'star' && look.title.startsWith('Notes') && look.count === 2, JSON.stringify(look))

    // 6. list
    await say('/groups')
    await settle(3000, async () => /Notes \(2\): one, two/.test(await lastToast()))
    check('bare `groups` lists the groups and who is in them', /Notes \(2\): one, two/.test(await lastToast()), await lastToast())

    // 7. publish — the group, not the `publish` word
    await say('/groups publish notes')
    const reported = await settle(20000, async () => (await page.evaluate(() =>
      window.__gw.toasts.some(t => /Notes/.test(String(t.title ?? '')) && /not published/.test(String(t.title ?? ''))))))
    const publishPanel = await page.evaluate(() => !!document.querySelector('.publish-panel'))
    check('`groups publish notes` runs the group — and not the `publish` word', reported && !publishPanel,
      `reported=${reported} publishPanel=${publishPanel}`)
    await shot('07-after-publish')

    // 8. said, never guessed
    await say('/groups add nope one'); await page.waitForTimeout(800)
    const noGroup = await lastToast()
    await say('/groups add notes ghost'); await page.waitForTimeout(800)
    const noTile = await lastToast()
    await say('/groups delete notes'); await page.waitForTimeout(800)
    const usage = await lastToast()
    check('unknown group, unknown tile and unknown sub-word are each said',
      /No group called nope/.test(noGroup) && /Not on this layer: ghost/.test(noTile) && /^groups: on, off/.test(usage),
      JSON.stringify([noGroup, noTile, usage]))
    const stillTwo = (await strip())?.[0]?.count === 2
    check('nothing was written by the refused lines', stillTwo, JSON.stringify(await strip()))

    // 9. ungroup, off
    await say('/groups ungroup notes')
    const gone = await settle(6000, async () => ((await strip()) ?? ['x']).length === 0)
    await say('/groups off')
    const off = await settle(6000, async () => (await strip()) === null)
    check('`groups ungroup notes` takes it off; `groups off` puts the strip out', gone && off, `gone=${gone} off=${off}`)
    await shot('09-off')
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
