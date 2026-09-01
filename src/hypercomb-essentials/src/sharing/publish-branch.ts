// sharing/publish-branch.ts
//
// THE PUBLISH ROUTINE — one branch, from local head to a link anyone can
// open. Extracted from the `/host` queen so the queen and the publish panel
// drive the SAME sequence; there is exactly one implementation of "put a
// branch into the world", and it is this.
//
// The sequence is unchanged from /host (seal → stage → availability gate →
// index → link), with two additions that make publishing safe to repeat and
// honest to report:
//
//   THE WIPE GUARD. The hive index is replaceable, not mergeable: every PUT
//   carries the complete map, so advancing one branch means rewriting all of
//   them. The original merge read the live index and fell back to `{}` on
//   failure — and `fetchHiveManifest` returns null for EVERY failure, so one
//   flaky GET published an index containing only the branch in hand, silently
//   unpublishing every other branch. `fetchHiveIndex` now reports WHY, and
//   this routine REFUSES to write unless it either verified the existing
//   index or was told 404 (nothing published yet). Refusing costs the
//   participant a retry; guessing costs them every link they have shared.
//
//   THE CONFIRMATION. A PUT that returns 200 proves the host accepted an
//   index, not that the world can see it. The routine re-reads the index with
//   `cache: 'no-store'`, requires the branch's head to be present, and probes
//   that the head bytes are actually served. Only then does it report
//   `confirmed`. A caller may render "published" on `unconfirmed`, but it must
//   not render "live".

import { EffectBus, get } from '@hypercomb/core'
import {
  HIVE_LINK_KIND,
  HIVE_LINK_VERSION,
  PUBLIC_CONTENT_HOSTS,
  encodeHiveLinkBundle,
  type HiveLinkBundle,
} from './hive-link.js'
import { fetchHiveIndex, putHiveManifest } from './hive-pointer.js'
import { lineageKey } from '../history/lineage-key.js'
import { isBranchPublic, setBranchPublic } from '../presentation/tiles/tile-actions.drone.js'
import { knownRoots, writePublishRecord, type PublishRecord } from './publish-heads.js'
import { wornKindsWithin, writePublishLights } from '../commands/publish-lights.js'
import { readGlobalOnKinds } from './behavior-enablement.js'

const STORE_KEY = '@hypercomb.social/Store'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'
const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'

const SIG_RE = /^[a-f0-9]{64}$/
const LOOPBACK_RE = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i
/** Availability wait: closure receipts normally land in seconds; a big
 *  first-time branch can take longer. Past the deadline the drain keeps
 *  retrying detached — publishing just declines to advance the pointer yet. */
const AVAILABILITY_DEADLINE_MS = 120_000
const AVAILABILITY_POLL_MS = 2_500
/** How long to keep re-reading the index for our own advance before calling
 *  it unconfirmed. Short on purpose: an edge that has not caught up in this
 *  window is reported as `unconfirmed`, and the panel re-checks on backoff. */
const CONFIRM_DEADLINE_MS = 20_000
const CONFIRM_POLL_MS = 2_000
/** The link bundle's own receipt wait — the bundle is a separate resource, and
 *  a green branch with a 404 link is still a broken share. */
const BUNDLE_RECEIPT_MS = 12_000

interface StoreLike { putResource: (b: Blob) => Promise<string> }
interface HistoryLike {
  sealSubtree: (segments: readonly string[]) => Promise<string | null>
  healSubtreeBags: (segments: readonly string[]) => Promise<unknown>
}
interface HostSyncLike {
  isEnabled?: () => boolean
  isPublicHostEnabled?: () => boolean
  publicHostDomain?: () => string
  /** Per-branch targets — primary first. Every zone shares one heap and one
   *  index, so these differ only in which door the writes go through. */
  publicHostDomainFor?: (key: string) => string
  publicHostDomainsFor?: (key: string) => string[]
  enablePublicHost?: () => void
  markPublic?: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  drain?: () => Promise<void>
  reDrain?: () => Promise<unknown>
  isClosureAvailable?: (sig: string, kind: string, closure: boolean) => Promise<boolean>
  ensureReceipt?: (sig: string, timeoutMs?: number) => Promise<boolean>
  probeServed?: (host: string, sig: string) => Promise<'served' | 'absent' | 'unknown'>
}
interface SignerLike { getPublicKeyHex?: () => Promise<string | null> }

export type PublishPhase =
  | 'sealing' | 'staging' | 'waiting' | 'indexing' | 'linking' | 'confirming'

export interface PublishProgress {
  phase: PublishPhase
  /** Objects still queued for the host, when known. */
  pending?: number
}

