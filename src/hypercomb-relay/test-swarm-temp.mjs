// hypercomb-relay/test-swarm-temp.mjs
//
// Local round-trip test for the swarm-temp pool. Spawns the relay in a
// child process on a free port + temp content dir, generates a fresh
// Nostr keypair, PUTs bytes to /__swarm_temp__/<pubkey>/<sig>, then GETs
// both /<sig> (the canonical endpoint, exercising resolveFlatSig's
// probe) and the explicit path. Asserts identical bytes back.
//
// Run: node test-swarm-temp.mjs

import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = 17773
const BASE = `http://localhost:${PORT}`
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const log  = (...a) => console.log('[test]', ...a)
const fail = (msg) => { console.error('[FAIL]', msg); process.exit(1) }
const pass = (msg) => console.log('[PASS]', msg)

function authHeader(url, sk) {
  const evt = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'PUT']], content: '' }
  return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent(evt, sk))).toString('base64')
}

const contentDir = mkdtempSync(join(tmpdir(), 'swarm-temp-test-'))
log('content-dir', contentDir)
mkdirSync(contentDir, { recursive: true })

const relayPath = join(__dirname, 'relay.js')
const child = spawn('node', [relayPath, '--port', String(PORT), '--memory', '--content-dir', contentDir], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
child.stdout.on('data', (d) => process.stdout.write('[relay] ' + d))
child.stderr.on('data', (d) => process.stderr.write('[relay-err] ' + d))

process.on('exit', () => { try { child.kill('SIGTERM') } catch {} ; try { rmSync(contentDir, { recursive: true, force: true }) } catch {} })
process.on('SIGINT', () => process.exit(1))

async function waitForRelay() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/')).ok) return } catch {}
    await sleep(100)
  }
  fail('relay did not start')
}

async function main() {
  await waitForRelay()
  pass('relay up')

  // Fresh keypair — no operator allowlist involved, the temp pool accepts
  // any pubkey as long as the path's pubkey matches the auth event's.
  const sk = generateSecretKey()
  const pk = getPublicKey(sk).toLowerCase()
  log('pubkey', pk)

  // Bytes + sig (sig must equal sha256(body); relay enforces this).
  const bytes = randomBytes(1024)
  const sig = sha256(bytes)
  log('sig', sig.slice(0, 12) + '…', `(${bytes.length} bytes)`)

  // PUT to the per-pubkey path.
  const tempPath = `/__swarm_temp__/${pk}/${sig}`
  const tempUrl = BASE + tempPath
  const put = await fetch(tempUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader(tempUrl, sk) },
    body: bytes,
  })
  if (put.status !== 201) fail(`PUT expected 201, got ${put.status} (${await put.text()})`)
  pass(`PUT 201 to ${tempPath}`)

  // GET /<sig> — the canonical endpoint exercises resolveFlatSig, which
  // should probe __swarm_temp__/<pk>/<sig> and find it.
  const flatRes = await fetch(`${BASE}/${sig}`)
  if (flatRes.status !== 200) fail(`flat GET expected 200, got ${flatRes.status}`)
  const flatBytes = Buffer.from(await flatRes.arrayBuffer())
  if (flatBytes.length !== bytes.length || !flatBytes.equals(bytes)) fail('flat GET bytes mismatch')
  pass(`flat GET /<sig> served identical ${flatBytes.length} bytes`)

  // GET the explicit temp path — should also work via the legacy typed
  // path branch in tryServeContent (which resolves any file under
  // contentDir).
  const explicit = await fetch(tempUrl)
  if (explicit.status !== 200) fail(`explicit GET expected 200, got ${explicit.status}`)
  pass(`explicit GET ${tempPath} served`)

  // Reject: another participant tries to write into our slice — must 401.
  const evilSk = generateSecretKey()
  const evilPut = await fetch(tempUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader(tempUrl, evilSk) },
    body: bytes,
  })
  if (evilPut.status !== 401) fail(`sandbox check: expected 401 from foreign pubkey, got ${evilPut.status}`)
  pass(`sandbox enforced — foreign pubkey rejected with 401`)

  // Reject: hash mismatch (write the right path but wrong body) — must 422.
  const wrongBytes = randomBytes(512)
  const wrongPut = await fetch(tempUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader(tempUrl, sk) },
    body: wrongBytes,
  })
  if (wrongPut.status !== 422) fail(`integrity check: expected 422 on hash mismatch, got ${wrongPut.status}`)
  pass(`integrity enforced — sha256 mismatch rejected with 422`)

  log('All scenarios pass.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
