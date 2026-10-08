// sharing/publish-branch.ts
//
// THE PUBLISH ROUTINE — one branch, from local head to a link anyone can
// open. The share-sheet gesture and the Publish panel drive the SAME sequence;
// there is exactly one implementation of "put a branch into the world", and
// it is this.
//
// The sequence is unchanged (seal → stage → availability gate →
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

import { EffectBus, get, mintMetaEnvelope } from '@hypercomb/core'
import {
  HIVE_LINK_KIND,
  HIVE_LINK_VERSION,
  PUBLIC_CONTENT_HOSTS,
  encodeHiveLinkBundle,
  type HiveLinkBundle,
} from './hive-link.js'
import { fetchHiveIndex, fetchHiveManifestFromAny, nip98Header, putHiveManifest } from './hive-pointer.js'
import {
  STAGE_LIVE,
  STAGE_PUBLISHED,
  STAGE_SHARED,
  advanceStage,
  stageRootKey,
  withdrawStage,
  type StageWord,
} from './stage-succession.js'
import { isReservedRootKey } from './hive-link.js'
import {
  ENTRANCES_MAX, ENTRANCE_POWERS, boundLineage, creationUrl, entranceHost, foldContentLabel, isPoweredEntrance, ownAddressHost,
  ownAddressRefusal, readEntrance, readEntrances, withOwnAddress, zoneDoor, type ZoneEntrance, type ZoneEntranceFrom,
} from './zone-door.js'
import type { ModuleAssessmentRecord } from '../assistant/module-review.js'

/** The heads the index names under its branch keys — what a stage list may
 *  hold (deployment-stages.md R2: a list is reconciled against the index). */
const indexedHeads = (roots: Record<string, string>): Set<string> =>
  new Set(Object.entries(roots)
    .filter(([k, v]) => !isReservedRootKey(k) && SIG_RE.test(String(v ?? '').toLowerCase()))
    .map(([, v]) => String(v).toLowerCase()))

/** The indexed heads whose branch opens on at least one domain — the `live` list. */
const liveHeadsOf = (roots: Record<string, string>, doors: Record<string, readonly string[]>): Set<string> =>
  new Set(Object.entries(roots)
    .filter(([k, v]) => !isReservedRootKey(k) && SIG_RE.test(String(v ?? '').toLowerCase()) && (doors[k] ?? []).length > 0)
    .map(([, v]) => String(v).toLowerCase()))
import { lineageKey } from '../history/lineage-key.js'
import { hostsOfBranch } from './community-hosts.js'
import { isBranchPublic, setBranchPublic } from '../presentation/tiles/tile-public.js'
import { knownRoots, listPublishRecords, writePublishRecord, type PublishRecord } from './publish-heads.js'
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

interface StoreLike { putResource: (b: Blob, options?: { emit?: boolean }) => Promise<string> }
interface HistoryLike {
  sealSubtree: (segments: readonly string[]) => Promise<string | null>
}
interface HostSyncLike {
  isEnabled?: () => boolean
  isPublicHostEnabled?: () => boolean
  publicHostDomain?: () => string
  /** Name the nodes THIS publish puts its bytes on (host-sync.service). */
  addPublishNodes?: (domains: readonly string[]) => void
  markPublic?: (sig: string, kind?: string, closure?: boolean) => Promise<void>
  drain?: () => Promise<void>
  reDrain?: () => Promise<unknown>
  isClosureAvailable?: (sig: string, kind: string, closure: boolean) => Promise<boolean>
  /** Available on one of THESE hosts (the nodes this publish writes to). */
  isClosureAvailableOn?: (sig: string, kind: string, closure: boolean, domains: readonly string[]) => Promise<boolean>
  ensureReceipt?: (sig: string, timeoutMs?: number) => Promise<boolean>
  probeServed?: (host: string, sig: string) => Promise<'served' | 'absent' | 'unknown'>
  /** Publish these atoms to one host now, read back by hash (host-sync). */
  publishAtoms?: (host: string, sigs: readonly string[], bytesOf: (sig: string) => Promise<Uint8Array | null>) =>
    Promise<{ ok: true } | { ok: false; error: string }>
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
  | 'no-host'         // nowhere to put the bytes: no node named, none standing, or none answering
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
      /** The link bundle on this shell's origin — the adopt/invite link. */
      url: string
      /** WHERE THE CREATION LIVES — the share link: its own address on the
       *  primary domain when it has one, else that domain's root path
       *  (`https://<zone>/<path>`). */
      address: string
      /** The link bundle's own receipt landed inside the wait. */
      linkReceipted: boolean
      /** Index keys our ledger knows about that the live index does NOT carry
       *  — evidence of a previous wipe (or a publish from another device).
       *  Reported, never silently re-asserted: resurrecting a branch the
       *  participant deliberately unpublished would be its own kind of lie. */
      missingFromIndex: string[]
      /** The stage lists this act advanced (documentation/deployment-stages.md):
       *  `listed` = a new succession, its pointer in this index write;
       *  `unchanged` = the list already named this head; `refused` = no
       *  identity or signature — the publish stands, the pointer is absent. */
      stages: Partial<Record<StageWord, 'listed' | 'unchanged' | 'refused'>>
      /** Every advanced succession (and its envelopes) holds a receipt on the
       *  host — a stranger reading the pointer finds the atom. */
      stagesReceipted: boolean
    }
  | { ok: false; failure: PublishFailure; reason?: string; sealed?: string }

