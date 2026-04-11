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

export const ensureInstall = async (): Promise<void> => {
  // register the central signature allowlist — scripts in the store skip re-verification
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[ensure-install] Store not registered')
    return
  }

  await store.initialize()

  // ── Fast path: cached OPFS state present → boot instantly, no network ──
  // We compare the cached install signature against the package signature in
  // the local /content/manifest.json. If they match, the OPFS is up to date
  // and we can boot from cache without re-downloading anything. If they differ
  // (a new build was deployed since the last visit) we MUST reinstall — the
  // cached bees still reference dep signatures that no longer exist on the
  // server, and dynamic-importing them either 404s or (if the server returns
  // an SPA HTML fallback) throws a parse error mid-bee.
  //
  // The cheap manifest fetch is one round-trip on warm start. The alternative
  // — boot from cache and hope nothing changed — is what gave us the
  // "Standard Angular field decorators are not supported in JIT mode" runtime
  // error: an old substrate dep file in OPFS, compiled against an earlier
  // shared-import-leaks-Angular bug, kept being loaded forever.
  const cachedManifest = tryParseManifest(localStorage.getItem(MANIFEST_KEY) ?? '')
  if (cachedManifest && cachedManifest.bees.length > 0) {
    const cachedInstallSig = (localStorage.getItem(INSTALLED_KEY) ?? '').trim()
    const remotePackageSig = await fetchLocalPackageSignature()
    const sigsMatch = !!remotePackageSig && !!cachedInstallSig && remotePackageSig === cachedInstallSig
    const spotOk = sigsMatch && await fileExists(store.bees, `${cachedManifest.bees[0]}.js`)
    if (spotOk) {
      console.log(`[ensure-install] booting from cached state (sig ${cachedInstallSig.slice(0, 12)})`)
      restoreSignatureStore(sigStore)
      restoreCachedBeeDeps()
      return
    }
    if (remotePackageSig && cachedInstallSig && remotePackageSig !== cachedInstallSig) {
      console.warn(`[ensure-install] cached install (${cachedInstallSig.slice(0, 12)}) is older than deployed (${remotePackageSig.slice(0, 12)}) — reinstalling`)
    } else {
      console.warn('[ensure-install] cached state spot-check failed, reinstalling')
    }
    localStorage.removeItem(MANIFEST_KEY)
    localStorage.removeItem(INSTALLED_KEY)
    localStorage.removeItem(SYNC_SIG_KEY)
    await purgeStaleOpfsArtifacts(store)
  }

  // ── Cold start: OPFS empty → install directly from DCP's static files ──
  console.log('[ensure-install] OPFS empty — running cold install from DCP')
  await localInstall(store, sigStore)
}

/**
 * Read the package signature from the local /content/manifest.json. The
 * signature is the package key — see pickInstallablePackage for why we
 * prefer the package whose key appears in its own layers[] array (the
 * canonical convention used by build-module).
 *
 * Returns null if the manifest is unreachable, malformed, or empty. Callers
 * should treat null as "can't tell" — fall back to spot-check + reinstall.
 */
