// hypercomb-shim/src/replicate.ts
//
// ACQUISITION. What a host offers, and how one of its packages becomes yours.
//
// The whole of it is: ask a domain what it publishes, then resolve one
// package's declared inventory into the local heap, sha256-verifying every
// atom against its own name before admission. Present atoms are reused, so a
// repeat call is an idempotent delta repair, and a package is runnable only
// when its inventory resolves with no holes and nothing refused —
// complete-or-absent (documentation/install-by-replication.md).
//
// The walk itself is NOT written here. `resolveInventory` in shared already
// IS the protocol, and it is deliberately kind-blind: it knows nothing about
// pools, `.js` suffixes or URL shapes. Everything kind-shaped lives in the io
// wiring below, which is where it belongs and where it stays.
//
// WHAT THIS DELIBERATELY DOES NOT DO — stated rather than implied, because it
// is the difference between this chip and the next one: the manifest a domain
// serves is NOT signed. Every atom is verified, so a hostile or hijacked host
// cannot serve you wrong bytes — but it CAN offer you a different tree and
// call it current. Binding "current" to a publisher identity is the signed
// sentinel. Until that lands, adding a domain is exactly as much trust as
// visiting one.

// NARROW IMPORTS, NOT THE BARREL. `@hypercomb/shared/core` re-exports
// Angular-flavoured modules, so one barrel import pulls @angular/core into the
// bundle — 120 modules instead of 43, and a shim that cannot boot (the
// directives use standard field decorators and throw "not supported in JIT
// mode" without the AOT compiler). The build's `✓ framework-free` check caught
// exactly this; keep every import here module-specific.
// `@hypercomb/core` is EXTERNAL — the import map resolves it to the runtime
// the shim already loaded, so this bundle shares its instances rather than
// minting a second set.
import { registerPoolMeaning, SignatureStore } from '@hypercomb/core'
// These two are PURE — stateless functions over bytes, no IoC registration, no
// module state — which is the entire reason they may be bundled in here. The
// walker IS the protocol; only the io wiring below is ours.
import { isComplete, resolveInventory, type ReplicationIo, type ReplicationResult } from '@hypercomb/runtime/replication-walker'
import { hostBases, listHostPackages, type HostPackage } from '@hypercomb/runtime/host-packages'

// Re-exported so the shim's own callers keep one import site. The
// IMPLEMENTATION moved to runtime (the app needs the same answer and cannot
// import the shim); nothing about the shape changed.
export { hostBases, listHostPackages, type HostPackage }
import { validateSealedPackage } from '@hypercomb/runtime/sealed-package'

// Store is reached STRUCTURALLY, never imported. Importing the module would
// bundle a second Store class AND run its module-scope
// `register('@hypercomb.social/Store', new Store())` — a second instance over
// the same OPFS, which is the one thing a packed/flat store must never have.
// The shim already registered the real one; this is the shape we need of it.
type StoreLike = {
  initialize(): Promise<void>
  readonly opfsAvailable: boolean
  readonly hypercombRoot?: FileSystemDirectoryHandle
  readonly bees: FileSystemDirectoryHandle
  readonly dependencies: FileSystemDirectoryHandle
}

const STORE_KEY = '@hypercomb.social/Store'

/** Pool addresses are DERIVED, never hardcoded — `sign(meaning)` through the
 *  registry, so addressing a pool also registers its meaning. Both meanings
 *  below are in core's frozen bare-word set. */
const BEES_MEANING = 'bees'
const DEPENDENCIES_MEANING = 'dependencies'

const SIG_RE = /^[a-f0-9]{64}$/

/** The package sig currently installed, so a warm boot skips straight past
 *  acquisition. A HINT — OPFS presence is the truth, and the walker
 *  re-derives it on any call. */
const INSTALLED_KEY = 'hc:shim:installed-package'