export interface PublishOptions {
  /** Re-verify receipts and re-stage before waiting. The `markPublic` walk
   *  short-circuits on sigs it already marked THIS SESSION, so a plain retry
   *  after a failure does nothing; the resume/re-push paths need this. */
  forceReDrain?: boolean
  onProgress?: (p: PublishProgress) => void
  /** Stage lists to advance in the same act besides `published` —
   *  `publish here` (the offering act) passes `['shared']`. */
  stages?: readonly StageWord[]
}

const normalizeHost = (raw: string): string =>
  String(raw ?? '').trim()
    .replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '').toLowerCase()

const selfDomain = (): string => {
  try { return foldContentLabel(normalizeHost(localStorage.getItem(SELF_DOMAIN_KEY) ?? '')) } catch { return '' }
}

/** The nodes a branch is served from: its host marks (primary first) as
 *  zone ROOTS, else the participant's STANDING targets — never anything
 *  flipped on for the occasion. Every node is a write door, so every one is
 *  a zone root: the `content.<zone>` face is retired, and a stored one (an
 *  install from before the retirement) is read as its zone (zone-door.ts). */
export const nodesFor = async (segs: readonly string[], hostSync: HostSyncLike | undefined): Promise<string[]> => {
  let branchZones: string[] = []
  try { branchZones = await hostsOfBranch(segs) } catch { /* no marks — the standing targets remain */ }
  const self = selfDomain()
  const standing = [
    ...(hostSync?.isEnabled?.() && self ? [self] : []),
    ...(hostSync?.isPublicHostEnabled?.() ? [zoneDoor(hostSync.publicHostDomain?.() || PUBLIC_CONTENT_HOSTS[0] || '')] : []),
  ]
  return [...new Set([...branchZones.map(zoneDoor), ...standing])].filter(Boolean)
}

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

  // 1b. WHERE THE BYTES GO: the branch's published nodes, THIS act. A publish
  //     is one act with two halves — put the bytes where the branch is served
  //     from, then advance the index — and both belong to this press. The
  //     nodes are the branch's own host marks (primary first) from the
  //     community pool, and when it wears none, the participant's STANDING
  //     targets (own host, public host) as they already are. Nothing is
  //     flipped on: this used to call `enablePublicHost()` unconditionally,
  //     even over an explicit opt-out — a standing rule set by a press that
  //     was about one branch (write-conformance check 10, adjudication).
  //     Available = the node's index door answers (a verified index or an
  //     honest 404). A node that is down is skipped for this publish and
  //     named in the result; with no node at all, the publish stops and says
  //     so — it never picks a host the participant did not.
  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }
  const nodes = await nodesFor(segs, hostSync)
  if (nodes.length === 0) return { ok: false, failure: 'no-host', reason: 'no node named' }
  const answering: string[] = []
  const unreachable: string[] = []
  for (const door of nodes) {
    const read = await fetchHiveIndex(door, pubkey)
    // Answered = anything but a transport failure. A forged, malformed or
    // 5xx index is a node that IS there, and the wipe guard below must see
    // it as such (index-unsafe), never as an absent node.
    if (read.ok || read.reason !== 'unreachable') answering.push(door)
    else unreachable.push(door)
  }
  if (answering.length === 0) return { ok: false, failure: 'no-host', reason: `no node answered (${unreachable.join(', ')})` }
  hostSync.addPublishNodes?.(answering)

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

  // 3. A merkle-coherent root from LIVE heads, else fail loud — never
  //    publish a lossy seal, and never auto-heal on the way (see step 6).
  report({ phase: 'sealing' })
  const sealed = await history.sealSubtree(segs)
  if (!sealed || !SIG_RE.test(sealed)) return { ok: false, failure: 'seal-failed' }

  // 4. Stage the sealed closure and start pushing.
  report({ phase: 'staging' })
  await hostSync.markPublic(sealed, 'layer', true)
  if (options.forceReDrain) void hostSync.reDrain?.()
  else void hostSync.drain?.()

  // 5. THE AVAILABILITY GATE — the index only ever names a served head.
  //    Served by the nodes THIS publish writes to: a joined participant's
  //    meeting host takes the closure first (it leads the drain), and its
  //    receipts say nothing about the node whose index is about to name the
  //    branch. So the question is asked of the answering nodes, and the
  //    progress counts only what they still owe.
  report({ phase: 'waiting' })
  const nodeSet = new Set(answering.map(d => foldContentLabel(String(d).toLowerCase())))
  let pending = -1
  const offSync = EffectBus.on<{ pending?: number; host?: string }>('sync:state', p => {
    if (typeof p?.pending !== 'number') return
    if (p.host && !nodeSet.has(foldContentLabel(String(p.host).toLowerCase()))) return
    pending = p.pending
  })
  const availableOnNodes = async (): Promise<boolean> => hostSync.isClosureAvailableOn
    ? (await hostSync.isClosureAvailableOn(sealed, 'layer', true, answering)) === true
    : (await hostSync.isClosureAvailable?.(sealed, 'layer', true)) === true
  let available = false
  const deadline = Date.now() + AVAILABILITY_DEADLINE_MS
  try {
    for (;;) {
      available = await availableOnNodes()
      if (available || Date.now() >= deadline) break
      report({ phase: 'waiting', ...(pending >= 0 ? { pending } : {}) })
      await new Promise(r => setTimeout(r, AVAILABILITY_POLL_MS))
    }
  } finally { offSync() }
  if (!available) return { ok: false, failure: 'not-available', sealed }

  // 6. Merge + sign + PUT the index — behind the wipe guard.
  report({ phase: 'indexing' })
  const key = lineageKey(segs)
  // The nodes that answered, primary first; the first that still answers
  // carries the write.
  const { host: indexHost, read } = await resolveIndexDoor(answering, pubkey)

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

  // THE DOORS: where this branch opens. The branch's own host marks when it
  // wears any (the panel's per-domain switches write those marks), else the
  // entry it already had — every other branch's doors ride through as-is.
  const doors = { ...(read.ok ? read.manifest.doors ?? {} : {}) }
  let marked: string[] = []
  try { marked = await hostsOfBranch(segs) } catch { /* no marks — keep what the index says */ }
  if (marked.length > 0) doors[key] = marked

  // THE STAGE LISTS (documentation/deployment-stages.md R2, R3). `published`
  // always; whatever else the act names (`join` names `shared`). Each list is
  // the author's next succession with THIS head as the member and the branch's
  // previous head dropped; its pointer `stage:<word>` rides THIS index write —
  // one signature, two pointers, never two facts. A refused signature does not
  // fail the publish: the pointer is simply absent and the result says so.
  // A list is RECONCILED against the index every time it is written: a head
  // no non-reserved key names any more (this branch's previous head, an
  // orphan a failed write left, a republished door) is dropped — so a stale
  // member never lingers and identity needs no field beyond the head.
  const nextRoots: Record<string, string> = { ...existing, [key]: sealed }
  const indexed = indexedHeads(nextRoots)
  const liveHeads = liveHeadsOf(nextRoots, doors)
  const opensHere = (doors[key] ?? []).length > 0
  const stageWords: StageWord[] = [STAGE_PUBLISHED]
  for (const word of options.stages ?? []) if (!stageWords.includes(word)) stageWords.push(word)
  if (opensHere && !stageWords.includes(STAGE_LIVE)) stageWords.push(STAGE_LIVE)
  const stages: Partial<Record<StageWord, 'listed' | 'unchanged' | 'refused'>> = {}
  const stageRoots: Record<string, string> = {}
  const stageAtoms: string[] = []
  for (const word of stageWords) {
    const keep = word === STAGE_LIVE ? (h: string) => liveHeads.has(h) : (h: string) => indexed.has(h)
    // The author key is the one this act signs with — never a cache some
    // other gesture may or may not have primed.
    const advanced = await advanceStage(word, { add: [sealed], keep }, { pubkey })
    if (!advanced.ok) { stages[word] = 'refused'; continue }
    stages[word] = advanced.changed ? 'listed' : 'unchanged'
    // The pointer names the SIGNED CLAIM, not the bare list: a stranger GETs
    // it, verifies it against sign(word) and the pinned key
    // (acceptHeadClaim), and only then follows it to the list. An unchanged
    // list whose claim this replica cannot name yields no pointer.
    if (!SIG_RE.test(advanced.claim)) continue
    stageRoots[stageRootKey(word)] = advanced.claim
    // The claim, the succession and its envelopes travel with the closure: a
    // stranger who reads the pointer must find the atoms on the same host.
    for (const sig of [advanced.claim, advanced.head, ...advanced.envelopes]) {
      if (!stageAtoms.includes(sig)) stageAtoms.push(sig)
      await hostSync.markPublic(sig, 'resource')
    }
  }

  const roots = { ...nextRoots, ...stageRoots }
  const put = await putHiveManifest(indexHost, roots, doors,
    read.ok ? read.manifest.createdAt : 0, read.ok ? read.manifest.signedContent : undefined)
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason, sealed }

  // 7. The stable bearer link: segments + pubkey + hosts (+ the sealed head
  //    as a cold-index fallback hint). The hosts are the nodes this publish
  //    put its bytes on — nothing is advertised that did not take them.
  report({ phase: 'linking' })
  const hosts = [...answering]
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
  // The stage atoms share the link's budget, side by side: a pointer a
  // stranger can read must find its atom on the host.
  const stagesReceipted = (await Promise.all(
    stageAtoms.map(async sig => (await hostSync.ensureReceipt?.(sig, BUNDLE_RECEIPT_MS)) === true),
  )).every(Boolean)

  const linkHost = normalizeHost(window.location.host) || window.location.host
  const scheme = LOOPBACK_RE.test(linkHost) ? 'http' : 'https'
  const url = `${scheme}://${linkHost}/${bundleSig}`
  // The address a person shares: the branch's primary open domain, at its
  // root path unless the signed index gives it an own address there.
  const primary = (doors[key] ?? [])[0] || answering[0] || ''
  const address = primary ? creationUrl(primary, segs, key, read.ok ? read.manifest.addresses : undefined) : ''

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
    // A pointer a stranger can read must find its atoms: an unreceipted
    // stage list makes the publish `unconfirmed`, like an unnamed head.
    status: confirmed && stagesReceipted ? 'confirmed' : 'unconfirmed',
    sealed,
    pubkey,
    host: indexHost,
    lineageKey: key,
    bundleSig,
    url,
    address,
    linkReceipted,
    missingFromIndex,
    stages,
    stagesReceipted,
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
  // Withdraw through the first of the branch's nodes that answers — the same
  // set publishing uses, against the same shared index.
  const nodes = await nodesFor(segs, get<HostSyncLike>(HOST_SYNC_KEY))
  if (nodes.length === 0) return { ok: false, failure: 'no-host', reason: 'no node named' }
  const { host: indexHost, read } = await resolveIndexDoor(nodes, pubkey)
  // The same guard as publishing, for the same reason: a rewrite we cannot
  // base on a verified read is a rewrite that drops everything we cannot see.
  if (!read.ok) {
    if (read.reason === 'http' && read.status === 404) return { ok: true, removed: false }
    return { ok: false, failure: 'index-unsafe', reason: read.reason }
  }
  if (!(key in read.manifest.roots)) return { ok: true, removed: false }
  const roots = { ...read.manifest.roots }
  const head = String(roots[key] ?? '').toLowerCase()
  delete roots[key]
  const doors = { ...(read.manifest.doors ?? {}) }
  delete doors[key]
  // Its own addresses go with it: a host never names a creation the index
  // no longer publishes (putHiveManifest prunes the same way, for every writer).
  const content: Record<string, unknown> | undefined = read.manifest.signedContent
    ? { ...read.manifest.signedContent }
    : undefined
  if (content && read.manifest.addresses) {
    content['addresses'] = Object.fromEntries(Object.entries(read.manifest.addresses).filter(([, k]) => k !== key))
  }
  // The withdrawn head leaves every stage list — an unlink, never a forget:
  // the prior lists are one `prev` back and the bytes stay by signature. The
  // new pointers ride this same write (deployment-stages.md R4). A head another
  // still-published key shares stays listed: the lists are reconciled against
  // the index as it will be after this write.
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  hostSync?.addPublishNodes?.(nodes)
  const indexed = indexedHeads(roots)
  const liveHeads = liveHeadsOf(roots, doors)
  Object.assign(roots, await withdrawFromStages(
    [STAGE_PUBLISHED, STAGE_SHARED, STAGE_LIVE],
    indexed.has(head) ? [] : [head],
    hostSync,
    pubkey,
    word => (word === STAGE_LIVE ? h => liveHeads.has(h) : h => indexed.has(h)),
  ))

  const put = await putHiveManifest(indexHost, roots, doors,
    read.manifest.createdAt, content)
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason }

  // Local mark follows the index, so the two cannot disagree afterwards.
  const parentLocation = '/' + segs.slice(0, -1).join('/')
  const name = segs[segs.length - 1] ?? ''
  if (isBranchPublic(parentLocation, name)) setBranchPublic(parentLocation, name, false)
  return { ok: true, removed: true }
}

