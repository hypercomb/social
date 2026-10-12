#!/usr/bin/env node
// scripts/drive-publish-groups.cjs
//
// PUBLISH GROUPS (jwize 2026-10-10) — "a behavior that you get to put tiles
// in, assign icons and colors in the hive itself"; top of the hive, select
// then tap, per layer. Driven through the real panel and the real strip:
//
//   1. the Beehaviors pool lists "Publish groups"; lighting it is one click
//   2. the layer offers it; depositing it puts the strip at the top of the hive
//   3. tiles selected + `+` → a new group, the selection already in it
//   4. the editor renames it and recolours it — the strip follows
//   5. select + tap joins; the same tap again takes them out
//   6. hovering the icon names its members to the hive (group:preview)
//   7. Publish runs every member (a fresh profile has no host: it reports why)
//   8. a reload keeps it all — the groups are layer data, not memory
//   9. a takeover view takes the strip away; the hexagons bring it back
//  10. Ungroup takes the group and its marks off the layer
//
// Usage: node scripts/drive-publish-groups.cjs --url http://localhost:4253
//        [--engine chrome|msedge|chromium] [--out test-results/publish-groups]

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
  const out = path.resolve(String(arg('out', 'test-results/publish-groups')))
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
      meaning: b.dataset.meaning,
      title: b.title,
      icon: b.querySelector('.mat-sym')?.textContent ?? '',
      color: b.style.getPropertyValue('--pg'),
      count: Number(b.querySelector('.hc-pg-count')?.textContent ?? 0),
    }))
  })
  const addTile = (name) => page.evaluate(async (cellName) => {
    const input = document.querySelector('hc-command-line input') || document.querySelector('input[type="text"]')
    if (!input) return false
    input.focus(); input.value = cellName
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 150))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    return true
  }, name)
  const settle = async (ms, until) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await until()) return true
      await page.waitForTimeout(150)
    }
    return until()
  }
  const listen = () => page.evaluate(() => {
    window.__pg = { preview: [], toasts: [] }
    window.__hypercombEffectBus.on('group:preview', p => window.__pg.preview.push(p))
    window.__hypercombEffectBus.on('toast:show', p => window.__pg.toasts.push(p))
  })

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

    // 1. the pool
    await emit('features:lens', { lens: 'global' })
    await settle(4000, () => page.evaluate(() => !!document.querySelector('.features-panel')))
    await page.waitForTimeout(800)
    const poolRow = page.locator('.features-panel .features-row').filter({ hasText: 'Publish groups' }).first()
    const inPool = await poolRow.count()
    check('the Beehaviors pool lists Publish groups', inPool > 0)
    if (inPool) {
      const wasOn = await poolRow.evaluate(el => el.classList.contains('on') || !!el.querySelector('.on'))
      if (!wasOn) await poolRow.click()
      await page.waitForTimeout(1200)
    }
    const globalOn = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('hc:behavior-global-on') || '[]').includes('publish:groups') } catch { return false }
    })
    check('one click lights it in the pool', globalOn)

    // 2. the layer
    await emit('features:lens', { lens: 'behaviors' })
    await page.waitForTimeout(1500)
    const layerRow = page.locator('.features-panel .features-row').filter({ hasText: 'Publish groups' }).first()
    if (await layerRow.count()) { await layerRow.click(); await page.waitForTimeout(3000) }
    const shown = await settle(6000, async () => (await strip()) !== null)
    check('depositing it on the layer puts the strip at the top of the hive', shown, JSON.stringify(await strip()))
    await emit('features:viewer-close', {})
    await page.waitForTimeout(800)
    await shot('02-strip')
    await listen()

    // 3. + with a selection
    await select(['one', 'two'])
    await page.locator('hc-publish-groups .hc-pg-add').click()
    const created = await settle(6000, async () => ((await strip()) ?? []).some(g => g.count === 2))
    const afterCreate = await strip()
    check('tiles selected + `+` → a new group with the selection already in it',
      created && afterCreate.length === 1, JSON.stringify(afterCreate))
    const editorUp = await settle(3000, () => page.evaluate(() => !!document.querySelector('.hc-pg-editor')))
    check('the new group opens its editor', editorUp)
    await shot('03-created')

    // 4. rename + recolour
    await select([])
    const name = page.locator('.hc-pg-editor .hc-pg-name')
    await name.fill('Blog')
    await name.press('Enter')
    await settle(5000, async () => ((await strip()) ?? []).some(g => g.title.startsWith('Blog')))
    const swatch = page.locator('.hc-pg-editor .hc-pg-swatch').nth(2)
    const wantColor = await swatch.getAttribute('aria-label')
    await swatch.click()
    await settle(5000, async () => ((await strip()) ?? []).some(g => g.color === wantColor))
    const edited = (await strip())?.[0]
    check('the editor renames and recolours the group — the strip follows, the members stay',
      !!edited && edited.title.startsWith('Blog') && edited.color === wantColor && edited.count === 2,
      JSON.stringify(edited))
    const records = await page.evaluate(async () => {
      const ioc = window.ioc
      const history = ioc.get('@diamondcoreprocessor.com/HistoryService')
      const store = ioc.get('@hypercomb.social/Store')
      const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['site'] }))
      const groups = []
      for (const sig of layer?.decorations ?? []) {
        const rec = JSON.parse(await (await store.getResource(sig)).text())
        if (rec.kind === 'publish:group') groups.push(`${sig.slice(0, 8)} ${rec.payload?.name} ${rec.payload?.color}`)
      }
      return groups
    })
    check('an edit replaces the group\'s record — one record on the layer, never two',
      records.length === 1, JSON.stringify(records))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // 5. select + tap, both directions
    const groupBtn = page.locator('hc-publish-groups .hc-pg-btn[data-meaning]').first()
    await select(['three'])
    await groupBtn.click()
    const joined = await settle(5000, async () => (await strip())?.[0]?.count === 3)
    await select(['three'])
    await groupBtn.click()
    const left = await settle(5000, async () => (await strip())?.[0]?.count === 2)
    check('select + tap joins; the same tap again takes them out', joined && left, `joined=${joined} left=${left}`)
    await select([])

    // 6. hover
    await page.waitForTimeout(600)
    await groupBtn.hover()
    await page.waitForTimeout(700)
    await shot('06-hover-lights-members')
    await page.mouse.move(700, 600)
    const previews = await page.evaluate(() => window.__pg.preview)
    const lit = previews.find(p => Array.isArray(p.labels) && p.labels.length > 0)
    check('hovering the icon names its members to the hive, leaving clears it',
      !!lit && lit.labels.sort().join(',') === 'one,two' && previews[previews.length - 1].labels.length === 0,
      JSON.stringify(previews.slice(-2)))

    // 7. publish
    await groupBtn.click()
    await settle(3000, () => page.evaluate(() => !!document.querySelector('.hc-pg-editor')))
    await page.locator('.hc-pg-editor .hc-pg-act').first().click()
    const toasted = await settle(20000, () => page.evaluate(() => window.__pg.toasts.some(t => /Blog/.test(String(t.title ?? '')))))
    const toast = await page.evaluate(() => window.__pg.toasts.find(t => /Blog/.test(String(t.title ?? ''))))
    check('Publish runs every member and reports — here, why it could not (fresh profile, no host)',
      toasted, JSON.stringify(toast))
    await shot('07-published')
    await page.keyboard.press('Escape')

    // 8. reload
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(9000)
    await go(['site'])
    const kept = await settle(10000, async () => ((await strip()) ?? []).some(g => g.title.startsWith('Blog') && g.count === 2))
    check('a reload keeps the group, its look and its members', kept, JSON.stringify(await strip()))

    // 9. a takeover view
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('postit'))
    const gone = await settle(3000, async () => (await strip()) === null)
    await page.evaluate(() => window.ioc.get('@hypercomb.social/ViewMode').setMode('hexagons'))
    const back = await settle(4000, async () => (await strip()) !== null)
    check('a takeover view takes the strip away; the hexagons bring it back', gone && back, `gone=${gone} back=${back}`)

    // 10. ungroup
    await select([])
    await page.locator('hc-publish-groups .hc-pg-btn[data-meaning]').first().click()
    await settle(3000, () => page.evaluate(() => !!document.querySelector('.hc-pg-editor')))
    await page.locator('.hc-pg-editor .hc-pg-act.quiet').click()
    const ungrouped = await settle(6000, async () => ((await strip()) ?? ['x']).length === 0)
    const marks = await page.evaluate(async () => {
      const ioc = window.ioc
      const history = ioc.get('@diamondcoreprocessor.com/HistoryService')
      const store = ioc.get('@hypercomb.social/Store')
      let worn = 0
      for (const label of ['one', 'two', 'three']) {
        const layer = await history.currentLayerAt(await history.sign({ explorerSegments: () => ['site', label] }))
        for (const sig of layer?.decorations ?? []) {
          const rec = JSON.parse(await (await store.getResource(sig)).text())
          if (rec.kind === 'group' && String(rec.payload?.meaning ?? '').startsWith('publish:')) worn++
        }
      }
      return worn
    })
    check('Ungroup takes the group and every member\'s mark off the layer', ungrouped && marks === 0,
      `strip empty=${ungrouped}, marks left=${marks}`)
    await shot('10-ungrouped')
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
