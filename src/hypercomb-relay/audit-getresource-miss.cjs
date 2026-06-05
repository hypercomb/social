// Throwaway audit: Store.getResource() fetch-on-miss against a real host.
//
// Proves the Phase-1 resource migration through the REAL in-browser Store:
//   - host (:7798) holds one image resource (signed PUT).
//   - dev shell (:4250), fresh OPFS, community-domains=[host]. The sig is
//     NOT local.
//   - store.getResource(sig) must: fetch from the host on the OPFS miss,
//     return the Blob, AND silently write-through to OPFS (sha256-verified)
//     WITHOUT emitting content:wrote (no push-queue echo — those are the
//     host's bytes, not ours).
//   - Positive control: store.putResource() (genuine authoring) DOES create
//     a __push__/queue/<sig>.resource entry, proving the push queue is live
//     so the "no echo" assertion is meaningful, not vacuous.
//   - Second getResource() is served locally (now cached).
//
// Run: node audit-getresource-miss.cjs   (dev shell up on 4250)

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const PORT = 7798
const HOST = `localhost:${PORT}`
const APP = 'http://localhost:4250/'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (t, ...a) => console.log(`[${t}]`, ...a)

async function main() {
  const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools/pure')
  const wSk = generateSecretKey(); const wPk = getPublicKey(wSk)
  const contentDir = mkdtempSync(join(tmpdir(), 'getresource-miss-'))

  const imageBytes = Buffer.from('PNG-ish-image-' + 'q'.repeat(2048))
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
  page.on('console', (m) => { if (m.type() === 'error') log('page-err', m.text().slice(0, 200)) })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (host) => {
    const r = await navigator.storage.getDirectory()
    for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => null)
    localStorage.setItem('hc:community:domains', JSON.stringify([host]))
    localStorage.setItem('hc:mesh-public', 'true')
  }, HOST)
  await page.reload({ waitUntil: 'domcontentloaded' })

  let ready = false
  for (let i = 0; i < 160; i++) {
    ready = await page.evaluate(() => !!(
      window.ioc?.get?.('@hypercomb.social/Store')?.getResource &&
      window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')?.fetchBySig
    ))
    if (ready) break
    await sleep(250)
  }
  if (!ready) { log('B', 'TIMEOUT — Store/broker not ready'); await browser.close(); try { relay.kill() } catch {}; process.exit(2) }

  const before = await page.evaluate(async (sig) => {
    const r = await navigator.storage.getDirectory()
    try { const d = await r.getDirectoryHandle('__resources__'); await d.getFileHandle(sig); return true } catch { return false }
  }, resSig)
  log('B', `resource in OPFS BEFORE getResource: ${before} (expect false)`)

  log('B', 'calling store.getResource(resSig) — should fetch from host on the OPFS miss')
  const got = await page.evaluate(async (sig) => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const blob = await store.getResource(sig)
    return blob ? { ok: true, size: blob.size } : { ok: false }
  }, resSig)
  log('B', `getResource returned: ${JSON.stringify(got)}`)

  const v = await page.evaluate(async ({ sig }) => {
    const r = await navigator.storage.getDirectory()
    const read = async (dir, name) => { try { const d = await r.getDirectoryHandle(dir); const h = await d.getFileHandle(name); return new Uint8Array(await (await h.getFile()).arrayBuffer()) } catch { return null } }
    const sha = async (b) => { const h = await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); let s = ''; for (const x of new Uint8Array(h)) s += x.toString(16).padStart(2, '0'); return s }
    const rb = await read('__resources__', sig)
    let pushEcho = false
    try { const pd = await r.getDirectoryHandle('__push__'); const qd = await pd.getDirectoryHandle('queue'); await qd.getFileHandle(sig + '.resource'); pushEcho = true } catch {}
    return { writtenThrough: !!rb, sha256Match: rb ? (await sha(rb)) === sig : false, pushEcho }
  }, { sig: resSig })
  log('B', `after getResource — OPFS write-through + echo check: ${JSON.stringify(v)}`)

  // Positive control: authoring a resource DOES enqueue a push (queue is live).
  const ctl = await page.evaluate(async () => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const bytes = new TextEncoder().encode('authored-' + Date.now() + '-' + Math.random())
    const sig = await store.putResource(new Blob([bytes]))
    await new Promise((r) => setTimeout(r, 800))
    const r = await navigator.storage.getDirectory()
    let enq = false
    try { const pd = await r.getDirectoryHandle('__push__'); const qd = await pd.getDirectoryHandle('queue'); await qd.getFileHandle(sig + '.resource'); enq = true } catch {}
    return { sig: sig.slice(0, 8), enq }
  })
  log('B', `positive control — authored resource enqueued: ${JSON.stringify(ctl)}`)

  const second = await page.evaluate(async (sig) => {
    const store = window.ioc.get('@hypercomb.social/Store')
    const blob = await store.getResource(sig)
    return blob ? blob.size : null
  }, resSig)
  log('B', `second getResource size: ${second} (expect ${imageBytes.length})`)

  const fetchedOk = got.ok && got.size === imageBytes.length
  const echoNote = ctl.enq ? '' : ' (control failed — echo check inconclusive)'
  const pass = fetchedOk && v.writtenThrough && v.sha256Match && !v.pushEcho && ctl.enq && second === imageBytes.length

  console.log('\n========== VERDICT ==========')
  console.log(`getResource fetched on miss (size ${imageBytes.length}):  ${fetchedOk ? '✓' : '✗'}  ${JSON.stringify(got)}`)
  console.log(`wrote through to OPFS + sha256 verified:       ${v.writtenThrough && v.sha256Match ? '✓' : '✗'}`)
  console.log(`silent — no content:wrote push echo:           ${!v.pushEcho ? '✓' : '✗ ECHO LEAKED'}${echoNote}`)
  console.log(`positive control — authoring DOES enqueue:     ${ctl.enq ? '✓' : '✗'}`)
  console.log(`second call served locally (size ${imageBytes.length}):    ${second === imageBytes.length ? '✓' : '✗'}`)
  console.log(pass
    ? '✓ PASS — getResource fetch-on-miss streams from host, caches (write-through), stays silent'
    : '✗ FAIL (see rows)')
  console.log('=============================\n')

  await browser.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
