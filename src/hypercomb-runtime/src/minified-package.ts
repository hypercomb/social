// hypercomb-runtime/src/minified-package.ts
//
// THE VISITOR'S MINIFIED PACKAGE — derived, never the truth (jwize
// 2026-10-18: "make sure we don't break the merkle promise and this is somehow
// traceable to the bytes signature from the related scripts" · "keep the
// resolution, when being initially verified, slim").
//
// The signed package stays READABLE: the source lives in the hive, models read
// and draft modules by their `// src/…` sections, and Jev reviews against them.
// A published site's visitor runs a DERIVED package instead: every module's
// body minified (whitespace and syntax only — every name stays), its leading
// comment lines kept verbatim (the alias, the lazy marker, the source path),
// and every layer rewritten bottom-up to the new signatures. So it is a whole
// Merkle tree of its own: each file is named by the hash of the bytes that
// run, and the install checks each one exactly as before.
//
// TRACEABLE: the derived root layer names the readable root it came from
// (`derivedFrom`) and a DERIVATION RECORD (`derivation`) holding the tool,
// its options and every readable → minified module pair. Anyone holding the
// readable package reruns the same transform and gets the same signatures.
// The record names the readable root, never the derived one, so the chain is
// acyclic: derived root → record → readable root.
//
// SLIM: what a visitor resolves first has the same shape and size as before
// (the package record, its index, its layers pack); the only addition is the
// record's 64-hex pointer in the root layer. The record itself is fetched
// only by whoever verifies.
//
// A module the transform cannot handle keeps its readable bytes and its own
// signature — the derivation never fails a build, it only shrinks less.

import { SignatureService } from '@hypercomb/core'
import { bagSignature, beeEntries, dependencyEntries, aliasOf, type BagEntry } from './bags.js'

const SIG_RE = /^[a-f0-9]{64}$/
const SIG_FILE_RE = /^([a-f0-9]{64})(\.js)?$/

/** The package record the build writes beside a package (manifest.json). */
export type PackageRecord = {
  readonly layers?: readonly string[]
  readonly bees?: readonly string[]
  readonly dependencies?: readonly string[]
  readonly beeDeps?: Readonly<Record<string, readonly string[]>>
  readonly dependenciesBag?: string
  readonly beesBag?: string
  readonly label?: string
  readonly previous?: string | null
  readonly [field: string]: unknown
}

/** A module body in, its minified body out. Throwing keeps the module as is. */
export type MinifyBody = (body: string) => Promise<string>

export type DerivedPackage = {
  /** The derived package's root — its root layer's signature. */
  readonly root: string
  readonly record: PackageRecord
  /** Every file the derived package adds: minified modules and rewritten layers. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** The bags, as their entries — written as `<bagSig>/<00000000…>`. */
  readonly bags: ReadonlyArray<{ readonly sig: string; readonly entries: readonly BagEntry[] }>
  /** The derivation record, by its signature. */
  readonly derivation: { readonly sig: string; readonly bytes: Uint8Array }
  /** readable → minified, for every module the transform changed. */
  readonly modules: ReadonlyMap<string, string>
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const sign = (bytes: Uint8Array): Promise<string> =>
  SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

/** A module's leading `//` lines (alias, lazy marker, source path) and the
 *  rest. The head is kept byte for byte: the install reads lines 1 and 2. */
export const splitHead = (text: string): { head: string; body: string } => {
  let at = 0
  while (text.startsWith('//', at)) {
    const end = text.indexOf('\n', at)
    if (end < 0) return { head: text, body: '' }
    at = end + 1
  }
  return { head: text.slice(0, at), body: text.slice(at) }
}

/** Rewrite every signature a layer names — values and keys, bare or `.js` —
 *  through `map`. Field names do not matter: the package's layers name
 *  modules in `bees`, `dependencies`, `criticalBees`, `bootBees` and
 *  `docs.bees`, and child layers in `cells`, and all of them follow. */
const remap = (value: unknown, map: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') {
    const hit = SIG_FILE_RE.exec(value)
    const to = hit ? map.get(hit[1]!) : undefined
    return to ? to + (hit![2] ?? '') : value
  }
  if (Array.isArray(value)) return value.map(item => remap(item, map))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const hit = SIG_FILE_RE.exec(key)
      const to = hit ? map.get(hit[1]!) : undefined
      out[to ? to + (hit![2] ?? '') : key] = remap(item, map)
    }
    return out
  }
  return value
}

