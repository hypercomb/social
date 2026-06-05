// Throwaway audit: the REAL in-browser broker.adopt() pulling an
// image-bearing hive from a local host, verified in OPFS.
//
//   host (:7797) is pre-populated with a hive: root → photo, where photo
//     references an image resource. (Stands in for A's HostSync backup;
//     HostSync's PUT wire is already proven — this leg focuses on the
//     real browser adopt().)
//   B (dev shell :4250, fresh OPFS, community-domains=[host]) runs the
//     actual window.ioc.get(ContentBroker).adopt(rootSig). adopt walks
//     root → photo → fetches the image, verifying + storing each into
//     OPFS.
//   Verify B's OPFS holds root + photo layers AND the image resource,
//     with the image sha256-verified — i.e. the image bytes really
//     transferred via the real adopt path.
//
// Requires the loopback-http affordance (adopt's fetchOverHttp uses http
// for localhost). Run: node audit-browser-adopt-image.cjs (dev shell up).

const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const RELAY_DIR = __dirname
const RELAY_JS = join(RELAY_DIR, 'relay.js')
const PORT = 7797
const HOST = `localhost:${PORT}`
const APP = 'http://localhost:4250/'
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (t, ...a) => console.log(`[${t}]`, ...a)

async function main() {
  const { generateSecretKey, getPublicKey, finalizeEvent } = await import('nostr-tools/pure')
  const wSk = generateSecretKey(); const wPk = getPublicKey(wSk)
  const contentDir = mkdtempSync(join(tmpdir(), 'browser-adopt-'))

  // hive: image → photo (references image) → root (references photo)
  const imageBytes = Buffer.from('PNG-ish-image-bytes-' + 'z'.repeat(120))
  const resSig = sha256(imageBytes)
  const photo = Buffer.from(JSON.stringify({ name: 'photo', children: [], image: [resSig] }))
  const photoSig = sha256(photo)
  const root = Buffer.from(JSON.stringify({ name: 'root', children: [photoSig] }))
  const rootSig = sha256(root)
  log('hive', `root ${rootSig.slice(0, 8)} → photo ${photoSig.slice(0, 8)} → image ${resSig.slice(0, 8)}`)

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
  log('host', 'pre-populating host with the hive (signed PUT)')
  for (const [path, bytes, label] of [['/__layers__/' + rootSig + '.json', root, 'root'], ['/__layers__/' + photoSig + '.json', photo, 'photo'], ['/__resources__/' + resSig, imageBytes, 'image']]) {
    log('host', `${label.padEnd(6)} PUT ${await put(path, bytes)}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await (await browser.newContext()).newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (host) => {
    const r = await navigator.storage.getDirectory()
    for await (const [n] of r.entries()) await r.removeEntry(n, { recursive: true }).catch(() => null)
    localStorage.setItem('hc:community:domains', JSON.stringify([host]))
    localStorage.setItem('hc:mesh-public', 'true')
  }, HOST)
  await page.reload({ waitUntil: 'domcontentloaded' })
  let ready = false
  for (let i = 0; i < 120; i++) {
    ready = await page.evaluate(() => !!(window.ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone')?.adopt && window.ioc?.get?.('@hypercomb.social/Store')))
    if (ready) break
    await sleep(250)
  }
  if (!ready) { log('B', 'TIMEOUT — broker.adopt or Store not available'); await browser.close(); try { relay.kill() } catch {}; process.exit(2) }

  log('B', 'running the REAL window.ioc.get(ContentBroker).adopt(rootSig)')
  const stats = await page.evaluate(async (rootSig) => {
    const broker = window.ioc.get('@diamondcoreprocessor.com/ContentBrokerDrone')
    return await broker.adopt(rootSig)
  }, rootSig)
  log('B', `adopt() returned: ${JSON.stringify(stats)}`)

  const v = await page.evaluate(async ({ rootSig, photoSig, resSig }) => {
    const r = await navigator.storage.getDirectory()
    const read = async (dir, sig) => { try { const d = await r.getDirectoryHandle(dir); const h = await d.getFileHandle(sig); return new Uint8Array(await (await h.getFile()).arrayBuffer()) } catch { return null } }
    const sha = async (b) => { const h = await crypto.subtle.digest('SHA-256', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); let s = ''; for (const x of new Uint8Array(h)) s += x.toString(16).padStart(2, '0'); return s }
    const rb = await read('__layers__', rootSig), pb = await read('__layers__', photoSig), ib = await read('__resources__', resSig)
    return { root: !!rb, photo: !!pb, image: !!ib, imageVerified: ib ? (await sha(ib)) === resSig : false }
  }, { rootSig, photoSig, resSig })
  log('B', `OPFS pool after adopt: ${JSON.stringify(v)}`)

  const pass = v.root && v.photo && v.image && v.imageVerified && stats && stats.failed === 0
  console.log('\n========== VERDICT ==========')
  console.log(`real in-browser adopt() returned: ${JSON.stringify(stats)}`)
  console.log(`B holds root layer:                ${v.root ? '✓' : '✗'}`)
  console.log(`B holds photo layer:               ${v.photo ? '✓' : '✗'}`)
  console.log(`B holds image resource (sha256 ✓): ${v.imageVerified ? '✓' : '✗'}`)
  console.log(pass
    ? '✓ PASS — the REAL in-browser adopt() pulled the whole hive incl. the image (verified) from a local host'
    : '✗ FAIL (see rows)')
  console.log('=============================\n')
  await browser.close(); try { relay.kill() } catch {}
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); process.exit(1) })
