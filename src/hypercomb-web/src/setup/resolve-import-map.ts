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
    // One pass over `__dependencies__/`: locate the active bag dir AND record
    // the flat `<sig>.js` leaf files present. We need both — the bag names the
    // leaf sigs, but the SW only serves them from the flat files, so a bag
    // entry is only usable if its flat file actually exists.
    let bagDir: FileSystemDirectoryHandle | null = null
    const flatNames = new Set<string>()
    for await (const [name, handle] of depsDir.entries()) {
      if (handle.kind === 'directory') {
        if (!bagDir && /^[a-f0-9]{64}$/i.test(name)) bagDir = handle as FileSystemDirectoryHandle
      } else if (handle.kind === 'file') {
        flatNames.add(name)
      }
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

      // Bag/flat consistency guard. A resync rewrites the flat dep files for
      // the new enabled set but leaves the bag from the last bundled install
      // untouched, so a bag leaf can point at a flat file that's been deleted.
      // Building the import map from it then resolves aliases to a 404 — the
      // "Failed to fetch dynamically imported module" the dependency-loader
      // throws. If ANY leaf is missing its flat file the whole bag is stale:
      // discard it and let the flat scan below rebuild the map from what's
      // actually on disk (self-healing, no reinstall needed).
      const valid = entries.filter((e): e is { alias: string; sig: string } => !!e)
      const allLeavesPresent = valid.length > 0 && valid.every(e => flatNames.has(`${e.sig}.js`))

      if (allLeavesPresent) {
        for (const entry of valid) {
          if (imports[entry.alias]) continue
          imports[entry.alias] = `${OPFS_DEPENDENCY_BASE_PATH}/${entry.sig}`
          aliasSource.set(entry.alias, entry.sig)
        }
        bagPathSucceeded = aliasSource.size > 0
      } else {
        console.warn('[resolveImportMap] dependency bag is stale (leaf sigs missing flat files) — falling back to flat scan')
        bagPathSucceeded = false
      }
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
