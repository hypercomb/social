// Produce the deployable website harness from the Angular visitor build.
//
// The participant distribution retains many historical package entries so DCP
// can walk revisions. A read-only website needs only the current verified
// renderer package: creation bytes come from the public signature heap. Keep
// the current package, its sigbags and ordinary shell assets; omit historical
// packages, documentation and participant-only track assets from Cloudflare.

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..')
const source = join(project, 'dist', 'hypercomb-web', 'browser')
const output = join(project, 'dist', 'hypercomb-web', 'visitor')
const sourceContent = join(source, 'content')
const outputContent = join(output, 'content')
const SIG_RE = /^[a-f0-9]{64}$/

const sourceManifest = JSON.parse(await readFile(join(sourceContent, 'manifest.json'), 'utf8'))
const currentSig = Object.keys(sourceManifest?.packages ?? {})[0]
const current = sourceManifest?.packages?.[currentSig]
if (!SIG_RE.test(currentSig ?? '') || !current) {
  throw new Error('visitor build has no current signed renderer package')
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

// Copy the compiled shell and local presentation assets. These root folders
// are authoring/discovery material, not runtime inputs for a published site.
const omittedRoots = new Set(['content', 'documentation', 'tracks'])
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (omittedRoots.has(entry.name)) continue
  await cp(join(source, entry.name), join(output, entry.name), { recursive: entry.isDirectory() })
}

await mkdir(outputContent, { recursive: true })
const sigs = new Set([
  ...(current.bees ?? []),
  ...(current.dependencies ?? []),
  ...(current.layers ?? []),
])
for (const sig of sigs) {
  if (!SIG_RE.test(sig)) throw new Error(`invalid renderer signature: ${sig}`)
  await cp(join(sourceContent, sig), join(outputContent, sig))
}

for (const bagSig of [current.dependenciesBag, current.beesBag]) {
  if (bagSig == null) continue
  if (!SIG_RE.test(bagSig)) throw new Error(`invalid renderer sigbag: ${bagSig}`)
  await cp(join(sourceContent, bagSig), join(outputContent, bagSig), { recursive: true })
}

await writeFile(
  join(outputContent, 'manifest.json'),
  JSON.stringify({ packages: { [currentSig]: current } }, null, 2) + '\n',
  'utf8',
)

// THE PACKAGE POOL, ONE ENTRY DEEP. Since 2026-09-03 the engine does not read
// manifest.json to learn its own package — it walks `sign('host:packages')`
// under /content/ exactly as it would on any host (ensure-install.ts,
// fetchBundledPackage). A door that ships no pool ships no package: every
// published subdomain booted to "visitor renderer package is unavailable"
// for eight days because this directory was the one thing left out. A
// published door carries ONE package, so its pool is one marker naming it,
// plus the two listings a static host answers a directory with.
const pool = createHash('sha256').update('host:packages').digest('hex')
const poolDir = join(outputContent, pool)
await mkdir(poolDir, { recursive: true })
const label = String(current.label ?? '').trim()
await writeFile(join(poolDir, '00000000'), label ? `${currentSig}\n${label}` : currentSig, 'utf8')
for (const listing of ['index.html', 'listing.txt']) {
  await writeFile(join(poolDir, listing), '00000000\n', 'utf8')
}

let bytes = 0
const addSize = async (path) => {
  const held = await stat(path)
  if (held.isFile()) bytes += held.size
}
await addSize(join(outputContent, 'manifest.json'))
for (const sig of sigs) await addSize(join(outputContent, sig))
console.log(
  `[visitor-assets] ${currentSig.slice(0, 12)}… · ${sigs.size} signed renderer files · ` +
  `${(bytes / 1024 / 1024).toFixed(2)} MiB flat package`,
)
