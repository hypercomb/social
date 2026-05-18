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

  // Cache alias map so DependencyLoader can skip redundant OPFS scan
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
