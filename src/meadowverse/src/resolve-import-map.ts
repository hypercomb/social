// meadowverse/src/resolve-import-map.ts
// Builds the browser import map from installed dependency bundles.
// Dependencies live in the sign('dependencies') POOL OF MEANING — a dir at
// the OPFS root named by the sha256 of the meaning string — with the legacy
// `__dependencies__` dir surviving only as a read-fallback drain source.
// Enumeration UNIONS pool + legacy (pool wins on alias collision) so a
// partially-drained store never yields an empty import map mid-migration.

import { Store } from '../../hypercomb-shared/core'

export type ResolvedImports = Record<string, string>

// URL prefix the service worker resolves against OPFS: /opfs/<dirName>/<file>.
// dirName is the pool sig or the legacy `__dependencies__` — the worker
// mirrors the same new-location-first fallback (see meadowverse.worker.js).
const OPFS_BASE_PATH = '/opfs'
const LEGACY_DEPENDENCIES_DIRECTORY = '__dependencies__'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()

  // core runtime — bees import from @hypercomb/core at runtime
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'

  // three.js vendor bundle (loaded from public/ or future vendor build)
  imports['three'] = '/vendor/three.runtime.js'

  const root = await navigator.storage.getDirectory()

  // Both opened WITHOUT create — this is a read path; an absent pool or an
  // already-drained legacy dir simply contributes nothing.
  const openDir = async (name: string): Promise<FileSystemDirectoryHandle | null> => {
    try { return await root.getDirectoryHandle(name) } catch { return null }
  }
  const poolName = await Store.poolSignature(Store.DEPENDENCIES_MEANING)
  const sources: { dirName: string; dir: FileSystemDirectoryHandle | null }[] = [
    { dirName: poolName, dir: await openDir(poolName) },                              // canonical
    { dirName: LEGACY_DEPENDENCIES_DIRECTORY, dir: await openDir(LEGACY_DEPENDENCIES_DIRECTORY) }, // legacy drain
  ]

  for (const { dirName, dir } of sources) {
    if (!dir) continue
    // duck-type cast: TS's DOM lib lacks the async-iterator members
    const entries = (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [name, handle] of entries) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()

      const prefix = await file.slice(0, 512).arrayBuffer()
      const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
      if (!firstLine) continue

      const alias = firstLine.split(/\s+/)[1]
      if (!alias) continue

      if (imports[alias]) {
        // pool enumerated first, so during the drain window the canonical
        // copy wins and the legacy duplicate is skipped silently-ish.
        const existing = aliasSource.get(alias) ?? 'unknown'
        console.warn(`[meadowverse:importmap] alias collision for ${alias}; keeping ${existing}, skipping ${name}`)
        continue
      }

      imports[alias] = `${OPFS_BASE_PATH}/${dirName}/${name}`
      aliasSource.set(alias, name)
    }
  }

  // cache alias map for DependencyLoader
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
