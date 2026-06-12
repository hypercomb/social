// scripts/repro-safari-start-loop.cjs
//
// Reproduces the Safari first-run "Start → Starting… → Start" loop against
// the live site in WebKit, with full console capture — plus a feature-probe
// of the storage APIs the install path depends on.

const { webkit } = require('playwright')

const URL = process.argv[2] || 'https://hypercomb.io/'

function ts() { return new Date().toISOString().slice(11, 23) }
function log(...args) { console.log(`[${ts()}]`, ...args) }

async function main() {
  const browser = await webkit.launch({ headless: true })
  const page = await (await browser.newContext()).newPage()
  page.on('console', m => {
    const t = m.text()
    if (m.type() === 'error' || m.type() === 'warning' || /install|sentinel|opfs|store|boot|bundle|manifest|sync/i.test(t)) {
      console.log(`  [${m.type()}] ${t.slice(0, 220)}`)
    }
  })
  page.on('pageerror', e => console.log(`  [pageerror] ${String(e).slice(0, 300)}`))

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await new Promise(r => setTimeout(r, 6000))

  const features = await page.evaluate(async () => {
    const out = { opfs: false, createWritable: false, syncAccessHandle: false, serviceWorker: 'serviceWorker' in navigator, webgl: false, err: null }
    try {
      out.webgl = !!document.createElement('canvas').getContext('webgl')
      const root = await navigator.storage.getDirectory()
      out.opfs = true
      const f = await root.getFileHandle('__probe__', { create: true })
      out.createWritable = typeof f.createWritable === 'function'
      out.syncAccessHandle = typeof f.createSyncAccessHandle === 'function'
      await root.removeEntry('__probe__').catch(() => null)
    } catch (e) { out.err = String(e) }
    return out
  })
  log('feature probe:', JSON.stringify(features))

  const hasStart = await page.evaluate(() => !!document.querySelector('.install-cta'))
  log('welcome card present:', hasStart)
  if (hasStart) {
    log('clicking Start…')
    await page.click('.install-cta')
    // watch the button state for the loop across ~90s
    for (let i = 0; i < 9; i++) {
      await new Promise(r => setTimeout(r, 10000))
      const state = await page.evaluate(() => ({
        btn: document.querySelector('.install-cta')?.textContent?.trim() ?? '(gone)',
        url: location.href,
      }))
      log(`t+${(i + 1) * 10}s button="${state.btn}"`)
      if (state.btn === '(gone)') break
    }
  }
  const finale = await page.evaluate(() => ({
    canvas: !!document.querySelector('[data-hypercomb-pixi="root"] canvas'),
    note: document.querySelector('[data-hypercomb-pixi="webgl-required"]')?.textContent?.slice(-60) ?? null,
    installed: localStorage.getItem('hypercomb.installed'),
  }))
  log('final state:', JSON.stringify(finale))
  await browser.close()
}

main().catch(err => { console.error('[fatal]', err); process.exit(1) })
