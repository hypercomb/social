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
 *
 * A PORT SURVIVES TOO, and loopback is a zone. That is not a convenience: a
 * machine serving its own hive answers on `localhost:4270`, so without this
 * there is no way to name the host you are running — the one host a
 * participant is most certain about. This MUST stay identical to the shim's
 * `hostZone` (hypercomb-shim/src/bootstrap/hosts.ts): both write the SAME
 * `community:hosts` pool by address, and a host addable in one shell but not
 * the other is a pool the two disagree about.
 */
export const hostZone = (raw: unknown): string => {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return ''
  const withoutScheme = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const hostOnly = withoutScheme.split(/[/?#]/)[0] ?? ''
  const bare = hostOnly.replace(/^content\./, '').replace(/\.+$/, '')
  if (/^(localhost|127(?:\.\d+){3})(:\d{1,5})?$/.test(bare)) return bare
  // A zone is labels joined by dots. Anything else is a typo, not a host.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(bare) ? bare : ''
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

// ── the zone side: who may publish at a host ────────────────────────
//
// documentation/signed-site-bindings.md, Plan A. The directory worker used to
// learn which keys may publish at a zone, and under which titles and lineages,
// from a wrangler variable no client can see, verify or replicate. That fact is
// content now: a BINDING ARTIFACT in the same `community:hosts` pool as the
// hosts, one per zone, named by its own bytes. It holds authority only when the
// zone operator's signed index names it under `binding:<zone>`; a record nobody
// names is bytes in a pool and nothing more. The worker keeps SITE_BINDINGS as
// the fallback, and a lost operator key is recovered by redeploying the
// worker's operator config (decided 2026-09-13).

/** The artifact family — `visual:binding:artifact`, beside `visual:host:artifact`. */
export const BINDING_FAMILY = 'binding'

export const BINDING_ARTIFACT_KIND = artifactKindFor(BINDING_FAMILY)

const SIG_RE = /^[0-9a-f]{64}$/

export interface SitePublisher {
  readonly pubkey: string
  readonly label: string
  readonly primary: boolean
}

/** One bound site, in the shape the directory worker serves it. */
export interface BoundSite {
  readonly host: string
  readonly lineage: string
  readonly title: string
  readonly publishers: readonly SitePublisher[]
  /** Is this host's route deployed? Gates what is advertised, never what is served. */
  readonly routed: boolean
  /** Is `*.<host>` deployed? */
  readonly wildcard: boolean
  /** A same-origin tab mark, when the site declares one. */
  readonly icon?: string
}

export interface ZoneBinding {
  readonly zone: string
  readonly sig: string
  readonly sites: readonly BoundSite[]
}

/** `hypercomb.com` → `binding:hypercomb.com`; '' for anything that is not a zone. */
export const bindingMeaning = (raw: unknown): string => {
  const zone = hostZone(raw)
  return zone ? `${BINDING_FAMILY}:${zone}` : ''
}

/** `binding:hypercomb.com` → `hypercomb.com`; anything else → ''. */
export const zoneOfBindingMeaning = (meaning: unknown): string => {
  const text = String(meaning ?? '')
  if (familyOfMeaning(text) !== BINDING_FAMILY) return ''
  return hostZone(text.slice(BINDING_FAMILY.length + 1))
}

const withinZone = (host: string, zone: string): boolean => host === zone || host.endsWith(`.${zone}`)

/**
 * One site entry, normalized by the SAME rule the directory worker applies to
 * a SITE_BINDINGS entry (`normalizeBinding` in blossom-worker/worker.js). Two
 * rules would be two sources that disagree about one zone, silently — the
 * vector in site-bindings.vector.json pins them together.
 */
export const normalizeBoundSite = (rawHost: unknown, raw: unknown): BoundSite | null => {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const host = String(rawHost || '').trim().toLowerCase()
  const lineage = String(entry['lineage'] || '').split('/').map(s => s.trim()).filter(Boolean).join('/')
  if (!host || !lineage) return null
  const publishers = (Array.isArray(entry['publishers']) ? entry['publishers'] : [])
    .map((value): SitePublisher => {
      const p = (value ?? {}) as Record<string, unknown>
      return {
        pubkey: String(p['pubkey'] || '').toLowerCase(),
        label: String(p['label'] || '').trim(),
        primary: p['primary'] === true,
      }
    })
    .filter(p => SIG_RE.test(p.pubkey))
  const icon = String(entry['icon'] || '').trim()
  return {
    host,
    lineage,
    title: String(entry['title'] || lineage.split('/').at(-1) || 'Published Hypercomb').trim(),
    publishers,
    routed: entry['routed'] !== false,
    wildcard: entry['wildcard'] !== false,
    ...(icon.startsWith('/') && !icon.startsWith('//') ? { icon } : {}),
  }
}

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key])
  return out
}

