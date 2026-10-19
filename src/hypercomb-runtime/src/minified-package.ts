// hypercomb-runtime/src/minified-package.ts
//
// THE VISITOR'S MINIFIED PACKAGE — derived, never the truth (jwize
// 2026-10-18: "make sure we don't break the merkle promise and this is somehow
// traceable to the bytes signature from the related scripts" · "keep the
// resolution, when being initially verified, slim").
//
// The signed package stays READABLE: the source lives in the hive, models read
// and draft modules by their `// src/…` sections, and Jev reviews against them.
// A published site's visitor runs a DERIVED package instead. The tree itself —
// walked from the readable root, bodies minified with their heads kept, every
// layer re-hashed bottom-up, the root naming `derivedFrom` and `derivation` —
// is core's `deriveMinifiedTree` (core/derivation.ts), the one implementation
// the build, the terminal verifier and the hive's `derive verify` word all run.
//
// What this adds is what only a BUILD needs: the package record the visitor
// installs from (bees, dependencies, layers, beeDeps in the derived
// signatures) and its two bags, recomputed by bags.ts.
//
// SLIM: what a visitor resolves first has the same shape and size as before;
// the only addition is the record's 64-hex pointer in the root layer.

import { deriveMinifiedTree, type DerivationTool, type MinifyBody } from '@hypercomb/core'
import { bagSignature, beeEntries, dependencyEntries, aliasOf, type BagEntry } from './bags.js'

export { splitHead, type MinifyBody } from '@hypercomb/core'

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

export type DerivedPackage = {
  /** The derived package's root — its root layer's signature. */
  readonly root: string
  readonly record: PackageRecord
  /** Every file the derived package adds: minified modules, rewritten layers, the record. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** The bags, as their entries — written as `<bagSig>/<00000000…>`. */
  readonly bags: ReadonlyArray<{ readonly sig: string; readonly entries: readonly BagEntry[] }>
  /** The derivation record, by its signature. */
  readonly derivation: { readonly sig: string; readonly bytes: Uint8Array }
  /** readable → minified, for every module the transform changed. */
  readonly modules: ReadonlyMap<string, string>
}

/** Derive the minified package from a readable one. `read` answers any file
 *  of the readable package by signature; `record` is its package record. */
export const deriveMinifiedPackage = async (
  rootSig: string,
  record: PackageRecord,
  read: (signature: string) => Promise<Uint8Array | null>,
  minify: MinifyBody,
  tool: DerivationTool,
): Promise<DerivedPackage> => {
  const tree = await deriveMinifiedTree(rootSig, read, minify, tool)
  const mapModule = (sig: string): string => tree.modules.get(sig) ?? sig
  const bees = (record.bees ?? []).map(mapModule)
  const dependencies = (record.dependencies ?? []).map(mapModule)
  const beeDeps = Object.fromEntries(Object.entries(record.beeDeps ?? {})
    .map(([bee, deps]) => [mapModule(bee), deps.map(mapModule)]))
  const aliasBySig = new Map<string, string>()
  for (const sig of dependencies) aliasBySig.set(sig, aliasOf(tree.files.get(sig) ?? await read(sig)))
  const depEntries = dependencyEntries(dependencies, sig => aliasBySig.get(sig) ?? '')
  const beeBagEntries = beeEntries(bees)
  const bags = [
    { sig: await bagSignature(depEntries), entries: depEntries },
    { sig: await bagSignature(beeBagEntries), entries: beeBagEntries },
  ]
  const derivedRecord: PackageRecord = {
    ...record,
    layers: (record.layers ?? []).map(sig => tree.layers.get(sig) ?? sig),
    bees,
    dependencies,
    beeDeps,
    dependenciesBag: bags[0]!.sig,
    beesBag: bags[1]!.sig,
  }
  return { root: tree.root, record: derivedRecord, files: tree.files, bags, derivation: tree.derivation, modules: tree.modules }
}
