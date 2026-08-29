// Offline smoke test for the built read-only visitor.
//
// Serves the prepared assets plus a real Schnorr-signed hive index and a tiny
// Merkle root on loopback, then boots Chromium. All non-loopback requests are
// aborted and reported, so this also guards the zero-third-party-request
// contract without touching the public internet.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import http from 'node:http'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { schnorr } from '@noble/curves/secp256k1.js'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const assets = resolve(here, '..', 'dist', 'hypercomb-web', 'visitor')
await access(join(assets, 'index.html'))

const privateKey = Uint8Array.from({ length: 32 }, (_, i) => i === 31 ? 1 : 0)
const pubkey = Buffer.from(schnorr.getPublicKey(privateKey)).toString('hex')
const rootBytes = Buffer.from(JSON.stringify({
  name: 'revolucion',
  children: [],
  dependencies: [],
  bees: [],
}))
const head = createHash('sha256').update(rootBytes).digest('hex')
const createdAt = 1_800_000_000
const content = JSON.stringify({ roots: { revolucion: head } })
const event = { pubkey, created_at: createdAt, kind: 30564, tags: [], content }
const serial = JSON.stringify([0, pubkey, createdAt, 30564, [], content])
const id = createHash('sha256').update(serial).digest('hex')
const signedIndex = {
  ...event,
  id,
  sig: Buffer.from(schnorr.sign(Buffer.from(id, 'hex'), privateKey)).toString('hex'),
}

const mime = (path) => ({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
}[extname(path).toLowerCase()] ?? 'application/octet-stream')

let origin = ''
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', origin)
    if (url.pathname === '/site.json') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({
        title: 'Revolución', pubkey, head, lineage: 'revolucion',
        segments: ['revolucion'], hosts: [new URL(origin).host], publishedAt: createdAt,
      }))
      return
    }
    if (url.pathname === `/hive/${pubkey}`) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(signedIndex))
      return
    }
    if (url.pathname === `/${head}` || url.pathname === `/@resource/${head}`) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' })
      response.end(rootBytes)
      return
    }

    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
    let file = resolve(assets, normalize(requested))
    const withinAssets = relative(assets, file)
    if (withinAssets.startsWith('..') || isAbsolute(withinAssets)) throw new Error('path escaped visitor assets')
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file')
    } catch {
      file = join(assets, 'index.html')
    }
    response.writeHead(200, { 'content-type': mime(file) })
    createReadStream(file).pipe(response)
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(String(error))
  }
})

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
const address = server.address()
assert(address && typeof address === 'object')
origin = `http://127.0.0.1:${address.port}`

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const external = []
await context.route('**/*', async route => {
  const url = new URL(route.request().url())
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.hostname === '127.0.0.1') {
    await route.continue()
  } else {
    external.push(url.href)
    await route.abort('blockedbyclient')
  }
})

try {
  const page = await context.newPage()
  const diagnostics = []
  page.on('console', message => diagnostics.push(`[console:${message.type()}] ${message.text()}`))
  page.on('pageerror', error => diagnostics.push(`[pageerror] ${error.stack ?? error.message}`))
  page.on('requestfailed', request => diagnostics.push(
    `[requestfailed] ${request.url()} · ${request.failure()?.errorText ?? 'unknown'}`,
  ))
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForFunction(
      () => document.documentElement.dataset.visitorReady === 'true',
      undefined,
      { timeout: 60_000 },
    )
  } catch (error) {
    const snapshot = await page.evaluate(() => ({
      dataset: { ...document.documentElement.dataset },
      title: document.title,
      readonly: window.__HC_READONLY__ === true,
      body: document.body.innerText.slice(0, 500),
      ioc: Boolean(window.ioc),
    })).catch(snapshotError => ({ snapshotError: String(snapshotError) }))
    console.error('[visitor-smoke] boot snapshot', snapshot)
    console.error(diagnostics.slice(-100).join('\n'))
    console.error('[visitor-smoke] blocked external requests', external)
    throw error
  }
  const state = await page.evaluate(async () => ({
    readonly: window.__HC_READONLY__ === true,
    mode: document.documentElement.dataset.hypercombMode,
    title: document.title,
    serviceWorkers: 'serviceWorker' in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0,
  }))
  assert.deepEqual(state, {
    readonly: true,
    mode: 'visitor',
    title: 'Revolución',
    serviceWorkers: 0,
  })
  assert.deepEqual(external, [])
  console.log(`[visitor-smoke] ready at signed root ${head.slice(0, 12)}…; no OPFS service worker or third-party requests`)
} finally {
  await context.close()
  await browser.close()
  await new Promise(resolveClosed => server.close(resolveClosed))
}
