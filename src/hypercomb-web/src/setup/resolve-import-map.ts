// hypercomb-web/src/setup/resolve-import-map.ts

import { environment, Store } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

const OPFS_DEPENDENCY_BASE_PATH = '/opfs/__dependencies__'

/**
 * Build the runtime importmap by opening exactly one bag.
 *
 * Receiver-side `__dependencies__/` contains:
 *   - `<bagSig>/0000…` — the active bag, named by its content sig
 *   - `<leafSig>.js`   — namespace bundles at root, one per dep
 *
 * `installFromBundled` enforces the single-bag invariant: only one bag
 * directory ever exists in `__dependencies__/` at a time (old ones are
 * evicted before the new one is written). So the boot path:
 *
 *   1. scan `__dependencies__/` until we find a directory (the bag);
 *   2. iterate its entries in parallel; each entry is two-line text
 *      (line 1 = `@scope/name` alias, line 2 = leaf sig);
 *   3. assemble the importmap directly from those pairs.
 *
 * No localStorage on the critical path. No leaf-file opens. No pointer
 * file. The bag dir's existence IS the signal that an install is present.
 *
 * A flat-scan fallback survives for installs that predate the bag
 * (`installFromBundled` runs without `dependenciesBag` set). New installs
 * always populate the bag, so the fallback eventually goes idle.
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

  // Bag-discovery fast path. Iterate `__dependencies__/` once; the first
  // directory whose name is a 64-hex sig is the active bag.
  let bagPathSucceeded = false
  try {
    let bagDir: FileSystemDirectoryHandle | null = null
    for await (const [name, handle] of depsDir.entries()) {
      if (handle.kind !== 'directory') continue
      if (!/^[a-f0-9]{64}$/i.test(name)) continue
      bagDir = handle as FileSystemDirectoryHandle
      break
    }

    if (bagDir) {
      const names: string[] = []
      for await (const [n] of bagDir.entries()) names.push(n)
      names.sort()

      const entries = await Promise.all(names.map(async (n) => {
        const h = await bagDir!.getFileHandle(n).catch(() => null)
        if (!h) return null
        const text = (await (await h.getFile()).text()).trim()
        const nl = text.indexOf('\n')
        if (nl < 0) return null
        const alias = text.slice(0, nl).trim()
        const sig = text.slice(nl + 1).trim()
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
  } catch (err) {
    console.warn('[resolveImportMap] bag scan failed; falling back to flat scan', err)
    bagPathSucceeded = false
  }

  // Flat-scan fallback. Only runs when no bag dir is present (installs
  // that predate the bag emission). Reads each leaf's first 512 bytes
  // to extract the namespace alias from the source-path comment.
  if (!bagPathSucceeded) {
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

  // Cache the alias map for in-session reuse by DependencyLoader.
  // NOT consulted on the next boot — every cold boot re-derives from OPFS.
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
