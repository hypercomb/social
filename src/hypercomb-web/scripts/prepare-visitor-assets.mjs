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

// WHICH PACKAGE: the one the content pool names as its head — the same walk
// the engine itself does. NEVER the first key of content/manifest.json: builds
// stopped writing that document on 2026-09-03, so it froze on that day's
// package and every visitor rebuild re-shipped a Sep 3 engine, one that cannot
// unwrap META children and paints every published tile "unavailable". The
// record comes from the manifest the essentials build writes beside the
// package; a head with no record fails the build instead of shipping a stale one.
const pool = createHash('sha256').update('host:packages').digest('hex')
const poolNames = (await readdir(join(sourceContent, pool)).catch(() => [])).filter(n => /^\d{8}$/.test(n)).sort()
const headEntry = poolNames.length ? await readFile(join(sourceContent, pool, poolNames[poolNames.length - 1]), 'utf8') : ''
const currentSig = headEntry.split('\n')[0].trim().toLowerCase()
const recordFrom = async (path) => {
  try { return JSON.parse(await readFile(path, 'utf8'))?.packages?.[currentSig] ?? null } catch { return null }
}
const current = SIG_RE.test(currentSig)
  ? (await recordFrom(join(project, '..', 'hypercomb-essentials', 'dist', 'manifest.json')))
    ?? (await recordFrom(join(sourceContent, 'manifest.json')))
  : null
if (!current) {
  throw new Error(`visitor build: the content pool names ${currentSig.slice(0, 12) || 'no package'} as current and no manifest carries its record — rebuild essentials`)
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

// Copy the compiled shell and local presentation assets. These root folders
// are authoring/discovery material, not runtime inputs for a published site.
// esbuild-wasm serves the participant's `derive verify` — a published
// site's reader never verifies there, so its 13 MB stay out of the door.
const omittedRoots = new Set(['content', 'documentation', 'tracks', 'esbuild-wasm'])
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (omittedRoots.has(entry.name)) continue
  await cp(join(source, entry.name), join(output, entry.name), { recursive: entry.isDirectory() })
}

await mkdir(outputContent, { recursive: true })
const { tsImport } = await import('tsx/esm/api')

// THE VISITOR RUNS A MINIFIED DERIVATION (hypercomb-runtime/src/minified-
// package.ts; jwize 2026-10-18). The signed package stays readable — the
// source lives in the hive. A published site ships a package derived from it:
// each module's body minified (whitespace and syntax only, every name kept),
// its head lines kept byte for byte, every layer re-hashed bottom-up, and the
// root naming the readable root and a derivation record (tool, options, every
// readable → minified pair) so anyone can rerun it and get the same bytes.
// Whatever fails, the readable package ships exactly as before.
// VISITOR_MINIFY=0 ships the readable package on purpose.
let shipSig = currentSig
let ship = current
let derived = null
if (process.env.VISITOR_MINIFY !== '0') {
  try {
    const esbuild = await import('esbuild')
    const { deriveMinifiedPackage } = await tsImport('../../hypercomb-runtime/src/minified-package.ts', import.meta.url)
    const MINIFY = { loader: 'js', format: 'esm', target: 'es2022', minifyWhitespace: true, minifySyntax: true, treeShaking: false, legalComments: 'none', charset: 'utf8' }
    const readSource = async (sig) => { try { return new Uint8Array(await readFile(join(sourceContent, sig))) } catch { return null } }
    derived = await deriveMinifiedPackage(currentSig, current, readSource,
      async (body) => (await esbuild.transform(body, MINIFY)).code,
      { name: `esbuild@${esbuild.version}`, options: MINIFY })
    shipSig = derived.root
    ship = derived.record
    console.log(`[visitor-assets] minified ${derived.modules.size} modules: ${currentSig.slice(0, 12)}… → ${shipSig.slice(0, 12)}… (derivation ${derived.derivation.sig.slice(0, 12)}…)`)
  } catch (err) {
    derived = null
    console.warn(`[visitor-assets] minified derivation failed — shipping the readable package: ${err?.message ?? err}`)
  }
}

const sigs = new Set([
  ...(ship.bees ?? []),
  ...(ship.dependencies ?? []),
  ...(ship.layers ?? []),
])
for (const sig of sigs) {
  if (!SIG_RE.test(sig)) throw new Error(`invalid renderer signature: ${sig}`)
  const made = derived?.files.get(sig)
  if (made) await writeFile(join(outputContent, sig), made)
  else await cp(join(sourceContent, sig), join(outputContent, sig))
}
if (derived) await writeFile(join(outputContent, derived.derivation.sig), derived.derivation.bytes)

// THE INPUTS SHIP BESIDE THE DERIVATION (documentation/derivations.md: a
// reproducible derivation needs its inputs reachable). The readable package's
// files go out too, by signature, so anyone can re-derive the minified package
// from the live site itself (`verify-minified-package.mjs --host <door>`). No
// pool marker, index or pack names them: no visitor fetches them, and the
// first resolution stays exactly as slim.
if (derived) {
  let inputs = 0
  for (const sig of new Set([...(current.bees ?? []), ...(current.dependencies ?? []), ...(current.layers ?? [])])) {
    if (!SIG_RE.test(sig) || sigs.has(sig)) continue
    await cp(join(sourceContent, sig), join(outputContent, sig))
    inputs++
  }
  console.log(`[visitor-assets] ${inputs} readable input files ship beside the derivation (reachable by signature, fetched by no visitor)`)
}

