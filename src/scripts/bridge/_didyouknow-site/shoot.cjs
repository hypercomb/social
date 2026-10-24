// shoot.cjs -- look at a generated page before it is said into the hive.
//
//   node scripts/bridge/_didyouknow-site/shoot.cjs <pages-dir> [--out <dir>]
//
// The generator names the shared stylesheet by signature (resource:<sha>/chrome.css),
// which only a hive can resolve. This reads each <page>.html in <pages-dir>,
// points that one link at the chrome.css beside the generator, and screenshots
// the page at a desktop and a phone width. It writes only to --out (default:
// <os temp>/didyouknow-shots). It never touches the hive.

'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), __dirname] }))

const args = process.argv.slice(2)
const pagesDir = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null
const outAt = args.indexOf('--out')
const OUT = path.resolve(outAt >= 0 ? args[outAt + 1] : path.join(os.tmpdir(), 'didyouknow-shots'))
if (!pagesDir || !fs.existsSync(pagesDir)) {
  console.error('usage: shoot.cjs <pages-dir> [--out <dir>]')
  process.exit(2)
}

const CHROME = path.resolve(__dirname, '..', '_hosting-site', 'chrome.css')
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } }

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(pagesDir, file), 'utf8')
        .replace(/resource:[0-9a-f]{64}\/chrome\.css/g, pathToFileURL(CHROME).href)
      const local = path.join(OUT, file)
      fs.writeFileSync(local, html)
      for (const [name, viewport] of Object.entries(SIZES)) {
        const page = await browser.newPage({ viewport })
        const errors = []
        page.on('pageerror', (e) => errors.push(String(e)))
        await page.goto(pathToFileURL(local).href)
        await page.waitForTimeout(300)
        const target = path.join(OUT, `${path.basename(file, '.html')}-${name}.png`)
        await page.screenshot({ path: target, fullPage: true })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        console.log(`${name.padEnd(8)} ${target}${overflow > 0 ? `  HORIZONTAL OVERFLOW ${overflow}px` : ''}${errors.length ? `  ERRORS ${errors.join(' | ')}` : ''}`)
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
