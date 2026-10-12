#!/usr/bin/env node
// scripts/drive-publish-panel-groups.cjs
//
// PUBLISH GROUPS INSIDE THE PUBLISH PANEL — a group publishes from the panel
// as it does from the strip, and from inside a view, where the strip is not
// drawn (publish-groups.md).
//
//   1. a layer with a group (made with the `groups` word)
//   2. `p` opens Publish; its Groups section lists the layer's groups
//   3. a row reads the group's name and Publish (n); pressing it runs the
//      group and reports (a fresh profile has no host — it says why)
//   4. over a takeover view the strip is gone but the panel still lists them
//
// Usage: node scripts/drive-publish-panel-groups.cjs --url http://localhost:4253
//        [--engine chrome|msedge|chromium] [--out test-results/publish-panel-groups]

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
  const out = path.resolve(String(arg('out', 'test-results/publish-panel-groups')))
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
      await page.waitForTimeout(150)
    }
    return until()
  }
  const stripUp = () => page.evaluate(() => {
    const host = document.querySelector('hc-publish-groups')
    return !!host && !host.hidden && host.querySelectorAll('.hc-pg-btn[data-meaning]').length > 0
  })
  const panelGroups = () => page.evaluate(() => {
    const head = [...document.querySelectorAll('.publish-panel .psec-head')].find(h => /Groups/.test(h.textContent ?? ''))
    if (!head) return null
    return {
      head: (head.textContent ?? '').trim(),
      rows: [...document.querySelectorAll('.publish-panel .pgroup')].map(r => ({
        name: r.querySelector('.pgroup-name')?.textContent?.trim() ?? '',
        icon: r.querySelector('.pgroup-icon')?.textContent?.trim() ?? '',
        act: r.querySelector('.pgroup-act')?.textContent?.trim() ?? '',
      })),
    }
  })
  const pressP = async () => {
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body) a.blur() })
    await page.keyboard.press('p')
  }

  try {
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
    // The pool light is a toggle; a fresh profile may already have it lit.
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

    // 1.
    await say('/groups on'); await settle(6000, stripUp)
    await select(['one', 'two'])
    await say('/groups new Blog')
    const made = await settle(6000, stripUp)
    await select([])
    check('a layer with a group (made by the `groups` word)', made)
    await page.evaluate(() => {
      window.__pp = { toasts: [] }
      window.__hypercombEffectBus.on('toast:show', p => window.__pp.toasts.push(p))
    })

    // 2.
    await pressP()
    await settle(5000, () => page.evaluate(() => !!document.querySelector('.publish-panel')))
    const listed = await settle(6000, async () => (await panelGroups()) !== null)
    check('`p` opens Publish; its Groups section is there', listed, JSON.stringify(await panelGroups()))

    // 3.
    await page.locator('.publish-panel .psec-head').filter({ hasText: 'Groups' }).click()
    await settle(3000, async () => ((await panelGroups())?.rows ?? []).length > 0)
    const opened = await panelGroups()
    const row = opened?.rows?.[0]
    check('a row reads the group and Publish (n)', !!row && row.name === 'Blog' && row.act === 'Publish (2)'
      && row.icon === 'label', JSON.stringify(opened))
    await shot('03-panel-groups')
    await page.locator('.publish-panel .pgroup-act').first().click()
    const reported = await settle(20000, () => page.evaluate(() =>
      window.__pp.toasts.some(t => /Blog/.test(String(t.title ?? '')))))
    const toast = await page.evaluate(() => window.__pp.toasts.find(t => /Blog/.test(String(t.title ?? ''))))
    check('pressing it runs the group and reports', reported, JSON.stringify(toast))

    // 4.
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('postit'))
    await page.waitForTimeout(1200)
    const stripGone = !(await stripUp())
    const stillListed = await panelGroups()
    const panelUp = await page.evaluate(() => !!document.querySelector('.publish-panel'))
    check('over a takeover view the strip is gone, the panel still lists the group',
      stripGone && panelUp && (stillListed?.rows ?? []).some(r => r.name === 'Blog'),
      `stripGone=${stripGone} panel=${panelUp} rows=${JSON.stringify(stillListed?.rows)}`)
    await shot('04-over-view')
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
