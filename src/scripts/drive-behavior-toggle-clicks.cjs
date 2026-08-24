#!/usr/bin/env node
// drive-behavior-toggle-clicks — how many clicks does ONE bulb take?
//
// The claim under test (Jaime, 2026-08-23): "you still have to click it three
// times". Each scope of the Beehaviors panel is supposed to be a plain two
// state switch — the pool's global light, and the layer's deposit. This drives
// a single row in each scope, click by click, and prints the row's own state
// (classes, aria-checked, bulb) plus the localStorage / decoration truth after
// every press, so an extra state has nowhere to hide.
//
//   node scripts/drive-behavior-toggle-clicks.cjs [--url http://localhost:4250]
//                                                 [--out <dir>] [--engine chrome]

const fs = require('node:fs')
const path = require('node:path')
const { chromium, firefox, webkit } = require('playwright')

function arg(name, fallback) {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1)
  const next = process.argv[process.argv.indexOf(hit) + 1]
  return next && !next.startsWith('--') ? next : true
}

function launcherFor(name) {
  switch (String(name)) {
    case 'firefox': return { type: firefox, opts: {} }
    case 'webkit': return { type: webkit, opts: {} }
    case 'msedge': return { type: chromium, opts: { channel: 'msedge' } }
    case 'chromium': return { type: chromium, opts: {} }
    default: return { type: chromium, opts: { channel: 'chrome' } }
  }
}

const TILE = 'click-count'

const ROW_SNAP = (scope) => {
  const sel = scope === 'store' ? '.features-scroll.store .features-row' : '.features-scroll .features-row'
  return Array.from(document.querySelectorAll(sel)).map((li, i) => ({
    i,
    label: (li.querySelector('.feature-name')?.textContent ?? '').trim().slice(0, 40),
    cls: li.className,
    checked: li.getAttribute('aria-checked'),
    bulb: li.querySelector('.feat-bulb')?.className ?? '',
  }))
}

