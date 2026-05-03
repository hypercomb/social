// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.
//
// Two-source install: the sentinel is the preferred source (DCP audits
// content, can push deltas). The bundled `/content/` shipped with the
// web shell is the fallback — used when DCP is unreachable, and as a
// reference for stale-cache detection so a new deploy is picked up
// even when the sentinel hasn't pushed yet.

import { EffectBus, SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared/core'
import type { SentinelBridge } from './sentinel-bridge'

export type BootStatus =
  | { kind: 'cached' }
  | { kind: 'installing' }
  | { kind: 'installed' }
  | { kind: 'install-needed'; reason: 'no-sentinel' | 'sentinel-empty' }

const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'
const SYNC_SIG_KEY = 'sentinel.sync-signature'
const INSTALLED_FLAG_KEY = 'hypercomb.installed'

// ensure side-effect registrations
const _deps = [Store]

type InstallManifest = {
  version: number
  layers: string[]
  bees: string[]
  dependencies: string[]
  beeDeps?: Record<string, string[]>
}

export const ensureInstall = async (sentinel: SentinelBridge | null): Promise<void> => {
  // register the central signature allowlist — scripts in the store skip re-verification
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[ensure-install] Store not registered')
    return
  }

  await store.initialize()

  if (!store.opfsAvailable) {
    console.warn('[ensure-install] OPFS unavailable — skipping install; app will boot without persistence')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    return
  }

  // Read the bundled manifest sig shipped with this build of the web shell.
  // Used to detect a stale OPFS cache when the deployed shell carries
  // newer content than what's installed (e.g., user reloads after a
  // deploy but before DCP has had a chance to push).
  const bundled = await fetchBundledPackage()

  // Fast path: cached install present and intact → boot from cache.
  // Before short-circuiting we ask the sentinel to apply any pending
  // diff so a fresh deploy lands on the next reload instead of waiting
  // for a DCP toggle.
  const cachedManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  const stale = cachedManifest && bundled && bundledDiffersFromCached(bundled, cachedManifest)
  if (stale) {
    console.warn('[ensure-install] bundled package sig differs from cached install — invalidating cache')
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    await purgeStaleOpfsArtifacts(store)
  }
  const usableCache = !stale && cachedManifest && cachedManifest.bees.length > 0
  if (usableCache) {
    const beeOk = await fileExists(store.bees, `${cachedManifest.bees[0]}.js`)
    const beeDepsOk = beeOk && await beeDepValuesPresent(store.dependencies, cachedManifest.beeDeps)
    if (beeOk && beeDepsOk) {
      if (sentinel) {
        try {
          await resyncFromSentinel(sentinel)
        } catch (err) {
          console.warn('[ensure-install] boot resync failed; continuing with cached state', err)
        }
      }
      console.log('[ensure-install] booting from cached state')
      restoreSignatureStore(sigStore)
      restoreCachedBeeDeps()
      // Existing installs predate the flag — adopt them on first cached
      // boot so they don't get punted to the install prompt if the
      // cache is ever invalidated.
      if (localStorage.getItem(INSTALLED_FLAG_KEY) !== 'true') {
        localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
      }
      EffectBus.emit('boot:status', { kind: 'cached' } as BootStatus)
      return
    }
    console.warn('[ensure-install] cached state spot-check failed — wiping and awaiting fresh install')
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    await purgeStaleOpfsArtifacts(store)
  }

  // Sentinel preferred. If unavailable, fall back to installing from the
  // bundled `/content/` shipped with the shell so dev/offline still works.
  if (sentinel) {
    console.log('[ensure-install] cold/refresh boot — awaiting sentinel sync')
    EffectBus.emit('boot:status', { kind: 'installing' } as BootStatus)
    await resyncFromSentinel(sentinel)
  } else if (bundled) {
    console.log('[ensure-install] no sentinel — installing from bundled /content/')
    EffectBus.emit('boot:status', { kind: 'installing' } as BootStatus)
    await installFromBundled(bundled, sigStore)
  } else {
    console.warn('[ensure-install] no sentinel and no bundled content — install needed')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    return
  }

  // After sync: if nothing landed in OPFS, DCP is reachable but has no
  // content for us. Surface as install-needed so the shell prompts the
  // user to install at DCP rather than rendering an empty hex grid.
  const postSyncManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  if (!postSyncManifest || postSyncManifest.bees.length === 0) {
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'sentinel-empty' } as BootStatus)
    return
  }
  EffectBus.emit('boot:status', { kind: 'installed' } as BootStatus)
}