/** Withdraw `heads` from each stage list; the changed pointers, keyed
 *  `stage:<word>`, for the caller's index write. A list that never named a
 *  head is untouched and yields no pointer. Refusals (no identity, no
 *  signature) yield nothing — the withdrawal of the index key stands alone. */
async function withdrawFromStages(
  words: readonly StageWord[],
  heads: readonly string[],
  hostSync: HostSyncLike | undefined,
  pubkey: string,
  keepFor: (word: StageWord) => (head: string) => boolean = () => () => true,
): Promise<Record<string, string>> {
  const pointers: Record<string, string> = {}
  const gone = heads.filter(h => SIG_RE.test(h))
  for (const word of words) {
    const next = await withdrawStage(word, gone, { pubkey }, keepFor(word))
    if (!next.ok || !next.changed || !SIG_RE.test(next.claim)) continue
    pointers[stageRootKey(word)] = next.claim
    for (const sig of [next.claim, next.head, ...next.envelopes]) await hostSync?.markPublic?.(sig, 'resource')
  }
  return pointers
}


/** Say which domains an ALREADY-PUBLISHED branch opens on — the per-domain
 *  switch. One signed index rewrite, no seal and no upload: the bytes are
 *  already hosted, so turning a domain on or off is as fast as the index
 *  write. An empty set is a withdrawal (unpublishBranch). A branch not in the
 *  index yet has nothing to open — the caller publishes it instead. */
