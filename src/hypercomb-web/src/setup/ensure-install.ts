// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.

import { SignatureStore } from '@hypercomb/core'
import { Store, LayerInstaller } from '@hypercomb/shared/core'
import { LocationParser } from '@hypercomb/shared/core/initializers/location-parser'
import type { SentinelBridge } from './sentinel-bridge'

const AZURE_CONTENT_URL = 'https://storagehypercomb.blob.core.windows.net/content'
const isLocalDev = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const CONTENT_BASE_URL = isLocalDev
  ? `${window.location.origin}/content`
  : AZURE_CONTENT_URL
const SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
const INSTALLED_KEY = 'core-adapter.installed-signature'
const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'
const SYNC_SIG_KEY = 'sentinel.sync-signature'

// ensure side-effect registrations
const _deps = [Store, LayerInstaller]

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

      // Write new/updated files from sentinel
      for (const file of files) {
        switch (file.kind) {
          case 'layer':
            await writeBytes(layerDir, file.signature, file.bytes)
            break
          case 'bee':
            await writeBytes(store.bees, `${file.signature}.js`, file.bytes)
            break
          case 'dependency':
            await writeBytes(store.dependencies, `${file.signature}.js`, file.bytes)
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

      // Clear stale SW cache so removed modules aren't served from cache
      await clearStaleCaches()

      console.log(`[ensure-install] sentinel sync complete: ${syncSig.slice(0, 12)} (${enabledBees.length} bees, ${enabledDeps.length} deps, ${enabledLayers.length} layers)`)
      return
    }

    // Sentinel returned null — fall through to direct fetch
    console.warn('[ensure-install] sentinel sync returned no result — falling back to direct fetch')
  }

  // ── Direct fetch path (fallback when sentinel unavailable) ──
  const signature = resolveSignatureFromUrl()
    ?? await resolveLatestSignature()
  if (!signature) {
    console.warn('[ensure-install] no content signature — add ?content=<sig> or ensure latest.txt is served')
    return
  }
  console.log(`[ensure-install] active signature: ${signature} (source: ${resolveSignatureFromUrl() ? 'url' : 'latest.txt'})`)
  const shouldInstall = await needsInstall(store, signature)

  if (shouldInstall) {
    await clearStaleCaches()
  }

  if (!shouldInstall) {
    console.log('[ensure-install] already installed:', signature)
    restoreSignatureStore(sigStore)
    // Restore beeDeps from cached manifest for lazy loading
    const cached = localStorage.getItem(MANIFEST_KEY)
    if (cached) {
      const m = tryParseManifest(cached)
      if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
      // Manifest already in localStorage — ScriptPreloader reads it directly
    }
    // In local dev, double-check Azure for a newer version the dev server might not have
    if (isLocalDev) {
      const remote = await fetchText(`${AZURE_CONTENT_URL}/latest.txt`)
      const remoteSig = remote ? extractSignature(remote) : null
      if (remoteSig && remoteSig !== signature) {
        console.warn(`[ensure-install] WARNING: remote has newer content (${remoteSig.slice(0, 12)}…) — run build:essentials or deploy:essentials`)
      }
    }
    return
  }

  const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller | undefined
  if (!installer) {
    console.warn('[ensure-install] LayerInstaller not registered')
    return
  }

  // Resolve content base: local if available, Azure as fallback
  const contentBase = await resolveContentBase(signature)

  // Fetch new manifest to diff against old
  const newManifest = await fetchManifest(contentBase, signature)

  // Incremental diff: only clear entries not in new manifest
  const oldManifestJson = localStorage.getItem(MANIFEST_KEY)
  const oldManifest = oldManifestJson ? tryParseManifest(oldManifestJson) : null

  if (oldManifest && newManifest) {
    console.log('[ensure-install] incremental update:', signature)
    await removeStale(store.layers, oldManifest.layers, newManifest.layers, '.json')
    await removeStale(store.bees, oldManifest.bees, newManifest.bees, '.js')
    await removeStale(store.dependencies, oldManifest.dependencies, newManifest.dependencies, '.js')
  } else {
    console.log('[ensure-install] full install:', signature)
    await clearDirectory(store.layers)
    await clearDirectory(store.bees)
    await clearDirectory(store.dependencies)
  }

  const installUrl = `${contentBase}/${signature}`
  const parsed = LocationParser.parse(installUrl)

  const complete = await installer.install(parsed)

  // populate the signature store from the install manifest (browser cache hit)
  await populateSignatureStore(sigStore, contentBase, signature)

  // Only mark as installed if the install actually completed.
  // If incomplete, next load will retry without clearing — the installer
  // skips files that are already present, so it resumes where it left off.
  if (complete) {
    localStorage.setItem(INSTALLED_KEY, signature)
    if (newManifest) {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
      // Manifest already in localStorage — ScriptPreloader reads it directly
    }
    console.log('[ensure-install] done:', signature)
  } else {
    // Still stash beeDeps so partially-installed bees can load this session
    if (newManifest) {
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
      // Persist partial manifest so ScriptPreloader can discover bees
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
    }
    console.warn('[ensure-install] install incomplete — will resume on next load')
  }
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