// -------------------------------------------------
// bundled-content fallback — used when sentinel is unreachable, and
// also to detect stale OPFS cache when a new shell deploy lands but
// DCP hasn't pushed yet.
// -------------------------------------------------

type BundledPackage = { packageSig: string; bees: string[]; dependencies: string[]; layers: string[]; beeDeps?: Record<string, string[]> }

const fetchBundledPackage = async (): Promise<BundledPackage | null> => {
  try {
    const res = await fetch('/content/manifest.json', { cache: 'no-store' })
    if (!res.ok) return null
    const content = await res.json() as { packages?: Record<string, { bees?: string[]; dependencies?: string[]; layers?: string[]; beeDeps?: Record<string, string[]> }> }
    const sig = Object.keys(content.packages ?? {})[0]
    if (!sig) return null
    const pkg = content.packages![sig]
    return {
      packageSig: sig,
      bees: pkg.bees ?? [],
      dependencies: pkg.dependencies ?? [],
      layers: pkg.layers ?? [],
      beeDeps: pkg.beeDeps,
    }
  } catch {
    return null
  }
}

const bundledDiffersFromCached = (bundled: BundledPackage, cached: InstallManifest): boolean => {
  if (bundled.bees.length !== cached.bees.length) return true
  const cachedSet = new Set(cached.bees)
  for (const sig of bundled.bees) {
    if (!cachedSet.has(sig)) return true
  }
  return false
}

const installFromBundled = async (bundled: BundledPackage, sigStore: SignatureStore): Promise<void> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) return

  // Mirror resyncFromSentinel's layout exactly: bees/deps in flat dirs,
  // layers under __layers__/sentinel/. This way the boot fast path and
  // script-preloader find content at the same paths regardless of source.
  const layerDir = await store.domainLayersDirectory('sentinel', true)

  const fetchBytes = async (path: string): Promise<ArrayBuffer | null> => {
    try {
      const res = await fetch(path, { cache: 'no-store' })
      if (!res.ok) return null
      return await res.arrayBuffer()
    } catch {
      return null
    }
  }

  const writeAll = async (
    sigs: string[],
    urlFor: (sig: string) => string,
    dir: FileSystemDirectoryHandle,
    nameFor: (sig: string) => string,
  ): Promise<number> => {
    let written = 0
    await Promise.all(sigs.map(async (sig) => {
      const bytes = await fetchBytes(urlFor(sig))
      if (!bytes) return
      const handle = await dir.getFileHandle(nameFor(sig), { create: true })
      const writable = await handle.createWritable()
      await writable.write(bytes)
      await writable.close()
      written++
    }))
    return written
  }

  const beeCount = await writeAll(bundled.bees, (s) => `/content/__bees__/${s}.js`, store.bees, (s) => `${s}.js`)
  const depCount = await writeAll(bundled.dependencies, (s) => `/content/__dependencies__/${s}.js`, store.dependencies, (s) => `${s}.js`)
  const layerCount = await writeAll(bundled.layers, (s) => `/content/__layers__/${s}.json`, layerDir, (s) => s)

  // Mirror the manifest + sync state that resyncFromSentinel would write
  // so the next reload boots through the cached fast path.
  const manifest = { version: 2, layers: bundled.layers, bees: bundled.bees, dependencies: bundled.dependencies, beeDeps: bundled.beeDeps }
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
  localStorage.setItem(SYNC_SIG_KEY, bundled.packageSig)
  localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
  if (bundled.beeDeps) (globalThis as any).__hypercombBeeDeps = bundled.beeDeps
  sigStore.trustAll([...bundled.bees, ...bundled.dependencies, ...bundled.layers])
  localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  console.log(`[ensure-install] bundled install complete: ${bundled.packageSig.slice(0, 12)} (${beeCount}/${bundled.bees.length} bees, ${depCount}/${bundled.dependencies.length} deps, ${layerCount}/${bundled.layers.length} layers)`)
}

