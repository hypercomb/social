// verify-minified-package.mjs — re-derive the visitor's minified package from
// the readable one and check it is the same tree (hypercomb-runtime/src/
// minified-package.ts; documentation/derivations.md, dialect `minify`). The
// derivation is only as trustworthy as it is repeatable: anyone holding the
// readable package and the same tool gets the same signatures, or this says
// where they part.
//
//   node scripts/verify-minified-package.mjs                     a local visitor build
//   node scripts/verify-minified-package.mjs <visitor-dir> <readable-dir>
//   node scripts/verify-minified-package.mjs --host <door> [--version <worker version>] [--worker <name>]
//
// --host re-derives from the live site itself: which package the door runs
// (its host:packages marker), the root's `derivedFrom` and `derivation`, and
// the readable package — walked from its root signature alone, every file
// fetched by signature and checked against it. --version asks a staged worker
// version (Cloudflare-Workers-Version-Overrides), so a candidate is verified
// before anyone is served it.
//
// Exit 0 when the root names its readable origin and derivation record, every
// file read hashes to its name, and re-deriving with the record's own tool and
// options gives the same root and the same record.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SIG_RE = /^[a-f0-9]{64}$/
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (why) => { console.error(`[verify-minified] FAIL: ${why}`); process.exit(1) }

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const host = flag('--host')?.replace(/^https?:\/\//, '').replace(/\/+$/, '')
const version = flag('--version')
const workerName = flag('--worker') ?? 'pluginthematrix-core'
const positional = args.filter((arg, i) => !arg.startsWith('--') && !String(args[i - 1] ?? '').startsWith('--'))

// ONE READER PER SOURCE, every byte checked against the signature it was asked by.
const held = new Map()
const checked = async (sig, bytes) => {
  if (!bytes) return null
  if (sha(bytes) !== sig) fail(`${sig.slice(0, 12)}… does not hash to its name`)
  held.set(sig, bytes)
  return bytes
}
let readShipped, readReadable, shippedRoot
if (host) {
  const headers = version ? { 'Cloudflare-Workers-Version-Overrides': `${workerName}="${version}"` } : {}
  const get = async (path) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`https://${host}${path}`, { headers })
        if (res.ok) return new Uint8Array(await res.arrayBuffer())
        if (res.status === 404) return null
      } catch { /* retry */ }
    }
    return null
  }
  const bySig = async (sig) => held.get(sig) ?? checked(sig, await get(`/content/${sig}`))
  readShipped = bySig
  readReadable = bySig
  const pool = sha(Buffer.from('host:packages'))
  const marker = await get(`/content/${pool}/00000000`)
  shippedRoot = marker ? Buffer.from(marker).toString('utf8').split('\n')[0].trim().toLowerCase() : ''
  if (!SIG_RE.test(shippedRoot)) fail(`${host} names no package in its host:packages pool`)
} else {
  const shipped = positional[0] ?? join(here, '..', 'dist', 'hypercomb-web', 'visitor', 'content')
  const readable = positional[1] ?? join(here, '..', 'dist', 'hypercomb-web', 'browser', 'content')
  const fromDir = (dir) => async (sig) => {
    try { return await checked(sig, new Uint8Array(await readFile(join(dir, sig)))) } catch { return null }
  }
  readShipped = fromDir(shipped)
  readReadable = fromDir(readable)
  const manifest = JSON.parse(await readFile(join(shipped, 'manifest.json'), 'utf8'))
  shippedRoot = Object.keys(manifest.packages ?? {})[0] ?? ''
  if (!SIG_RE.test(shippedRoot)) fail('the shipped manifest names no package')
}
const where = host ? `${host}${version ? ` (version ${version.slice(0, 8)})` : ''}` : 'the local build'

// 1. The root names where it came from and how.
const rootBytes = await readShipped(shippedRoot)
if (!rootBytes) fail(`the package root ${shippedRoot.slice(0, 12)}… is not served`)
const rootLayer = JSON.parse(Buffer.from(rootBytes).toString('utf8'))
if (!rootLayer.derivedFrom) {
  console.log(`[verify-minified] ${where} runs ${shippedRoot.slice(0, 12)}…, a readable package — nothing derived to verify`)
  process.exit(0)
}
const derivationBytes = await readShipped(rootLayer.derivation)
if (!derivationBytes) fail(`the derivation record ${String(rootLayer.derivation).slice(0, 12)}… is not served`)
const derivation = JSON.parse(Buffer.from(derivationBytes).toString('utf8'))
if (derivation.kind !== 'minify') fail(`the record is a "${derivation.kind}" derivation, not "minify"`)
if (derivation.from !== rootLayer.derivedFrom) fail('the root and its record name different readable roots')

// 2. The readable package, from its root signature alone: walk its layers.
const layers = [], bees = new Set(), dependencies = new Set(), seen = new Set()
const visit = async (sig) => {
  if (seen.has(sig)) return
  seen.add(sig)
  const bytes = await readReadable(sig)
  if (!bytes) fail(`readable layer ${sig.slice(0, 12)}… is not reachable — the derivation's input must ship beside it`)
  layers.push(sig)
  const layer = JSON.parse(Buffer.from(bytes).toString('utf8'))
  for (const field of ['bees', 'criticalBees', 'bootBees', 'dependencies']) {
    for (const entry of Array.isArray(layer[field]) ? layer[field] : []) {
      const s = String(entry).replace(/\.js$/i, '').toLowerCase()
      if (SIG_RE.test(s)) (field === 'dependencies' ? dependencies : bees).add(s)
    }
  }
  for (const cell of Array.isArray(layer.cells) ? layer.cells : []) if (SIG_RE.test(String(cell))) await visit(String(cell))
}
await visit(derivation.from)
const modules = [...bees, ...dependencies]
// Fetch every module up front, many at once — the derivation then reads them in order.
for (let i = 0; i < modules.length; i += 24) {
  const missing = (await Promise.all(modules.slice(i, i + 24).map(async (sig) => (await readReadable(sig)) ? null : sig))).filter(Boolean)
  if (missing.length) fail(`readable module ${missing[0].slice(0, 12)}… is not reachable (${missing.length} in this batch)`)
}

// 3. Re-derive with the record's own tool and options.
const esbuild = await import('esbuild')
if (`esbuild@${esbuild.version}` !== derivation.tool) fail(`the record was made by ${derivation.tool}; this machine has esbuild@${esbuild.version}`)
const { tsImport } = await import('tsx/esm/api')
const { deriveMinifiedPackage } = await tsImport('../../hypercomb-runtime/src/minified-package.ts', import.meta.url)
const again = await deriveMinifiedPackage(derivation.from, { layers, bees: [...bees], dependencies: [...dependencies] },
  readReadable,
  async (body) => (await esbuild.transform(body, derivation.options)).code,
  { name: derivation.tool, options: derivation.options })
if (again.root !== shippedRoot) fail(`re-derived root ${again.root.slice(0, 12)}… is not the served ${shippedRoot.slice(0, 12)}…`)
if (again.derivation.sig !== rootLayer.derivation) fail('the re-derived record differs from the served one')
console.log(
  `[verify-minified] OK — ${where} runs ${shippedRoot.slice(0, 12)}…, re-derived from the readable ${derivation.from.slice(0, 12)}… ` +
  `(${layers.length} layers, ${modules.length} modules, ${held.size} files checked against their signatures) with ${derivation.tool}`,
)
