// hypercomb-web/src/setup/resolve-import-map.ts

import type { Store } from '@hypercomb/shared'

export type ResolvedImports = Record<string, string>

/**
 * Build dependency alias metadata by opening exactly one bag. Current signed
 * packages need no browser import map: their @hypercomb/core and pixi.js
 * edges were rewritten to exact OPFS signature URLs when the modules were
 * built. A two-entry compatibility map survives only for an already-installed
 * package whose cached manifest predates that platform-signature metadata.
 *
 * Dependencies live in the sign('dependencies') POOL OF MEANING — a dir
 * at the OPFS root named by the sha256 of the meaning string, derived at
 * runtime (never hardcoded). It contains:
 *   - `<bagSig>/0000…` — the active bag, named by its content sig
 *   - `<leafSig>.js`   — namespace bundles, one per dep
 *
 * The legacy `__dependencies__` dir is a read-only drain source: the
 * Store's detached absorb empties it, but on the first post-upgrade boot
 * files (or the bag dir) can still be mid-drain there, so every scan
 * below UNIONS the pool with the legacy handle while it exists.
 *
 * `installFromBundled` enforces the single-bag invariant: only one bag
 * directory ever exists in the pool at a time (old ones are evicted
 * before the new one is written). So the boot path:
 *
 *   1. scan the pool (∪ legacy) until we find a directory (the bag);
 *   2. iterate its entries in parallel; each entry is two-line text
 *      (line 1 = `@scope/name` alias, line 2 = leaf sig);
 *   3. retain alias → sig as discovery/log metadata.
 *
 * Namespace and platform modules execute by
 * `/opfs/<pool-sig>/<content-sig>`, so aliases do NOT enter the browser import
 * map for current packages. No leaf-file opens. No pointer file. The bag
 * dir's existence IS the signal that an install is present.
 *
 * A flat-scan fallback survives for installs that predate the bag
 * (`installFromBundled` runs without `dependenciesBag` set). New installs
 * always populate the bag, so the fallback eventually goes idle.
 */
/**
 * Where the legacy compatibility map is cached for index.html's pre-module
 * script.
 *
 * An import map only counts if it is live BEFORE the browser triggers any
 * module script load — and the shell's own `main.js` is a module script, so
 * the map appended during bootstrap is always late. Chrome/Edge 133+ merge
 * late maps; Safari and older Chrome discard them and every bare specifier
 * (`@hypercomb/core`, `pixi.js`) fails to resolve in an old package. Current
 * package graphs embed signature URLs and remove this cache. It remains a
 * bounded read fallback so upgrading the shell does not strand a participant
 * who has not adopted the new content package yet.
 */
export const IMPORT_MAP_STORAGE_KEY = 'hc:importmap'
const INSTALL_MANIFEST_STORAGE_KEY = 'core-adapter.installed-manifest'
const SIGNATURE = /^[a-f0-9]{64}$/i

const needsLegacyPlatformMap = (): boolean => {
  try {
    const raw = localStorage.getItem(INSTALL_MANIFEST_STORAGE_KEY)
    if (!raw) return false
    const manifest = JSON.parse(raw) as {
      bees?: unknown
      dependencies?: unknown
      platforms?: Record<string, unknown>
    }
    if (!Array.isArray(manifest.bees) || manifest.bees.length === 0) return false
    const dependencies = Array.isArray(manifest.dependencies)
      ? new Set(manifest.dependencies.filter((value): value is string => typeof value === 'string'))
      : new Set<string>()
    const core = manifest.platforms?.['@hypercomb/core']
    const pixi = manifest.platforms?.['pixi.js']
    const signed = (value: unknown): value is string =>
      typeof value === 'string' && SIGNATURE.test(value) && dependencies.has(value)
    return !signed(core) || !signed(pixi)
  } catch {
    return false
  }
}

/**
 * Re-derive the import map and cache it for the next boot's pre-module
 * script. Call before any deliberate `location.reload()` that follows an
 * install/resync, so the reload lands with the newly written dependencies
 * already resolvable.
 */