/**
 * Wipe stale bees, deps, and layer files from OPFS so the next sync
 * starts from a clean slate. Without this, old artifacts linger in
 * OPFS forever — even after a successful resync — because resync only
 * writes the new files; it never removes signatures that fell out of
 * the manifest. The script-preloader can then still find and load a
 * stale dep with broken Angular code in it.
 */
const purgeStaleOpfsArtifacts = async (store: Store): Promise<void> => {
  const purgeDir = async (dir: FileSystemDirectoryHandle) => {
    const names: string[] = []
    try {
      for await (const [name] of dir.entries()) names.push(name)
    } catch { return }
    for (const name of names) {
      try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
    }
  }
  await Promise.all([purgeDir(store.bees), purgeDir(store.dependencies)])
  try {
    for await (const [, handle] of store.layers.entries()) {
      if (handle.kind === 'directory') await purgeDir(handle as FileSystemDirectoryHandle)
    }
  } catch { /* skip */ }
  // Also drop the SW module cache so refetches aren't served from a stale entry.
  try {
    if ('caches' in self) await caches.delete('hypercomb-modules-v2')
  } catch { /* skip */ }
}

// -------------------------------------------------
// resync — the SOLE install/update path
// -------------------------------------------------

export const resyncFromSentinel = async (sentinel: SentinelBridge): Promise<void> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store || !store.opfsAvailable) return

  const currentSyncSig = (localStorage.getItem(SYNC_SIG_KEY) ?? '').trim() || undefined
  const result = await sentinel.sync(currentSyncSig)
  if (!result) return

  const { syncSig, enabledBees, enabledDeps, enabledLayers, beeDeps, files } = result

  if (!files.length && currentSyncSig === syncSig) return

  const enabledBeeSet = new Set(enabledBees)
  const enabledDepSet = new Set(enabledDeps)
  const enabledLayerSet = new Set(enabledLayers)

  await removeDisabled(store.bees, enabledBeeSet, '.js')
  await removeDisabled(store.dependencies, enabledDepSet, '.js')
  const layerDir = await store.domainLayersDirectory('sentinel', true)
  await removeDisabled(layerDir, enabledLayerSet, '')
  await clearStaleCaches()

  for (const file of files) {
    switch (file.kind) {
      case 'layer':
        await writeBytes(layerDir, file.signature, file.bytes)
        await seedCacheEntry(`/opfs/__layers__/${file.signature}.json`, file.bytes, 'application/json; charset=utf-8')
        break
      case 'bee':
        await writeBytes(store.bees, `${file.signature}.js`, file.bytes)
        await seedCacheEntry(`/opfs/__bees__/${file.signature}.js`, file.bytes, 'application/javascript; charset=utf-8')
        break
      case 'dependency':
        await writeBytes(store.dependencies, `${file.signature}.js`, file.bytes)
        await seedCacheEntry(`/opfs/__dependencies__/${file.signature}.js`, file.bytes, 'application/javascript; charset=utf-8')
        break
    }
  }

  const sigStore = get('@hypercomb/SignatureStore') as SignatureStore | undefined
  if (sigStore) {
    const allSigs = [...enabledBees, ...enabledDeps, ...enabledLayers]
    sigStore.trustAll(allSigs)
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  }

  const syncManifest = { version: 2, layers: enabledLayers, bees: enabledBees, dependencies: enabledDeps, beeDeps }
  localStorage.setItem(SYNC_SIG_KEY, syncSig)
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(syncManifest))
  if (beeDeps) (globalThis as any).__hypercombBeeDeps = beeDeps

  // First successful resync that produced a non-empty install satisfies
  // the cold-boot consent gate. Adding a domain in DCP fires
  // toggle-changed, which lands content here and flips the flag so the
  // post-resync reload boots through the cached fast path.
  if (enabledBees.length > 0 && localStorage.getItem(INSTALLED_FLAG_KEY) !== 'true') {
    localStorage.setItem(INSTALLED_FLAG_KEY, 'true')
  }

  console.log(`[ensure-install] resync complete: ${syncSig.slice(0, 12)} (${enabledBees.length} bees, ${enabledDeps.length} deps, ${enabledLayers.length} layers)`)
}