if (derived) {
  const { orderedEntries, bagEntryName } = await tsImport('../../hypercomb-runtime/src/bags.ts', import.meta.url)
  for (const bag of derived.bags) {
    await mkdir(join(outputContent, bag.sig), { recursive: true })
    const entries = orderedEntries(bag.entries)
    for (let i = 0; i < entries.length; i++) await writeFile(join(outputContent, bag.sig, bagEntryName(i)), entries[i].content, 'utf8')
  }
} else {
  for (const bagSig of [current.dependenciesBag, current.beesBag]) {
    if (bagSig == null) continue
    if (!SIG_RE.test(bagSig)) throw new Error(`invalid renderer sigbag: ${bagSig}`)
    await cp(join(sourceContent, bagSig), join(outputContent, bagSig), { recursive: true })
  }
}

await writeFile(
  join(outputContent, 'manifest.json'),
  JSON.stringify({ packages: { [shipSig]: ship } }, null, 2) + '\n',
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
const poolDir = join(outputContent, pool)
await mkdir(poolDir, { recursive: true })
const label = String(ship.label ?? '').trim()
await writeFile(join(poolDir, '00000000'), label ? `${shipSig}\n${label}` : shipSig, 'utf8')
for (const listing of ['index.html', 'listing.txt']) {
  await writeFile(join(poolDir, listing), '00000000\n', 'utf8')
}

// THE TRANSFER PACK. Every file of the package in ONE content-addressed file
// (hypercomb-runtime/src/transfer-pack.ts), so a visitor — who keeps nothing
// between visits — installs in one request instead of ~1,500. Without it every
// published site paid ~5–10s of file-by-file fetching on EVERY load. A hint:
// a build that minted no pack still ships, and the visitor installs loose.
const packsPool = createHash('sha256').update('transfer:packs').digest('hex')
if (derived) {
  // The derivation's own pack: every file of the shipped package, one request.
  const { encodeTransferPack, gzipBytes } = await tsImport('../../hypercomb-runtime/src/transfer-pack.ts', import.meta.url)
  const members = await Promise.all([...sigs].map(async (sig) => [sig, new Uint8Array(await readFile(join(outputContent, sig)))]))
  const packBytes = await gzipBytes(encodeTransferPack(members))
  const packSig = createHash('sha256').update(packBytes).digest('hex')
  await writeFile(join(outputContent, packSig), packBytes)
  await mkdir(join(outputContent, packsPool), { recursive: true })
  await writeFile(join(outputContent, packsPool, shipSig), packSig, 'utf8')
  console.log(`[visitor-assets] transfer pack ${packSig.slice(0, 12)}… minted for the minified package (${(packBytes.byteLength / 1024).toFixed(0)} KB)`)
} else {
  const packPointer = await readFile(join(sourceContent, packsPool, currentSig), 'utf8').catch(() => '')
  const packSig = packPointer.trim().toLowerCase()
  if (SIG_RE.test(packSig) && await stat(join(sourceContent, packSig)).then(() => true, () => false)) {
    await mkdir(join(outputContent, packsPool), { recursive: true })
    await writeFile(join(outputContent, packsPool, currentSig), packSig, 'utf8')
    await cp(join(sourceContent, packSig), join(outputContent, packSig))
    console.log(`[visitor-assets] transfer pack ${packSig.slice(0, 12)}… shipped`)
  } else {
    console.warn(`[visitor-assets] no transfer pack for ${currentSig.slice(0, 12)}… — visitors will install file by file`)
  }
}

// THE INSTALL INDEX (hypercomb-runtime/src/install-index.ts). What a visitor
// used to learn by unpacking all ~900 files into memory and reading every
// module three times — aliases, which dependencies are atoms, what each bee
// claims, what the package needs of core — derived here once, by the same
// functions, from the same bytes. Keyed by the package it describes, beside
// a transfer pack of just the layers. A derived record: a visitor with none
// installs the old way.
{
  const { deriveInstallIndex, INSTALL_INDEX_MEANING } = await tsImport('../../hypercomb-runtime/src/install-index.ts', import.meta.url)
  const { encodeTransferPack, gzipBytes } = await tsImport('../../hypercomb-runtime/src/transfer-pack.ts', import.meta.url)
  const read = async (sig) => new Uint8Array(await readFile(join(outputContent, sig)).catch(() => null) ?? []) || null
  const layerMembers = await Promise.all((ship.layers ?? []).map(async (sig) => [sig, await read(sig)]))
  const layersPackBytes = await gzipBytes(encodeTransferPack(layerMembers))
  const layersPack = createHash('sha256').update(layersPackBytes).digest('hex')
  await writeFile(join(outputContent, layersPack), layersPackBytes)
  const index = await deriveInstallIndex(shipSig, { bees: ship.bees ?? [], dependencies: ship.dependencies ?? [] }, read, layersPack)
  const indexPool = createHash('sha256').update(INSTALL_INDEX_MEANING).digest('hex')
  await mkdir(join(outputContent, indexPool), { recursive: true })
  await writeFile(join(outputContent, indexPool, shipSig), JSON.stringify(index), 'utf8')
  console.log(
    `[visitor-assets] install index: ${Object.keys(index.aliases).length} aliases, ${index.lazy.length} atoms, ` +
    `${Object.keys(index.beeDeps).length} bees with claims, ${index.coreImports.length} core names; ` +
    `layers pack ${layersPack.slice(0, 12)}… (${(layersPackBytes.byteLength / 1024).toFixed(0)} KB)`,
  )
}

let bytes = 0
const addSize = async (path) => {
  const held = await stat(path)
  if (held.isFile()) bytes += held.size
}
await addSize(join(outputContent, 'manifest.json'))
for (const sig of sigs) await addSize(join(outputContent, sig))
console.log(
  `[visitor-assets] ${shipSig.slice(0, 12)}… · ${sigs.size} signed renderer files · ` +
  `${(bytes / 1024 / 1024).toFixed(2)} MiB flat package`,
)