export async function setBranchDoors(
  segments: readonly string[],
  zones: readonly string[],
): Promise<{ ok: true; removed?: boolean } | { ok: false; failure: PublishFailure; reason?: string }> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!signer?.getPublicKeyHex) return { ok: false, failure: 'services' }
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return { ok: false, failure: 'no-branch' }
  const wanted = [...new Set(zones.map(z => normalizeHost(z)).filter(Boolean))]
  if (wanted.length === 0) {
    const out = await unpublishBranch(segs)
    return out.ok ? { ok: true, removed: out.removed } : out
  }

  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }
  const key = lineageKey(segs)
  const nodes = await nodesFor(segs, get<HostSyncLike>(HOST_SYNC_KEY))
  if (nodes.length === 0) return { ok: false, failure: 'no-host', reason: 'no node named' }
  const { host: indexHost, read } = await resolveIndexDoor(nodes, pubkey)
  if (!read.ok) return { ok: false, failure: 'index-unsafe', reason: read.reason }
  if (!(key in read.manifest.roots)) return { ok: false, failure: 'no-branch', reason: 'not published yet' }

  const doors = { ...(read.manifest.doors ?? {}), [key]: wanted }
  // Opening a door is entering `live` (deployment-stages.md §2): the head the
  // index names joins the author's live list, its pointer in this same write.
  const roots = { ...read.manifest.roots }
  const head = String(roots[key] ?? '').toLowerCase()
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  hostSync?.addPublishNodes?.(nodes)
  const liveHeads = liveHeadsOf(roots, doors)
  const live = await advanceStage(STAGE_LIVE, { add: [head], keep: h => liveHeads.has(h) }, { pubkey })
  if (live.ok && live.changed && SIG_RE.test(live.claim)) {
    roots[stageRootKey(STAGE_LIVE)] = live.claim
    for (const sig of [live.claim, live.head, ...live.envelopes]) await hostSync?.markPublic?.(sig, 'resource')
  }
  const put = await putHiveManifest(indexHost, roots, doors,
    read.manifest.createdAt, read.manifest.signedContent)
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason }
  return { ok: true }
}

