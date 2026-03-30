// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.

import { SignatureStore } from '@hypercomb/core'
import { Store } from '@hypercomb/shared/core'
import type { SentinelBridge } from './sentinel-bridge'

const INSTALLED_KEY = 'core-adapter.installed-signature'
const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'
const SYNC_SIG_KEY = 'sentinel.sync-signature'

// ensure side-effect registrations
const _deps = [Store]

type InstallManifest = {
  version: number
  layers: string[]
  bees: string[]
  dependencies: string[]
  beeDeps?: Record<string, string[]>
}

export const ensureInstall = async (sentinel?: SentinelBridge | null): Promise<void> => {
  // register the central signature allowlist — scripts in the store skip re-verification
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[ensure-install] Store not registered')
    return
  }

  await store.initialize()

  // ── Sentinel path: DCP handles all server contact ──
  // Uses sync (toggle-aware) — web becomes a snapshot of DCP's enabled state
  if (sentinel) {
    const currentSyncSig = (localStorage.getItem(SYNC_SIG_KEY) ?? '').trim() || undefined
    const result = await sentinel.sync(currentSyncSig)

    if (result) {
      const { syncSig, enabledBees, enabledDeps, enabledLayers, beeDeps, files } = result

      // Short-circuit: already in sync
      if (!files.length && currentSyncSig === syncSig) {
        console.log('[ensure-install] sentinel sync — already in sync:', syncSig.slice(0, 12))
        restoreSignatureStore(sigStore)
        const cached = localStorage.getItem(MANIFEST_KEY)
        if (cached) {
          const m = tryParseManifest(cached)
          await seedManifestCache(store, m)
          if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
        }
        return
      }

      // Compute what web currently has vs what DCP says should be enabled
      const enabledBeeSet = new Set(enabledBees)
      const enabledDepSet = new Set(enabledDeps)
      const enabledLayerSet = new Set(enabledLayers)

      // Remove bees that are no longer enabled
      await removeDisabled(store.bees, enabledBeeSet, '.js')
      // Remove deps that are no longer enabled
      await removeDisabled(store.dependencies, enabledDepSet, '.js')
      // Remove layers that are no longer enabled
      const layerDir = await store.domainLayersDirectory('sentinel', true)
      await removeDisabled(layerDir, enabledLayerSet, '')

      // Clear stale SW cache before seeding freshly synced artifacts.
      await clearStaleCaches()

      // Write new/updated files from sentinel
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

      // Populate signature store
      const allSigs = [...enabledBees, ...enabledDeps, ...enabledLayers]
      sigStore.trustAll(allSigs)
      localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))

      // Build a manifest matching what's now installed
      const syncManifest = {
        version: 2,
        layers: enabledLayers,
        bees: enabledBees,
        dependencies: enabledDeps,
        beeDeps
      }

      // Mark synced — transaction complete
      localStorage.setItem(SYNC_SIG_KEY, syncSig)
      localStorage.setItem(INSTALLED_KEY, syncSig)
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(syncManifest))
      if (beeDeps) (globalThis as any).__hypercombBeeDeps = beeDeps

      console.log(`[ensure-install] sentinel sync complete: ${syncSig.slice(0, 12)} (${enabledBees.length} bees, ${enabledDeps.length} deps, ${enabledLayers.length} layers)`)
      return
    }

    // Sentinel returned null — no direct fetch fallback, use cached OPFS state
    console.warn('[ensure-install] sentinel sync returned no result — using cached OPFS state')
    restoreSignatureStore(sigStore)
    restoreCachedBeeDeps()
    await seedManifestCache(store, tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? ''))
    return
  }

  // No sentinel available — DCP is the sole gateway for executable content.
  // Operate with whatever is already in OPFS from a previous successful sync.
  console.warn('[ensure-install] no sentinel available — using cached OPFS state (DCP required for new content)')
  restoreSignatureStore(sigStore)
  restoreCachedBeeDeps()
  await seedManifestCache(store, tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? ''))
}

// -------------------------------------------------
// resync — callable after DCP portal install
// -------------------------------------------------

export const resyncFromSentinel = async (sentinel: SentinelBridge): Promise<void> => {
  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) return

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
  localStorage.setItem(INSTALLED_KEY, syncSig)
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(syncManifest))
  if (beeDeps) (globalThis as any).__hypercombBeeDeps = beeDeps

  console.log(`[ensure-install] resync complete: ${syncSig.slice(0, 12)} (${enabledBees.length} bees, ${enabledDeps.length} deps, ${enabledLayers.length} layers)`)
}

// ----- helpers -----

const clearStaleCaches = async (): Promise<void> => {
  // Clear Service Worker Cache API — old signature entries are stale after reinstall
  if ('caches' in self) {
    const deleted = await caches.delete('hypercomb-modules-v2')
    if (deleted) console.log('[ensure-install] cleared SW module cache')
  }
  // Prune signature store — old trusted sigs are irrelevant after reinstall
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

const seedManifestCache = async (store: Store, manifest: InstallManifest | null): Promise<void> => {
  if (!manifest) return

  await Promise.all([
    seedDirEntries(store.bees, manifest.bees, '/opfs/__bees__', '.js', 'application/javascript; charset=utf-8'),
    seedDirEntries(store.dependencies, manifest.dependencies, '/opfs/__dependencies__', '.js', 'application/javascript; charset=utf-8'),
    seedLayerEntries(store, manifest.layers),
  ])
}

const seedDirEntries = async (
  dir: FileSystemDirectoryHandle,
  signatures: string[],
  basePath: string,
  suffix: string,
  contentType: string
): Promise<void> => {
  for (const signature of signatures) {
    try {
      const handle = await dir.getFileHandle(`${signature}${suffix}`)
      const file = await handle.getFile()
      await seedCacheEntry(`${basePath}/${signature}${suffix}`, await file.arrayBuffer(), contentType)
    } catch {
      // skip missing cached artifact
    }
  }
}

const seedLayerEntries = async (store: Store, signatures: string[]): Promise<void> => {
  if (!signatures.length) return

  for await (const [domain, handle] of store.layers.entries()) {
    if (handle.kind !== 'directory') continue
    for (const signature of signatures) {
      try {
        const fileHandle = await (handle as FileSystemDirectoryHandle).getFileHandle(signature)
        const file = await fileHandle.getFile()
        await seedCacheEntry(`/opfs/__layers__/${signature}.json`, await file.arrayBuffer(), 'application/json; charset=utf-8')
      } catch {
        // continue searching other domain layer directories
      }
    }
  }
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
