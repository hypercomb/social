// Bootstrap-owned package checkpoints.
//
// Package adoption is append-only: immutable sig-addressed bytes are filled
// first and only the small active-package pointer moves.  A reversible update
// therefore needs to preserve the pointer state, not ask whichever package is
// currently running to snapshot itself.  Keeping this mechanism beside the
// pinned acquisition bootstrap means an old/broken package can never block the
// install of its replacement.

const MANIFEST_KEY = 'core-adapter.installed-manifest'
const SYNC_SIG_KEY = 'sentinel.sync-signature'
const INSTALLED_FLAG_KEY = 'hypercomb.installed'

export const INSTALL_CHECKPOINT_PREFIX = 'hypercomb.install-checkpoint.'
export const INSTALL_CHECKPOINT_INDEX_KEY = 'hypercomb.install-checkpoints'
export const INSTALL_CHECKPOINT_LATEST_KEY = 'hypercomb.install-checkpoint.latest'

type InstallPointerState = {
  manifest: string
  syncSignature: string | null
  installed: string | null
}

export type InstallCheckpoint = {
  version: 1
  name: string
  createdAt: string
  state: InstallPointerState
}

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

const validManifest = (raw: string | null): raw is string => {
  if (!raw) return false
  try {
    const value = JSON.parse(raw) as { bees?: unknown }
    return Array.isArray(value?.bees) && value.bees.length > 0
  } catch {
    return false
  }
}

/** Save an immutable, content-addressed pointer checkpoint and advance only
 * the discovery pointer. Old checkpoints and all package leaves remain. */
export const saveLocalInstallCheckpoint = async (name: string): Promise<string | null> => {
  try {
    const manifest = localStorage.getItem(MANIFEST_KEY)
    if (!validManifest(manifest)) return null

    const checkpoint: InstallCheckpoint = {
      version: 1,
      name: String(name ?? '').trim().slice(0, 200),
      createdAt: new Date().toISOString(),
      state: {
        manifest,
        syncSignature: localStorage.getItem(SYNC_SIG_KEY),
        installed: localStorage.getItem(INSTALLED_FLAG_KEY),
      },
    }
    const serialized = JSON.stringify(checkpoint)
    const sig = await sha256Hex(serialized)

    localStorage.setItem(`${INSTALL_CHECKPOINT_PREFIX}${sig}`, serialized)
    localStorage.setItem(INSTALL_CHECKPOINT_LATEST_KEY, sig)

    // The index is convenience/history discovery, never the checkpoint's
    // authority. If an old malformed index exists, start a fresh index without
    // touching its immutable checkpoint records.
    try {
      const parsed = JSON.parse(localStorage.getItem(INSTALL_CHECKPOINT_INDEX_KEY) ?? '[]')
      const index = Array.isArray(parsed)
        ? parsed.filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
        : []
      if (!index.includes(sig)) index.push(sig)
      localStorage.setItem(INSTALL_CHECKPOINT_INDEX_KEY, JSON.stringify(index))
    } catch {
      localStorage.setItem(INSTALL_CHECKPOINT_INDEX_KEY, JSON.stringify([sig]))
    }

    return sig
  } catch (error) {
    console.warn('[install-checkpoint] package pointer could not be saved', error)
    return null
  }
}

/** Restore one verified pointer checkpoint. Package bytes are never copied or
 * deleted here: the append-only heap already contains the referenced leaves. */
export const restoreLocalInstallCheckpoint = async (sig: string): Promise<boolean> => {
  const normalized = String(sig ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false

  try {
    const serialized = localStorage.getItem(`${INSTALL_CHECKPOINT_PREFIX}${normalized}`)
    if (!serialized || await sha256Hex(serialized) !== normalized) return false
    const checkpoint = JSON.parse(serialized) as Partial<InstallCheckpoint>
    const state = checkpoint?.state
    if (checkpoint?.version !== 1 || !state || !validManifest(state.manifest)) return false

    localStorage.setItem(MANIFEST_KEY, state.manifest)
    if (typeof state.syncSignature === 'string') localStorage.setItem(SYNC_SIG_KEY, state.syncSignature)
    else localStorage.removeItem(SYNC_SIG_KEY)
    if (typeof state.installed === 'string') localStorage.setItem(INSTALLED_FLAG_KEY, state.installed)
    else localStorage.removeItem(INSTALLED_FLAG_KEY)
    return true
  } catch (error) {
    console.warn('[install-checkpoint] package pointer could not be restored', error)
    return false
  }
}