/** Why an own address could not be set. */
export type OwnAddressFailure = PublishFailure | 'not-a-label' | 'reserved' | 'not-published'

/** GIVE A CREATION ITS OWN ADDRESS on one zone — `https://<label>.<zone>` —
 *  or, with `label` null, take it away so the creation lives at its root path
 *  again (`https://<zone>/<path>`, the default). One signed index rewrite in
 *  the same shape every publish makes: the `addresses` map rides beside the
 *  roots and doors, and every other field is carried through. A label that is
 *  not a DNS label, or is reserved (`content`, `try-*`), is refused before
 *  anything is signed. A branch the index does not name has nothing to
 *  address yet — the caller publishes it first. */
export async function setBranchAddress(
  segments: readonly string[],
  zone: string,
  label: string | null,
): Promise<{ ok: true; host: string } | { ok: false; failure: OwnAddressFailure; reason?: string }> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  if (!signer?.getPublicKeyHex) return { ok: false, failure: 'services' }
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return { ok: false, failure: 'no-branch' }
  const z = foldContentLabel(zone)
  if (!z || LOOPBACK_RE.test(z)) return { ok: false, failure: 'no-host', reason: 'not a zone' }
  if (label !== null) {
    const refusal = ownAddressRefusal(label)
    if (refusal) return { ok: false, failure: refusal }
  }

  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }
  const key = lineageKey(segs)
  const nodes = await nodesFor(segs, get<HostSyncLike>(HOST_SYNC_KEY))
  if (nodes.length === 0) return { ok: false, failure: 'no-host', reason: 'no node named' }
  const { host: indexHost, read } = await resolveIndexDoor(nodes, pubkey)
  if (!read.ok) return { ok: false, failure: 'index-unsafe', reason: read.reason }
  if (!(key in read.manifest.roots)) return { ok: false, failure: 'not-published' }

  const addresses = withOwnAddress(read.manifest.addresses, z, key, label)
  const put = await putHiveManifest(indexHost, read.manifest.roots, read.manifest.doors ?? {},
    read.manifest.createdAt, { ...read.manifest.signedContent, addresses })
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason }
  return { ok: true, host: label ? ownAddressHost(label, z) || `${label}.${z}` : z }
}

/** Why an address's entrance could not be changed — each its own word for the
 *  participant (`publish.entrance.failure.<code>`); `reason` is for logs.
 *  `root` = the host is a domain's root, whose front door runs no powers;
 *  `no-address` = the index binds no creation to the host, so nothing runs
 *  there; `powers-unasked` = the write would leave powers on without a Turn
 *  on. */
export type ZoneEntranceFailure =
  | 'services' | 'no-host' | 'no-signer' | 'index-unsafe' | 'index-failed'
  | 'not-available' | 'scent-failed' | 'root' | 'no-address' | 'no-page' | 'too-many' | 'powers-unasked'

/** WHAT THE PARTICIPANT ASKED — never a whole entry. The intent is applied to
 *  the entrance as the index holds it at the moment of writing, so no cached
 *  copy can raise or drop powers it did not mean to touch. */
export type ZoneEntranceIntent =
  /** Run `page` (previewed) with all three powers; follow `from` for updates. */
  | { kind: 'on'; page: string; from?: ZoneEntranceFrom }
  /** Keep serving the page, with no powers. */
  | { kind: 'off' }
  /** Forget the entrance (the host keeps the last page it served sealed). */
  | { kind: 'forget' }

