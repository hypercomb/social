#!/usr/bin/env node
// shot — a screenshot of any page, taken by Playwright.
//
// Vendor-neutral verification: no bridge, no vendor browser tooling, no
// running renderer to attach to. Point it at a URL (http(s):// or file://)
// and it writes a PNG. Engines: chromium (default) | firefox | webkit |
// msedge | chrome — the same launcher vocabulary the drive-* harnesses use.
//
//   node scripts/shot.cjs <url> [--out shot.png] [--selector .foo]
//                              [--width 1280] [--height 800] [--full]
//                              [--engine chromium] [--wait 300]
//
// --selector clips to one element (its own box, transforms included).
// --full captures the whole scrollable page instead of the viewport.

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
    case 'chrome': return { type: chromium, opts: { channel: 'chrome' } }
    default: return { type: chromium, opts: {} }
  }
}

async function main() {
  const target = process.argv[2]
  if (!target || target.startsWith('--')) {
    console.error('usage: node scripts/shot.cjs <url|file> [--out shot.png] [--selector sel] [--full]')
    process.exit(2)
  }
  const url = /^[a-z]+:\/\//i.test(target) ? target : 'file:///' + path.resolve(target).replace(/\\/g, '/')
  const out = path.resolve(String(arg('out', 'shot.png')))
  const selector = arg('selector', null)
  const width = Number(arg('width', 1280))
  const height = Number(arg('height', 800))
  const wait = Number(arg('wait', 300))

  const { type, opts } = launcherFor(arg('engine', 'chromium'))
  const browser = await type.launch({ headless: true, ...opts })
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForTimeout(wait)
    const shot = selector ? page.locator(String(selector)).first() : page
    await shot.screenshot({ path: out, ...(selector ? {} : { fullPage: arg('full', false) === true }) })
    console.log(`wrote ${out}`)
    if (errors.length) console.log(`page errors:\n  ${errors.join('\n  ')}`)
  } finally {
    await browser.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
