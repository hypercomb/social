// hypercomb-essentials/src/assistant/package-typescript.ts
//
// THE PACKAGE'S TYPESCRIPT, NAMED BY ITS OWN LAYERS (owner, 2026-11-16: "Host
// the package's TypeScript without installing it, fetched only when a file is
// opened"). A package layer that owns a source folder carries one optional
// slot, `typescript`: the signature of a text atom holding that folder's
// TypeScript as written, under the same `// src/<path>` headers the compiled
// module carries. A file directly in src/ has no atom: those are barrels a
// script rewrites, and the build's own discovery drops them too.
//
// So "this module, this section" resolves to "the atom the layer on that path
// names, the same section" with no index, no pool and no path table: the
// signed layers are the whole record.
//
// This file imports NOTHING. The build script imports it, and that script
// links before its own check that core is built; the device imports it too.

/** The layer field. `source` already means a carried signature on text-theme
 *  layers, so the slot has its own word. */
export const TYPESCRIPT_SLOT = 'typescript'

/** Line 1 of an atom is `// ${TYPESCRIPT_NAME}<folder>`. */
export const TYPESCRIPT_NAME = '@hypercomb/typescript/'

/** Does this text open as a source atom? Line 1 of every atom is its name.
 *  It is how an atom is known where no layer can be asked what it names. */
export const isTypescriptAtomText = (text: string): boolean =>
  typeof text === 'string' && text.startsWith(`// ${TYPESCRIPT_NAME}`)

/** What the lookup needs of an installed node (a subset of core's InstallNode). */
export type TypescriptNode = { readonly path: string; readonly layerSig: string; readonly base: string }

const SIGNATURE = /^[a-f0-9]{64}$/
const SECTION = /^src\/(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.ts$/

/** The atom a layer names, or undefined. A malformed value is no slot at all:
 *  a reader never asks a host for something that is not a bare signature. */
export const typescriptSlot = (layer: unknown): string | undefined => {
  if (!layer || typeof layer !== 'object') return undefined
  const value = (layer as Record<string, unknown>)[TYPESCRIPT_SLOT]
  return typeof value === 'string' && SIGNATURE.test(value) ? value : undefined
}

/** The layer paths that may answer for a section, deepest first, without the
 *  root: `src/a/b/c.ts` gives `['a/b', 'a']`, `src/x.ts` gives `[]`. Null when
 *  the section is not a TypeScript source path. A `.` or `..` segment is not
 *  one: a layer path is never a way out of its own folder. */
export const typescriptPaths = (section: string): string[] | null => {
  if (typeof section !== 'string' || section.length > 200 || !SECTION.test(section)) return null
  const segments = section.split('/')
  if (segments.some(segment => segment === '.' || segment === '..')) return null
  const folders = segments.slice(1, -1)
  const paths: string[] = []
  for (let depth = folders.length; depth > 0; depth--) paths.push(folders.slice(0, depth).join('/'))
  return paths
}

/**
 * Is this section a file the atoms carry at all? The name half of the build's
 * own rule (scripts/source-filters.ts isCarriedSource, which a device cannot
 * import; source-filters.spec.ts holds the two to one answer): a file in a
 * folder, and not a declaration, a spec, a self-test, a keys file, a
 * generated index, an entry, or anything under `types/`. The build's list of
 * excluded domains is not known here; a folder it leaves out yields no layer,
 * so the lookup below answers nothing for it anyway.
 */
export const typescriptCarries = (section: string): boolean => {
  const paths = typescriptPaths(section)
  if (!paths || !paths.length) return false
  if (paths[paths.length - 1] === 'types') return false
  const base = section.slice(section.lastIndexOf('/') + 1)
  if (base === 'index.ts' || base === 'essentials-keys.ts') return false
  return !/(?:\.d|\.spec|\.test|selftest|\.keys|-keys|\.entry)\.ts$/.test(section)
}

/**
 * The atom that holds a section's TypeScript in the selection that is running.
 * The deepest layer on the path that carries a slot answers, so a later build
 * may name atoms deeper without any reader changing. A picked layer (its
 * signature differs from its base) with no slot answers nothing: what runs
 * there is not what its parent's atom holds. A file the atoms never carry
 * (typescriptCarries), and a file in a folder that is no layer, has none.
 */
export const typescriptAtomFor = (
  section: string,
  nodes: readonly TypescriptNode[],
  slotOf: (layerSig: string) => string | undefined,
): { atom: string; layer: string } | undefined => {
  const paths = typescriptCarries(section) ? typescriptPaths(section) : null
  if (!paths) return undefined
  for (const path of paths) {
    const node = nodes.find(candidate => candidate.path === path)
    if (!node) continue
    const atom = slotOf(node.layerSig)
    if (atom) return { atom, layer: node.layerSig }
    if (node.layerSig !== node.base) return undefined
  }
  return undefined
}
