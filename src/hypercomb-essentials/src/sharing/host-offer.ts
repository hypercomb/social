// sharing/host-offer.ts
//
// OFFER ONE THING TO A HOST UNDER YOUR OWN KEY. Put the bytes, ship them to the
// host's zone root, and name them in this hive's own signed index there under a
// key. The shape every contribution to a pool takes: a translation catalog
// (`i18n:<locale>`, community-translations.ts) and a page contribution
// (`page:<base>`, page-contributions.ts). The host vouches for nothing — the
// signature on the index is the contributor's — and a host lists the claims at
// the pool's derived address.

import { setHiveRoot } from './hive-pointer.js'

export interface HostOfferDeps {
  put(text: string, type: string): Promise<string>
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
  now(): number
}

type StoreLike = {
  putResource?(blob: Blob, options?: { emit?: boolean }): Promise<string>
  getResourceLocal?(sig: string): Promise<Blob | null>
  getResource?(sig: string): Promise<Blob | null>
}
type HostSyncLike = {
  publishAtoms?(host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>):
    Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string }>
}

/** What this hive offers with: its store to put, its host service to ship, its
 *  key to stamp. Null when the store or the host service is not loaded. */
export const hostOfferDeps = (): HostOfferDeps | null => {
  const s = window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
  const sync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as HostSyncLike | undefined
  const putResource = s?.putResource?.bind(s)
  const publishAtoms = sync?.publishAtoms?.bind(sync)
  if (!putResource || !publishAtoms) return null
  const bytesOf = async (sig: string): Promise<Uint8Array | null> => {
    const blob = await (s?.getResourceLocal?.(sig).catch(() => null) ?? Promise.resolve(null)) ?? await (s?.getResource?.(sig).catch(() => null) ?? Promise.resolve(null))
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  }
  return {
    put: (text, type) => putResource(new Blob([text], { type }), { emit: false }),
    publish: async (h, sigs) => { const done = await publishAtoms(h, sigs, bytesOf); return done.ok ? { ok: true } : { ok: false, error: done.error } },
    stamp: (h, key, sig) => setHiveRoot(h, key, sig),
    now: Date.now,
  }
}
