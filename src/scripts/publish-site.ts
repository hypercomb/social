// publish-site — assemble a read-only deployment folder: the xcopy contract.
//
//   npx tsx scripts/publish-site.ts <headSig> --out <dir> [--from <url>…]
//   npx tsx scripts/publish-site.ts /branch/path --out <dir>      # head via bridge (ws:2401)
//
// Phase 3 of documentation/read-only-deployment.md. Produces a folder that
// deploys by copying it to any static server — no server-side build, no
// rewrites, no MIME config:
//
//   <out>/<sig>…            the creation's full Merkle closure, flat at the
//                           root — the one resolution contract <origin>/<sig>;
//                           the folder IS the pool, and every published site
//                           is an open host an installer can resolve from
//   <out>/content/          the module package (manifest.json + bees + deps),
//                           verbatim as the web shell's bundled install reads it
//   <out>/index.html        the branch's own visual:website:page — the visitor
//                           face until the Phase-1 website harness lands
//
// The closure is materialized BY THE RESOLVER (hypercomb-cli `install`'s
// resolveClosure) — publish and install are the same walk in two directions;
// this command is the reciprocal-format thesis, in code. Bytes come from the
// local relay pool first, then any --from source (default: the public CDN),
// each byte sha256-proven against its name before it lands.
//
// Deliberately NO bespoke pin/descriptor files: the communication language is
// meta layers everywhere. What boot needs, it reads from layers; the harness
// (Phase 1) defines its in-model pin when it arrives.

import { existsSync, mkdirSync, readFileSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, renameSync } from 'node:fs'
import WebSocket from 'ws'
import { resolveClosure, type ResolverIO } from '../hypercomb-cli/src/commands/install.js'
import { materializePages } from '../hypercomb-cli/src/commands/site.js'

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))
const RELAY_DIR = join(SRC, 'hypercomb-relay', 'content')
const MODULE_PACKAGE_DIR = join(SRC, 'hypercomb-web', 'public', 'content')
const DEFAULT_SOURCE = 'https://content.jwize.com'
const BRIDGE_PORT = 2401
const SIG = /^[a-f0-9]{64}$/
const FETCH_TIMEOUT_MS = 30_000

// ── bridge (only for /branch → head resolution; a bare sig never connects) ──

let counter = 0
const send = (request: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> =>
  new Promise((resolve, reject) => {
    const msg = { ...request, id: `site-${Date.now()}-${++counter}` }
    const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge timeout')) }, 45_000)
    ws.on('open', () => ws.send(JSON.stringify(msg)))
    ws.on('message', (raw: unknown) => {
      clearTimeout(timer)
      try { resolve(JSON.parse(String(raw))) } catch { reject(new Error('invalid bridge response')) }
      ws.close()
    })
    ws.on('error', (err: Error) => { clearTimeout(timer); reject(new Error(`bridge connection failed: ${err.message} — pass a head sig directly, or open the hive`)) })
  })

/** The branch head — the sig its PARENT points at (what a consumer folds). */
const headSigOf = async (segments: readonly string[]): Promise<string | null> => {
  const parent = await send({ op: 'layer-at', segments: segments.slice(0, -1) })
  if (!parent.ok) return null
  const want = segments[segments.length - 1]
  for (const sig of (Array.isArray(parent.data?.children) ? parent.data.children.map(String) : [])) {
    const inf = await send({ op: 'inflate', cell: sig })
    if ((inf?.data as { name?: unknown })?.name === want) return sig
  }
  return null
}

// ── assembly ────────────────────────────────────────────────────────────────

/** Local-pool-first IO: bytes come from the relay pool when it has them,
 *  else from the network sources — the same staged-write discipline as the
 *  CLI resolver, into the OUT dir itself. */
const siteIO = (out: string, sources: string[]): ResolverIO => ({
  fetch: async (sig) => {
    const local = join(RELAY_DIR, sig)
    if (existsSync(local)) return readFileSync(local)
    for (const base of sources) {
      try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/${sig}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        if (res.ok) return new Uint8Array(await res.arrayBuffer())
      } catch { /* next source */ }
    }
    return null
  },
  has: (sig) => existsSync(join(out, sig)),
  read: (sig) => readFileSync(join(out, sig)),
  write: (sig, bytes) => {
    const part = join(out, `.part-${sig}`)
    writeFileSync(part, bytes)
    renameSync(part, join(out, sig))
  },
})

// Face materialization lives in the CLI (the standalone shim uses the same
// code): resolve + page tree + standalone rewrites, one implementation.

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const sources: string[] = []
  let out = ''
  let target = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i] ?? ''
    else if (args[i] === '--from') sources.push(args[++i] ?? '')
    else if (!args[i].startsWith('--') && !target) target = args[i]
  }
  if (!target || !out) {
    console.error('usage: npx tsx scripts/publish-site.ts <headSig|/branch/path> --out <dir> [--from <url>…]')
    process.exit(1)
  }
  if (!sources.length) sources.push(DEFAULT_SOURCE)

  // The head: a bare sig stands on its own; a path asks the hive.
  let head = target
  if (!SIG.test(head)) {
    const segments = target.split('/').map(s => s.trim()).filter(Boolean)
    if (!segments.length) { console.error('a head sig or branch path is required'); process.exit(1) }
    const resolved = await headSigOf(segments)
    if (!resolved) { console.error(`could not resolve the head of /${segments.join('/')}`); process.exit(1) }
    head = resolved
    console.log(`head /${segments.join('/')} = ${head}`)
  }

  // 1. The closure — the resolver's walk, into the folder root.
  mkdirSync(out, { recursive: true })
  const stats = await resolveClosure(head, siteIO(out, sources))
  console.log(`closure ${head.slice(0, 12)}…: ${stats.total} sigs — already had ${stats.present}, fetched ${stats.fetched}, holes ${stats.holes.length}, refused ${stats.refused.length}`)
  if (stats.holes.length) console.warn('holes:', stats.holes.map(s => s.slice(0, 12)).join(', '))
  if (!existsSync(join(out, head))) { console.error('the head did not resolve — no deployment produced'); process.exit(1) }

  // 2. The module package — beehaviors, verbatim from the essentials build.
  if (!existsSync(join(MODULE_PACKAGE_DIR, 'manifest.json'))) {
    console.warn(`no module package at ${MODULE_PACKAGE_DIR} — run \`npm run build:essentials\` first; folder ships content-only`)
  } else {
    cpSync(MODULE_PACKAGE_DIR, join(out, 'content'), { recursive: true })
    console.log('module package → /content (manifest + bees + deps)')
  }

  // 3. The visitor face — the branch's page TREE, standalone-rewritten
  // copies only (the pool bytes stay canonical under their sigs).
  const pages = materializePages(out, head)
  if (pages) {
    console.log(`${pages} website page(s) materialized — index.html + the branch's path tree`)
  } else {
    console.warn('the branch carries no visual:website:page — folder is an oasis (resolvable pool), no visitor face until the Phase-1 harness')
  }

  console.log(`\nsite assembled at ${out}`)
  console.log(`deploy = copy the folder to any static server; update = re-run with the new head`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
