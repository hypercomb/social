// hypercomb-web/src/setup/resolve-import-map.ts

import { environment } from '@hypercomb/shared/environments/environment'
import { Store } from '@hypercomb/shared/core/store'

export type ResolvedImports = Record<string, string>

/**
 * Build the runtime importmap by opening exactly one bag.
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
 *   3. assemble the importmap directly from those pairs.
 *
 * No localStorage on the critical path. No leaf-file opens. No pointer
 * file. The bag dir's existence IS the signal that an install is present.
 *
 * A flat-scan fallback survives for installs that predate the bag
 * (`installFromBundled` runs without `dependenciesBag` set). New installs
 * always populate the bag, so the fallback eventually goes idle.
 */
/**
 * Where the resolved map is cached for index.html's pre-module script.
 *
 * An import map only counts if it is live BEFORE the browser triggers any
 * module script load — and the shell's own `main.js` is a module script, so
 * the map appended during bootstrap is always late. Chrome/Edge 133+ merge
 * late maps; Safari and older Chrome discard them and every bare specifier
 * (`@domain.com/namespace`, `@hypercomb/core`, `pixi.js`) fails to resolve.
 * Since the map can only be derived asynchronously from OPFS, the cache is
 * the bridge: written here, replayed synchronously by index.html on the next
 * boot. It is a HINT, never truth — every boot still re-derives from OPFS and
 * corrects the cache (main.ts reloads once when the two disagree).
 */
export const IMPORT_MAP_STORAGE_KEY = 'hc:importmap'

/**
 * Re-derive the import map and cache it for the next boot's pre-module
 * script. Call before any deliberate `location.reload()` that follows an
 * install/resync, so the reload lands with the newly written dependencies
 * already resolvable.
 */
export const cacheImportMap = async (): Promise<void> => {
  // A visitor's map points at blob: URLs (see the XCOPY note in
  // resolveImportMap). Those die with the session, so caching them would
  // replay a map of dead specifiers into the NEXT boot's pre-module script
  // and break every bare import before anything could re-derive. The visitor
  // has no persistence to speak for anyway — it re-derives from scratch every
  // load, which is exactly what this cache exists to avoid for participants.
  if ((window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true) return
  try {
    const imports = await resolveImportMap()
    localStorage.setItem(IMPORT_MAP_STORAGE_KEY, JSON.stringify({ imports }))
  } catch (err) {
    console.warn('[resolveImportMap] could not cache import map', err)
  }
}

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

  // Participant imports are pool-addressed and served by the OPFS service
  // worker. A published website deliberately has neither real OPFS nor that
  // worker: its verified dependency bytes remain at immutable
  // `/content/<signature>` URLs on the same origin.
  const readonlyVisitor = (window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true
  const dependencyBasePath = readonlyVisitor
    ? '/content'
    : `/opfs/${await Store.poolSignature(Store.DEPENDENCIES_MEANING)}`

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
          if (imports[entry.alias]) continue
          imports[entry.alias] = `${dependencyBasePath}/${entry.sig}`
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

          if (imports[alias]) {
            const existing = aliasSource.get(alias) ?? 'unknown'
            if (existing !== signature) {
              console.warn(`[resolveImportMap] alias collision for ${alias}; keeping ${existing}, skipping ${signature}`)
            }
            continue
          }

          imports[alias] = `${dependencyBasePath}/${signature}`
          aliasSource.set(alias, signature)
        }
      } catch { /* legacy dir vanished mid-drain — the pool holds everything */ }
    }
  }

  // Cache the alias map for in-session reuse by DependencyLoader.
  // NOT consulted on the next boot — every cold boot re-derives from OPFS.
  ;(globalThis as any).__hypercombAliasMap = aliasSource

  // THE XCOPY CONTRACT. A published site must run from ANY static host —
  // plain nginx/Apache/cPanel, no config. Dependencies are sig-named and
  // therefore EXTENSIONLESS, and the map above resolves an alias straight
  // to a `/content/<sig>` URL, so `import(alias)` is a MODULE SCRIPT LOAD
  // against the host. Browsers enforce strict MIME on those: a host that
  // answers `application/octet-stream` (which every dumb host does for an
  // unknown extension) gets the whole dependency set refused —
  //   "Expected a JavaScript-or-Wasm module script but the server
  //    responded with a MIME type of application/octet-stream"
  // — and the site boots to a blank page. Only a host that special-cases
  // `Sec-Fetch-Dest` (our Cloudflare worker does) makes URL imports work,
  // which silently made the deployment host-dependent.
  //
  // So the visitor fetches the bytes and imports a BLOB carrying the right
  // type. The server is then only ever a byte source — never a MIME
  // authority — which is the same posture the rest of the system already
  // takes (sha256 gates the bytes; the host is not trusted for anything).
  // Alias→alias imports inside a dep still resolve through this map, so
  // the whole graph stays blob-resolved.
  //
  // Participants are untouched: their deps come from `/opfs/<poolSig>`,
  // served by our own service worker, which sets the type itself.
  if (readonlyVisitor && aliasSource.size > 0) {
    await Promise.all([...aliasSource].map(async ([alias, sig]) => {
      try {
        const res = await fetch(`${dependencyBasePath}/${sig}`)
        if (!res.ok) return // leave the URL form; the loader reports the failure
        const source = await res.text()
        imports[alias] = URL.createObjectURL(
          new Blob([source], { type: 'text/javascript' }),
        )
      } catch {
        // Offline/blocked — keep the URL form so the existing error path runs.
      }
    }))
  }

  return imports
}