/** Canonical JSON: keys sorted at every depth, arrays kept in authored order.
 *  Order inside an array is data (the directory lists sites in that order);
 *  order of keys is formatting, so it is folded out. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value))

/** The artifact record for one zone. Sites outside the zone are dropped: a
 *  record speaks for its own zone and nothing beyond it. */
export const bindingArtifactRecord = (zone: unknown, sites: readonly BoundSite[]): Record<string, unknown> | null => {
  const clean = hostZone(zone)
  if (!clean) return null
  return {
    kind: BINDING_ARTIFACT_KIND,
    meaning: bindingMeaning(clean),
    payload: { sites: sites.filter(site => withinZone(site.host, clean)), zone: clean },
  }
}

export const bindingArtifactBytes = (zone: unknown, sites: readonly BoundSite[]): Uint8Array | null => {
  const record = bindingArtifactRecord(zone, sites)
  return record ? new TextEncoder().encode(canonicalJson(record)) : null
}

/** The pool member name for a zone's bindings — the signature of its own bytes. */
export const bindingArtifactSig = async (zone: unknown, sites: readonly BoundSite[]): Promise<string> => {
  const bytes = bindingArtifactBytes(zone, sites)
  return bytes ? SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : ''
}

/**
 * A SITE_BINDINGS value split into one record per zone, keeping the var's
 * order — the migration's first act. A zone is a bound host that no other
 * bound host is a parent of: `revolucion.pluginthematrix.com` belongs to
 * `pluginthematrix.com`, and `hypercomb.com` is its own.
 */
export const bindingRecordsFromSiteBindings = (raw: unknown): Map<string, BoundSite[]> => {
  let parsed = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return new Map() }
  }
  const sites = Object.entries(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {})
    .map(([host, value]) => normalizeBoundSite(host, value))
    .filter((site): site is BoundSite => site !== null)
  const hosts = sites.map(site => site.host)
  const out = new Map<string, BoundSite[]>()
  for (const site of sites) {
    const outermost = hosts.filter(host => withinZone(site.host, host)).sort((a, b) => a.length - b.length)[0]
    const zone = hostZone(outermost)
    if (!zone) continue
    out.set(zone, [...(out.get(zone) ?? []), site])
  }
  return out
}

/** A record read back: its zone and its sites, or null when it is not a
 *  binding artifact for the zone it names. */
export const parseBindingRecord = (record: unknown): { zone: string; sites: BoundSite[] } | null => {
  const r = (record ?? {}) as { kind?: unknown; meaning?: unknown; payload?: { zone?: unknown; sites?: unknown } }
  if (r.kind !== BINDING_ARTIFACT_KIND) return null
  const zone = zoneOfBindingMeaning(r.meaning)
  if (!zone || hostZone(r.payload?.zone) !== zone) return null
  const raw = Array.isArray(r.payload?.sites) ? r.payload.sites as unknown[] : []
  const sites = raw
    .map(value => normalizeBoundSite((value as { host?: unknown } | null)?.host, value))
    .filter((site): site is BoundSite => site !== null && withinZone(site.host, zone))
  return { zone, sites }
}

/**
 * Every zone binding this hive holds, by zone. A member is believed only when
 * its bytes hash to its name — the pool is the set, and a member that is not
 * named by its own bytes is not a member. Authority is not decided here: which
 * record a zone actually serves is the operator's signed index.
 */
export async function listZoneBindings(): Promise<ZoneBinding[]> {
  const pool = await communityPool()
  if (!pool) return []
  const found: ZoneBinding[] = []
  try {
    for await (const [name, handle] of (pool as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    }).entries()) {
      if (handle.kind !== 'file' || !SIG_RE.test(name)) continue
      try {
        const buffer = await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()
        if ((await SignatureService.sign(buffer)) !== name) continue
        const parsed = parseBindingRecord(JSON.parse(new TextDecoder().decode(buffer)))
        if (parsed) found.push({ zone: parsed.zone, sig: name, sites: parsed.sites })
      } catch { /* a member that will not parse is not a binding */ }
    }
  } catch { return [] }
  return found.sort((a, b) => a.zone.localeCompare(b.zone) || a.sig.localeCompare(b.sig))
}

/** Put one zone's bindings in the pool. Idempotent — the same bindings land on
 *  the same member. Returns the member's signature, or '' when nothing could
 *  be written. Naming it from the operator's index is a separate act. */
export async function addZoneBinding(zone: unknown, sites: readonly BoundSite[]): Promise<string> {
  const bytes = bindingArtifactBytes(zone, sites)
  const pool = await communityPool()
  if (!bytes || !pool) return ''
  try {
    const name = await bindingArtifactSig(zone, sites)
    const handle = await pool.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer])) } finally { await writable.close() }
    return name
  } catch { return '' }
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