// ----- helpers -----

const clearStaleCaches = async (): Promise<void> => {
  // Clear Service Worker Cache API — old signature entries are stale after resync
  if ('caches' in self) {
    const deleted = await caches.delete('hypercomb-modules-v2')
    if (deleted) console.log('[ensure-install] cleared SW module cache')
  }
  // Prune signature store — old trusted sigs are irrelevant after resync
  localStorage.removeItem(SIG_STORE_KEY)
}

const tryParseManifest = (json: string): InstallManifest | null => {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      version: parsed.version ?? 0,
      layers: Array.isArray(parsed.layers) ? parsed.layers : [],
      bees: Array.isArray(parsed.bees) ? parsed.bees : [],
      dependencies: Array.isArray(parsed.dependencies) ? parsed.dependencies : [],
      beeDeps: parsed.beeDeps && typeof parsed.beeDeps === 'object' ? parsed.beeDeps : undefined,
    }
  } catch {
    return null
  }
}

const writeBytes = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
}

const seedCacheEntry = async (path: string, bytes: ArrayBuffer, contentType: string): Promise<void> => {
  try {
    const cache = await caches.open('hypercomb-modules-v2')
    const url = new URL(path, location.origin).toString()
    const existing = await cache.match(url)
    if (existing) return

    const headers = new Headers()
    headers.set('content-type', contentType)
    headers.set('cache-control', 'no-store')
    await cache.put(url, new Response(bytes, { headers }))
  } catch {
    // non-fatal
  }
}

/**
 * Remove files from a directory whose signature is NOT in the enabled set.
 * Handles files stored as `{sig}{ext}` or bare `{sig}`.
 */
const removeDisabled = async (
  dir: FileSystemDirectoryHandle,
  enabledSigs: Set<string>,
  ext: string
): Promise<void> => {
  for await (const [name] of dir.entries()) {
    const sig = ext ? name.replace(new RegExp(`\\${ext}$`, 'i'), '') : name
    if (/^[a-f0-9]{64}$/i.test(sig) && !enabledSigs.has(sig)) {
      try { await dir.removeEntry(name) } catch { /* skip */ }
    }
  }
}

// ----- signature store helpers -----

const restoreCachedBeeDeps = (): void => {
  const cached = localStorage.getItem(MANIFEST_KEY)
  if (cached) {
    const m = tryParseManifest(cached)
    if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
  }
}

const restoreSignatureStore = (sigStore: SignatureStore): void => {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY)
    if (!raw) return
    sigStore.restore(JSON.parse(raw))
    console.log(`[ensure-install] signature store restored: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}

const fileExists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

/**
 * Return true when every signature listed across the beeDeps map values
 * is present in the dependencies directory. Empty/absent map → true
 * (nothing to verify). A single missing sig → false (resync).
 */
const beeDepValuesPresent = async (
  depsDir: FileSystemDirectoryHandle,
  beeDeps: Record<string, string[]> | undefined,
): Promise<boolean> => {
  if (!beeDeps) return true
  const seen = new Set<string>()
  for (const list of Object.values(beeDeps)) {
    for (const sig of list ?? []) seen.add(sig)
  }
  for (const sig of seen) {
    if (!await fileExists(depsDir, `${sig}.js`)) return false
  }
  return true
}
