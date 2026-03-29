// meadowverse/src/ensure-install.ts
// runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.

import { SignatureStore } from '@hypercomb/core'
import { Store, LayerInstaller } from '../../hypercomb-shared/core'
import { LocationParser } from '../../hypercomb-shared/core/initializers/location-parser'

const AZURE_CONTENT_URL = 'https://storagemeadowverse.blob.core.windows.net/content'
const isLocalDev = typeof window !== 'undefined'
  && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
const CONTENT_BASE_URL = isLocalDev
  ? `${window.location.origin}/content`
  : AZURE_CONTENT_URL
const SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
const INSTALLED_KEY = 'meadowverse.installed-signature'
const MANIFEST_KEY = 'meadowverse.installed-manifest'
const SIG_STORE_KEY = 'meadowverse.signature-store'

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
  const sigStore = new SignatureStore()
  register('@hypercomb/SignatureStore', sigStore)

  const store = get('@hypercomb.social/Store') as Store | undefined
  if (!store) {
    console.warn('[meadowverse:install] Store not registered')
    return
  }

  await store.initialize()

  const signature = resolveSignatureFromUrl()
    ?? await resolveLatestSignature()
  if (!signature) {
    console.warn('[meadowverse:install] no content signature — add ?content=<sig> or ensure latest.json is served')
    return
  }
  console.log(`[meadowverse:install] active signature: ${signature} (source: ${resolveSignatureFromUrl() ? 'url' : 'latest.json'})`)
  const shouldInstall = await needsInstall(store, signature)

  if (!shouldInstall) {
    console.log('[meadowverse:install] already installed:', signature)
    restoreSignatureStore(sigStore)
    const cached = localStorage.getItem(MANIFEST_KEY)
    if (cached) {
      const m = tryParseManifest(cached)
      if (m?.beeDeps) (globalThis as any).__hypercombBeeDeps = m.beeDeps
    }
    return
  }

  const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller | undefined
  if (!installer) {
    console.warn('[meadowverse:install] LayerInstaller not registered')
    return
  }

  const contentBase = await resolveContentBase(signature)

  const newManifest = await fetchManifest(contentBase, signature)

  const oldManifestJson = localStorage.getItem(MANIFEST_KEY)
  const oldManifest = oldManifestJson ? tryParseManifest(oldManifestJson) : null

  if (oldManifest && newManifest) {
    console.log('[meadowverse:install] incremental update:', signature)
    await removeStale(store.layers, oldManifest.layers, newManifest.layers, '.json')
    await removeStale(store.bees, oldManifest.bees, newManifest.bees, '.js')
    await removeStale(store.dependencies, oldManifest.dependencies, newManifest.dependencies, '.js')
  } else {
    console.log('[meadowverse:install] full install:', signature)
    await clearDirectory(store.layers)
    await clearDirectory(store.bees)
    await clearDirectory(store.dependencies)
  }

  const installUrl = `${contentBase}/${signature}`
  const parsed = LocationParser.parse(installUrl)

  const complete = await installer.install(parsed)

  await populateSignatureStore(sigStore, contentBase, signature)

  if (complete) {
    localStorage.setItem(INSTALLED_KEY, signature)
    if (newManifest) {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
    }
    console.log('[meadowverse:install] done:', signature)
  } else {
    if (newManifest) {
      if (newManifest.beeDeps) (globalThis as any).__hypercombBeeDeps = newManifest.beeDeps
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(newManifest))
    }
    console.warn('[meadowverse:install] install incomplete — will resume on next load')
  }
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

const resolveSignatureFromUrl = (): string | null => {
  const params = new URLSearchParams(window.location.search)
  return extractSignature(params.get('content'))
}

const resolveLatestSignature = async (): Promise<string | null> => {
  const local = await fetchJson(`${CONTENT_BASE_URL}/latest.json`)
  if (local) return extractSignature(local.seed)
  if (isLocalDev) {
    console.log('[meadowverse:install] local latest.json not found, falling back to server')
    const remote = await fetchJson(`${AZURE_CONTENT_URL}/latest.json`)
    return remote ? extractSignature(remote.seed) : null
  }
  return null
}

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.text() : null
  } catch { return null }
}

const fetchJson = async (url: string): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.json() : null
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
  const localManifest = await fetchJson(`${CONTENT_BASE_URL}/manifest.json`)
  if (localManifest?.packages && (localManifest.packages as Record<string, unknown>)[signature]) return CONTENT_BASE_URL
  console.log('[meadowverse:install] content not found locally, using server')
  return AZURE_CONTENT_URL
}

const fetchManifest = async (contentBase: string, signature: string): Promise<InstallManifest | null> => {
  const content = await fetchJson(`${contentBase}/manifest.json`)
  if (!content?.packages) return null
  const pkg = (content.packages as Record<string, unknown>)[signature]
  return pkg ? tryParseManifest(JSON.stringify(pkg)) : null
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

const populateSignatureStore = async (sigStore: SignatureStore, contentBase: string, rootSig: string): Promise<void> => {
  try {
    const res = await fetch(`${contentBase}/manifest.json`)
    if (!res.ok) return
    const content = await res.json()
    const manifest = content?.packages?.[rootSig]
    if (!manifest) return

    const allSigs = [
      ...(manifest.layers || []),
      ...(manifest.bees || []),
      ...(manifest.dependencies || []),
    ].filter(Boolean)

    sigStore.trustAll(allSigs)
    sigStore.trust(rootSig)

    localStorage.setItem(SIG_STORE_KEY, JSON.stringify(sigStore.toJSON()))
    console.log(`[meadowverse:install] signature store populated: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}

const restoreSignatureStore = (sigStore: SignatureStore): void => {
  try {
    const raw = localStorage.getItem(SIG_STORE_KEY)
    if (!raw) return
    sigStore.restore(JSON.parse(raw))
    console.log(`[meadowverse:install] signature store restored: ${sigStore.size} trusted sigs`)
  } catch {
    // non-fatal
  }
}
