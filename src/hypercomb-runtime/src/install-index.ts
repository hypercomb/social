// hypercomb-runtime/src/install-index.ts
//
// THE INSTALL INDEX — why a published site no longer unpacks 900 files.
//
// A visitor keeps nothing and imports every module from its door's `/<sig>`
// (resolve-import-map.ts, "a host that serves modules at the root"). Yet it
// used to unpack the whole package into its memory store on every visit —
// the 8 MB transfer pack, ~850 module writes, then three full read passes
// (the core check, the bee-deps pass, the aliases) — only to learn a handful
// of facts about bytes it would mostly never run. Those facts are pure
// derivations of the package, so they are derived ONCE, when the door is
// built, with the very functions the install runs, and kept beside it:
//
//   aliases      dependency → the specifier its first line names
//   lazy         the dependencies that are atoms (loaded through the map)
//   beeDeps      bee → the dependencies it claims (bee-deps.ts)
//   coreImports  what the package needs of @hypercomb/core (core-surface.ts)
//   layersPack   one transfer pack holding just the package's layers
//
// A DERIVED RECORD, never truth (documentation/optimize-phase.md): keyed by
// the package signature it describes, in the `install:index` pool; complete
// or absent; recomputable from the package by anyone; never load-bearing. A
// visitor that finds none — or one for another package — installs the way it
// always has. The core gate is still a derivation from bytes: the names were
// read out of the modules, and the live core is still asked.

import { deriveBeeDeps } from './bee-deps.js'
import { requiredCoreExports } from './core-surface.js'
import { aliasOf } from './bags.js'

export const INSTALL_INDEX_MEANING = 'install:index'

const SIG_RE = /^[a-f0-9]{64}$/
/** Line 2 of an atom (`LAZY_MARKER_LINE` in build-module.ts). */
const LAZY_MARKER = '// lazy'

export type InstallIndex = {
  readonly package: string
  readonly layersPack: string | null
  readonly aliases: Readonly<Record<string, string>>
  readonly lazy: readonly string[]
  readonly beeDeps: Readonly<Record<string, readonly string[]>>
  readonly coreImports: readonly string[]
}

/** Derive the index from a package's own bytes — the functions the install
 *  runs, run once where the door is built. */
export const deriveInstallIndex = async (
  packageSig: string,
  inventory: { readonly bees: readonly string[]; readonly dependencies: readonly string[] },
  read: (signature: string) => Promise<Uint8Array | null>,
  layersPack: string | null = null,
): Promise<InstallIndex> => {
  const aliases: Record<string, string> = {}
  const lazy: string[] = []
  for (const sig of inventory.dependencies) {
    const bytes = await read(sig)
    const alias = aliasOf(bytes)
    if (alias) aliases[sig] = alias
    if (bytes && (new TextDecoder().decode(bytes.subarray(0, 512)).split('\n', 3)[1] ?? '').startsWith(LAZY_MARKER)) lazy.push(sig)
  }
  const beeDeps = await deriveBeeDeps(inventory.bees, inventory.dependencies, read)
  const coreImports = await requiredCoreExports([...inventory.bees, ...inventory.dependencies], read)
  return { package: packageSig, layersPack, aliases, lazy: lazy.sort(), beeDeps, coreImports }
}

/** Read an index back, for exactly the package asked about; anything else —
 *  another package's, a malformed one — is no index. */
export const parseInstallIndex = (text: string, packageSig: string): InstallIndex | null => {
  let raw: Record<string, unknown>
  try { raw = JSON.parse(text) as Record<string, unknown> } catch { return null }
  if (!raw || raw['package'] !== packageSig) return null
  const aliases = raw['aliases']
  const beeDeps = raw['beeDeps']
  if (!aliases || typeof aliases !== 'object' || !beeDeps || typeof beeDeps !== 'object') return null
  if (!Array.isArray(raw['lazy']) || !Array.isArray(raw['coreImports'])) return null
  const layersPack = typeof raw['layersPack'] === 'string' && SIG_RE.test(raw['layersPack']) ? raw['layersPack'] : null
  return {
    package: packageSig,
    layersPack,
    aliases: aliases as Record<string, string>,
    lazy: (raw['lazy'] as unknown[]).map(String),
    beeDeps: beeDeps as Record<string, string[]>,
    coreImports: (raw['coreImports'] as unknown[]).map(String),
  }
}

/** The index this session installed from, with the bees the install derived
 *  from the layers. Set by the visitor install; null everywhere else. */
export type ActiveInstallIndex = InstallIndex & { readonly bees: readonly string[] }

export const activeInstallIndex = (): ActiveInstallIndex | null =>
  (globalThis as { __hcInstallIndex?: ActiveInstallIndex }).__hcInstallIndex ?? null

export const setActiveInstallIndex = (index: ActiveInstallIndex | null): void => {
  ;(globalThis as { __hcInstallIndex?: ActiveInstallIndex | null }).__hcInstallIndex = index
}
