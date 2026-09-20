// hypercomb-relay/drive-hive-index.mjs
//
// A MACHINE HOST CAN ANSWER "WHO SIGNED THIS". Bytes are content-addressed and
// verifiable on their own; authority is not — it lives in a publisher's signed
// index (kind 30564), and until this route existed only the Cloudflare worker
// served one. A participant carrying just a relay could fetch every byte of a
// build and still be refused at the activation gate with nowhere to look.
//
// Runs a relay of its own (fresh port, in-memory db, temp heap) so the live
// one is never touched, then drives the route with real keys:
//
//   - an address nobody has written is a 404, not an empty answer
//   - a publisher can PUT their own index and read it straight back
//   - somebody else's key cannot move it, and neither can an unsigned body
//   - a stale republish never displaces a newer index
//
//   node hypercomb-relay/drive-hive-index.mjs

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = 7788
const BASE = `http://127.0.0.1:${PORT}`
const KIND = 30564

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  — ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

const index = (sk, roots, createdAt) => finalizeEvent({
  kind: KIND,
  created_at: createdAt ?? Math.floor(Date.now() / 1000),
  tags: [],
  content: JSON.stringify({ v: 1, roots }),
}, sk)

const auth = (sk, url, method, body) => {
  const evt = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ['payload', createHash('sha256').update(body).digest('hex')]],
    content: '',
  }, sk)
  return 'Nostr ' + Buffer.from(JSON.stringify(evt), 'utf8').toString('base64')
}

const put = async (sk, pubkey, evt) => {
  const url = `${BASE}/hive/${pubkey}`
  const body = JSON.stringify(evt)
  const res = await fetch(url, { method: 'PUT', headers: { Authorization: auth(sk, url, 'PUT', body), 'Content-Type': 'application/json' }, body })
  return { status: res.status, text: await res.text() }
}

const get = async (pubkey) => {
  const res = await fetch(`${BASE}/hive/${pubkey}`)
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() }
}

const heap = mkdtempSync(join(tmpdir(), 'hive-index-'))
const relay = spawn(process.execPath, [join(HERE, 'relay.js'), '--port', String(PORT), '--memory', '--content-dir', heap], { stdio: ['ignore', 'pipe', 'pipe'] })
relay.stdout.on('data', d => { const t = String(d); if (/hive|listening/i.test(t)) process.stdout.write('  [relay] ' + t) })
relay.stderr.on('data', d => process.stdout.write('  [relay!] ' + String(d)))

try {
  for (let i = 0; i < 40 && !(await fetch(BASE).then(() => true).catch(() => false)); i++) await sleep(250)

  const sk = generateSecretKey(); const pk = getPublicKey(sk)
  const other = generateSecretKey(); const otherPk = getPublicKey(other)

  check('an address nobody has written is a 404', (await get(pk)).status === 404)

  const first = index(sk, { 'install:essentials': 'a'.repeat(64) })
  const wrote = await put(sk, pk, first)
  check('a publisher can put their own index', wrote.status === 200, `${wrote.status} ${wrote.text.slice(0, 80)}`)

  const read = await get(pk)
  const roots = read.status === 200 ? JSON.parse(read.body.content).roots : {}
  check('and read it straight back, signature intact',
    read.status === 200 && read.body.pubkey === pk && read.body.sig === first.sig && roots['install:essentials'] === 'a'.repeat(64),
    JSON.stringify(roots))

  // Somebody else's key, signed correctly, aimed at this address.
  const theirs = index(other, { 'install:essentials': 'b'.repeat(64) })
  const stolen = await put(other, pk, theirs)
  // 401 from the writer-set check (this address's only writer is its owner),
  // 403 from the owner compare below it — either is the same refusal, and
  // which one fires depends only on which gate the caller trips first.
  check('another key cannot move it', stolen.status === 401 || stolen.status === 403, `${stolen.status} ${stolen.text.slice(0, 60)}`)

  // The caller is right but the body is somebody else's event.
  const mismatched = await put(sk, pk, theirs)
  check('an index signed by another key is refused', mismatched.status === 403, `${mismatched.status}`)

  // A body that never verifies.
  const forged = { ...first, content: JSON.stringify({ v: 1, roots: { 'install:essentials': 'c'.repeat(64) } }) }
  const bad = await put(sk, pk, forged)
  check('a tampered index is refused', bad.status === 400, `${bad.status} ${bad.text.slice(0, 50)}`)

  // Newer wins; older never displaces it.
  const newer = index(sk, { 'install:essentials': 'd'.repeat(64) }, first.created_at + 10)
  await put(sk, pk, newer)
  const older = index(sk, { 'install:essentials': 'e'.repeat(64) }, first.created_at - 10)
  await put(sk, pk, older)
  const after = await get(pk)
  check('a stale republish never displaces a newer index',
    after.status === 200 && JSON.parse(after.body.content).roots['install:essentials'] === 'd'.repeat(64),
    JSON.parse(after.body.content).roots['install:essentials'].slice(0, 8))

  check("another publisher's index is its own address", (await get(otherPk)).status === 404)
} finally {
  relay.kill()
  try { rmSync(heap, { recursive: true, force: true }) } catch { /* temp */ }
  const passed = results.filter(r => r.ok).length
  console.log(`\n========== ${passed}/${results.length} passed ==========`)
  process.exit(passed === results.length ? 0 : 1)
}