export type InstallOutcome = {
  ok: boolean
  packageSig: string
  fetched: number
  present: number
  holes: string[]
  refused: string[]
  error?: string
}

export const installedPackageSig = (): string | null => {
  try {
    const sig = localStorage.getItem(INSTALLED_KEY)
    return sig && SIG_RE.test(sig) ? sig : null
  } catch { return null }
}

/** The shim's OWN origin is always a byte source, so a node that serves its
 *  own content needs no host added at all — it already carries itself. */
export const selfBases = (): string[] => [`${location.origin}/content`, location.origin]

const fetchBytes = async (url: string): Promise<Uint8Array<ArrayBuffer> | null> => {
  try {
    // Default cache mode, NOT 'no-store': every URL through here is
    // sig-addressed immutable content, so the HTTP cache is free bandwidth.
    const res = await fetch(url)
    if (!res.ok) return null
    // SPA fallback guard: an extension-less flat `/<sig>` on a dev-server
    // origin answers index.html with 200. Sig-addressed bytes are never
    // text/html. The sha256 check is the real gate; this only saves the
    // pointless hash of a 404 page.
    if ((res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
    return new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>
  } catch { return null }
}

const writeBytes = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try { await writable.write(bytes) } finally { await writable.close() }
}

/** Seed the service worker's cache so the first module import does not make a
 *  second round trip for bytes already in hand. Best-effort. */
const seedCache = async (path: string, bytes: ArrayBuffer, contentType: string): Promise<void> => {
  try {
    const cache = await caches.open('hypercomb-modules-v2')
    const url = new URL(path, location.origin).toString()
    if (await cache.match(url)) return
    const headers = new Headers({ 'content-type': contentType, 'cache-control': 'no-store' })
    await cache.put(url, new Response(bytes, { headers }))
  } catch { /* non-fatal */ }
}

const readFrom = (dirs: (FileSystemDirectoryHandle | undefined)[], namesFor: (sig: string) => string[]) =>
  async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    for (const dir of dirs) {
      if (!dir) continue
      for (const name of namesFor(sig)) {
        try {
          const handle = await dir.getFileHandle(name, { create: false })
          return new Uint8Array(await (await handle.getFile()).arrayBuffer()) as Uint8Array<ArrayBuffer>
        } catch { /* try the next name / dir */ }
      }
    }
    return null
  }

const writeTo = (
  dir: FileSystemDirectoryHandle | undefined,
  nameFor: (sig: string) => string,
  cacheUrlFor: (sig: string) => string,
  contentType: string,
) => async (sig: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
  if (!dir) throw new Error(`[replicate] no destination for ${sig.slice(0, 12)}`)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  await writeBytes(dir, nameFor(sig), buffer)
  await seedCache(cacheUrlFor(sig), buffer, contentType)
}

const merge = (root: string, parts: ReplicationResult[]): ReplicationResult =>
  parts.reduce<ReplicationResult>((acc, r) => ({
    root,
    total: acc.total + r.total,
    present: acc.present + r.present,
    fetched: acc.fetched + r.fetched,
    held: [...acc.held, ...r.held],
    holes: [...acc.holes, ...r.holes],
    refused: [...acc.refused, ...r.refused],
    limited: acc.limited || r.limited,
  }), { root, total: 0, present: 0, fetched: 0, held: [], holes: [], refused: [], limited: false })

/**
 * Make one package yours. Sealed first, then resolved, then gated:
 *
 *   1. SEAL — the record must declare its own root and close `beeDeps` over
 *      the declared sets. Nothing outside the record is ever a candidate.
 *   2. RESOLVE — three exact inventories (no mining, no recursion). Every
 *      fetched atom is sha256-verified before write; present atoms are reused.
 *   3. GATE — complete-or-absent. Holes or refusals mean nothing is marked
 *      installed, and the next attempt repairs the delta rather than starting
 *      over.
 */
