// hypercomb-web/src/setup/resolve-import-map.ts

import { environment, Store } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'

  // Reuse the OPFS handles `ensureInstall` already initialized via `Store`.
  // Calling `navigator.storage.getDirectory()` a second time here (with its
  // own short timeout) used to race on slower systems (e.g. macOS Catalina
  // + Chrome 128): the timeout fired, the import map shipped without any
  // namespace aliases, then `DependencyLoader` fell back to scanning OPFS
  // directly, found a dep file, and tried `import('@dcp.com/link')` against
  // the now-empty import map → `Failed to resolve module specifier`.
  // `Store.initialize` memoizes, so this is idempotent.
  const store = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
    '@hypercomb.social/Store',
  ) as Store | undefined
  if (!store) {
    console.warn('[resolveImportMap] Store not registered — returning core imports only')
    return imports
  }

  await store.initialize()
  if (!store.opfsAvailable) {
    console.warn('[resolveImportMap] OPFS unavailable — returning core imports only')
    return imports
  }

  const depsDir = store.dependencies
  if (!depsDir) return imports

  // Sigbag path (Phase 2): when the installed manifest carries a
  // `dependenciesBag` sig AND that bag directory is in OPFS, walk it
  // in index order. Each entry file's contents is a leaf sig; the leaf
  // file's first line carries the `// @namespace/name` alias.
  //
  // Benefits over flat scan:
  //   - Order is authoritative (bag index = canonical load order)
  //   - Skips bag directories that aren't the active one (if multiple
  //     bag versions coexist during rollback / A-B)
  //   - One file-handle open per entry instead of scanning the whole dir
  //
  // Falls through to flat scan if no bag is declared or the bag dir
  // isn't present (older installs, partial transitions).
  let bagWalkSucceeded = false
  try {
    const installedManifestRaw = localStorage.getItem('core-adapter.installed-manifest')
    const installedManifest = installedManifestRaw ? JSON.parse(installedManifestRaw) : null
    const activeBagSig: string | undefined = installedManifest?.dependenciesBag

    if (activeBagSig) {
      const bagDir = await depsDir.getDirectoryHandle(activeBagSig).catch(() => null)
      if (bagDir) {
        const indexNames: string[] = []
        for await (const [name] of bagDir.entries()) indexNames.push(name)
        indexNames.sort()

        // Parallel two-step read: bag entry → leaf file's first 512 bytes.
        // Serial awaits dominated the import-map build time on cold boots;
        // Promise.all collapses the entire walk into ~one OPFS round-trip
        // per layer. Returns sorted [alias, leafSig] tuples preserving the
        // bag's index order so the importmap object retains the canonical
        // load order (relevant for collision dedup).
        const resolved = await Promise.all(indexNames.map(async (indexName) => {
          const entryHandle = await bagDir.getFileHandle(indexName).catch(() => null)
          if (!entryHandle) return null
          const entryFile = await entryHandle.getFile()
          const leafSig = (await entryFile.text()).trim()
          if (!leafSig) return null
          const leafHandle = await depsDir.getFileHandle(`${leafSig}.js`).catch(() => null)
          if (!leafHandle) return { indexName, leafSig, missing: true as const }
          const leafFile = await leafHandle.getFile()
          const prefix = await leafFile.slice(0, 512).arrayBuffer()
          const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
          const alias = firstLine?.split(/\s+/)[1]
          return alias ? { indexName, leafSig, alias, missing: false as const } : null
        }))

        let missingLeaf = false
        for (const entry of resolved) {
          if (!entry) continue
          if (entry.missing) {
            console.warn(`[resolveImportMap] bag entry ${entry.indexName} -> ${entry.leafSig} missing leaf; falling back to flat scan`)
            missingLeaf = true
            break
          }
          if (imports[entry.alias!]) continue
          imports[entry.alias!] = `${OPFS_DEPENDENCY_BASE_PATH}/${entry.leafSig}`
          aliasSource.set(entry.alias!, entry.leafSig)
        }

        if (!missingLeaf && indexNames.length > 0) {
          bagWalkSucceeded = true
        }
      }
    }
  } catch (err) {
    console.warn('[resolveImportMap] bag walk failed; falling back to flat scan', err)
    bagWalkSucceeded = false
  }

  // Flat-scan fallback (existing behavior). Always runs when the bag
  // path is absent or failed. Idempotent — `imports[alias]` collision
  // check skips anything already set by the bag walk.
  if (!bagWalkSucceeded) {
    for await (const [signature, handle] of depsDir.entries()) {
      if (handle.kind !== 'file') continue

      const file = await (handle as FileSystemFileHandle).getFile()

      const prefix = await file.slice(0, 512).arrayBuffer()
      const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
      if (!firstLine) continue

      const alias = firstLine.split(/\s+/)[1]
      if (!alias) continue

      if (imports[alias]) {
        const existing = aliasSource.get(alias) ?? 'unknown'
        console.warn(`[resolveImportMap] alias collision for ${alias}; keeping ${existing}, skipping ${signature}`)
        continue
      }

      imports[alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${signature}`
      aliasSource.set(alias, signature)
    }
  }

  // Cache alias map so DependencyLoader can skip redundant OPFS scan
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
