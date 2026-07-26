// publish-content — sync a hive branch's FULL closure from the authoring
// browser to this machine's host surfaces, at build/publish time.
//
//   npx tsx scripts/publish-content.ts /revolucion            # relay only
//   npx tsx scripts/publish-content.ts /revolucion --r2       # relay + public CDN
//   …--no-relink                                              # skip step 0
//
// One command carries the whole publish: RE-LINK the branch and every ancestor
// up to the hive root (or the walk sees a stale subtree and reports a confident
// "zero holes" over content that predates the build), walk the closure, push
// it, then resolve the branch HEAD, prove it resolves, and print the
// paste-ready consumer sync line. Nothing fires a consumer update on its own —
// the head sig has to be carried by hand, so the script hands it over.
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

/** Child NAMES of a layer, in the layer's own order. `children` holds sigs;
 *  the name lives inside each child layer, so this is one inflate per child. */
async function childNames(layer: unknown): Promise<string[]> {
  const sigs: string[] = Array.isArray((layer as { children?: unknown })?.children)
    ? ((layer as { children: unknown[] }).children).map(String) : []
  const names: string[] = []
  for (const sig of sigs) {
    const inf = await send({ op: 'inflate', cell: sig })
    const name = (inf?.data as { name?: unknown })?.name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

/** The branch's current head — the sig its PARENT points at. This is what a
 *  consumer folds, and the one sig that has to be handed over by name. */
async function headSigOf(segments: readonly string[]): Promise<string | null> {
  const parent = await send({ op: 'layer-at', segments: segments.slice(0, -1) })
  if (!parent.ok) return null
  const want = segments[segments.length - 1]
  const sigs: string[] = Array.isArray(parent.data?.children) ? parent.data.children.map(String) : []
  for (const sig of sigs) {
    const inf = await send({ op: 'inflate', cell: sig })
    if ((inf?.data as { name?: unknown })?.name === want) return sig
  }
  return null
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
  if (!segments.length) { console.error('a branch path is required'); process.exit(1) }

  // 0. RE-LINK the chain, branch first, then every ancestor up to the hive
  // root. Per-page history commits a page into the PAGE's own bag; the
  // ancestors keep pointing at the generation they last saw, so without this
  // the publish walks a stale subtree and reports a confident "zero holes"
  // while the root still addresses content that predates the build. Re-linking
  // is a bridge `update` with the SAME child names in the SAME order — it
  // moves pointers, never membership.
  if (!args.includes('--no-relink')) {
    for (let i = segments.length; i >= 0; i--) {
      const at = segments.slice(0, i)
      const layer = await send({ op: 'layer-at', segments: at })
      if (!layer.ok) { console.error(`re-link: no layer at /${at.join('/')}: ${layer.error}`); process.exit(1) }
      const names = await childNames(layer.data)
      const res = await send({ op: 'update', segments: at, layer: { name: layer.data?.name ?? (at[at.length - 1] ?? '/'), children: names } })
      if (!res.ok) { console.error(`re-link /${at.join('/')} FAILED: ${res.error}`); process.exit(1) }
    }
    console.log(`re-linked ${segments.length + 1} levels: /${segments.join('/')} → /`)
  }

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

  // ── the head, verified ────────────────────────────────────────────────
  // The head layer's OWN sig reaches the closure only through the `history`
  // op, and it loses the race against a fresh re-link often enough to have
  // half-landed twice in one session: "zero holes, N uploaded" while the head
  // itself 404s and every consumer is stranded. So resolve it explicitly,
  // prove it resolves, and push it directly if the walk missed it.
  const head = await headSigOf(segments)
  if (!head) {
    console.warn(`\ncould not resolve the head of /${segments.join('/')} — consumers cannot be pointed at this publish`)
    return
  }
  const headOnDisk = join(RELAY_DIR, head)
  if (!existsSync(headOnDisk)) {
    const res = await send({ op: 'get-resource', sig: head, text: 'base64' })
    if (res.ok) {
      const bytes = Buffer.from(res.data.base64, 'base64')
      if (createHash('sha256').update(bytes).digest('hex') === head) {
        writeFileSync(headOnDisk, bytes)
        console.log(`head ${head.slice(0, 12)}… was missing from the relay — written`)
      }
    }
  }
  let headLive = true
  if (r2 && !(await cdnHas(head))) {
    try {
      execFileSync(process.execPath, [WRANGLER, 'r2', 'object', 'put', `hypercomb-content/${head}`,
        '--file', headOnDisk, '--content-type', 'application/json', '--remote'],
        { cwd: WORKER_DIR, stdio: 'pipe', timeout: 60_000 })
      console.log(`head ${head.slice(0, 12)}… lost the R2 race — pushed directly`)
    } catch (err) {
      headLive = false
      console.error(`HEAD NOT ON THE CDN: ${head} — ${String((err as Error).message).slice(0, 120)}`)
    }
  }
  if (r2 && headLive) headLive = await cdnHas(head)

  console.log(`\nhead /${segments.join('/')} = ${head}`)
  console.log(r2 ? (headLive ? `verified live on ${CDN}` : `NOT resolvable on ${CDN} — consumers will 404`) : '(relay only — pass --r2 to reach the public CDN)')

  // Consumer installs hold their own folded generation and nothing fires a
  // sync when a publisher's root moves, so the update is carried by hand.
  // Print it ready to paste rather than making anyone hunt a 64-hex sig.
  const label = segments[segments.length - 1]
  const at = JSON.stringify(segments.slice(0, -1))
  console.log(`\nto update a consumer install — paste in its console at the hexagon root:\n`)
  console.log(`ioc.get('@diamondcoreprocessor.com/ContentBrokerDrone').noteDomainsForSig('${head}', ['jwize.com','content.jwize.com']); await ioc.get('@diamondcoreprocessor.com/SwarmAdoptDrone').syncResolvedBranch({ layerSig: '${head}', at: ${at}, domain: 'jwize.com', label: '${label}' })`)
  console.log(`\nthen reload, and confirm with:`)
  console.log(`await ioc.get('@diamondcoreprocessor.com/SiteViewDrone').resolvePageSig(${JSON.stringify(segments)})`)
  const pageSig = await branchPageSig(segments)
  if (pageSig) console.log(`  → must return ${pageSig}`)
}

/** The branch's own `visual:website:page` htmlSig, so the confirmation step is
 *  an equality check rather than "read a hash and squint at it". */
async function branchPageSig(segments: readonly string[]): Promise<string | null> {
  const layer = await send({ op: 'layer-at', segments })
  const decos: string[] = Array.isArray(layer.data?.decorations) ? layer.data.decorations.map(String) : []
  for (const sig of decos) {
    const res = await send({ op: 'get-resource', sig })
    if (!res.ok) continue
    try {
      const rec = JSON.parse(res.data.text)
      const html = rec?.payload?.htmlSig
      if (rec?.kind === 'visual:website:page' && SIG.test(String(html))) return String(html)
    } catch { /* not a JSON decoration record */ }
  }
  return null
}

main().catch(err => { console.error(err.message); process.exit(1) })