export type ZoneEntranceResult =
  | { ok: true; host: string; entrance: ZoneEntrance | null; reason?: 'unchanged'; assessed?: string }
  | { ok: false; failure: ZoneEntranceFailure; reason?: string }

/** The participant's own review scent for a card page they turned on: the
 *  module-assessment shape (assistant/module-review.ts) with the card door
 *  as its sandbox, so the community reads it beside any other assessment. */
export const CARD_DOOR_SANDBOX = 'card-door'

/** The entrance an intent leaves, from what the index holds now. Pure; the
 *  shape only — whether the host is bound is the index's own question. */
export function applyEntranceIntent(before: ZoneEntrance | null, intent: ZoneEntranceIntent): ZoneEntrance | null {
  switch (intent.kind) {
    case 'on': {
      const from = intent.from ?? before?.from
      return readEntrance({ page: intent.page, powers: [...ENTRANCE_POWERS], ...(from ? { from } : {}) })
    }
    case 'off': return before ? readEntrance({ ...before, powers: [] }) : null
    case 'forget': return null
  }
}

/** THE PARTICIPANT TURNS AN ADDRESS'S POWERS ON, OR OFF — the one writer of
 *  the signed `entrances[host]` (documentation/using-a-creation.md, "Powers
 *  are off by default, and the participant turns them on"). The Hyperdex app
 *  runs at its own address (`business-card.<zone>`), never at a domain's
 *  root: the root is a plain front door. Never remote: the bridge has no
 *  intent for it, because a review is not a single tap.
 *
 *  It reads the index at the host's zone root, applies the INTENT to the
 *  entrance it holds now, and signs — one read-modify-write:
 *  - `on` sets the page and all three powers, and in the SAME signed write
 *    records the participant's own review scent for the page as
 *    `roots['assess:<page>']`. Only `on` needs the host bound to a creation
 *    (`boundLineage`), never a domain's root, and the page held on the host.
 *  - `off` keeps the page and sets no powers: the host keeps serving it, so
 *    cards visitors already kept stay unreadable to any other code there.
 *  - `forget` removes the entry; the panel asks first.
 *
 *  HARD GUARD: no write leaves powers on unless the intent is `on`, or the
 *  entrance already ran that same page with its powers on.
 *
 *  Refuses, before anything is signed, an index it cannot read (the wipe
 *  guard). */
