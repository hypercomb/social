// Throwaway end-to-end daisy-chain audit on DIFFERENT PORTS.
//
//   host-A (:7794)  — holds an authored hive. A signs + PUTs the whole
//                     branch (root → dolphin → team → projects + a resource).
//   B               — adopts from host-A's DOMAIN by getting the INITIAL
//                     layer (rootSig), then recursively resolving the entire
//                     branch from host-A via flat /<sig> GETs, verifying each
//                     sig, and storing into host-B — so B co-hosts it.
//   host-B (:7795)  — B's store; must end up serving the complete branch.
//
// This exercises the real relay write endpoint (signed NIP-98 PUT), the real
// flat /<sig> read, and the recursive resolution adopt() relies on — proving
// "get the layer back, then resolve recursively from the domain, the entire
// branch," across two hosts on two ports. Deletes itself after.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'

// relay.js lives next to this script; resolve absolutely so the audit
// runs from any cwd. The relay's own deps resolve from this dir.
const RELAY_DIR = dirname(fileURLToPath(import.meta.url))
const RELAY_JS = join(RELAY_DIR, 'relay.js')

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (tag, ...a) => console.log(`[${tag}]`, ...a)
const pad = (d) => '  '.repeat(d)

const aSk = generateSecretKey(), aPk = getPublicKey(aSk)
const bSk = generateSecretKey(), bPk = getPublicKey(bSk)

const aDir = mkdtempSync(join(tmpdir(), 'hostA-'))
const bDir = mkdtempSync(join(tmpdir(), 'hostB-'))
const A_PORT = 7794, B_PORT = 7795
const A = `http://localhost:${A_PORT}`, B = `http://localhost:${B_PORT}`

const relayA = spawn('node', [RELAY_JS, '--port', String(A_PORT), '--memory', '--writers', aPk, '--content-dir', aDir], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
const relayB = spawn('node', [RELAY_JS, '--port', String(B_PORT), '--memory', '--writers', bPk, '--content-dir', bDir], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
relayA.stderr.on('data', (d) => process.stderr.write('[hostA-err] ' + d))
relayB.stderr.on('data', (d) => process.stderr.write('[hostB-err] ' + d))
const killAll = () => { try { relayA.kill() } catch {} try { relayB.kill() } catch {} }

function authHeader(url, sk) {
  const evt = { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', url], ['method', 'PUT']], content: '' }
  return 'Nostr ' + Buffer.from(JSON.stringify(finalizeEvent(evt, sk))).toString('base64')
}
const bytesOf = (obj) => Buffer.from(JSON.stringify(obj))
async function put(base, path, bytes, sk) {
  const url = base + path
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: authHeader(url, sk) }, body: bytes })
  return r.status
}
const isSig = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
function collectSigs(v, out) {
  if (typeof v === 'string') { if (isSig(v)) out.add(v); return }
  if (Array.isArray(v)) { for (const x of v) collectSigs(x, out); return }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) collectSigs(x, out) }
}

