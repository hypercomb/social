// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.

import { SignatureStore } from '@hypercomb/core'
import { Store, LayerInstaller } from '@hypercomb/shared/core'
import { LocationParser } from '@hypercomb/shared/core/initializers/location-parser'

const AZURE_CONTENT_URL = 'https://storagehypercomb.blob.core.windows.net/content'
const isLocalDev = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const CONTENT_BASE_URL = isLocalDev
  ? `${window.location.origin}/content`
  : AZURE_CONTENT_URL
const FALLBACK_SIGNATURE = '6a09457f907419eb03493cda1d8e43d24a76e8f72acbcdbebd894b4bed5d0c08'
const SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
const INSTALLED_KEY = 'core-adapter.installed-signature'
const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SIG_STORE_KEY = 'hypercomb.signature-store'

// ensure side-effect registrations
const _deps = [Store, LayerInstaller]

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

  const signature = (await resolveLatestSignature()) || FALLBACK_SIGNATURE
  const shouldInstall = await needsInstall(store, signature)

  if (!shouldInstall) {
    console.log('[ensure-install] already installed:', signature)
    restoreSignatureStore(sigStore)
    // Restore beeDeps from cached manifest for lazy loading
    const cached = localStorage.getItem(MANIFEST_KEY)
    if (cached) {
      const m = tryParseManifest(cached)
      if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
      // Ensure markers exist in hypercomb root (idempotent — safe to always run)
      if (m?.bees) await applyBeeMarkers(store, m.bees)
    }
    return
  }

  const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller | undefined
  if (!installer) {
    console.warn('[ensure-install] LayerInstaller not registered')
    return
  }

  // Fetch new manifest to diff against old
  const newManifest = await fetchManifest(signature)

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

  const installUrl = `${CONTENT_BASE_URL}/${signature}`
  const parsed = LocationParser.parse(installUrl)

  await installer.install(parsed)

  // populate the signature store from the install manifest (browser cache hit)
  await populateSignatureStore(sigStore, signature)

  localStorage.setItem(INSTALLED_KEY, signature)
  if (newManifest) {
    localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
    if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
    // Place bee markers in hypercomb.io/ root so ScriptPreloader.find() discovers them
    await applyBeeMarkers(store, newManifest.bees)
  }
  console.log('[ensure-install] done:', signature)
}

// ----- helpers -----

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

const resolveLatestSignature = async (): Promise<string | null> => {
  const text = await fetchText(`${CONTENT_BASE_URL}/latest.txt`)
  return text ? extractSignature(text) : null
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

const fetchManifest = async (signature: string): Promise<InstallManifest | null> => {
  const json = await fetchText(`${CONTENT_BASE_URL}/${signature}/install.manifest.json`)
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

// Place empty marker files in hypercomb.io/ root — one per bee sig.
// ScriptPreloader.find() always scans hypercombRoot, so all markers here
// load globally (same behaviour as hypercomb-dev where bees are instantiated
// directly at startup).
const applyBeeMarkers = async (store: Store, bees: string[]): Promise<void> => {
  let placed = 0
  for (const sig of bees) {
    if (!sig) continue
    try {
      await store.hypercombRoot.getFileHandle(sig, { create: true })
      placed++
    } catch { /* ignore — already exists or unwritable */ }
  }
  if (placed) console.log(`[ensure-install] placed ${placed} bee markers in hypercomb root`)
}

// ----- signature store helpers -----

const populateSignatureStore = async (sigStore: SignatureStore, rootSig: string): Promise<void> => {
  try {
    const url = `${CONTENT_BASE_URL}/${rootSig}/install.manifest.json`
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
