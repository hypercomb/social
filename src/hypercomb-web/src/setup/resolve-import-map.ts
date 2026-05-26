// hypercomb-web/src/setup/resolve-import-map.ts

import { environment, Store } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

/**
 * Build the runtime importmap entirely from OPFS — no localStorage,
 * no manifest fetch, no leaf-file opens.
 *
 * Boot reads exactly one bag:
 *
 *   1. `__dependencies__/HEAD`         — file containing the active bag sig
 *   2. `__dependencies__/<HEAD>/000x`  — bag entries, each is two-line text:
 *                                         line 1 = `@scope/name` alias
 *                                         line 2 = leaf sig
 *
 * Entries are read in parallel; the importmap is assembled directly from
 * the (alias, sig) pairs. The leaf files (`__dependencies__/<sig>.js`)
 * are never opened during import-map resolution.
 *
 * A flat-scan fallback survives for installs predating the HEAD pointer
 * (older `installFromBundled` runs that wrote leaves but no HEAD). On
 * future installs the fallback never fires.
 */
export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()
  imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
  imports['pixi.js'] = '/vendor/pixi.runtime.js'

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

  // HEAD-file fast path. One stat + one read of `HEAD`, one dir scan of
  // the active bag, parallel reads of N small two-line entries. The bag
  // sig in HEAD is the disk truth — no cross-checking against localStorage.
  let bagPathSucceeded = false
  try {
    const headHandle = await depsDir.getFileHandle('HEAD').catch(() => null)
    if (headHandle) {
      const activeBagSig = (await (await headHandle.getFile()).text()).trim()
      if (activeBagSig) {
        const bagDir = await depsDir.getDirectoryHandle(activeBagSig).catch(() => null)
        if (bagDir) {
          const names: string[] = []
          for await (const [n] of bagDir.entries()) names.push(n)
          names.sort()

          const entries = await Promise.all(names.map(async (n) => {
            const h = await bagDir.getFileHandle(n).catch(() => null)
            if (!h) return null
            const text = (await (await h.getFile()).text()).trim()
            const newlineIdx = text.indexOf('\n')
            if (newlineIdx < 0) return null
            const alias = text.slice(0, newlineIdx).trim()
            const sig = text.slice(newlineIdx + 1).trim()
            return alias && sig ? { alias, sig } : null
          }))

          for (const entry of entries) {
            if (!entry) continue
            if (imports[entry.alias]) continue
            imports[entry.alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${entry.sig}`
            aliasSource.set(entry.alias, entry.sig)
          }
          bagPathSucceeded = aliasSource.size > 0
        }
      }
    }
  } catch (err) {
    console.warn('[resolveImportMap] HEAD-path build failed; falling back to flat scan', err)
    bagPathSucceeded = false
  }

  // Flat-scan fallback. Only runs when no HEAD file exists yet (older
  // installs that predate the HEAD pointer). New installs always hit
  // the bag path above.
  if (!bagPathSucceeded) {
    for await (const [signature, handle] of depsDir.entries()) {
      if (handle.kind !== 'file') continue
      if (signature === 'HEAD') continue

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

  // Cache the alias map so DependencyLoader can skip its own OPFS scan
  // later in this session. NOT consulted on the next boot — that path
  // re-reads OPFS truth from HEAD.
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
