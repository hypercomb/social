// sharing/host-welcome.ts
//
// A ZONE'S CARD — what a front door calls itself — as a pool of meaning.
//
// A host card used to take its name from `welcome.json`, a file staged next to
// the shim. Every zone a worker fronts shares that one origin, so the file could
// only ever name all of them at once, and only whoever could deploy it could
// change it. The card is an atom instead — `{ title, tagline, links }`, carrying
// the zone it names — sent to the host under the participant's key and named in
// their signed index as `welcome:<zone>`. The host gathers every card ever named
// into the pool sign('welcome:<zone>') (hypercomb-relay worker.js
// noteSharedPools), so the history only grows and replicates like any pool,
// and the front door wears the one the zone's own publishers sign now
// (worker.js welcomeCard). jwize 2026-10-07: "it is extensible if it uses
// pools, otherwise it is not".

import { SignatureService } from '@hypercomb/core'
import { setHiveRoot } from './hive-pointer.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

/** The index key — and the pool's meaning — for one zone's card. */
export const welcomeKey = (zone: string): string => `welcome:${zone}`

/** A zone as a card names it: a bare lower-case domain, or '' when it is not one. */
export const welcomeZone = (raw: unknown): string => {
  const zone = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '')
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(zone) ? zone : ''
}

/** The card's bytes: canonical, so the same words always land on the same signature. */
export const welcomeCardBytes = (zone: string, title: string, tagline: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({
    kind: 'host:welcome',
    zone,
    title: title.trim().slice(0, 60),
    tagline: tagline.trim().slice(0, 400),
    links: [],
  }))

type HostSyncLike = {
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
}

/** Send the card to `host` and name it in the signed index as `welcome:<zone>`. */
export async function publishWelcome(host: string, zone: string, title: string, tagline: string): Promise<{ ok: true; sig: string } | { ok: false; reason: string }> {
  const bytes = welcomeCardBytes(zone, title, tagline)
  const sig = await SignatureService.sign(bytes.buffer as ArrayBuffer)
  const sync = get<HostSyncLike>('@diamondcoreprocessor.com/HostSyncService')
  if (!sync?.publishAtoms) return { ok: false, reason: 'host sync is not available here' }
  const sent = await sync.publishAtoms(host, [sig], async wanted => (wanted === sig ? bytes : null))
  if (!sent.ok) return { ok: false, reason: sent.error }
  const stamped = await setHiveRoot(host, welcomeKey(zone), sig)
  return stamped.ok ? { ok: true, sig } : { ok: false, reason: stamped.reason ?? 'the index refused it' }
}