export async function setEntrance(host: string, intent: ZoneEntranceIntent): Promise<ZoneEntranceResult> {
  const signer = get<SignerLike>(NOSTR_SIGNER_KEY)
  const hostSync = get<HostSyncLike>(HOST_SYNC_KEY)
  if (!signer?.getPublicKeyHex) return { ok: false, failure: 'services' }
  const h = entranceHost(String(host ?? '').toLowerCase())
  if (!h) return { ok: false, failure: 'no-host', reason: 'not an address' }
  if (intent.kind === 'on' && !SIG_RE.test(String(intent.page ?? '').toLowerCase())) return { ok: false, failure: 'no-page' }

  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }
  // THE ZONE ROOT carries the write — the host itself when it is one of the
  // standing write doors, else the domain it sits under — then the standing
  // targets, against the same shared index.
  const standing = await nodesFor([], hostSync)
  const rest = h.slice(h.indexOf('.') + 1)
  const zone = standing.includes(h) || !rest.includes('.') ? h : rest
  const nodes = [...new Set([zone, ...standing])]
  hostSync?.addPublishNodes?.(nodes)
  const { host: indexHost, read } = await resolveIndexDoor(nodes, pubkey)
  const nothing = !read.ok && read.reason === 'http' && read.status === 404
  if (!read.ok && !nothing) return { ok: false, failure: 'index-unsafe', reason: read.reason }
  const manifest = read.ok ? read.manifest : null
  const held = manifest?.entrances ?? {}
  const before = held[h] ?? null

  // A DOMAIN'S ROOT IS A PLAIN FRONT DOOR on every device: nothing may run
  // with powers there. And a creation must live at the address for a page to
  // run there. Turning powers off and forgetting are always allowed: an
  // entrance whose address went away must still be possible to switch off.
  if (intent.kind === 'on') {
    const roots = new Set([...standing, ...Object.values(manifest?.doors ?? {}).flat().map(z => String(z ?? '').toLowerCase())])
    if (roots.has(h)) return { ok: false, failure: 'root' }
    if (!boundLineage(manifest, h)) return { ok: false, failure: 'no-address' }
  }

  const next = applyEntranceIntent(before, intent.kind === 'on' ? { ...intent, page: intent.page.toLowerCase() } : intent)
  if (isPoweredEntrance(next) && intent.kind !== 'on' && !(isPoweredEntrance(before) && before?.page === next?.page)) {
    return { ok: false, failure: 'powers-unasked' }
  }
  const same = (a: ZoneEntrance | null, b: ZoneEntrance | null): boolean => {
    // What was followed is recorded at turn-on, never asked for: compare who.
    const strip = (e: ZoneEntrance | null) => e?.from ? { ...e, from: { pubkey: e.from.pubkey, lineage: e.from.lineage } } : e
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
  }
  if (same(before, next)) return { ok: true, host: h, entrance: before, reason: 'unchanged' }
  if (next && !before && Object.keys(held).length >= ENTRANCES_MAX) {
    return { ok: false, failure: 'too-many', reason: `a host keeps at most ${ENTRANCES_MAX} entrances` }
  }

  // THE PAGE MUST BE HELD before powers run it — asked only when this write
  // turns a page's powers on. Off and Forget never wait on a receipt.
  const page = next?.page ?? ''
  const raising = !!next && isPoweredEntrance(next) && (page !== before?.page || !isPoweredEntrance(before))
  if (raising) {
    const ok = hostSync?.isClosureAvailableOn
      ? (await hostSync.isClosureAvailableOn(page, 'resource', false, [indexHost])) === true
      : (await hostSync?.isClosureAvailable?.(page, 'resource', false)) === true
    if (!ok) return { ok: false, failure: 'not-available', reason: 'the page is not held on the host yet' }
  }

  // WHAT WAS FOLLOWED AT TURN-ON: the followed index's stamp and the followed
  // lineage's head. Following yourself, the stamp is that of this very write
  // and the head is the one your index names now; another publisher's are
  // taken from the notice that offered the page, or read from their index.
  let createdAt: number | undefined
  if (intent.kind === 'on' && next?.from) {
    const replaces = manifest?.createdAt ?? 0
    const { pubkey: followedKey, lineage } = next.from
    let at: number
    let head = ''
    if (followedKey === pubkey) {
      at = Math.max(Math.floor(Date.now() / 1000), replaces + 1)
      createdAt = at
      head = String(manifest?.roots[lineage] ?? '')
    } else if (Number.isSafeInteger(intent.from?.at) && SIG_RE.test(String(intent.from?.head ?? ''))) {
      at = intent.from!.at!
      head = intent.from!.head!
    } else {
      const followed = await fetchHiveManifestFromAny([indexHost, ...nodes], followedKey).catch(() => null)
      at = followed?.createdAt || Math.floor(Date.now() / 1000)
      head = String(followed?.roots[lineage] ?? '')
    }
    head = head.toLowerCase()
    next.from = { pubkey: followedKey, lineage, at, ...(SIG_RE.test(head) ? { head } : {}) }
  }

  const roots = { ...(manifest?.roots ?? {}) }
  let assessed: string | undefined
  const scentKey = `assess:${page}`
  if (raising && !roots[scentKey]) {
    const scent = await cardDoorScent(page, h, indexHost, hostSync)
    if ('error' in scent) return { ok: false, failure: 'scent-failed', reason: scent.error }
    roots[scentKey] = scent.sig
    assessed = scent.sig
  }

  const entrances: Record<string, ZoneEntrance> = { ...held }
  if (next) entrances[h] = next
  else delete entrances[h]
  const put = await putHiveManifest(indexHost, roots, manifest?.doors ?? {},
    manifest?.createdAt ?? 0, { ...(manifest?.signedContent ?? {}), entrances },
    { setsEntrances: true, ...(createdAt ? { createdAt } : {}) })
  if (!put.ok) return { ok: false, failure: 'index-failed', reason: put.reason }
  // What the write signed, after its own normalisation: an entry on a host
  // the index no longer binds is dropped there, never kept here.
  const written = next && manifest ? readEntrances({ [h]: next }, manifest)[h] ?? null : next
  return { ok: true, host: h, entrance: written, ...(assessed ? { assessed } : {}) }
}

/** Mint and publish the participant's review scent for page `page`: a note
 *  (wrapped in its relation envelope, as module-review's putHop does) and the
 *  assessment record, sent to the host now and read back by hash. The index
 *  pointer `assess:<page>` is the caller's, in its own signed write. */
async function cardDoorScent(
  page: string, address: string, host: string, hostSync: HostSyncLike | undefined,
): Promise<{ sig: string } | { error: string }> {
  const store = get<StoreLike>(STORE_KEY)
  if (!store?.putResource || !hostSync?.publishAtoms) return { error: 'the review scent cannot be published from here' }
  const held = new Map<string, Uint8Array>()
  const put = async (text: string, type: string): Promise<string> => {
    const bytes = new TextEncoder().encode(text)
    const sig = await store.putResource(new Blob([bytes], { type }), { emit: false })
    held.set(sig, bytes)
    return sig
  }
  try {
    const noteText = await put(`Previewed and turned on for ${address}.`, 'text/plain; charset=utf-8')
    const note = await put(JSON.stringify(mintMetaEnvelope({ resource: noteText, relation: 'note' })), 'application/json')
    const record: ModuleAssessmentRecord = {
      kind: 'module-assessment', sandbox: CARD_DOOR_SANDBOX, root: page, change: null, verdict: 'accept', note, at: Date.now(),
    }
    const sig = await put(JSON.stringify(record), 'application/json')
    const sent = await hostSync.publishAtoms(host, [noteText, note, sig], async s => held.get(s) ?? null)
    return sent.ok ? { sig } : { error: sent.error }
  } catch { return { error: 'the review scent could not be written' } }
}

