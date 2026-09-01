// sharing/community-hosts.ts
//
// WHERE A BRANCH PUBLISHES, as the Life Primitive.
//
// A host used to be a string inside a per-branch record, and the panel's list
// was a derived union of every claim any branch had ever made. Two things
// followed, both wrong: a claim was never withdrawn (one mistyped hostname sat
// in the list forever, on every branch), and "the hosts I have" and "where this
// publishes" were the same fact wearing one hat, so you could not have a host
// without publishing to it, or stop publishing without losing the host.
//
// They are two different facts and this module keeps them apart:
//
//   THE COMMUNITY — the hosts you carry. Each one is an ARTIFACT: a record in
//   the `community:hosts` pool, named by its own content. Adding a host mints
//   it; removing deletes it. It holds nothing and names nobody.
//
//   WHERE A BRANCH PUBLISHES — a MARK the branch wears. `host:<zone>` is a
//   relation, `groupSignature` of it is a pure referent (no bytes behind it,
//   by construction), and the branch wears one membership per host. Several
//   marks = several addresses, and `order` rides the mark, so the primary door
//   is just position 0 — an attribute of THIS branch's participation in THIS
//   host, which is exactly where it can honestly live.
//
// Nothing holds a list of branches. Deleting a host from your community leaves
// every branch intact, still naming a host you no longer carry — the doctrine's
// promise, and the reason a typo becomes a thing you delete rather than a claim
// baked into a union. Connected to everything, dependent on nothing.
//
// Full doctrine: documentation/website-artifact-paradigm.md.

import { SignatureService, groupSignature } from '@hypercomb/core'
import {
  artifactKindFor,
  enrollmentsIn,
  familyOfMeaning,
  readCell,
} from '../pheromones/enrollment.js'
import { dropEnrollment, wearEnrollment } from '../pheromones/enrollment-acts.js'

const get = <T,>(key: string): T | undefined => (window as any).ioc?.get?.(key) as T | undefined

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

/** The artifact family. `visual:host:artifact` names one, exactly like
 *  `visual:gallery:artifact` names a gallery — no registration anywhere. */
export const HOST_FAMILY = 'host'

/** The naming kind for a host artifact. */
export const HOST_ARTIFACT_KIND = artifactKindFor(HOST_FAMILY)

/** The pool of meaning that holds the hosts you carry. The colon is required
 *  of every new pool meaning: `lineageKey` folds non-alphanumerics to `-`, so a
 *  colon-bearing meaning can never collide with a lineage sigbag. */
export const COMMUNITY_HOSTS_POOL = 'community:hosts'