const fetchLocalPackageSignature = async (): Promise<string | null> => {
  try {
    const res = await fetch(`${location.origin}/content/manifest.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const json = await res.json()
    return pickInstallablePackage(json?.packages)
  } catch {
    return null
  }
}

/**
 * Wipe stale bees, deps, and layer files from OPFS so the next reinstall
 * starts from a clean slate. Without this, old artifacts linger in OPFS
 * forever — even after a successful reinstall — because localInstall only
 * writes the new files; it never removes signatures that fell out of the
 * manifest. The script-preloader can then still find and load a stale dep
 * with broken Angular code in it.
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
// background sync — runs after Angular bootstraps
// -------------------------------------------------
// Fast HTTP status check first; only loads the sentinel iframe if the
// remote root signature differs from what we have cached.

export type SyncState = 'idle' | 'checking' | 'syncing' | 'complete' | 'error'

export type BackgroundSyncOptions = {
  initSentinel: () => Promise<SentinelBridge | null>
  onState: (state: SyncState, detail?: { changedFiles?: number; error?: string }) => void
}

const DCP_ORIGIN =
  globalThis.location?.hostname === 'localhost'
    ? 'http://localhost:2400'
    : 'https://diamondcoreprocessor.com'

export const backgroundSync = async (options: BackgroundSyncOptions): Promise<void> => {
  const { initSentinel, onState } = options

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) return

  onState('checking')

  // ── Step 1: cheap status check via HTTP fetch (no iframe) ──
  let remoteRootSig: string | null = null
  try {
    const res = await fetch(`${DCP_ORIGIN}/manifest.json`, { cache: 'no-store' })
    if (res.ok) {
      const json = await res.json()
      const sigs = Object.keys(json?.packages ?? {})
      remoteRootSig = sigs[0]?.replace(/\uFEFF/g, '').trim().toLowerCase() ?? null
      if (remoteRootSig && !/^[a-f0-9]{64}$/.test(remoteRootSig)) remoteRootSig = null
    }
  } catch (err) {
    console.warn('[background-sync] status check failed:', err)
    onState('error', { error: 'status check failed' })
    return
  }

  if (!remoteRootSig) {
    console.warn('[background-sync] no remote root signature — skipping')
    onState('idle')
    return
  }

  const cachedRootSig = (localStorage.getItem(REMOTE_ROOT_KEY) ?? '').trim()
  if (cachedRootSig === remoteRootSig) {
    console.log('[background-sync] status unchanged — no work needed')
    onState('idle')
    return
  }

  console.log(`[background-sync] status changed (${cachedRootSig.slice(0, 12) || 'none'} → ${remoteRootSig.slice(0, 12)}) — loading sentinel`)

  // ── Step 2: status differs → load sentinel iframe and run full sync ──
  onState('syncing')

  let sentinel: SentinelBridge | null = null
  try {
    sentinel = await initSentinel()
  } catch (err) {
    console.warn('[background-sync] sentinel init failed:', err)
    onState('error', { error: 'sentinel unreachable' })
    return
  }

  if (!sentinel) {
    onState('error', { error: 'sentinel unreachable' })
    return
  }

  try {
    const changed = await applySentinelSync(store, sentinel)
    localStorage.setItem(REMOTE_ROOT_KEY, remoteRootSig)
    onState('complete', { changedFiles: changed })
    console.log(`[background-sync] complete: ${changed} file(s) updated`)
  } catch (err) {
    console.warn('[background-sync] sync apply failed:', err)
    onState('error', { error: err instanceof Error ? err.message : 'sync failed' })
  }
}

const REMOTE_ROOT_KEY = 'background-sync.remote-root'

/** Run sentinel sync, apply diffs to OPFS, persist new manifest. Returns count of files written. */
const applySentinelSync = async (store: Store, sentinel: SentinelBridge): Promise<number> => {
  const sigStore = get('@hypercomb/SignatureStore') as SignatureStore | undefined

  const currentSyncSig = (localStorage.getItem(SYNC_SIG_KEY) ?? '').trim() || undefined
  const result = await sentinel.sync(currentSyncSig)
  if (!result) return 0

  const { syncSig, enabledBees, enabledDeps, enabledLayers, beeDeps, files } = result

  if (!files.length && currentSyncSig === syncSig) return 0

  const enabledBeeSet = new Set(enabledBees)
  const enabledDepSet = new Set(enabledDeps)
  const enabledLayerSet = new Set(enabledLayers)

  // Remove disabled artifacts so the next reload doesn't passively load them
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

  if (sigStore) {
    const allSigs = [...enabledBees, ...enabledDeps, ...enabledLayers]
    sigStore.trustAll(allSigs)
    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
  }

  const syncManifest = {
    version: 2,
    layers: enabledLayers,
    bees: enabledBees,
    dependencies: enabledDeps,
    beeDeps,
  }

  localStorage.setItem(SYNC_SIG_KEY, syncSig)
  localStorage.setItem(INSTALLED_KEY, syncSig)
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(syncManifest))
  if (beeDeps) (globalThis as any).__hypercombBeeDeps = beeDeps

  return files.length
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

// ----- install verification -----
// Blocks bootstrap until EVERY artifact in the manifest is confirmed present in OPFS.

type VerificationResult = { ok: boolean; missing: string[] }

const verifyInstall = async (store: Store, manifest: InstallManifest | null): Promise<VerificationResult> => {
  if (!manifest) return { ok: true, missing: [] }

  // Collect all domain layer directories upfront
  const layerDirs: FileSystemDirectoryHandle[] = []
  for await (const [, handle] of store.layers.entries()) {
    if (handle.kind === 'directory') layerDirs.push(handle as FileSystemDirectoryHandle)
  }

  // Verify all artifacts in parallel
  const checks = [
    ...manifest.bees.filter(Boolean).map(async sig => {
      const found = await fileExists(store.bees, `${sig}.js`) || await fileExists(store.bees, sig)
      return found ? null : `bee:${sig}`
    }),
    ...manifest.dependencies.filter(Boolean).map(async sig => {
      const found = await fileExists(store.dependencies, `${sig}.js`) || await fileExists(store.dependencies, sig)
      return found ? null : `dependency:${sig}`
    }),
    ...manifest.layers.filter(Boolean).map(async sig => {
      for (const dir of layerDirs) {
        if (await fileExists(dir, sig) || await fileExists(dir, `${sig}.json`)) return null
      }
      return `layer:${sig}`
    }),
  ]

  const results = await Promise.all(checks)
  const missing = results.filter((r): r is string => r !== null)

  if (missing.length) {
    console.error(`[ensure-install] verification failed — ${missing.length} missing artifact(s):`, missing)
  } else {
    console.log(`[ensure-install] verification passed (${manifest.bees.length} bees, ${manifest.dependencies.length} deps, ${manifest.layers.length} layers)`)
  }

  return { ok: missing.length === 0, missing }
}

const fileExists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
  try {
    await dir.getFileHandle(name)
    return true
  } catch {
    return false
  }
}

// ----- local install fallback -----
// Content loads exclusively through the DCP proxy.

const CONTENT_SOURCES = [
  `${location.origin}/content`,
  'https://diamondcoreprocessor.com',
]

/**
 * Pick an installable package signature from a (possibly multi-package) manifest.
 *
 * Historical bug: build-module merged successive build outputs into one
 * manifest.json. The runtime then chose Object.keys(packages)[0], which is the
 * *first inserted* (chronologically oldest) entry — a stale signature whose
 * layer/dependency files no longer exist on disk. Result: install fails with
 * "missing artifact" 404s and the substrate (and everything else) never loads.
 *
 * The build now writes a single-package manifest, but users may already have
 * a stale multi-package manifest in their browser cache or behind a CDN, so
 * the loader has to defend itself. Strategy:
 *
 *   1. If only one package — use it.
 *   2. Otherwise prefer a package whose key appears inside its own layers[]
 *      array (the canonical "rootLayerSig is also a layer" convention used by
 *      build-module).
 *   3. Fall back to the LAST inserted entry — the most recently appended
 *      package is the one the latest build wrote.
 */
const pickInstallablePackage = (packages: unknown): string | null => {
  if (!packages || typeof packages !== 'object') return null
  const keys = Object.keys(packages as Record<string, unknown>)
  if (keys.length === 0) return null
  if (keys.length === 1) return keys[0]
  const pkgs = packages as Record<string, { layers?: string[] }>
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]
    const pkg = pkgs[key]
    if (Array.isArray(pkg?.layers) && pkg.layers.includes(key)) return key
  }
  return keys[keys.length - 1]
}

const localInstall = async (store: Store, sigStore: SignatureStore): Promise<void> => {
  let baseUrl = ''
  let manifest: InstallManifest | null = null
  let packageSig = ''

  for (const source of CONTENT_SOURCES) {
    try {
      const res = await fetch(`${source}/manifest.json`, { cache: 'no-store' })
      if (!res.ok) continue
      const content = await res.json()
      const sig = pickInstallablePackage(content?.packages)
      if (!sig) continue
      manifest = content.packages[sig] as InstallManifest
      baseUrl = source
      packageSig = sig
      console.log(`[ensure-install] using content source: ${source} (package ${sig.slice(0, 12)})`)
      break
    } catch {
      console.warn(`[ensure-install] source unreachable: ${source}`)
    }
  }

  if (!manifest || !baseUrl) {
    console.warn('[ensure-install] no content source available')
    return
  }

  const layerDir = await store.domainLayersDirectory('local', true)

  // Install layers, dependencies, and bees in parallel
  await Promise.all([
    ...manifest.layers.map(async sig => {
      try {
        const res = await fetch(`${baseUrl}/__layers__/${sig}.json`, { cache: 'no-store' })
        if (res.ok) await writeBytes(layerDir, sig, await res.arrayBuffer())
      } catch { /* skip */ }
    }),
    ...manifest.dependencies.map(async sig => {
      try {
        const res = await fetch(`${baseUrl}/__dependencies__/${sig}.js`, { cache: 'no-store' })
        if (res.ok) await writeBytes(store.dependencies, `${sig}.js`, await res.arrayBuffer())
      } catch { /* skip */ }
    }),
    ...manifest.bees.map(async sig => {
      try {
        const res = await fetch(`${baseUrl}/__bees__/${sig}.js`, { cache: 'no-store' })
        if (res.ok) await writeBytes(store.bees, `${sig}.js`, await res.arrayBuffer())
      } catch { /* skip */ }
    }),
  ])

  // Verify all artifacts landed in OPFS before committing
  const verification = await verifyInstall(store, manifest)
  if (!verification.ok) {
    throw new Error(`[ensure-install] local install incomplete — ${verification.missing.length} artifact(s) missing: ${verification.missing.join(', ')}`)
  }

  // Trust all signatures and persist manifest
  const allSigs = [...manifest.bees, ...manifest.dependencies, ...manifest.layers]
  sigStore.trustAll(allSigs)
  localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))

  // INSTALLED_KEY MUST be the package signature, not a bee/layer sig. The
  // fast-path on the next visit fetches /content/manifest.json, picks the
  // current package sig, and compares it against this value. Storing a bee
  // sig instead would always fail to match the deployed package sig and
  // force a reinstall on every page load.
  const installSig = packageSig || (allSigs.length > 0 ? allSigs[0] : 'local')
  localStorage.setItem(SYNC_SIG_KEY, installSig)
  localStorage.setItem(INSTALLED_KEY, installSig)
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest))
  if (manifest.beeDeps) (globalThis as any).__hypercombBeeDeps = manifest.beeDeps

  console.log(`[ensure-install] local install complete: package ${installSig.slice(0, 12)} (${manifest.bees.length} bees, ${manifest.dependencies.length} deps, ${manifest.layers.length} layers)`)
}
