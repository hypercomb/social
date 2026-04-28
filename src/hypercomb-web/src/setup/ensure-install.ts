// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.
//
// Push-only install: the sentinel is the SOLE source of content. Cold
// boot does not pull any HTTP manifest or content; it awaits a sync
// from DCP. Subsequent loads boot from the cached OPFS state and let
// resyncFromSentinel apply incremental updates.

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

  // Fast path: cached install present and intact → boot from cache.
  // Before short-circuiting we ask the sentinel to apply any pending
  // diff so a fresh deploy lands on the next reload instead of waiting
  // for a DCP toggle. Push-only contract is preserved: this calls
  // sentinel.sync(), not an HTTP manifest fetch, and is a no-op when
  // the cached sync signature matches what DCP holds.
  const cachedManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  if (cachedManifest && cachedManifest.bees.length > 0) {
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
    console.warn('[ensure-install] cached state spot-check failed — wiping and awaiting DCP push')
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    await purgeStaleOpfsArtifacts(store)
  }

  // Cold start: OPFS empty. Sentinel is the only legitimate source of
  // content under the push-only contract — there is no HTTP fallback.
  // If the sentinel never came up, the shell shows an "Install via DCP"
  // prompt; resyncAndEnforce will pick up content once DCP comes online.
  if (!sentinel) {
    console.warn('[ensure-install] no sentinel — cold boot has no content; waiting for DCP to come online')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    return
  }

  // Cold-boot consent gate: don't auto-pull on a fresh install. The
  // user installs by going to DCP and adding a domain — that fires
  // toggle-changed, the post-bootstrap resync flips the flag, and the
  // subsequent reload boots from cache through the fast path above.
  if (localStorage.getItem(INSTALLED_FLAG_KEY) !== 'true') {
    console.log('[ensure-install] cold boot — install prompt; waiting for DCP install')
    EffectBus.emit('boot:status', { kind: 'install-needed', reason: 'no-sentinel' } as BootStatus)
    return
  }

  console.log('[ensure-install] cold boot — awaiting sentinel sync')
  EffectBus.emit('boot:status', { kind: 'installing' } as BootStatus)
  await resyncFromSentinel(sentinel)

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
