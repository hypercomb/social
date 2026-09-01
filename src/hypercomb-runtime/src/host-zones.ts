// hypercomb-runtime/src/host-zones.ts
//
// THE DOMAINS YOU CARRY. Adding one is the only act — everything after it is
// a consequence of the bytes, not of another decision.
//
// MOVED HERE FROM THE SHIM (2026-08-31) for the same reason acquisition was:
// both shells need it and neither can import the other. It imports only core.
//
// This is the same `community:hosts` pool essentials writes
// (sharing/community-hosts.ts), shared by ADDRESS —
// `sign('community:hosts')` — and never by import. That direction is not a
// preference: essentials is the thing being ACQUIRED, so the shim cannot
// depend on it and must not try. A pool is data; whichever side is loaded
// reads it, and a host added in the full app is already there when the shim
// boots cold.
//
// The record shape below must stay byte-identical to essentials' — the member
// is NAMED by the hash of its own bytes, so a stray space would mint a second
// member for the same host instead of being the no-op that adding twice is
// supposed to be.

import { SignatureService } from '@hypercomb/core'

// Structural, never imported — see the note in replicate.ts. A second Store
// module here would be a second instance over the same OPFS.
type PoolStore = { getPool(meaning: string): Promise<FileSystemDirectoryHandle | null> }

/** Must match essentials `artifactKindFor('host')` — `visual:<family>:artifact`. */
const HOST_ARTIFACT_KIND = 'visual:host:artifact'
const HOST_FAMILY = 'host'
const COMMUNITY_HOSTS_POOL = 'community:hosts'

/**
 * A hostname reduced to the ZONE it is. Scheme, path, `content.` plumbing and
 * case are not part of the identity, so they are folded out BEFORE the meaning
 * is minted — a signature is forever, and `Hypercomb.com` and
 * `https://content.hypercomb.com/` must not become two different hosts.
 *
 * Dots survive on purpose: the meaning has to round-trip back to a hostname
 * you can visit. A port survives too, so `localhost:4270` is a host you can
 * carry — which is what makes a node able to name itself.
 */
/**
 * THE HOST A SHELL KNOWS BEFORE IT KNOWS ANYTHING.
 *
 * A cold client carries nothing: the `community:hosts` pool is empty, and the
 * drone that seeds it ships INSIDE the package that has not arrived yet. So the
 * shell needs one domain it can reach without having been told — the first
 * thread, and the only bootstrap trust in the chain.
 *
 * It is exactly as much trust as visiting a URL, and no more: everything the
 * domain offers is content-addressed and sha256-verified before admission, so
 * this host can be wrong, hostile or gone and the worst it costs is a boot that
 * falls through to the welcome card.
 *
 * ONE constant, deliberately not a list that could quietly grow — every fresh
 * client contacts this domain on its first run, and that should stay a fact
 * someone decided rather than one that accumulated.
 */
export const DEFAULT_HOST_ZONES: readonly string[] = ['jwize.com']

export const hostZone = (raw: unknown): string => {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return ''
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const hostOnly = withoutScheme.split(/[/?#]/)[0] ?? ''
  const bare = hostOnly.replace(/^content\./, '').replace(/\.+$/, '')
  if (/^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/.test(bare)) return bare
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(bare) ? bare : ''
}

const hostMeaning = (raw: unknown): string => {
  const zone = hostZone(raw)
  return zone ? `${HOST_FAMILY}:${zone}` : ''
}

const zoneOfHostMeaning = (meaning: unknown): string => {
  const text = String(meaning ?? '')
  return text.startsWith(`${HOST_FAMILY}:`) ? hostZone(text.slice(HOST_FAMILY.length + 1)) : ''
}

/** Canonical: sorted keys, no wall clock, so the same zone always mints the
 *  same signature. Adding twice is a no-op; removing needs no index. */
const encodeRecord = (zone: string): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify({
    kind: HOST_ARTIFACT_KIND,
    meaning: hostMeaning(zone),
    payload: { zone: hostZone(zone) },
  })).buffer as ArrayBuffer

const memberName = (zone: string): Promise<string> => SignatureService.sign(encodeRecord(zone))

const pool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const store = window.ioc?.get?.<PoolStore>('@hypercomb.social/Store')
  if (!store?.getPool) return null
  try { return await store.getPool(COMMUNITY_HOSTS_POOL) } catch { return null }
}

/** Every host you carry, alphabetically. The pool IS the set — there is no
 *  roster document to keep in agreement with it, so a half-written add can
 *  only ever mean one host missing, never a list that disagrees. */
export const listHostZones = async (): Promise<string[]> => {
  const dir = await pool()
  if (!dir) return []
  const zones = new Set<string>()
  try {
    for await (const [, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue
      try {
        const text = await (await (handle as FileSystemFileHandle).getFile()).text()
        const zone = zoneOfHostMeaning((JSON.parse(text) as { meaning?: unknown })?.meaning)
        if (zone) zones.add(zone)
      } catch { /* a member that will not parse is not a host */ }
    }
  } catch { return [] }
  return [...zones].sort()
}

/** Add a host. Idempotent — content-addressed, so the same zone lands on the
 *  same member. Returns the normalized zone, or '' when the text was not a
 *  hostname (say so rather than minting an address nobody answers). */
export const addHostZone = async (raw: unknown): Promise<string> => {
  const zone = hostZone(raw)
  if (!zone) return ''
  const dir = await pool()
  if (!dir) return ''
  try {
    const handle = await dir.getFileHandle(await memberName(zone), { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(encodeRecord(zone)) } finally { await writable.close() }
    return zone
  } catch { return '' }
}

/** Drop a host. Nothing else is touched — content already replicated from it
 *  is yours, verified, and does not know where it came from. */
export const removeHostZone = async (raw: unknown): Promise<boolean> => {
  const zone = hostZone(raw)
  if (!zone) return false
  const dir = await pool()
  if (!dir) return false
  try { await dir.removeEntry(await memberName(zone)); return true } catch { return false }
}
