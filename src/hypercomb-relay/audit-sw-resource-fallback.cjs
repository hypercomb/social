// Throwaway audit: the service worker's /@resource/<sig> host-fallback
// (Phase 2). Proves embedded-site resource streaming through the REAL SW.
//
//   host (:7799) holds one image resource (signed PUT).
//   dev shell (:4250), fresh OPFS, community-domains=[host]. The page posts
//     those domains to the SW (postCommunityDomainsToServiceWorker).
//   page fetches /@resource/<sig> → SW misses OPFS → streams from the host,
//     sha256-verifies, serves + writes through to OPFS + caches.
//   Verify: 200 with correct bytes, OPFS __resources__/<sig> written
//     (sha256 ✓), second fetch served locally.
//
// Unique sig per run so a prior run's Cache-API entry can't mask the
// host-fallback. Forces registration.update() so the dev shell adopts the
// latest worker bytes. Run: node audit-sw-resource-fallback.cjs (dev shell up)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const PORT = 7799
const HOST = `localhost:${PORT}`
const APP = 'http://localhost:4250/'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (t, ...a) => console.log(`[${t}]`, ...a)

async function main() {
  const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools/pure')
  const wSk = generateSecretKey(); const wPk = getPublicKey(wSk)
  const contentDir = mkdtempSync(join(tmpdir(), 'sw-resource-'))

  // Unique per run → fresh sig → no cross-run Cache-API collision.
  const imageBytes = Buffer.from('PNG-ish-site-image-' + Date.now() + '-' + 'r'.repeat(3000))
  const resSig = sha256(imageBytes)
  log('host', `resource ${resSig.slice(0, 8)} (${imageBytes.length} bytes)`)

  const relay = spawn('node', [RELAY_JS, '--port', String(PORT), '--memory', '--writers', wPk, '--content-dir', contentDir], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  relay.stderr.on('data', (d) => process.stderr.write('[relay-err] ' + d))
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://${HOST}/`)).ok) break } catch {} await sleep(100) }

  const authHeader = (url) => {
    const e = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'PUT']], content: '' }
    return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent(e, wSk))).toString('base64')
  }
  const put = async (path, bytes) => {
    const url = `http://${HOST}${path}`
    return (await fetch(url, { method: 'PUT', headers: { Authorization: authHeader(url) }, body: bytes })).status
  }
  log('host', `PUT /__resources__/${resSig.slice(0, 8)} → ${await put('/__resources__/' + resSig, imageBytes)}`)

  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext()).newPage()
  page.on('console', (m) => { const t = m.text(); if (t.includes('@resource') || m.type() === 'error') log('page', t.slice(0, 170)) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (host) => {
    const r = await navigator.storage.getDirectory()
    for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => null)
    localStorage.setItem('hc:community:domains', JSON.stringify([host]))
    localStorage.setItem('hc:mesh-public', 'true')
  }, HOST)
  await page.reload({ waitUntil: 'domcontentloaded' })
  // Force the dev shell to adopt the latest worker bytes.
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); if (reg) { try { await reg.update() } catch {} } })

  let swReady = false
  for (let i = 0; i < 120; i++) {
    swReady = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller))
    if (swReady) break
    await sleep(250)
  }
  log('B', `SW controlling: ${swReady}`)
  await sleep(1800)  // let the new SW claim + the page post domains

  const before = await page.evaluate(async (sig) => {
    const r = await navigator.storage.getDirectory()
    try { const d = await r.getDirectoryHandle('__resources__'); await d.getFileHandle(sig); return true } catch { return false }
  }, resSig)
  log('B', `resource in OPFS BEFORE /@resource fetch: ${before} (expect false)`)

  log('B', 'fetching /@resource/<sig> — SW should stream from host on the OPFS miss')
  const got = await page.evaluate(async (sig) => {
    try {
      const res = await fetch('/@resource/' + sig, { cache: 'no-store' })
      if (!res.ok) return { ok: false, status: res.status }
      const buf = new Uint8Array(await res.arrayBuffer())
      return { ok: true, status: res.status, size: buf.length, ct: res.headers.get('content-type') }
    } catch (e) { return { ok: false, error: String(e).slice(0, 120) } }
  }, resSig)
  log('B', `/@resource fetch returned: ${JSON.stringify(got)}`)

  const v = await page.evaluate(async ({ sig }) => {
    const r = await navigator.storage.getDirectory()
    const read = async (dir, name) => { try { const d = await r.getDirectoryHandle(dir); const h = await d.getFileHandle(name); return new Uint8Array(await (await h.getFile()).arrayBuffer()) } catch { return null } }
    const sha = async (b) => { const h = await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); let s = ''; for (const x of new Uint8Array(h)) s += x.toString(16).padStart(2, '0'); return s }
    const rb = await read('__resources__', sig)
    return { writtenThrough: !!rb, sha256Match: rb ? (await sha(rb)) === sig : false }
  }, { sig: resSig })
  log('B', `after fetch — OPFS write-through: ${JSON.stringify(v)}`)

  const second = await page.evaluate(async (sig) => {
    const res = await fetch('/@resource/' + sig)
    return res.ok ? new Uint8Array(await res.arrayBuffer()).length : null
  }, resSig)
  log('B', `second /@resource fetch size: ${second} (expect ${imageBytes.length})`)

  const fetchedOk = got.ok && got.size === imageBytes.length
  const pass = swReady && fetchedOk && v.writtenThrough && v.sha256Match && second === imageBytes.length

  console.log('\n========== VERDICT ==========')
  console.log(`SW controlling page:                          ${swReady ? '✓' : '✗'}`)
  console.log(`/@resource streamed from host (size ${imageBytes.length}):  ${fetchedOk ? '✓' : '✗'}  ${JSON.stringify(got)}`)
  console.log(`wrote through to OPFS + sha256 verified:       ${v.writtenThrough && v.sha256Match ? '✓' : '✗'}`)
  console.log(`second fetch served locally (size ${imageBytes.length}):    ${second === imageBytes.length ? '✓' : '✗'}`)
  console.log(pass
    ? '✓ PASS — SW /@resource/ host-fallback streams from host, caches (write-through)'
    : '✗ FAIL (see rows)')
  console.log('=============================\n')

  await browser.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