async function main() {
  const url = String(arg('url', 'http://localhost:4250'))
  const out = path.resolve(String(arg('out', '.')))
  fs.mkdirSync(out, { recursive: true })
  const { type, opts } = launcherFor(arg('engine', 'chrome'))
  const browser = await type.launch({ headless: true, ...opts })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  const shot = async (n) => { await page.screenshot({ path: path.join(out, n + '.png') }) }
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  const lsSnap = () => page.evaluate(() => ({
    on: localStorage.getItem('hc:behavior-global-on'),
    off: localStorage.getItem('hc:behavior-global-off'),
    wake: localStorage.getItem('hc:behavior-wake'),
  }))

  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(9000)
    const startEmpty = page.getByText('Start empty', { exact: true })
    if (await startEmpty.count()) { await startEmpty.first().click(); await page.waitForTimeout(2500) }

    await page.keyboard.press('Escape')
    const input = page.locator('.command-input, input.shell-input, [role="combobox"]').first()
    await input.fill(TILE)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(3500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    await page.evaluate((t) => window.ioc?.get?.('@hypercomb.social/Navigation')?.go?.([t]), TILE)
    await page.waitForTimeout(6500)
    await shot('00-layer')

    const panel = page.locator('.features-panel')
    console.log('panel up: ' + (await panel.count()))

    // ── LAYER SCOPE ─────────────────────────────────────────────────────
    let rows = await page.evaluate(ROW_SNAP, 'layer')
    console.log('\n== LAYER rows (' + rows.length + ') ==')
    for (const r of rows.slice(0, 30)) console.log(`  [${r.i}] ${r.label} | ${r.cls} | checked=${r.checked} | bulb=${r.bulb}`)

    const target = rows.find(r => /(^|\s)off(\s|$)/.test(r.cls) && !/inherited/.test(r.cls))
    if (!target) console.log('  (no off layer row to drive)')
    else {
      console.log('\n-- driving LAYER row: ' + target.label)
      for (let click = 1; click <= 3; click++) {
        await page.locator('.features-scroll .features-row').nth(target.i).click()
        await page.waitForTimeout(4000)
        const now = await page.evaluate(ROW_SNAP, 'layer')
        const same = now.find(r => r.label === target.label) ?? now[target.i]
        console.log(`  click ${click}: ${same?.label} | ${same?.cls} | checked=${same?.checked} | bulb=${same?.bulb}`)
        await shot(`layer-click-${click}`)
      }
    }

    // ── NO PHANTOM LAYER ────────────────────────────────────────────────
    // The bug this script was written for: the refresh after a deposit
    // described `<tile>/<tile>` (the label resolved at the current location)
    // instead of the layer just written, so the row came back dark and the
    // second press deposited at the doubled path. Nothing may live there.
    {
      const phantom = await page.evaluate(async (t) => {
        const history = window.ioc?.get?.('@diamondcoreprocessor.com/HistoryService')
        if (!history) return { err: 'no history' }
        const sig = await history.sign({ explorerSegments: () => [t, t] })
        const layer = await history.currentLayerAt(sig)
        return { exists: !!layer, decorations: Array.isArray(layer?.decorations) ? layer.decorations.length : 0 }
      }, TILE)
      console.log('  no phantom layer at /' + TILE + '/' + TILE + ': ' + JSON.stringify(phantom))
    }

    // ── THE DEFAULT-VIEW ICON — one press, same rule ────────────────────
    // The icon of a lit view row makes the layer OPEN AS that view. It
    // refreshes through the same path the enable does, so it is the same
    // one-press question.
    {
      const lit = (await page.evaluate(ROW_SNAP, 'layer')).find(r => /(^|\s)lit(\s|$)/.test(r.cls))
      if (!lit) console.log('-- no lit view row to press the icon on')
      else {
        const icon = page.locator('.features-scroll .features-row').nth(lit.i).locator('.feature-icon.as-default')
        if (!(await icon.count())) console.log('-- lit row has no default control: ' + lit.label)
        else {
          console.log('-- pressing DEFAULT icon on: ' + lit.label)
          for (let click = 1; click <= 2; click++) {
            await icon.click(); await page.waitForTimeout(4000)
            const now = (await page.evaluate(ROW_SNAP, 'layer')).find(r => r.label === lit.label)
            const isDefault = await page.locator('.features-scroll .features-row .feature-icon.as-default.is-default').count()
            console.log(`  icon click ${click}: ${now?.cls} | is-default=${isDefault}`)
          }
        }
      }
    }

    // ── POOL SCOPE ──────────────────────────────────────────────────────
    await page.locator('.features-panel .scope-toggle').click()
    await page.waitForTimeout(2500)
    await shot('10-pool')
    rows = await page.evaluate(ROW_SNAP, 'store')
    console.log('\n== POOL rows (' + rows.length + ') ==')
    for (const r of rows.slice(0, 12)) console.log(`  [${r.i}] ${r.label} | ${r.cls} | checked=${r.checked} | bulb=${r.bulb}`)
    const poolTarget = rows.find(r => /(^|\s)off(\s|$)/.test(r.cls)) ?? rows[0]
    if (poolTarget) {
      console.log('\n-- driving POOL row: ' + poolTarget.label + ' (start ' + poolTarget.cls + ')')
      console.log('  ls before: ' + JSON.stringify(await lsSnap()).slice(0, 300))
      for (let click = 1; click <= 3; click++) {
        await page.locator('.features-scroll.store .features-row').nth(poolTarget.i).click()
        await page.waitForTimeout(1500)
        const now = await page.evaluate(ROW_SNAP, 'store')
        const same = now.find(r => r.label === poolTarget.label) ?? now[poolTarget.i]
        const ls = await lsSnap()
        const onList = (() => { try { return JSON.parse(ls.on ?? '[]') } catch { return [] } })()
        const offList = (() => { try { return JSON.parse(ls.off ?? '[]') } catch { return [] } })()
        console.log(`  click ${click}: ${same?.label} | ${same?.cls} | checked=${same?.checked} | onList=${onList.length} offList=${offList.length}`)
        await shot(`pool-click-${click}`)
      }
    }
  } finally {
    await browser.close()
  }
  if (errors.length) console.log('\npage errors:\n  ' + errors.slice(0, 8).join('\n  '))
}

main().catch(e => { console.error(e); process.exit(1) })