type PoolStore = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  getResourceLocal?: (sig: string) => Promise<Blob | null>
  getResourceResolvedLocal?: (sig: string) => Promise<Blob | null>
}
type HistoryLike = {
  sign(l: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(sig: string): Promise<Record<string, unknown> | null>
}

/**
 * A hostname reduced to the ZONE it is. Scheme, path, `content.` plumbing and
 * case are not part of the identity, so they are folded out BEFORE the meaning
 * is minted — a signature is forever, and `Hypercomb.com` and
 * `https://content.hypercomb.com/` must not become two different hosts.
 *
 * Dots survive on purpose: the meaning has to round-trip back to a hostname you
 * can visit, which is why this is not `siteSlug` (it folds every dot to `-`).
 */
export const hostZone = (raw: unknown): string => {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return ''
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const hostOnly = withoutScheme.split(/[/?#]/)[0] ?? ''
  const bare = hostOnly.replace(/^content\./, '').replace(/\.+$/, '')
  // A zone is labels joined by dots. Anything else is a typo, not a host.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) ? bare : ''
}

/** `hypercomb.com` → `host:hypercomb.com`. Empty for anything that is not a
 *  zone, so a malformed entry can never mint a group. */
export const hostMeaning = (raw: unknown): string => {
  const zone = hostZone(raw)
  return zone ? `${HOST_FAMILY}:${zone}` : ''
}

/** `host:hypercomb.com` → `hypercomb.com`; anything else → ''. */
export const zoneOfHostMeaning = (meaning: unknown): string => {
  const text = String(meaning ?? '')
  if (familyOfMeaning(text) !== HOST_FAMILY) return ''
  return hostZone(text.slice(HOST_FAMILY.length + 1))
}

/** The signature that IS the host called `<zone>` — a referent, no bytes. */
export const hostSignature = async (raw: unknown): Promise<string> => {
  const meaning = hostMeaning(raw)
  return meaning ? groupSignature(meaning) : ''
}

// ── the community: the hosts you carry ──────────────────────────────

/** The artifact record for one host. Canonical (sorted keys, no wall clock) so
 *  the same zone always mints the same signature: adding twice is a no-op and
 *  removing needs no index. */
export const hostArtifactRecord = (zone: string): Record<string, unknown> => ({
  kind: HOST_ARTIFACT_KIND,
  meaning: hostMeaning(zone),
  payload: { zone: hostZone(zone) },
})

const encodeRecord = (zone: string): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(hostArtifactRecord(zone))).buffer as ArrayBuffer

/** The pool member name for a host — the signature of its own bytes. */
export const hostArtifactSig = (zone: string): Promise<string> =>
  SignatureService.sign(encodeRecord(zone))

const communityPool = async (): Promise<FileSystemDirectoryHandle | null> => {
  const store = get<PoolStore>(STORE_KEY)
  if (!store?.getPool) return null
  try { return await store.getPool(COMMUNITY_HOSTS_POOL) } catch { return null }
}

/**
 * Every host you carry, alphabetically. The pool IS the set — there is no
 * roster document to keep in agreement with it, so a half-written add can only
 * ever mean one host missing, never a list that disagrees with its members.
 */
export async function listCommunityHosts(): Promise<string[]> {
  const pool = await communityPool()
  if (!pool) return []
  const zones = new Set<string>()
  try {
    for await (const [, handle] of (pool as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    }).entries()) {
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

/** Add a host to your community. Idempotent — the record is content-addressed,
 *  so the same zone lands on the same member. Returns the normalized zone, or
 *  '' when the text was not a hostname (the panel says so rather than minting
 *  an address nobody answers). */
export async function addCommunityHost(raw: unknown): Promise<string> {
  const zone = hostZone(raw)
  if (!zone) return ''
  const pool = await communityPool()
  if (!pool) return ''
  try {
    const name = await hostArtifactSig(zone)
    const handle = await pool.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([encodeRecord(zone)])) } finally { await writable.close() }
    return zone
  } catch { return '' }
}

/** Drop a host from your community. Branches that name it are untouched: they
 *  keep wearing a mark for a host you no longer carry, which is the honest
 *  state and is visible as such. */
export async function removeCommunityHost(raw: unknown): Promise<boolean> {
  const zone = hostZone(raw)
  if (!zone) return false
  const pool = await communityPool()
  if (!pool) return false
  try {
    await pool.removeEntry(await hostArtifactSig(zone))
    return true
  } catch { return false }
}

// ── where a branch publishes: the marks it wears ────────────────────

const cellAt = async (segments: readonly string[]) => {
  const history = get<HistoryLike>(HISTORY_KEY)
  const store = get<PoolStore>(STORE_KEY)
  if (!history?.sign || !history.currentLayerAt || !store?.getResourceLocal) return null
  const locationSig = await history.sign({ explorerSegments: () => [...segments] })
  const layer = locationSig ? await history.currentLayerAt(locationSig) : null
  return readCell(
    store as { getResourceLocal(sig: string): Promise<Blob | null> },
    layer,
    segments,
  )
}

/**
 * The zones this branch publishes to, primary first.
 *
 * Read straight off the marks the branch wears — position 0 is the primary
 * door, and a branch with no marks names nobody (the caller decides what an
 * unset branch rides).
 */
export async function hostsOfBranch(segments: readonly string[]): Promise<string[]> {
  const cell = await cellAt(segments)
  if (!cell) return []
  return enrollmentsIn(cell, HOST_FAMILY)
    .map(e => ({ zone: zoneOfHostMeaning(e.meaning), order: typeof e.order === 'number' ? e.order : Number.POSITIVE_INFINITY }))
    .filter(e => e.zone !== '')
    .sort((a, b) => (a.order === b.order ? a.zone.localeCompare(b.zone) : a.order - b.order))
    .map(e => e.zone)
}

/**
 * Say where this branch publishes: the given zones, in order, primary first.
 *
 * Written as marks — one per host, `order` carrying the position — and every
 * mark the branch was wearing for a host no longer named is dropped. Ordering
 * is a rewrite rather than a diff because position is only meaningful as a
 * whole: two marks claiming position 0 is not a state this can produce.
 */
export async function setBranchHosts(
  segments: readonly string[],
  zones: readonly unknown[],
): Promise<string[]> {
  const wanted: string[] = []
  for (const raw of zones) {
    const zone = hostZone(raw)
    if (zone && !wanted.includes(zone)) wanted.push(zone)
  }
  const current = await hostsOfBranch(segments)
  for (const zone of current) {
    if (wanted.includes(zone)) continue
    const sig = await hostSignature(zone)
    if (sig) await dropEnrollment(segments, sig)
  }
  for (const [index, zone] of wanted.entries()) {
    const sig = await hostSignature(zone)
    if (!sig) continue
    // Re-wearing is how position moves: same group, new order. The slot keeps
    // one copy per record signature, so the old position has to go first.
    await dropEnrollment(segments, sig)
    await wearEnrollment(segments, { sig, meaning: hostMeaning(zone), order: index })
  }
  return wanted
}

/** Add one host to a branch without disturbing the others — it takes the last
 *  position, so choosing a second address never moves your primary door. */
export async function addBranchHost(segments: readonly string[], raw: unknown): Promise<string[]> {
  const zone = hostZone(raw)
  if (!zone) return hostsOfBranch(segments)
  const current = await hostsOfBranch(segments)
  return current.includes(zone) ? current : setBranchHosts(segments, [...current, zone])
}

/** Stop publishing this branch to one host. */
export async function removeBranchHost(segments: readonly string[], raw: unknown): Promise<string[]> {
  const zone = hostZone(raw)
  const current = await hostsOfBranch(segments)
  if (!zone || !current.includes(zone)) return current
  return setBranchHosts(segments, current.filter(z => z !== zone))
}

/** Make one of the branch's hosts its primary door. */
export async function makeBranchHostPrimary(
  segments: readonly string[],
  raw: unknown,
): Promise<string[]> {
  const zone = hostZone(raw)
  const current = await hostsOfBranch(segments)
  if (!zone || !current.includes(zone) || current[0] === zone) return current
  return setBranchHosts(segments, [zone, ...current.filter(z => z !== zone)])
}
