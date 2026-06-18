// Quick visual check of the susan art style — renders representative
// illustrations from _susan-build.cjs to a contact sheet via Playwright.
// Loads the ART object straight out of the build script (no duplication).
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

// Pull frame/C/ART out of the build source by evaluating just that block.
const src = fs.readFileSync(path.join(__dirname, '_susan-build.cjs'), 'utf8')
const start = src.indexOf('const W = 900')
const end = src.indexOf('// ─── warm chrome stylesheet')
const block = src.slice(start, end)
const sandbox = {}
new Function('exports', block + '\nexports.ART = ART; exports.W = W; exports.H = H;')(sandbox)
const { ART } = sandbox

;(async () => {
  const keys = Object.keys(ART)
  const cells = keys.map(k => `<figure><div class="t">${k}</div>${ART[k]()}</figure>`).join('')
  const html = `<!doctype html><meta charset=utf-8><style>
    body{margin:0;background:#efe6d6;font-family:system-ui;display:grid;grid-template-columns:repeat(2,1fr);gap:18px;padding:18px}
    figure{margin:0;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 6px 18px rgba(80,52,28,.14)}
    figure svg{display:block;width:100%;height:auto}
    .t{font:600 13px system-ui;padding:7px 12px;color:#5b4a38;letter-spacing:.04em}
  </style>${cells}`
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 }, deviceScaleFactor: 1.5 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.waitForTimeout(300)
  const out = 'scripts/bridge/_susan_assets/art_contact_sheet.png'
  fs.mkdirSync('scripts/bridge/_susan_assets', { recursive: true })
  await page.screenshot({ path: out, fullPage: true })
  console.log('rendered', keys.length, 'illustrations →', out)
  await browser.close()
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
