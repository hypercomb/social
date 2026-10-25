// scripts/preview-front-door.cjs
//
// VIEW A DOMAIN'S FRONT DOOR LOCALLY, before it is deployed.
//
//   node scripts/preview-front-door.cjs                    # hypercomb.com, a desktop window
//   node scripts/preview-front-door.cjs --phone            # the same, as a touch phone (hold, swipe)
//   node scripts/preview-front-door.cjs --domain pluginthematrix.com
//   node scripts/preview-front-door.cjs --no-build         # reuse the last build
//
// It builds the shim (hypercomb-shim, the framework-free front door) into the
// temp directory and opens a real Chromium window at the domain's REAL address.
// The shell's own files come from your working tree; everything else — the
// ledger, the owners' signed index, the pictures, /welcome.json — is the
// domain's live answer, so you see today's data in tomorrow's code. Nothing is
// uploaded, deployed or signed, and closing the window ends it.
//
// A window on a phone-sized screen is a touch phone: hold a tile for the
// domains sheet, swipe the list to turn a community page. Rebuild by closing
// the window and running it again.

const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SRC = path.resolve(__dirname, '..')
const SHIM = path.join(SRC, 'hypercomb-shim')
const flags = process.argv.slice(2)
const flag = name => flags.includes(`--${name}`)
const value = (name, fallback) => { const at = flags.indexOf(`--${name}`); return at >= 0 && flags[at + 1] ? flags[at + 1] : fallback }

const domain = value('domain', 'hypercomb.com').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) { console.error(`"${domain}" is not a domain.`); process.exit(2) }
const out = path.join(os.tmpdir(), 'hypercomb-front-door-preview')

if (!flag('no-build') || !fs.existsSync(path.join(out, 'index.html'))) {
  console.log('Building the front door from your working tree…')
  fs.rmSync(out, { recursive: true, force: true })
  execFileSync(process.execPath, ['build.mjs', '--pure'], {
    cwd: SHIM, stdio: 'inherit', env: { ...process.env, HYPERCOMB_HOST_OUT_DIR: out },
  })
}

// The shim waits for its service worker; Playwright must be allowed to see it.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1'
const { chromium } = require(require.resolve('playwright', { paths: [SRC] }))

const types = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}

;(async () => {
  const phone = flag('phone')
  const browser = await chromium.launch({ headless: false, args: phone ? [] : ['--window-size=1500,1000'] })
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'allow' }
    : { viewport: null, serviceWorkers: 'allow' })

  // The shell is yours; the data is the domain's.
  await context.route(`https://${domain}/**`, async route => {
    const url = new URL(route.request().url())
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/' || pathname === '/hosts') pathname = '/index.html'
    const file = path.join(out, pathname)
    if (route.request().method() === 'GET' && file.startsWith(out) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const named = /^[0-9a-f]{64}$/.test(path.basename(file))
      return route.fulfill({
        status: 200, body: fs.readFileSync(file), headers: { 'cache-control': 'no-store' },
        contentType: types[path.extname(file)] || (named ? 'text/javascript' : 'application/octet-stream'),
      })
    }
    return route.continue()
  })

  const page = await context.newPage()
  page.on('pageerror', error => console.log('[page error]', error.message))
  await page.goto(`https://${domain}/`, { waitUntil: 'domcontentloaded' })
  console.log(`\nThe front door of ${domain}, from your working tree${phone ? ', as a touch phone' : ''}.`)
  console.log('Close the window to stop.')
  await new Promise(resolve => browser.on('disconnected', resolve))
})().catch(error => { console.error(error); process.exit(1) })