export const cacheImportMap = async (): Promise<void> => {
  try {
    const imports = await resolveImportMap()
    if (Object.keys(imports).length > 0) {
      localStorage.setItem(IMPORT_MAP_STORAGE_KEY, JSON.stringify({ imports }))
    } else {
      localStorage.removeItem(IMPORT_MAP_STORAGE_KEY)
    }
  } catch (err) {
    console.warn('[resolveImportMap] could not cache import map', err)
  }
}

export const resolveImportMap = async (): Promise<ResolvedImports> => {
  const imports: ResolvedImports = {}
  const aliasSource = new Map<string, string>()
  if (needsLegacyPlatformMap()) {
    imports['@hypercomb/core'] = '/hypercomb-core.runtime.js'
    imports['pixi.js'] = '/vendor/pixi.runtime.js'
  }

  const store = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(
    '@hypercomb.social/Store',
  ) as Store | undefined
  if (!store) {
    console.warn('[resolveImportMap] Store not registered — returning compatibility imports only')
    return imports
  }

  await store.initialize()
  if (!store.opfsAvailable) {
    console.warn('[resolveImportMap] OPFS unavailable — returning compatibility imports only')
    return imports
  }

  // Pool first, legacy drain dir second — union, not either/or.
  const depDirs = [store.dependencies, store.legacyDependencies]
    .filter((d): d is FileSystemDirectoryHandle => !!d)
  if (!depDirs.length) return imports

  // Bag-discovery fast path. Iterate the pool (∪ legacy) once; the first
  // directory whose name is a 64-hex sig is the active bag.
  let bagPathSucceeded = false
  try {
    // One pass: locate the active bag dir AND record the flat `<sig>.js`
    // leaf files present. We need both — the bag names the leaf sigs, but
    // the SW only serves them from the flat files, so a bag entry is only
    // usable if its flat file actually exists (in either location).
    let bagDir: FileSystemDirectoryHandle | null = null
    const flatNames = new Set<string>()
    for (const depsDir of depDirs) {
      try {
        for await (const [name, handle] of depsDir.entries()) {
          if (handle.kind === 'directory') {
            if (!bagDir && /^[a-f0-9]{64}$/i.test(name)) bagDir = handle as FileSystemDirectoryHandle
          } else if (handle.kind === 'file') {
            flatNames.add(name)
          }
        }
      } catch { /* legacy dir vanished mid-drain — the pool holds everything */ }
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
          if (aliasSource.has(entry.alias)) continue
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
  // to extract the namespace alias from the source-path comment. Same
  // pool ∪ legacy union; the alias-collision guard dedupes a leaf that
  // sits in both locations mid-drain.
  if (!bagPathSucceeded) {
    for (const depsDir of depDirs) {
      try {
        for await (const [signature, handle] of depsDir.entries()) {
          if (handle.kind !== 'file') continue

          const file = await (handle as FileSystemFileHandle).getFile()
          const prefix = await file.slice(0, 512).arrayBuffer()
          const firstLine = new TextDecoder().decode(prefix).split('\n', 1)[0]?.trim()
          if (!firstLine) continue

          const alias = firstLine.split(/\s+/)[1]
          if (!alias) continue

          if (aliasSource.has(alias)) {
            const existing = aliasSource.get(alias) ?? 'unknown'
            if (existing !== signature) {
              console.warn(`[resolveImportMap] alias collision for ${alias}; keeping ${existing}, skipping ${signature}`)
            }
            continue
          }
          aliasSource.set(alias, signature)
        }
      } catch { /* legacy dir vanished mid-drain — the pool holds everything */ }
    }
  }

  // Cache alias metadata for in-session dependency discovery and readable
  // logs. DependencyLoader and ScriptPreloader execute the sig URL directly;
  // neither imports through this alias. NOT consulted on the next boot —
  // every cold boot re-derives from OPFS.
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  return imports
}