/** Derive the minified package from a readable one. `read` answers any file
 *  of the readable package by signature. */
export const deriveMinifiedPackage = async (
  rootSig: string,
  record: PackageRecord,
  read: (signature: string) => Promise<Uint8Array | null>,
  minify: MinifyBody,
  tool: { readonly name: string; readonly options: Readonly<Record<string, unknown>> },
): Promise<DerivedPackage> => {
  const files = new Map<string, Uint8Array>()
  const modules = new Map<string, string>()
  const decoder = new TextDecoder()

  // 1. THE MODULES: the body minified, the head kept, renamed by its hash.
  for (const sig of [...(record.bees ?? []), ...(record.dependencies ?? [])]) {
    if (!SIG_RE.test(sig) || modules.has(sig)) continue
    const bytes = await read(sig)
    if (!bytes) continue
    const { head, body } = splitHead(decoder.decode(bytes))
    let small: string
    try { small = await minify(body) } catch { continue }
    const out = encode(head + small)
    if (out.byteLength >= bytes.byteLength) continue
    const to = await sign(out)
    modules.set(sig, to)
    files.set(to, out)
  }

  // 2. THE DERIVATION RECORD — readable root, tool, every pair. Written before
  //    the root so the root can name it (and the record never names the root).
  const derivationBytes = encode(JSON.stringify({
    v: 1,
    kind: 'minify',
    from: rootSig,
    tool: tool.name,
    options: tool.options,
    modules: Object.fromEntries([...modules].sort(([a], [b]) => a.localeCompare(b))),
  }))
  const derivation = { sig: await sign(derivationBytes), bytes: derivationBytes }

  // 3. THE LAYERS, bottom-up: a child's new signature is known before its
  //    parent is rewritten, so the whole tree re-hashes to a new root.
  const layerMap = new Map<string, string>()
  const known = new Set(record.layers ?? [])
  const deriveLayer = async (sig: string, trail: ReadonlySet<string>): Promise<string> => {
    const done = layerMap.get(sig)
    if (done) return done
    if (trail.has(sig)) throw new Error(`layer cycle at ${sig.slice(0, 12)}`)
    const bytes = await read(sig)
    if (!bytes) throw new Error(`layer ${sig.slice(0, 12)} is not held`)
    const layer = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
    const next = new Set(trail).add(sig)
    for (const cell of Array.isArray(layer['cells']) ? layer['cells'] : []) {
      if (typeof cell === 'string' && SIG_RE.test(cell) && known.has(cell)) await deriveLayer(cell, next)
    }
    const rewritten = remap(layer, new Map([...modules, ...layerMap])) as Record<string, unknown>
    const named = sig === rootSig ? { ...rewritten, derivedFrom: rootSig, derivation: derivation.sig } : rewritten
    const out = encode(JSON.stringify(named))
    const to = await sign(out)
    layerMap.set(sig, to)
    files.set(to, out)
    return to
  }
  const root = await deriveLayer(rootSig, new Set())
  for (const sig of known) if (!layerMap.has(sig)) await deriveLayer(sig, new Set())

  // 4. THE RECORD AND ITS BAGS, in the derived signatures.
  const mapModule = (sig: string): string => modules.get(sig) ?? sig
  const bees = (record.bees ?? []).map(mapModule)
  const dependencies = (record.dependencies ?? []).map(mapModule)
  const beeDeps = Object.fromEntries(Object.entries(record.beeDeps ?? {})
    .map(([bee, deps]) => [mapModule(bee), deps.map(mapModule)]))
  const aliasBySig = new Map<string, string>()
  for (const sig of dependencies) aliasBySig.set(sig, aliasOf(files.get(sig) ?? await read(sig)))
  const depEntries = dependencyEntries(dependencies, sig => aliasBySig.get(sig) ?? '')
  const beeBagEntries = beeEntries(bees)
  const bags = [
    { sig: await bagSignature(depEntries), entries: depEntries },
    { sig: await bagSignature(beeBagEntries), entries: beeBagEntries },
  ]
  const derivedRecord: PackageRecord = {
    ...record,
    layers: (record.layers ?? []).map(sig => layerMap.get(sig) ?? sig),
    bees,
    dependencies,
    beeDeps,
    dependenciesBag: bags[0]!.sig,
    beesBag: bags[1]!.sig,
  }
  files.set(derivation.sig, derivation.bytes)
  return { root, record: derivedRecord, files, bags, derivation, modules }
}
