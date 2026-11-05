// sharing/profile-live.ts
//
// The profile's LIVE collaborators — the host, the label, the signer, the store —
// and the face a meeting draws from them. A plain module, not a bee: the
// profile word (profile.queen.ts) and the meeting (hive-meeting.drone.ts) both
// read it, and one bee never imports another (the module build stubs that
// import as empty).

import { fetchHiveIndex, putHiveManifest, setHiveRoot } from './hive-pointer.js'
import { cachedPubkey, readerPubkey } from './head-claim-signer.js'
import { PUBLIC_CONTENT_HOSTS } from './hive-link.js'
import { profileHostUrl, showProfile, PROFILE_NAME_MAX, type ProfileDeps } from './profile.js'

const STORE_KEY = '@hypercomb.social/Store'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
/** The name this hive already goes by on the mesh — read, never written here. */
const USER_LABEL_KEY = 'hc:user-label'
const SIG_RE = /^[0-9a-f]{64}$/

type StoreLike = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
}
type HostSyncLike = {
  publicHostDomain?(): string
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}
type SignerLike = {
  signEvent?(evt: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Record<string, unknown>>
}

const ioc = <T>(key: string): T | undefined => window.ioc?.get?.(key) as T | undefined

/** The host this participant publishes to — one they NAMED, or '' (there is
 *  no default host, jwize 2026-10-11). A set writes only here. */
export const ownHost = (): string => {
  try { return ioc<HostSyncLike>(HOST_SYNC_KEY)?.publicHostDomain?.() || '' }
  catch { return '' }
}

/** Where a show READS: your host, else the public content host — a profile
 *  published there before the default went is still read there. */
export const readHost = (): string => ownHost() || (PUBLIC_CONTENT_HOSTS[0] ?? '')

export const seedLabel = (): string | null => {
  try { return localStorage.getItem(USER_LABEL_KEY) } catch { return null }
}

const bytesOfBlob = async (blob: Blob | null | undefined): Promise<Uint8Array | null> =>
  blob ? new Uint8Array(await blob.arrayBuffer()) : null

/** The live collaborators. Any the hive has not loaded answers as a failure
 *  the set reports; a show needs none of the writers. */
export const liveDeps = (): ProfileDeps => {
  const store = (): StoreLike | undefined => ioc<StoreLike>(STORE_KEY)
  const readLocal = async (sig: string): Promise<Uint8Array | null> => {
    try { return await bytesOfBlob(await store()?.getResourceLocal?.(sig)) } catch { return null }
  }
  return {
    cachedPubkey: () => cachedPubkey(),
    signerPubkey: () => readerPubkey(),
    sign: async event => {
      const signer = ioc<SignerLike>(NOSTR_SIGNER_KEY)
      if (!signer?.signEvent) throw new Error('no Nostr signer is available')
      return signer.signEvent(event)
    },
    readIndex: (host, pubkey) => fetchHiveIndex(host, pubkey),
    readLocal,
    fetchAtom: async (host, sig) => {
      try {
        const res = await fetch(`${profileHostUrl(host)}/${sig}`, { cache: 'no-store' })
        // A page (an SPA fallback answering 200) is not a held atom.
        if (!res.ok || (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) return null
        return new Uint8Array(await res.arrayBuffer())
      } catch { return null }
    },
    put: async bytes => {
      const held = store()
      if (!held?.putResource) throw new Error('the store is not loaded')
      return held.putResource(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/json' }), { emit: false })
    },
    publish: async (host, sigs) => {
      const sync = ioc<HostSyncLike>(HOST_SYNC_KEY)
      if (!sync?.publishAtoms) return { ok: false, error: 'the host service is not loaded' }
      const done = await sync.publishAtoms(host, sigs, readLocal)
      return done.ok ? { ok: true } : { ok: false, error: done.error }
    },
    // The condition rides on setHiveRoot's OWN read — the one its merge is
    // built from — so nothing can land between the check and that merge
    // inside this hive: the write goes ahead only if that read still names
    // what the set started from.
    stamp: async (host, key, sig, expected) => {
      let named: string | null = null
      let changed = false
      const done = await setHiveRoot(host, key, sig, {
        fetchIndex: async (h, pubkey) => {
          const read = await fetchHiveIndex(h, pubkey)
          const root = read.ok ? String(read.manifest.roots[key] ?? '').toLowerCase() : ''
          named = SIG_RE.test(root) ? root : null
          return read
        },
        putManifest: (...args: Parameters<typeof putHiveManifest>) => {
          if (named === expected) return putHiveManifest(...args)
          changed = true
          return Promise.resolve({ ok: false, pubkey: '', createdAt: 0, reason: 'changed' })
        },
      })
      return done.ok ? { ok: true } : changed ? { ok: false, changed: true } : { ok: false, reason: done.reason }
    },
    now: Date.now,
  }
}

/** The name and picture a meeting draws on this person's flower. A profile
 *  name wins; otherwise the name this hive already goes by. Never throws. */
export const ownProfileFace = async (): Promise<{ name: string; picture: string }> => {
  const label = (): string => (seedLabel() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, PROFILE_NAME_MAX)
  const host = readHost()
  if (!host) return { name: label(), picture: '' }
  try {
    const shown = await showProfile(host, liveDeps(), seedLabel)
    if (shown.kind === 'shown') return { name: shown.profile.fields.name || label(), picture: shown.profile.fields.picture ?? '' }
  } catch { /* the label still shows */ }
  return { name: label(), picture: '' }
}
