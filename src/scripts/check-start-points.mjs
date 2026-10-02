#!/usr/bin/env node
// check-start-points — TWO BUILDS, ONE ORIGIN, in a real browser. The origin
// serves the current build at its root and the minimal host in a folder
// (hypercomb-shim/host/start-points.mjs); this walks a person through both,
// switching each way, and checks that neither build disturbs the other.
//
//   node scripts/check-start-points.mjs http://localhost:4953/   (a composed folder, served
//                                                                with hypercomb-shim/host/serve.mjs)
//   node scripts/check-start-points.mjs https://hypercomb.com/   (after a deploy)
//
// Each requirement prints PASS or FAIL; any FAIL exits non-zero.

import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const origin = new URL(process.argv[2] ?? '')
const folder = `/${process.argv[3] ?? 'minimal'}/`
if (!/^https?:$/.test(origin.protocol)) {
  console.error('usage: node scripts/check-start-points.mjs <origin url> [folder]')
  process.exit(2)
}
const at = path => new URL(path, origin).href

const results = []
const check = (requirement, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${requirement}${detail ? ` — ${detail}` : ''}`)
}

// The origin answers the minimal host's signed files at its root, readable
// from any origin: it is a seed host for the minimal kernel.
const pin = (await (await fetch(at(`${folder}pin`), { cache: 'no-store' })).text()).trim()
const bundle = await fetch(at(`/${pin}`))
const bytes = Buffer.from(await bundle.arrayBuffer())
check('the origin serves the minimal host\'s bundle at its root, by signature, to any origin',
  /^[0-9a-f]{64}$/.test(pin) && bundle.ok && createHash('sha256').update(bytes).digest('hex') === pin
    && bundle.headers.get('access-control-allow-origin') === '*',
  `${folder}pin → /${pin.slice(0, 12)}… ${bundle.status}, CORS ${bundle.headers.get('access-control-allow-origin')}`)

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const page = await (await browser.newContext()).newPage()
  const settle = () => page.waitForTimeout(2500)
  const look = () => page.evaluate(async () => ({
    path: location.pathname + location.search + location.hash,
    kept: localStorage.getItem('hc:start'),
    worker: navigator.serviceWorker.controller?.scriptURL ?? null,
    scopes: (await navigator.serviceWorker.getRegistrations()).map(r => new URL(r.scope).pathname).sort(),
    caches: await caches.keys(),
    kernel: !!window.__hcCoreImports,
    currentMap: localStorage.getItem('hc:importmap'),
  }))

  await page.goto(at('/')); await settle()
  let seen = await look()
  check('a person who never chose stays on the current build', seen.path === '/' && !seen.kernel && seen.kept === null, seen.path)

  // A hive location is the URL path: it comes along, under the folder.
  await page.goto(at('/garden?start=minimal&probe=1#note')); await settle()
  seen = await look()
  check('?start=minimal enters the minimal host at the same location, keeps the choice, carries the query',
    seen.path === `${folder}garden?probe=1#note` && seen.kept === 'minimal' && seen.kernel, seen.path)

  await page.reload(); await settle()
  seen = await look()
  check('the minimal host runs under its own worker, scoped to its folder',
    seen.worker === at(`${folder}hypercomb.worker.js`) && seen.scopes.includes(folder), `${seen.worker} · scopes ${seen.scopes.join(' ')}`)
  const minimalCaches = seen.caches.filter(name => /^hypercomb-(sig|shell)-v\d+$/.test(name))

  await page.goto(at('/garden/kitchen')); await settle()
  seen = await look()
  check('the front door sends a person to the start point they kept, at the same location',
    seen.path === `${folder}garden/kitchen` && seen.kernel, seen.path)

  await page.goto(at(`${folder}garden?start=current`)); await settle()
  seen = await look()
  check('?start=current returns to the current build at the same location and keeps that',
    seen.path.startsWith('/garden') && seen.kept === 'current' && !seen.kernel, seen.path)
  check('the current build runs under its own worker at the root', seen.worker === at('/hypercomb.worker.js'), String(seen.worker))

  await page.goto(at(folder)); await settle()
  seen = await look()
  check('a folder link is honored without changing the kept choice', seen.path === folder && seen.kernel && seen.kept === 'current', seen.path)

  await page.goto(at('/')); await settle()
  seen = await look()
  check('the current build\'s import map carries nothing of the minimal host\'s',
    // The minimal kernel's core is a blob: facade; replayed by the current
    // build it would be a dead import before anything could run.
    !/blob:/.test(seen.currentMap ?? ''), (seen.currentMap ?? 'none').slice(0, 80))
  check('the minimal host\'s caches survive the current build', minimalCaches.length > 0 && minimalCaches.every(name => seen.caches.includes(name)),
    `${minimalCaches.join(', ') || 'none kept'} → ${seen.caches.join(', ')}`)
} finally {
  await browser.close()
}

const failed = results.filter(ok => !ok).length
console.log(failed ? `\n${failed} of ${results.length} requirements failed` : `\nall ${results.length} requirements hold`)
process.exit(failed ? 1 : 0)