/** Why a publish stopped short. Each maps to one thing the participant can do. */
export type PublishFailure =
  | 'services'        // core services not ready
  | 'no-branch'       // called at the hive root
  | 'seal-failed'     // a child is cold or unresolvable
  | 'no-signer'       // no key to sign the index with
  | 'not-available'   // closure still uploading at the deadline — pointer NOT advanced
  | 'index-unsafe'    // could not verify the existing index — refused to rewrite it
  | 'index-failed'    // the PUT itself failed
  | 'bundle-failed'   // the link resource could not be minted

export type PublishResult =
  | {
      ok: true
      /** `confirmed` = re-read index names this head AND the bytes are served. */
      status: 'confirmed' | 'unconfirmed'
      sealed: string
      pubkey: string
      host: string
      lineageKey: string
      bundleSig: string
      url: string
      /** The link bundle's own receipt landed inside the wait. */
      linkReceipted: boolean
      /** Index keys our ledger knows about that the live index does NOT carry
       *  — evidence of a previous wipe (or a publish from another device).
       *  Reported, never silently re-asserted: resurrecting a branch the
       *  participant deliberately unpublished would be its own kind of lie. */
      missingFromIndex: string[]
    }
  | { ok: false; failure: PublishFailure; reason?: string; sealed?: string }

export interface PublishOptions {
  /** Re-verify receipts and re-stage before waiting. The `markPublic` walk
   *  short-circuits on sigs it already marked THIS SESSION, so a plain retry
   *  after a failure does nothing; the resume/re-push paths need this. */
  forceReDrain?: boolean
  onProgress?: (p: PublishProgress) => void
}

const normalizeHost = (raw: string): string =>
  String(raw ?? '').trim()
    .replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '').toLowerCase()

const selfDomain = (): string => {
  try { return normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '') } catch { return '' }
}

/** The branch's doors in preference order: its own choices (primary first),
 *  then the standing defaults. Every door fronts ONE shared heap and ONE
 *  per-key index. */
const doorsFor = (hostSync: HostSyncLike | undefined, key: string): string[] =>
  [...new Set([
    ...(hostSync?.publicHostDomainsFor?.(key) ?? []),
    ...PUBLIC_CONTENT_HOSTS,
  ])].filter(Boolean)

/** Walk the doors until one ANSWERS — a verified index or an honest 404. A
 *  branch pointed at a zone whose DNS has not landed yet must still publish:
 *  the write lands in the same shared index through any live door, and the
 *  chosen address starts serving the moment its zone does. Only when NO door
 *  answers does the caller see the last failure. */
async function resolveIndexDoor(
  doors: readonly string[],
  pubkey: string,
): Promise<{ host: string; read: Awaited<ReturnType<typeof fetchHiveIndex>> }> {
  let last: { host: string; read: Awaited<ReturnType<typeof fetchHiveIndex>> } | null = null
  for (const host of doors) {
    const read = await fetchHiveIndex(host, pubkey)
    last = { host, read }
    if (read.ok || (read.reason === 'http' && read.status === 404)) return last
  }
  return last ?? { host: '', read: { ok: false, reason: 'unreachable' } as Awaited<ReturnType<typeof fetchHiveIndex>> }
}

