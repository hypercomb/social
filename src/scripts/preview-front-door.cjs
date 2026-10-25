// scripts/preview-front-door.cjs
//
// VIEW A DOMAIN'S FRONT DOOR LOCALLY, before it is deployed.
//
//   node scripts/preview-front-door.cjs                    # hypercomb.com, a desktop window
//   node scripts/preview-front-door.cjs --phone            # the same, as a touch phone (hold, swipe)
//   node scripts/preview-front-door.cjs --domain pluginthematrix.com
//   node scripts/preview-front-door.cjs --no-build         # reuse the last build
//   node scripts/preview-front-door.cjs --demo             # with named communities to swipe between
//   node scripts/preview-front-door.cjs --demo --view launcher   # ... drawn as the launcher
//
// --demo signs a showcase with a THROWAWAY key (never yours) that names a few
// communities, and swaps that key in for the domain's owner in the ledger the
// window sees: the domain itself is untouched. It is how to try the swipe
// before an owner has signed communities of their own.
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

const crypto = require('crypto')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

/** A throwaway owner, a signed index and a showcase atom naming a few communities. */
const demoFor = async (zone, view) => {
  const { generateSecretKey, getPublicKey, finalizeEvent } = require(require.resolve('nostr-tools/pure', { paths: [SRC] }))
  const live = await (await fetch(`https://${zone}/publications.json`)).json()
  const root = (live.sites || []).find(site => site.host === zone)
  const owner = root && root.publishers && root.publishers[0] && root.publishers[0].pubkey
  if (!owner) throw new Error(`${zone} names no owner in its ledger — nothing to demo on.`)
  const secret = generateSecretKey(), key = getPublicKey(secret)
  const ledger = JSON.stringify(live).split(owner).join(key)
  const here = (live.sites || []).filter(site => (site.hosts || []).some(host => host.host === zone || String(host.host).endsWith(`.${zone}`)) || site.host === zone)
  const lineages = [...new Set(here.map(site => site.lineage).filter(name => name && name !== zone && !String(name).includes('/')))]
  const item = lineage => ({ pubkey: key, lineage })
  const third = Math.max(1, Math.ceil(lineages.length / 3))
  const atom = Buffer.from(JSON.stringify({
    kind: 'host:showcase', zone, items: lineages.map(item), domains: [],
    ...(view ? { view } : {}),
    communities: [
      { name: 'First', items: lineages.slice(0, third).map(item), domains: [] },
      { name: 'Second', items: lineages.slice(third, third * 2).map(item), domains: [] },
      { name: 'Third', items: lineages.slice(third * 2).map(item), domains: [] },
    ].filter(community => community.items.length),
  }))
  const atomSig = sha(atom)
  const doors = Object.fromEntries(lineages.map(lineage => [lineage, [zone]]))
  const index = finalizeEvent({ kind: 30564, created_at: Math.floor(Date.now() / 1000), tags: [],
    content: JSON.stringify({ v: 1, roots: { [`showcase:${zone}`]: atomSig }, doors }) }, secret)
  return { ledger, key, atom, atomSig, index, indexes: sha(Buffer.from('hive:indexes')) }
}

const types = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
}

;(async () => {
  const phone = flag('phone')
  const demo = flag('demo') ? await demoFor(domain, value('view', '')) : null
  const browser = await chromium.launch({ headless: flag('headless'), args: phone ? [] : ['--window-size=1500,1000'] })
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'allow' }
    : { viewport: null, serviceWorkers: 'allow' })

  // The shell is yours; the data is the domain's.
  await context.route(`https://${domain}/**`, async route => {
    const url = new URL(route.request().url())
    let pathname = decodeURIComponent(url.pathname)
    if (demo && route.request().method() === 'GET') {
      const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
      if (pathname === '/publications.json') return route.fulfill({ status: 200, contentType: 'application/json', body: demo.ledger, headers: cors })
      if (pathname === `/${demo.indexes}/${demo.key}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(demo.index), headers: cors })
      if (pathname === `/${demo.atomSig}`) return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: demo.atom, headers: cors })
    }
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
  if (demo) console.log('Demo: a throwaway key signs a showcase with communities First, Second, Third — nothing real is changed.')
  if (flag('headless')) {
    await page.waitForTimeout(12000)
    console.log('tabs:', await page.evaluate(() => [...document.querySelector('hc-shim-hosts').shadowRoot.querySelectorAll('.pager-tab')].map(tab => tab.textContent).join(' | ')))
    await browser.close()
    return
  }
  console.log('Close the window to stop.')
  await new Promise(resolve => browser.on('disconnected', resolve))
})().catch(error => { console.error(error); process.exit(1) })
