// Proves the SUBSET icon font actually resolves every ligature the UI renders.
//
//   node scripts/check-icon-render.cjs [fontDir…]     # defaults to all shells
//
// check-icon-subset.cjs compares two lists; this one renders. Material Symbols
// resolves a glyph from the element's TEXT ("settings" → the gear), so a name
// missing from the subset does not fall back — it lays out as the literal word.
// A resolved glyph is one em box (~24px at 24px); literal text is far wider,
// and a blank is near zero. That width is the assertion.
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')

const REPO = path.resolve(__dirname, '..')
const DEFAULT = [
  'hypercomb-web/public/fonts',
  'hypercomb-shim/public/fonts',
  'hypercomb-dev/public/fonts',
]

;(async () => {
  const dirs = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT)
    .map(d => path.resolve(REPO, d))
  const browser = await chromium.launch()
  let bad = false

  for (const dir of dirs) {
    const label = path.relative(REPO, dir).replace(/\\/g, '/')
    if (!fs.existsSync(path.join(dir, 'icons.txt'))) {
      console.error(`MISSING  ${label}/icons.txt — run scripts/fetch-fonts.cjs`)
      bad = true; continue
    }
    const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8')
    const icons = fs.readFileSync(path.join(dir, 'icons.txt'), 'utf8').trim().split('\n')

    const page = await browser.newPage()
    // Serve the font dir so the stylesheet's relative woff2 urls resolve
    // exactly as they will in production.
    await page.route('**/*', route => {
      const f = path.join(dir, path.basename(new URL(route.request().url()).pathname))
      route.fulfill(fs.existsSync(f) ? { body: fs.readFileSync(f) } : { body: '', contentType: 'text/html' })
    })
    await page.goto('http://local.test/index.html')
    await page.setContent(`<style>${css}
      .mat-sym{font-family:"Material Symbols Outlined";font-size:24px;line-height:1;
               font-feature-settings:"liga";display:inline-block}</style>`
      + icons.map(i => `<span class="mat-sym" data-i="${i}">${i}</span>`).join(''))
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(400)
    const broken = await page.evaluate(() => [...document.querySelectorAll('.mat-sym')]
      .map(e => ({ i: e.dataset.i, w: e.getBoundingClientRect().width }))
      .filter(r => r.w > 30 || r.w < 4))
    await page.close()

    if (broken.length) {
      console.error(`FAIL     ${label} — ${broken.length} of ${icons.length} did not resolve:`)
      for (const r of broken) console.error(`           ${r.i}  ${r.w.toFixed(1)}px`)
      bad = true
    } else {
      console.log(`ok       ${label}  (${icons.length} ligatures resolve)`)
    }
  }

  await browser.close()
  if (bad) {
    console.error('\nEither the name is not a real Material Symbol, or the subset is stale:')
    console.error('  node scripts/fetch-fonts.cjs hypercomb-web/public/fonts inter material-symbols')
    process.exit(1)
  }
})().catch(e => { console.error(e); process.exit(1) })