/** Publish one branch and record the act. Never throws. */
export async function publishBranch(
  segments: readonly string[],
  options: PublishOptions = {},
): Promise<PublishResult> {
  const report = (p: PublishProgress): void => { try { options.onProgress?.(p) } catch { /* caller's problem */ } }

  const store = get<StoreLike>(STORE_KEY)
  const history = get<HistoryLike>(HISTORY_KEY)
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!store?.putResource || !history?.sealSubtree || !hostSync?.markPublic || !signer?.getPublicKeyHex) {
    return { ok: false, failure: 'services' }
  }

  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return { ok: false, failure: 'no-branch' }
  const name = segs[segs.length - 1] ?? ''

  // 1. This IS the sanctioned public enumerator for the branch — the swarm
  //    walk (if ever on) agrees with the same mark.
  const parentLocation = '/' + segs.slice(0, -1).join('/')
  if (!isBranchPublic(parentLocation, name)) setBranchPublic(parentLocation, name, true)
  hostSync.enablePublicHost?.()

  // 2. THE LIGHTS TRAVEL WITH THE TREE. Stamp the branch root with the
  //    behaviours it is DRESSED IN, BEFORE sealing, so the mark is inside
  //    the closure it describes. A visitor's browser is a fresh install
  //    with no roster: without this it can only guess, and both guesses
  //    are wrong (nothing lit → shaded hexagons and default art;
  //    everything lit → not what the publisher arranged).
  //
  //    Dressed in — NOT the publisher's whole roster: the stamp is the
  //    intersection of the branch's own worn kinds (wornKindsWithin walks
  //    it) with the lights that are on. A legacy hive has ~every kind lit,
  //    and sealing that list dressed every publication in everything — a
  //    visitor's Beehaviors list arrived fully lit, drowning a new
  //    participant in switches for behaviours the site never used.
  //    Best-effort — a publication that cannot carry its lights is still a
  //    publication (census unreadable → the full on-list, the old
  //    behaviour, rather than an empty dressing over a live creation).
  const lit = readGlobalOnKinds()
  if (lit) {
    let lights: string[] = [...lit]
    try {
      const worn = await wornKindsWithin(segs)
      if (worn) lights = [...worn].filter(k => lit.has(k))
    } catch { /* census is best-effort — fall back to the full on-list */ }
    try { await writePublishLights(segs, lights) }
    catch { /* the stamp is a courtesy to the reader, never a gate */ }
  }

  // 3. A merkle-coherent root from LIVE heads; heal once, retry, else fail
  //    loud — never publish a lossy seal.
  report({ phase: 'sealing' })
  let sealed = await history.sealSubtree(segs)
  if (!sealed) {
    try { await history.healSubtreeBags(segs) } catch { /* heal is best-effort */ }
    sealed = await history.sealSubtree(segs)
  }
  if (!sealed || !SIG_RE.test(sealed)) return { ok: false, failure: 'seal-failed' }

  // 4. Stage the sealed closure and start pushing.
  report({ phase: 'staging' })
  await hostSync.markPublic(sealed, 'layer', true)
  if (options.forceReDrain) void hostSync.reDrain?.()
  else void hostSync.drain?.()

  // 5. THE AVAILABILITY GATE — the index only ever names a served head.
  report({ phase: 'waiting' })
  let pending = -1
  const offSync = EffectBus.on<{ pending?: number }>('sync:state', p => {
    if (typeof p?.pending === 'number') pending = p.pending
  })
  let available = false
  const deadline = Date.now() + AVAILABILITY_DEADLINE_MS
  try {
    for (;;) {
      available = (await hostSync.isClosureAvailable?.(sealed, 'layer', true)) === true
      if (available || Date.now() >= deadline) break
      report({ phase: 'waiting', ...(pending >= 0 ? { pending } : {}) })
      await new Promise(r => setTimeout(r, AVAILABILITY_POLL_MS))
    }
  } finally { offSync() }
  if (!available) return { ok: false, failure: 'not-available', sealed }

  // 6. Merge + sign + PUT the index — behind the wipe guard.
  report({ phase: 'indexing' })
  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer', sealed }

  const key = lineageKey(segs)
  // The branch's own doors first; the first that ANSWERS carries the write.
  const { host: indexHost, read } = await resolveIndexDoor(doorsFor(hostSync, key), pubkey)

  let existing: Record<string, string>
  if (read.ok) {
    existing = read.manifest.roots
  } else if (read.reason === 'http' && read.status === 404) {
    // Nothing published under this key yet — an empty map is the TRUTH here,
    // not a guess. This is the only sanctioned path to a `{}` baseline.
    existing = {}
  } else {
    // Unreachable, malformed, or forged. We cannot see what we would be
    // overwriting, so we do not overwrite it.
    return {
      ok: false,
      failure: 'index-unsafe',
      reason: read.reason,
      sealed,
    }
  }

  // What our own ledger says we published that the live index does not carry.
  // Surfaced, never auto-healed: re-asserting would resurrect anything the
  // participant deliberately took down.
  const ledger = await knownRoots(indexHost, pubkey)
  const missingFromIndex = Object.keys(ledger).filter(k => k !== key && !(k in existing))

  const roots = { ...existing, [key]: sealed }
  const put = await putHiveManifest(indexHost, roots)
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason, sealed }

  // 7. The stable bearer link: segments + pubkey + hosts (+ the sealed head
  //    as a cold-index fallback hint).
  report({ phase: 'linking' })
  const self = selfDomain()
  // The branch's own doors first (primary leading), then the standing
  // defaults. All of them front the one shared heap, so every advertised
  // host serves the same bytes — the order is preference, not truth.
  const branchHosts = hostSync.publicHostDomainsFor?.(key) ?? []
  const hosts = [...new Set([
    ...(hostSync.isEnabled?.() && self ? [self] : []),
    ...branchHosts,
    ...PUBLIC_CONTENT_HOSTS,
  ])]
  const bundle: HiveLinkBundle = {
    kind: HIVE_LINK_KIND,
    v: HIVE_LINK_VERSION,
    segments: [...segs],
    pubkey,
    hosts,
    rootSig: sealed,
    createdAt: Date.now(),
  }
  let bundleSig: string
  try { bundleSig = await store.putResource(encodeHiveLinkBundle(bundle)) }
  catch { return { ok: false, failure: 'bundle-failed', sealed } }
  await hostSync.markPublic(bundleSig, 'resource')
  const linkReceipted = (await hostSync.ensureReceipt?.(bundleSig, BUNDLE_RECEIPT_MS)) === true

  const linkHost = normalizeHost(window.location.host) || window.location.host
  const scheme = LOOPBACK_RE.test(linkHost) ? 'http' : 'https'
  const url = `${scheme}://${linkHost}/${bundleSig}`

  // 8. Write the ledger record BEFORE confirming. The PUT already happened —
  //    if the tab closes during confirmation the act still has to be on
  //    record, or the next publish loses the freshness baseline and the wipe
  //    guard loses its evidence.
  const record: PublishRecord = {
    v: 1,
    segments: [...segs],
    lineageKey: key,
    host: indexHost,
    pubkey,
    at: Date.now(),
    indexCreatedAt: put.createdAt,
    bundleSig,
  }
  await writePublishRecord(sealed, record)

  // 9. Confirm: the world must be able to READ what we just wrote.
  report({ phase: 'confirming' })
  const confirmed = await confirmPublished(indexHost, pubkey, key, sealed, hostSync)

  return {
    ok: true,
    status: confirmed ? 'confirmed' : 'unconfirmed',
    sealed,
    pubkey,
    host: indexHost,
    lineageKey: key,
    bundleSig,
    url,
    linkReceipted,
    missingFromIndex,
  }
}