// ── SECURE DELETE — remove a switched-off place from my hosts ──────────────
//
// (documentation/remove-from-my-hosts.md.) Everyday visibility is the domain
// switch; this is the rare, deliberate act after it: the place is already off
// everywhere, and now the hosts should stop HOLDING what only it used.
//
//   candidates = every sig reachable from every version this place published
//   keep       = every sig reachable from every head the signed index still
//                names — and if any open head cannot be walked completely,
//                NOTHING is removed (an incomplete keep-set could delete
//                something an open place needs)
//   forget     = candidates − keep, sent to each host's POST /forget
//
// Each host guards again: the cloud deletes only bytes this key alone claims
// (and never an open head); a relay never forgets what its packages need.
// Deleting is the host forgetting — anyone who already holds the bytes keeps
// them, and this hive's own copy is untouched.

export type SecureDeleteFailure = 'services' | 'no-branch' | 'no-signer' | 'no-host' | 'index-unsafe' | 'still-open' | 'nothing-published' | 'keep-incomplete'

export type SecureDeleteResult =
  | { ok: true; asked: number; removed: number; kept: number; hosts: { host: string; removed: number; kept: number; error?: string }[] }
  | { ok: false; failure: SecureDeleteFailure; reason?: string }

interface ClosureWalker {
  closureSigs?: (sig: string, kind?: 'layer') => Promise<{ sigs: Set<string>; complete: boolean }>
}
interface SigningSigner extends SignerLike {
  signEvent?: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
}

export async function secureDeleteBranch(segments: readonly string[]): Promise<SecureDeleteResult> {
  const signer = get<SigningSigner>(NOSTR_SIGNER_KEY)
  const hostSync = get<HostSyncLike & ClosureWalker>(HOST_SYNC_KEY)
  if (!signer?.getPublicKeyHex || !signer.signEvent || !hostSync?.closureSigs) return { ok: false, failure: 'services' }
  const segs = segments.map(s => String(s ?? '').trim()).filter(Boolean)
  if (segs.length === 0) return { ok: false, failure: 'no-branch' }
  const pubkey = String((await signer.getPublicKeyHex()) ?? '').toLowerCase()
  if (!SIG_RE.test(pubkey)) return { ok: false, failure: 'no-signer' }
  const key = lineageKey(segs)

  // Hide first: a place any domain still shows is not deletable.
  const nodes = await nodesFor(segs, hostSync)
  if (nodes.length === 0) return { ok: false, failure: 'no-host', reason: 'no node named' }
  const { read } = await resolveIndexDoor(nodes, pubkey)
  let roots: Record<string, string> = {}
  if (read.ok) roots = read.manifest.roots
  else if (!(read.reason === 'http' && read.status === 404)) return { ok: false, failure: 'index-unsafe', reason: read.reason }
  if (key in roots) return { ok: false, failure: 'still-open' }

  const versions = (await listPublishRecords())
    .filter(e => e.record.lineageKey === key && e.record.pubkey === pubkey)
    .map(e => e.sealed)
  if (versions.length === 0) return { ok: false, failure: 'nothing-published' }

  const keep = new Set<string>()
  for (const [rootKey, head] of Object.entries(roots)) {
    const walk = await hostSync.closureSigs(head, 'layer')
    for (const s of walk.sigs) keep.add(s)
    // An open PLACE we cannot finish walking (published from another device,
    // a cold child) stops the whole act: its bytes would look unused. A
    // system root (install:<name>, vocabulary:…) keeps what it reaches here
    // and the host guards the rest — relays keep every package closure.
    if (!walk.complete && !rootKey.includes(':')) return { ok: false, failure: 'keep-incomplete', reason: rootKey }
  }
  const forget = new Set<string>()
  for (const version of versions) {
    for (const s of (await hostSync.closureSigs(version, 'layer')).sigs) if (!keep.has(s)) forget.add(s)
  }

  const sigs = [...forget]
  const hosts: { host: string; removed: number; kept: number; error?: string }[] = []
  for (const door of nodes) {
    const bare = normalizeHost(door)
    const url = `${LOOPBACK_RE.test(bare) ? 'http' : 'https'}://${bare}/forget`
    let removed = 0, kept = 0, error: string | undefined
    for (let i = 0; i < sigs.length && !error; i += 1000) {
      const auth = await nip98Header(signer as Parameters<typeof nip98Header>[0], url, 'POST')
      if (!auth) { error = 'signing failed'; break }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sigs: sigs.slice(i, i + 1000) }),
        })
        if (!res.ok) { error = `host said ${res.status}`; break }
        const out = await res.json() as { removed?: string[]; kept?: Record<string, string> }
        removed += out.removed?.length ?? 0
        kept += Object.keys(out.kept ?? {}).length
      } catch { error = 'host unreachable' }
    }
    hosts.push({ host: bare, removed, kept, ...(error ? { error } : {}) })
  }
  return {
    ok: true,
    asked: sigs.length,
    removed: hosts.reduce((n, h) => n + h.removed, 0),
    kept: hosts.reduce((n, h) => n + h.kept, 0),
    hosts,
  }
}
