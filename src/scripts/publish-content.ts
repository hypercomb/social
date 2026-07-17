// publish-content — sync a hive branch's FULL closure from the authoring
// browser to this machine's host surfaces, at build/publish time.
//
//   npx tsx scripts/publish-content.ts /revolucion            # relay only
//   npx tsx scripts/publish-content.ts /revolucion --r2       # relay + public CDN
//
// jwize.com serves hypercomb-relay/content/ straight off this disk, and the
// authoring hive runs in a browser on this same machine — so "push to host"
// doesn't need the in-app push queue at all: walk the branch closure over
// the Claude bridge (ws:2401), and write every sig file the relay lacks.
// With --r2, also backfill the public CDN (content.jwize.com — the Blossom
// worker over R2 bucket `hypercomb-content`) for any closure sig it 404s.
//
// The walk is pure get-resource BFS: layers and resources are both flat
// sig files at the OPFS root, and every referenced sig is a 64-hex string
// inside a JSON/HTML payload. Seeds = the branch's live layer + every
// marker in its lineage bag (so any generation a consumer still holds
// keeps resolving). Every byte is sha256-verified against its sig before
// it is written anywhere. Idempotent — rerun after every site build.
//
// This closes the publisher→host leg of the website upgrade path
// mechanically; consumer installs still refresh via sync (see
// memory: project_content_jwize_cdn_topology).

import WebSocket from 'ws'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))
const RELAY_DIR = join(SRC, 'hypercomb-relay', 'content')
const WORKER_DIR = join(SRC, 'hypercomb-relay', 'blossom-worker')
const WRANGLER = join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const CDN = 'https://content.jwize.com'
const BRIDGE_PORT = 2401
const SIG = /^[a-f0-9]{64}$/
const MAX_SIGS = 20_000

type BridgeRes = { id: string; ok: boolean; data?: any; error?: string }
let counter = 0

function send(request: Record<string, unknown>): Promise<BridgeRes> {
  return new Promise((resolve, reject) => {
    const msg = { ...request, id: `pub-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 45_000)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw)) as BridgeRes) } catch { reject(new Error('invalid bridge response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message} — is the hive open and the bridge running?`)) })
  })
}

const sniff = (bytes: Buffer): string => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  const head = bytes.subarray(0, 200).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('{') || head.startsWith('[')) return 'application/json'
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return 'text/html'
  return 'application/octet-stream'
}

const cdnHas = (sig: string): Promise<boolean> => new Promise(resolve => {
  import('node:https').then(({ request }) => {
    const req = request(`${CDN}/${sig}`, { method: 'HEAD', timeout: 12_000 }, res => resolve(res.statusCode === 200))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.on('error', () => resolve(false))
    req.end()
  })
})

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const r2 = args.includes('--r2')
  const path = args.find(a => !a.startsWith('--'))
  if (!path) {
    console.error('usage: npx tsx scripts/publish-content.ts /branch/path [--r2]')
    process.exit(1)
  }
  const segments = path.split('/').map(s => s.trim()).filter(Boolean)

  // Seeds: the branch's LIVE layer content + every lineage-bag marker (old
  // generations a consumer may still reference must keep resolving).
  const live = await send({ op: 'layer-at', segments })
  if (!live.ok) { console.error(`no layer at /${segments.join('/')}: ${live.error}`); process.exit(1) }
  const seeds = new Set<string>()
  for (const m of JSON.stringify(live.data).matchAll(/[a-f0-9]{64}/g)) seeds.add(m[0])
  const history = await send({ op: 'history', segments })
  if (history.ok && Array.isArray(history.data)) {
    for (const entry of history.data) {
      const sig = String((entry as { layer?: unknown })?.layer ?? '')
      if (SIG.test(sig)) seeds.add(sig)
    }
  }

  // BFS the closure. Bytes come from the relay when it already has them
  // (no bridge round-trip), else from the hive; sha256-verified either way.
  const seen = new Set<string>()
  const queue = [...seeds]
  let relayHits = 0, written = 0, holes: string[] = [], badHash = 0
  const bytesOf = new Map<string, Buffer>()

  while (queue.length && seen.size < MAX_SIGS) {
    const sig = queue.shift()!
    if (!SIG.test(sig) || seen.has(sig)) continue
    seen.add(sig)

    const onDisk = join(RELAY_DIR, sig)
    let bytes: Buffer | null = null
    if (existsSync(onDisk)) {
      bytes = readFileSync(onDisk)
      relayHits++
    } else {
      const res = await send({ op: 'get-resource', sig, text: 'base64' })
      if (!res.ok) { holes.push(sig); continue }
      bytes = Buffer.from(res.data.base64, 'base64')
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== sig) { badHash++; console.warn(`hash mismatch — refused: ${sig.slice(0, 12)}`); continue }
      writeFileSync(onDisk, bytes)
      written++
    }
    bytesOf.set(sig, bytes)

    // Mine nested refs from text payloads (layers, decoration records, pages).
    const text = bytes.toString('utf8')
    if (!text.includes('�')) {
      for (const m of text.matchAll(/[a-f0-9]{64}/g)) { if (!seen.has(m[0])) queue.push(m[0]) }
    }
  }
  console.log(`closure /${segments.join('/')}: ${seen.size} sigs — relay already had ${relayHits}, wrote ${written}, holes ${holes.length}, refused ${badHash}`)
  if (holes.length) console.warn('holes (in no local store — superseded or never authored here):', holes.map(s => s.slice(0, 12)).join(', '))

  if (r2) {
    let present = 0, uploaded = 0, failed = 0
    for (const sig of seen) {
      if (!bytesOf.has(sig)) continue
      if (await cdnHas(sig)) { present++; continue }
      try {
        // Direct wrangler entry: Node blocks npx.cmd spawning (EINVAL).
        execFileSync(process.execPath, [WRANGLER, 'r2', 'object', 'put', `hypercomb-content/${sig}`,
          '--file', join(RELAY_DIR, sig), '--content-type', sniff(bytesOf.get(sig)!), '--remote'],
          { cwd: WORKER_DIR, stdio: 'pipe', timeout: 60_000 })
        uploaded++
        if (uploaded % 25 === 0) console.log(`  r2: ${uploaded} uploaded…`)
      } catch (err) {
        failed++
        if (failed <= 3) console.warn(`  r2 put failed: ${sig.slice(0, 12)} — ${String((err as Error).message).slice(0, 120)}`)
      }
    }
    console.log(`cdn ${CDN}: already had ${present}, uploaded ${uploaded}, failed ${failed}`)
  }
}

main().catch(err => { console.error(err.message); process.exit(1) })
