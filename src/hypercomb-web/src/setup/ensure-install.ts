// hypercomb-web/src/setup/ensure-install.ts
// Runs BEFORE the import map is set, so that OPFS dependencies are written
// before the browser freezes the import-map entries.

import { Store, LayerInstaller } from '@hypercomb/shared/core'
import { LocationParser } from '@hypercomb/shared/core/initializers/location-parser'

const CONTENT_BASE_URL = 'https://storagehypercomb.blob.core.windows.net/content'
const FALLBACK_SIGNATURE = '6a09457f907419eb03493cda1d8e43d24a76e8f72acbcdbebd894b4bed5d0c08'
const SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
const INSTALLED_KEY = 'core-adapter.installed-signature'

// ensure side-effect registrations
const _deps = [Store, LayerInstaller]

export const ensureInstall = async (): Promise<void> => {
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
    return
  }

  console.log('[ensure-install] installing:', signature)
  await clearDirectory(store.layers)
  await clearDirectory(store.drones)
  await clearDirectory(store.dependencies)

  const installUrl = `${CONTENT_BASE_URL}/${signature}`
  const parsed = LocationParser.parse(installUrl)

  const installer = get('@hypercomb.social/LayerInstaller') as LayerInstaller | undefined
  if (!installer) {
    console.warn('[ensure-install] LayerInstaller not registered')
    return
  }

  await installer.install(parsed)
  localStorage.setItem(INSTALLED_KEY, signature)
  console.log('[ensure-install] done:', signature)
}

// ----- helpers -----

const needsInstall = async (store: Store, signature: string): Promise<boolean> => {
  const installed = (localStorage.getItem(INSTALLED_KEY) ?? '').trim().toLowerCase()
  if (installed !== signature) return true

  const hasLayers = await hasAny(store.layers)
  const hasDrones = await hasAny(store.drones)
  const hasDeps = await hasAny(store.dependencies)
  return !(hasLayers && hasDrones && hasDeps)
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
  const candidates = [
    `${CONTENT_BASE_URL}/latest.txt`,
    `${CONTENT_BASE_URL}/latest`,
    `${CONTENT_BASE_URL}/latest.json`,
    `${CONTENT_BASE_URL}/__latest__.txt`,
    `${CONTENT_BASE_URL}/__latest__.json`,
  ]

  for (const url of candidates) {
    const text = await fetchText(url)
    if (!text) continue

    const direct = extractSignature(text)
    if (direct) return direct

    try {
      const json = JSON.parse(text) as Record<string, string>
      const parsed =
        extractSignature(json['signature']) ||
        extractSignature(json['latest']) ||
        extractSignature(json['root'])
      if (parsed) return parsed
    } catch { /* not json */ }
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