async function main() {
  for (const base of [A, B]) for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/')).ok) break } catch {} await sleep(100) }
  log('boot', `host-A :${A_PORT} (writer ${aPk.slice(0, 8)}…) | host-B :${B_PORT} (writer ${bPk.slice(0, 8)}…)`)

  // ── build a 4-level hive bottom-up (child sigs first) + a resource ──
  const resBytes = Buffer.from('resource-bytes-' + 'x'.repeat(80))
  const resSig = sha256(resBytes)
  const projects = bytesOf({ name: 'projects', children: [] }); const projectsSig = sha256(projects)
  const team = bytesOf({ name: 'team', children: [projectsSig] }); const teamSig = sha256(team)
  const dolphin = bytesOf({ name: 'dolphin', children: [teamSig], properties: { image: resSig } }); const dolphinSig = sha256(dolphin)
  const root = bytesOf({ name: 'root', children: [dolphinSig] }); const rootSig = sha256(root)
  log('hive', `root ${rootSig.slice(0, 8)} → dolphin ${dolphinSig.slice(0, 8)} → team ${teamSig.slice(0, 8)} → projects ${projectsSig.slice(0, 8)}; resource ${resSig.slice(0, 8)}`)

  // ── A backs up the whole branch to host-A (signed PUT + flat read-back) ──
  log('A→hostA', 'authoring backup — signed PUT then confirmed read-back per sig')
  const branch = [
    ['/__layers__/' + rootSig + '.json', root, 'root'],
    ['/__layers__/' + dolphinSig + '.json', dolphin, 'dolphin'],
    ['/__layers__/' + teamSig + '.json', team, 'team'],
    ['/__layers__/' + projectsSig + '.json', projects, 'projects'],
    ['/__resources__/' + resSig, resBytes, 'resource'],
  ]
  for (const [path, bytes, label] of branch) {
    const st = await put(A, path, bytes, aSk)
    const sig = path.split('/').pop().replace(/\.(json|js)$/, '')
    const back = await fetch(A + '/' + sig)
    log('A→hostA', `${label.padEnd(9)} PUT ${st}  ·  flat read-back /${sig.slice(0, 8)} ${back.status}`)
  }

  // ── B adopts from host-A's domain, starting at the INITIAL layer ──
  log('B', 'adopt: get the initial layer, then resolve the branch recursively from host-A')
  const visited = new Set()
  const stats = { layers: 0, resources: 0, failed: 0 }

  async function adoptLayer(sig, depth) {
    if (visited.has(sig)) return
    visited.add(sig)
    const r = await fetch(A + '/' + sig)            // get the layer from host-A's domain (flat /<sig>)
    if (!r.ok) { log('B', pad(depth) + `✗ layer /${sig.slice(0, 8)} → ${r.status}`); stats.failed++; return }
    const bytes = Buffer.from(await r.arrayBuffer())
    if (sha256(bytes) !== sig) { log('B', pad(depth) + `✗ HASH MISMATCH /${sig.slice(0, 8)}`); stats.failed++; return }
    await put(B, '/__layers__/' + sig + '.json', bytes, bSk)   // store to host-B (B co-hosts)
    stats.layers++
    const layer = JSON.parse(bytes.toString())
    log('B', pad(depth) + `✓ layer "${layer.name}" /${sig.slice(0, 8)} — verified, mirrored to host-B`)
    const children = (Array.isArray(layer.children) ? layer.children : []).filter(isSig)
    const childSet = new Set(children)
    const refs = new Set(); collectSigs(layer, refs)
    for (const ref of refs) {
      if (childSet.has(ref) || visited.has(ref)) continue
      visited.add(ref)
      const rr = await fetch(A + '/' + ref)
      if (!rr.ok) { log('B', pad(depth) + `  ✗ resource /${ref.slice(0, 8)} → ${rr.status}`); stats.failed++; continue }
      const rb = Buffer.from(await rr.arrayBuffer())
      if (sha256(rb) !== ref) { log('B', pad(depth) + `  ✗ resource HASH MISMATCH`); stats.failed++; continue }
      await put(B, '/__resources__/' + ref, rb, bSk)
      stats.resources++
      log('B', pad(depth) + `  ✓ resource /${ref.slice(0, 8)} — verified, mirrored to host-B`)
    }
    for (const c of children) await adoptLayer(c, depth + 1)
  }
  await adoptLayer(rootSig, 0)

  // ── verify host-B now serves the entire adopted branch ──
  log('verify', 'does host-B (a different port) now serve the whole branch?')
  let served = 0
  for (const [sig, label] of [[rootSig, 'root'], [dolphinSig, 'dolphin'], [teamSig, 'team'], [projectsSig, 'projects'], [resSig, 'resource']]) {
    const r = await fetch(B + '/' + sig)
    log('verify', `host-B /${sig.slice(0, 8)} (${label}) → ${r.status}`)
    if (r.ok) served++
  }

  const pass = served === 5 && stats.failed === 0
  console.log('\n========== VERDICT ==========')
  console.log(`adopted: ${stats.layers} layers + ${stats.resources} resources, ${stats.failed} failed`)
  console.log(`host-B serves ${served}/5 of the branch (different port from host-A)`)
  console.log(pass
    ? '✓ PASS — B got the initial layer and resolved the ENTIRE branch recursively from host-A\'s domain, now co-hosted on host-B'
    : '✗ FAIL')
  console.log('=============================\n')
  killAll()
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error('[fatal]', e); killAll(); process.exit(1) })