/** Re-read the index (no-store) until it names our head, then prove the head
 *  bytes are actually served. Both halves are required: an index naming a head
 *  nobody serves is exactly the dead link the availability gate exists to
 *  prevent, and served bytes nobody is pointed at are invisible. */
export async function confirmPublished(
  host: string,
  pubkey: string,
  key: string,
  sealed: string,
  hostSync?: HostSyncLike,
): Promise<boolean> {
  const sync = hostSync ?? get<HostSyncLike>(HOST_SYNC_KEY)
  const deadline = Date.now() + CONFIRM_DEADLINE_MS
  for (;;) {
    const read = await fetchHiveIndex(host, pubkey)
    if (read.ok && read.manifest.roots[key] === sealed) {
      // The index is caught up. Now the bytes.
      const served = await sync?.probeServed?.(host, sealed)
      // `unknown` (CORS, 5xx, breaker) is not a failure to confirm the index —
      // but it is not proof of service either, so it does not read confirmed.
      return served === 'served'
    }
    if (Date.now() >= deadline) return false
    await new Promise(r => setTimeout(r, CONFIRM_POLL_MS))
  }
}

/** Remove a branch from the published index. The counterpart to publishing,
 *  and the thing `setBranchPublic(..., false)` never did — un-marking a branch
 *  locally left its index entry standing, so the world kept being handed a
 *  head the participant thought they had withdrawn.
 *
 *  THE HONEST LIMIT, which callers MUST put in front of the participant: this
 *  is not deletion. The closure stays hosted (content-addressed bytes are
 *  never removed), and any link already shared carries `rootSig` as a cold
 *  fallback, so an old link keeps resolving. Removing the index entry stops
 *  the branch being ADVERTISED and stops it tracking future changes; it does
 *  not un-share what was shared. */
export async function unpublishBranch(
  segments: readonly string[],
): Promise<{ ok: true; removed: boolean } | { ok: false; failure: PublishFailure; reason?: string }> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!signer?.getPublicKeyHex) return { ok: false, failure: 'services' }
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return { ok: false, failure: 'no-branch' }

  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }

  const key = lineageKey(segs)
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  // Withdraw through the first of the branch's doors that answers — the same
  // walk publishing takes, against the same shared index.
  const { host: indexHost, read } = await resolveIndexDoor(doorsFor(hostSync, key), pubkey)
  // The same guard as publishing, for the same reason: a rewrite we cannot
  // base on a verified read is a rewrite that drops everything we cannot see.
  if (!read.ok) {
    if (read.reason === 'http' && read.status === 404) return { ok: true, removed: false }
    return { ok: false, failure: 'index-unsafe', reason: read.reason }
  }
  if (!(key in read.manifest.roots)) return { ok: true, removed: false }
  const roots = { ...read.manifest.roots }
  delete roots[key]

  const put = await putHiveManifest(indexHost, roots)
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason }

  // Local mark follows the index, so the two cannot disagree afterwards.
  const parentLocation = '/' + segs.slice(0, -1).join('/')
  const name = segs[segs.length - 1] ?? ''
  if (isBranchPublic(parentLocation, name)) setBranchPublic(parentLocation, name, false)
  return { ok: true, removed: true }
}