export const installPackage = async (pkg: HostPackage): Promise<InstallOutcome> => {
  const fail = (error: string): InstallOutcome =>
    ({ ok: false, packageSig: pkg.packageSig, fetched: 0, present: 0, holes: [], refused: [], error })

  const store = window.ioc?.get?.<StoreLike>(STORE_KEY)
  if (!store) return fail('store unavailable')
  await store.initialize()
  if (!store.opfsAvailable) return fail('OPFS unavailable')

  const sealed = validateSealedPackage(pkg.packageSig, {
    layers: pkg.layers, bees: pkg.bees, dependencies: pkg.dependencies, beeDeps: pkg.beeDeps,
  })
  if (!sealed.valid) return fail(`package is not sealed: ${sealed.errors.join('; ')}`)

  // Byte sources, in order: this host, then the shim's own origin. Order is a
  // bandwidth preference only — verification makes a wrong source cost a 404,
  // never a wrong byte, which is why the fallback needs no trust argument.
  const origins = [...new Set([pkg.base, ...selfBases()])]
  const fetchFrom = async (sig: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    for (const base of origins) {
      const bytes = await fetchBytes(`${base}/${sig}`)
      if (bytes) return bytes
    }
    return null
  }

  const beesUrlBase = `/opfs/${await registerPoolMeaning(BEES_MEANING)}`
  const depsUrlBase = `/opfs/${await registerPoolMeaning(DEPENDENCIES_MEANING)}`

  const results = await Promise.all([
    resolveInventory(pkg.packageSig, pkg.layers, {
      read: readFrom([store.hypercombRoot], sig => [sig, `${sig}.json`]),
      fetch: fetchFrom,
      write: writeTo(store.hypercombRoot, sig => sig, sig => `/opfs/${sig}`, 'application/json; charset=utf-8'),
    } satisfies ReplicationIo),
    resolveInventory(pkg.packageSig, pkg.dependencies, {
      read: readFrom([store.dependencies], sig => [`${sig}.js`, sig]),
      fetch: fetchFrom,
      write: writeTo(store.dependencies, sig => `${sig}.js`, sig => `${depsUrlBase}/${sig}`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
    resolveInventory(pkg.packageSig, pkg.bees, {
      read: readFrom([store.bees], sig => [`${sig}.js`, sig]),
      fetch: fetchFrom,
      write: writeTo(store.bees, sig => `${sig}.js`, sig => `${beesUrlBase}/${sig}.js`, 'application/javascript; charset=utf-8'),
    } satisfies ReplicationIo),
  ])

  const held = merge(pkg.packageSig, results)
  if (!isComplete(held)) {
    return {
      ok: false,
      packageSig: pkg.packageSig,
      fetched: held.fetched,
      present: held.present,
      holes: held.holes,
      refused: held.refused,
      error: held.refused.length
        ? `${held.refused.length} atom(s) refused — served bytes did not hash to their name`
        : `${held.holes.length} atom(s) unreachable`,
    }
  }

  // The bags. Each is a sig-named dir INSIDE the pool whose entries carry the
  // alias→sig pairs the import map is assembled from — legitimate structure,
  // not a typed folder.
  await writeBags(store, pkg, origins)

  activate(pkg, held.held)
  return {
    ok: true,
    packageSig: pkg.packageSig,
    fetched: held.fetched,
    present: held.present,
    holes: [],
    refused: [],
  }
}

/** The key ScriptPreloader reads to learn which bees to import. Written ONLY
 *  after the complete-or-absent gate passes — an install that did not fully
 *  resolve leaves its admitted bytes in place (so the next attempt is a delta
 *  repair) but never claims the hive is runnable. */
const INSTALL_MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'

/**
 * Make the resolved package the LIVE one. Replication put verified bytes in
 * the heap; nothing reads them until this says which package is current — the
 * one place where "held" becomes "running", kept separate for exactly that
 * reason.
 */
const activate = (pkg: HostPackage, held: string[]): void => {
  try {
    localStorage.setItem(INSTALLED_KEY, pkg.packageSig)
    localStorage.setItem(INSTALL_MANIFEST_KEY, JSON.stringify({
      version: 2,
      layers: pkg.layers,
      bees: pkg.bees,
      dependencies: pkg.dependencies,
      beeDeps: pkg.beeDeps,
      dependenciesBag: pkg.dependenciesBag,
      beesBag: pkg.beesBag,
      // Provenance: a HOST produced this install, so the shell's own bundled
      // `/content/` package is NOT this install's update authority. 'sentinel'
      // is the existing spelling for "an external authority is current"; the
      // shim never runs the update check that reads it, but a web shell
      // sharing this origin would, and it must not raise a phantom "new
      // features" by diffing a host install against its own bundle.
      source: 'sentinel' as const,
    }))
    // Per-bee dependency closure, read by the preloader when it lazy-loads a
    // bee's deps. A global rather than storage because it is re-derived every
    // boot from the manifest above.
    if (pkg.beeDeps) (globalThis as { __hypercombBeeDeps?: unknown }).__hypercombBeeDeps = pkg.beeDeps
    // Every admitted signature is trusted BY CONSTRUCTION — its bytes hashed
    // to its name at the admission boundary. Runtime performs zero
    // verification, which is the design, not an optimization. Serialized
    // through SignatureStore itself so the on-disk shape can never drift from
    // the reader's.
    const sigStore = new SignatureStore()
    try {
      const existing = localStorage.getItem(SIG_STORE_KEY)
      if (existing) sigStore.restore(JSON.parse(existing) as { sigs?: string[]; storeSig?: string | null })
    } catch { /* unreadable — start from the set we just admitted */ }
    sigStore.trustAll(held)
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  } catch { /* storage unavailable — OPFS presence is still the truth */ }
}

const writeBags = async (store: StoreLike, pkg: HostPackage, origins: string[]): Promise<void> => {
  // Single-bag invariant: evict any prior bag before writing the new one, so
  // the import map's readdir finds exactly one and needs no pointer file.
  // Scoped STRICTLY to the install-owned pools — at the OPFS root the same
  // 64-hex dir shape is a user lineage sigbag.
  const evict = async (parent: FileSystemDirectoryHandle, keep: string): Promise<void> => {
    const stale: string[] = []
    for await (const [name, handle] of parent.entries()) {
      if (handle.kind === 'directory' && SIG_RE.test(name) && name !== keep) stale.push(name)
    }
    for (const name of stale) {
      try { await parent.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }

  const writeBag = async (parent: FileSystemDirectoryHandle, bagSig: string, count: number): Promise<void> => {
    await evict(parent, bagSig)
    const bagDir = await parent.getDirectoryHandle(bagSig, { create: true })
    await Promise.all(Array.from({ length: count }, (_, i) => i).map(async (index) => {
      // 8 digits is the marker width builds emit; 4 is the read fallback for
      // dists deployed before the widening. The bag sig is derived from entry
      // CONTENT, so an old dist presents the SAME bag sig under the old
      // filenames — without the fallback the fetch 404s and an empty bag is
      // written, which strands every alias the map needed.
      for (const name of [String(index).padStart(8, '0'), String(index).padStart(4, '0')]) {
        for (const base of origins) {
          const bytes = await fetchBytes(`${base}/${bagSig}/${name}`)
          if (!bytes) continue
          const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          await writeBytes(bagDir, String(index).padStart(8, '0'), buffer)
          return
        }
      }
    }))
  }

  if (pkg.dependenciesBag && SIG_RE.test(pkg.dependenciesBag)) {
    await writeBag(store.dependencies, pkg.dependenciesBag, pkg.dependencies.length)
  }
  if (pkg.beesBag && SIG_RE.test(pkg.beesBag)) {
    await writeBag(store.bees, pkg.beesBag, pkg.bees.length)
  }
}