const needsInstall = async (store: Store, signature: string): Promise<boolean> => {
  const installed = (localStorage.getItem(INSTALLED_KEY) ?? '').trim().toLowerCase()
  if (installed !== signature) return true

  const hasLayers = await hasAny(store.layers)
  const hasBees = await hasAny(store.bees)
  const hasDeps = await hasAny(store.dependencies)
  return !(hasLayers && hasBees && hasDeps)
}

const hasAny = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
  for await (const _ of dir.entries()) return true
  return false
}

const clearDirectory = async (dir: FileSystemDirectoryHandle): Promise<void> => {
  for await (const [name] of dir.entries()) {
    try { await dir.removeEntry(name, { recursive: true }) } catch { /* skip */ }
  }
}

const resolveSignatureFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  return extractSignature(params.get('content'))
}

const resolveLatestSignature = async (): Promise<string | null> => {
  // Try local first (fast in dev), fall back to Azure (always authoritative)
  const local = await fetchText(`${CONTENT_BASE_URL}/latest.txt`)
  if (local) return extractSignature(local)
  if (isLocalDev) {
    console.log('[ensure-install] local latest.txt not found, falling back to server')
    const remote = await fetchText(`${AZURE_CONTENT_URL}/latest.txt`)
    return remote ? extractSignature(remote) : null
  }
  return null
}

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.text() : null
  } catch { return null }
}

const extractSignature = (raw: string | null | undefined): string | null => {
  const text = (raw ?? '').replace(/\uFEFF/g, '').trim()
  if (!text) return null
  const fromPath = text.split('/').filter(Boolean).at(-1) ?? text
  const clean = fromPath.replace(/\.json$/i, '').replace(/\.txt$/i, '')
  return SIGNATURE_REGEX.test(clean) ? clean.toLowerCase() : null
}

const resolveContentBase = async (signature: string): Promise<string> => {
  if (!isLocalDev) return AZURE_CONTENT_URL
  // Check if local content exists for this signature
  const localManifest = await fetchText(`${CONTENT_BASE_URL}/${signature}/install.manifest.json`)
  if (localManifest) return CONTENT_BASE_URL
  console.log('[ensure-install] content not found locally, using server')
  return AZURE_CONTENT_URL
}

const fetchManifest = async (contentBase: string, signature: string): Promise<InstallManifest | null> => {
  const json = await fetchText(`${contentBase}/${signature}/install.manifest.json`)
  return json ? tryParseManifest(json) : null
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

const removeStale = async (
  dir: FileSystemDirectoryHandle,
  oldSigs: string[],
  newSigs: string[],
  ext: string
): Promise<void> => {
  const keep = new Set(newSigs)
  for (const sig of oldSigs) {
    if (keep.has(sig)) continue
    try { await dir.removeEntry(`${sig}${ext}`) } catch { /* already gone */ }
    try { await dir.removeEntry(sig) } catch { /* already gone */ }
  }
}

const writeBytes = async (dir: FileSystemDirectoryHandle, name: string, bytes: ArrayBuffer): Promise<void> => {
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes)
  await writable.close()
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

const populateSignatureStore = async (sigStore: SignatureStore, contentBase: string, rootSig: string): Promise<void> => {
  try {
    const url = `${contentBase}/${rootSig}/install.manifest.json`
    const res = await fetch(url)  // browser cache hit — LayerInstaller just fetched this
    if (!res.ok) return
    const manifest = await res.json()

    const allSigs = [
      ...(manifest.layers || []),
      ...(manifest.bees || []),
      ...(manifest.dependencies || []),
    ].filter(Boolean)

    sigStore.trustAll(allSigs)
    sigStore.trust(rootSig)

    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
    console.log(`[ensure-install] signature store populated: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal — verification falls back to SHA-256 hashing
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
