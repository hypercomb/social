// sharing/host-sync.service.ts
//
// Remote backup: signed HTTP push of committed content to the operator's
// OWN host (e.g. jwize.com), with confirmed-read-back receipts.
//
// THE ONLY `content:wrote` SUBSCRIBER THAT SENDS BYTES ANYWHERE, and it
// asks first: #anyEnabled() fronts the handler, the retry timer and the boot
// kick, so an un-opted-in participant queues nothing. It once had a sibling —
// PushQueueService, the DCP installer's push channel — which subscribed with
// no gate at all; that channel was retired with the installer and its pools
// are collected by `retired-push-pool.ts`. Do not grow a second one.
//
// Crash-safe queue-with-receipts, over its own destination and transport:
//
//   transport = HTTP PUT to https://<host>/<typed-path> carrying a NIP-98
//   Authorization header — a kind-27235 Nostr event signed by the
//   participant's key (the same key the mesh uses). The host verifies the
//   signature against its allowed-writers list and that sha256(body)
//   matches the URL sig (relay §21.12). Receipt = confirmed read-back
//   (a fresh GET returns 200), NEVER a bare PUT 200 — that is the exact
//   silent-drop lesson from the deploy pipeline, applied at this boundary.
//   See protocol-spec.md §21.11 / §21.12.
//
// IMPORTANT — this is HTTP-ONLY. It never touches the mesh. The mesh stays
// layer-sigs-only and lightweight (backup is not broadcast). No new event
// kinds, no bytes on the relay's event channel — just HTTP PUT/GET.
//
// On-disk shape: two POOLS OF MEANING at the OPFS root — dirs named by
// sign(meaning), sha256 of the UTF-8 meaning bytes, the same derivation
// Store uses (no typed __folders__, ever). The meanings are its own — the
// retired push channel's 'push'/'receipts' pools are a different address and
// are only ever collected, never written:
//
//   sign('host-push')/{sig}.{kind}         ← queued bytes (FIFO by mtime)
//   sign('host-push')/{sig}.public         ← sidecar marker: this sig is in a
//                                            published-public closure (see
//                                            markPublic). Not a queue entry.
//   sign('host-receipts')/{sig}            ← SELF-DOMAIN receipt (unchanged —
//                                            no migration)
//   sign('host-receipts')/{sig}.{hostHash} ← per-granted-host receipt
//
// MULTI-TARGET DRAIN (consent-hosting.md §"Transfer"): the drain iterates a
// LIST of targets — the operator's self-domain plus granted hosts. Phase 1
// grants exactly one standing host: the PUBLIC content endpoint at the zone
// ROOT pluginthematrix.com (documentation/read-only-deployment.md — Blossom/
// NIP-98 worker over R2), behind its own explicit opt-in
// (localStorage['hc:public-host'] = '1'). Doctrine: swarms resolve around
// hosts; PUBLIC content posts to the CDN; private/group content NEVER
// touches the public endpoint. The {sig}.public marker is that gate — a
// public-only target can only ever receive marker-carrying sigs, and
// markers are written exclusively where the publish walk enumerates a
// public closure. An entry leaves the queue only when EVERY currently-
// enabled applicable target holds its receipt (crash-safe as before).
//
// LEGACY: `__host_push__/queue/` and `__host_receipts__/` are the pre-pool
// locations. Read-fallback/drain sources ONLY — opened without create,
// unioned into reads while they exist, absorbed into the pools by the
// self-cleaning drain (per-entry copy→remove, gated non-recursive
// removeEntry once fully drained). Receipts are the only "host already
// serves this" ledger — losing one re-PUTs its sig on the next drain — so
// nothing is removed before its copy is confirmed in the pool.
//
// Inert by default. Two operator-controlled gates must BOTH be on for
// the service to subscribe to content commits, enqueue bytes, or invoke
// the signer:
//
//   1. localStorage['hc:nostrmesh:self-domain'] — the host to push to.
//   2. localStorage['hc:host-sync:enabled']     — explicit opt-in flag.
//
// Both off keeps the service silent: no enqueue, no timer drain, no
// signer call. This is the gate that prevents casual visitors from
// triggering a Nostr-signer permission prompt (the NIP-07 extension
// on desktop; on Android, Amber — whose intent-discovery permission
// is what Android describes as "access other apps and services").
//
// Toggle live via the public enable()/disable() methods; localStorage
// changes take effect on the next event, no reload required.
//
// THE SWARM'S HOSTS ARE RESOLVED PER PAGE (documentation/swarm-host.md,
// jwize 2026-10-07). A joined tab uploads the tiles it offers on a page to
// that page's PUBLISH DOMAINS (the host marks of the nearest branch at or
// above it), else to its MEETING HOST (the host the meeting this tab is in
// named — its meeting link's, or the facilitator's own meeting point; this
// tab's `hc:mesh-zone`), else to the primary host of its HOSTS POOL
// (`community:hosts`, hypercomb.com seeded), else — only then, and only when
// its card allows participants — to the RELAY it meets at. A changed meeting
// host is a resolver 'change' like any other: the targets are re-judged and
// what is owed re-staged. swarm-hosts.ts answers that from
// caches, synchronously; nothing on connect, join or announce waits on it.
// Each sig goes where it is SHOWN: a tile where its page goes, a branch's
// subtree where the pages below go (#publicRoots), and what already went
// elsewhere is re-staged when a host becomes owed it (#restage). A pool host
// that cannot take uploads is passed over (#notePoolHostFailure).
// Nothing is stored or picked here: the targets are a function of THIS tab's
// membership (membership.ts), the roots it offered this join and the pages it
// offered them on, so a reload, a discarded tab or the update pill brings back
// the same targets and the receipts on disk count again. Every swarm target is
// public-only like every granted host; a pool or publish host keeps its zone's
// retired `content.` face receipts (the same store); the meeting relay, however
// it was named, has none. Its
// receipt is the host's own answer when it says `stored <sig>` (the relay hashes
// the body against the URL before it writes) or `already held <sig>` (the
// meeting point's worker, which found that sig already in its heap) — a
// statement about that sig, not a bare 200 — so that answer skips the
// read-back GET. Every other answer keeps the read-back.

import { CHILD_SLOTS, EffectBus, SignatureService, registerPoolMeaning, isMetaEnvelope, metaPayloadOf } from '@hypercomb/core'
import { decorationClosureSigs, nestedResourceSigs } from './decoration-closure.js'
import { isJoinedHere } from './membership.js'
import { foldContentLabel, legacyContentFace } from './zone-door.js'
import { swarmHosts, type SwarmHostChoice, type SwarmHostResolver, type SwarmHostSource } from './swarm-hosts.js'

export type HostSyncKind = 'layer' | 'bee' | 'dependency' | 'resource'

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
}

const SIG_RE = /^[a-f0-9]{64}$/

/** Child slots a layer holds its descendant layers in — the core roster,
 *  never restated (documentation/life-primitive.md). Also the set of
 *  `relation` values a meta envelope can carry to mean "I am held as a
 *  child" — the privacy gate reads the relation exactly as it reads a slot. */
const CHILD_SLOT_SET: ReadonlySet<string> = new Set(CHILD_SLOTS)

/** The one incidence a META ENVELOPE (Life Primitive) references.
 *
 *  Every walk below classifies a layer's refs by iterating its ARRAY slots.
 *  An envelope has none: `{ meta: 1, layer: '<sig>', relation: 'children' }`
 *  carries its payload in a SCALAR slot, so `Object.entries` finds nothing to
 *  follow and the walk dead-ends ON the envelope — the envelope reaches the
 *  host, the layer it stands for never does. Because the push walk
 *  (`markPublic`), the gate (`isClosureAvailable`) and the diagnostic
 *  (`closureGaps`) all shared that blind spot, a branch with envelope children
 *  published "complete" and gap-checked "clean" while its children 404'd.
 *  Measured on the live revolucion head: 4 of 14 envelope targets missing.
 *
 *  Payload kinds are self-declared and are exactly HostSyncKind's members
 *  (`META_PAYLOAD_FIELDS`), so the declared key IS the store to read from. */
const metaIncidence = (record: unknown): { sig: string; kind: HostSyncKind } | null => {
  if (!isMetaEnvelope(record)) return null
  const payload = metaPayloadOf(record)
  if (!payload || !SIG_RE.test(payload.sig)) return null
  return { sig: payload.sig, kind: payload.kind as HostSyncKind }
}

/** True when an envelope is held as a descendant LAYER — the same condition
 *  the slot walks express as `CHILD_SLOT_SET.has(slot)`. A tile-only share must
 *  not descend through one, exactly as it does not descend a `children[]`. */
const metaIsChildIncidence = (record: unknown, kind: HostSyncKind): boolean =>
  kind === 'layer'
  && CHILD_SLOT_SET.has(String((record as Record<string, unknown>)?.['relation'] ?? 'children'))
const ENTRY_RE = /^([a-f0-9]{64})\.(layer|bee|dependency|resource)$/
// Pool meanings — sign(meaning) IS the pool address (see #poolSignature).
// Distinct from the retired push channel's 'push'/'receipts' meanings, so
// its collector can never reach these.
const PUSH_MEANING = 'host-push'
const RECEIPTS_MEANING = 'host-receipts'
// Legacy drain sources — pre-pool dirs. Opened WITHOUT create (a drained
// dir stays gone); read/absorb only, never written.
const LEGACY_PUSH_DIR = '__host_push__'
const LEGACY_QUEUE_SUBDIR = 'queue'
const LEGACY_RECEIPTS_DIR = '__host_receipts__'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
// The mesh keeps the relay-corrected clock (now()). Absent → the local clock.
const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const STORE_KEY = '@hypercomb.social/Store'
const CONTENT_BROKER_KEY = '@diamondcoreprocessor.com/ContentBrokerDrone'
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
// Explicit opt-in gate. Default false → no `content:wrote` handler
// reaches the signer, so a casual visitor never triggers a Nostr-signer
// prompt. Operators flip to 'true' once they've configured a host AND
// understand each commit will be signed.
const ENABLED_KEY = 'hc:host-sync:enabled'
// ── Public CDN target (Phase 1 of the multi-target drain) ─────────────
// The one standing granted host: the public content endpoint — a Blossom/
// NIP-98 worker over R2 (documentation/public-content-endpoint.md). Its own
// explicit opt-in, SEPARATE from the self-domain gate: '1' = on, anything
// else (default ABSENT) = off. Future granted hosts arrive as records from
// the consent handshake (kinds 20410/30411 — not built here) and simply
// append to #targets().
const PUBLIC_HOST_KEY = 'hc:public-host'
// WHICH public host. The gate above says whether to publish at all; this says
// WHERE. It used to be a constant, which meant a participant could publish or
// not publish but never choose a destination — and every new domain was a code
// change. It is a participant decision, so it is a value.
//
// Absent = the standing default below, so nothing changes for anyone who never
// sets it. Changing it changes the target's `hostHash`, and receipts are named
// per host, so bytes already confirmed on the old host stay confirmed there and
// the new host earns its own receipts. Nothing is deleted and nothing is
// invalidated by re-pointing.
//
// THE ROOT IS THE DOOR (2026-10-03): writes go to the zone itself, never its
// retired `content.` face. A value stored as `content.<zone>` is READ as
// `<zone>` (zone-door.ts) and saved folded the next time it is set — the
// stored history is never rewritten behind the participant's back.
const PUBLIC_HOST_DOMAIN_KEY = 'hc:public-host:domain'
const DEFAULT_PUBLIC_HOST_DOMAIN = 'pluginthematrix.com'
/** A bare hostname: labels joined by dots, no scheme, no path, no port. The
 *  target is concatenated into request URLs, so anything else is refused
 *  rather than normalised — a half-understood value is how you publish to
 *  somewhere you did not mean to. */
const HOST_DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
// Queue-pool sidecar marker: `{sig}.public` = this sig belongs to a
// published-public closure. THE doctrine gate for the CDN target — written
// only by markPublic() (fed by the swarm publish walk, which enumerates
// exactly the participant's public subset), never by the generic
// content:wrote enqueue. `.public` deliberately fails ENTRY_RE, so markers
// coexist in the push pool without ever being listed as queue entries.
const PUBLIC_MARKER_SUFFIX = 'public'
const NIP98_KIND = 27235
const RETRY_MS = 30_000
// ONE PER-HOST BACKOFF, every failure class (#noteHostFailure). The default
// ladder doubles from 2 s to 60 s with jitter and resets on a success or a
// reopened mesh socket. A key the relay has not yet seen live (401 not-live —
// the beacon is a moment behind the upload) is retried at a fixed second, up
// to five times, before it joins the ladder. A host that refuses (any other
// 401/403/4xx, participants-closed included) is asked again in 10 min; a full
// one (429/507) after its Retry-After, never sooner than 10 min. A 413 or 409
// is about ONE entry, never the host: that target is dropped for that sig.
// enable() / enablePublicHost() / reDrain() are the operator's "retry now".
const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 60_000
const NOT_LIVE_RETRY_MS = 1_000
const NOT_LIVE_RETRIES = 5
const REFUSED_BACKOFF_MS = 10 * 60_000
const FULL_MIN_BACKOFF_MS = 10 * 60_000
// Every HEAD and PUT is bounded: a hung request must never hold a drain slot
// (the drain is single-flight) or a verify slot (the semaphore is shared).
const REQUEST_TIMEOUT_MS = 15_000
const TIMEOUT_PER_100KB_MS = 1_000
// The largest body a common edge (Cloudflare's 100 MB) lets through to a
// host. Above it the edge answers 413 with no CORS headers, which a browser
// shows as a bare network error — one entry too large, never a host refusing.
const EDGE_BODY_MAX_BYTES = 100 * 1_048_576

type QueueEntry = { sig: string; kind: HostSyncKind; fileName: string; mtime: number; dir: FileSystemDirectoryHandle }

/** What a host's answer means, in the words the status line uses. Emitted on
 *  `sync:state` as both `status` and `state`, with the reason beside it. */
type SyncStatus = 'backed-up' | 'syncing' | 'refused' | 'full' | 'too-large' | 'unreachable' | 'not-live'

/** WHY a host is not taking this tab's uploads, as a person can act on it
 *  (#whyOf): it answers a web PAGE where a heap answers bytes or 404; nothing
 *  at that name ever answered while this tab was online (`unresolved` — a
 *  mistyped name, NXDOMAIN, a host that is gone or switched off: check the
 *  host name, and that it is running); it refuses (a writers list, an upload
 *  its browser preflight never lets leave); it is full; or it is plainly
 *  unreachable right now. Emitted on `sync:state` as `why`, beside the
 *  status. */
export type HostWhy = 'page' | 'unresolved' | 'refused' | 'full' | 'too-large' | 'not-live' | 'unreachable'

/** A host's refusal or silence, classified once (#refusal). `drop` = about
 *  this entry only (413, 409): that target never owes it again this session.
 *  `threw` = an upload that never left the browser, from a host that answers
 *  (#putThrew): a refusal read from the browser's side, which a path that
 *  changed under the upload can also cause — so it waits on the ladder, is
 *  never remembered across a reload, and is given back with the socket. */
type PushFailure = { status: Exclude<SyncStatus, 'backed-up' | 'syncing'>; reason: string; retryAfterMs?: number; drop?: true; threw?: true }

/** One push: receipted, local bytes that can never satisfy the sig, nothing
 *  attempted for a local reason (no signer, entry gone), or the host's answer. */
type PushOutcome = 'ok' | 'corrupt' | 'local' | PushFailure

/** A drain destination. `hostHash === null` marks the SELF-DOMAIN target —
 *  its receipt stays the bare `{sig}` file (no migration). Granted hosts
 *  receipt as `{sig}.{hostHash}`. `publicOnly` targets may only receive
 *  sigs carrying a `{sig}.public` marker — the doctrine gate that keeps
 *  private/group bytes off the public endpoint. Future consent-granted
 *  hosts (30411 records) append here with their own scoping. */
type SyncTarget = {
  domain: string
  hostHash: string | null
  publicOnly: boolean
  /** The hash of the zone's retired `content.<zone>` face. Receipts earned
   *  there before the face retired are the SAME store's answer, so they stay
   *  honoured — an updated hive does not re-push what the host already holds.
   *  Read only: new receipts are written under `hostHash`. */
  legacyHostHash?: string
  /** A swarm host (#swarmSources): owed what the pages it hosts offer now
   *  (#owedBy); its PUT answer `stored <sig>` (or `already held <sig>`) is
   *  the receipt, and unheld
   *  closure refs are vouched for by one HEAD to it. */
  swarm?: true
  /** Also a plain public-only target (the public host or a publish node):
   *  owed every marked sig, not only what the room is offered now. */
  marker?: true
}

/** The drain destinations by name, in order, before their hashes are taken.
 *  `relay`: a swarm host only because the meeting relay hosts participants —
 *  its own heap, with no retired `content.` face. */
type TargetSpec = { domain: string; self: boolean; swarm: boolean; marker: boolean; relay: boolean }

/** The swarm gate's per-page scope (isClosureAvailableAt): the page the
 *  node is shown on, hosts that count everywhere, the current targets, and
 *  whether some page on the way was still being read. */
type ScopeAt = { page: readonly string[]; extra: ReadonlySet<string>; targets: readonly SyncTarget[]; pending: { seen: boolean } }

/** One ref the marking walk recorded (#linkRef). */
type RefEdge = { kind: HostSyncKind; child: boolean; step: string }

/** A host's standing failure (#noteHostFailure). Removed on its next success. */
type HostBackoff = { until: number; streak: number; notLive: number; status: SyncStatus; reason: string; threw?: true }

export class HostSyncService extends EventTarget {

  /** sign(meaning) → pool address, memoized, via the core POOL REGISTRY.
   *  Deriving the address REGISTERS the meaning, so anything that walks
   *  the OPFS root can tell this pool apart from a lineage sigbag (they
   *  share one flat namespace, and a bare-word meaning hashes to the same
   *  address as a same-named root tile). Never re-derive locally. */
  static #poolSignature = (meaning: string): Promise<string> => registerPoolMeaning(meaning)

  /** hostHash = FIRST 16 HEX CHARS of sha256(lowercase domain). 16 chars
   *  (64 bits) keeps receipt filenames short and eyeball-able while being
   *  collision-free for any realistic granted-host list; lowercasing makes
   *  the hash stable across config spelling. Memoized — hosts are few and
   *  fixed for a session. */
  static readonly #hostHashes = new Map<string, Promise<string>>()
  static #hostHash = (domain: string): Promise<string> => {
    const key = domain.toLowerCase()
    let hash = HostSyncService.#hostHashes.get(key)
    if (!hash) {
      hash = SignatureService.sign(new TextEncoder().encode(key).buffer as ArrayBuffer).then(s => s.slice(0, 16))
      HostSyncService.#hostHashes.set(key, hash)
    }
    return hash
  }

  #draining = false

  /** The mesh's last announced state — an 'open' after 'open' or 'stalled'
   *  is not a return (unless the payload says reopened). */
  #meshState = ''

  /** A drain was asked for while one ran: run once more when it ends, so an
   *  entry staged during the last pass never waits for the 30 s timer. */
  #drainAgain = false

  /** True once both legacy dirs are confirmed gone — skips the absorb
   *  probe on subsequent drains. */
  #legacyDrained = false

  /** PER-HOST backoff: domain → its standing failure. Per-host on purpose — a
   *  paused public CDN (quota, grant expiry) must never stall the swarm's host
   *  or self-domain backup, and vice versa. Absent = the host is healthy. */
  readonly #hostBackoff = new Map<string, HostBackoff>()

  /** `{domain}:{sig}` a host refused for that entry alone (413, 409): not owed
   *  there again this session. Session memory — a reload asks once more. */
  readonly #refusedEntries = new Set<string>()

  /** domain → the last per-entry refusal, so the status line can say a file
   *  was too large for the host after the rest of the queue has drained. On
   *  the swarm's host it lasts only while the room still needs that sig (a
   *  current root's closure holds it): made private, or left, it fades. */
  readonly #entryRefusal = new Map<string, { status: SyncStatus; reason: string; sig: string }>()

  /** domain → pending count from its last drain, for states emitted between. */
  readonly #lastPending = new Map<string, number>()

  /** The one scheduled retry: the earliest backoff that ends. */
  #retryTimer: ReturnType<typeof setTimeout> | undefined
  #retryAt = 0

  /** One-time "no signer" console warning latch (see #pushAndReceipt). */
  #warnedNoSigner = false

  /** Sigs whose local bytes failed the sha256===sig precheck — warned once
   *  each, then dropped from the queue. A mismatch is permanent for the
   *  bytes we hold, so re-warning every retry tick is just noise. */
  #warnedCorrupt = new Set<string>()

  /** Where each offered page's bytes go (swarm-hosts.ts) — synchronous. */
  readonly #resolver: SwarmHostResolver

  constructor(resolver: SwarmHostResolver = swarmHosts) {
    super()
    this.#resolver = resolver
    // A page's hosts became known or moved (the pool, a branch's marks, the
    // relay's card): re-judge the target set, send what is now owed, and let
    // the swarm walk again so names wait no longer than the read did.
    resolver.addEventListener('change', () => {
      // A page whose hosts were pending may now be served: no "not
      // available" verdict judged before this answer stands.
      this.#receiptEpoch++
      this.#hostsEpoch++
      this.#targetSpecs()
      // What was sent elsewhere reaches the hosts it is now owed to.
      void this.#restageAll()
      if (this.#anyEnabled()) void this.drain()
      EffectBus.emit('swarm:hosts-changed', { at: Date.now() })
    })
    // Where the hive root's tiles go is read now, off every path, so a join
    // finds it cached rather than pending.
    resolver.warm(null)
    // Auto-enqueue every committed sig — gated on #isEnabled(). With the
    // gate off, the handler exits before reaching enqueue/signer, so no
    // permission prompt can fire. Subscription stays live so toggling the
    // gate takes effect without reload.
    EffectBus.on<{ sig: string; kind: HostSyncKind; bytes: ArrayBuffer }>(
      'content:wrote',
      ({ sig, kind, bytes }) => {
        if (!this.#anyEnabled()) return
        // PUBLIC-ONLY TARGETS ONLY (the swarm's host, the public CDN, publish
        // nodes — no self-domain backup): an unmarked sig has no destination,
        // so it is not walked or staged at all. In a joined tab that is every
        // private write; markPublic stages the public ones from local bytes
        // when the walk marks them, so nothing public is lost by waiting.
        if (!this.#isEnabled()) {
          void this.#isPublicMarked(sig).then(marked => { if (marked) void this.enqueue(sig, kind, bytes) })
          return
        }
        void this.enqueue(sig, kind, bytes)
      }
    )
    // Periodic retry — skipped while BOTH gates are off so the signer is
    // never invoked for an un-opted-in visitor. (Each gate — self-domain
    // backup and the public CDN — is its own explicit opt-in.)
    setInterval(() => {
      if (!this.#anyEnabled()) return
      void this.drain()
    }, RETRY_MS)
    // A socket that (re)opens is a path that came back: what failed on the
    // way may have been the path, not the host. Forget every backoff but a
    // full host's (it named its own wait) and retry at once — a relay that
    // restarted with participants allowed is shared with immediately.
    //
    // Only a socket that CAME BACK counts — the first open after a join, or
    // the one payload that says reopened. The mesh also announces 'open' when
    // a slow probe is answered, a refusal clears or the ladder resets; none
    // of those is a new path, and resetting on them dissolved a refusing
    // host's 10-minute pause on every flicker. Only swarm hosts are reset:
    // the RELAY's whole pause (it is the relay that came back — restarted
    // with participants allowed, it is shared with at once), any other swarm
    // host's only when the path was the problem (unreachable, not-live). A
    // refusal or a full host keeps the window its own answer earned.
    EffectBus.on<{ state?: string; reopened?: boolean }>('mesh:connection', (p) => {
      const prev = this.#meshState
      this.#meshState = String(p?.state ?? '')
      // stalled → open is the same socket answering late, not a return.
      const cameBack = p?.state === 'open' && (p.reopened === true || (prev !== 'open' && prev !== 'stalled'))
      if (!cameBack) return
      // A pool host that went silent (or answered a page) while the path
      // itself was down, or whose uploads never left the browser (#putThrew —
      // a network that changed under them reads the same), is given its
      // chance again with the path (one that failed while the relay answered
      // stays passed over — that was the host). Its refusal's evidence starts
      // over too.
      for (const host of [...this.#downWhileOffline]) this.#resolver.markUp(host)
      this.#downWhileOffline.clear()
      this.#putsThrew.clear()
      const relay = this.#resolver.relayHost()
      for (const domain of this.#swarmSources().keys()) {
        const backoff = this.#hostBackoff.get(domain)
        if (!backoff || backoff.status === 'full') continue
        if (domain === relay || backoff.status === 'unreachable' || backoff.status === 'not-live' || backoff.threw) this.#hostBackoff.delete(domain)
      }
      if (this.#anyEnabled()) void this.drain()
    })
    // A join or a leave starts a new offer: what was named before it is not
    // what this room was offered, and the join's walks name their roots
    // again (#publicRoots). A repeated announcement of the same state
    // changes nothing.
    EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => {
      const joined = p?.public === true
      if (joined === this.#rootsJoined) return
      this.#rootsJoined = joined
      this.#publicRoots.clear()
      this.#rootsByPage.clear()
      this.#pages.clear()
      this.#rootClosure.clear()
      this.#restagedAt.clear()
      this.#closurePagesOf.clear()
      this.#rootsVersion++
    })
  }

  /** True iff the operator has both opted in AND configured a self-domain. */
  public readonly isEnabled = (): boolean => this.#isEnabled()

  /** Turn host backup on. Optionally set the self-domain in the same call.
   *  Effect is immediate — no reload required. Caller is responsible for
   *  showing the user a clear "we will sign each backup to <domain>" dialog
   *  BEFORE invoking this.
   *
   *  You own the host: writes go to the host's flat sig heap and require your
   *  pubkey to be in the relay's writers list. (The old 'temp-swarm' mode —
   *  pushing to a host's per-participant staging pool — was removed: the
   *  relay no longer host-brokers others' bytes; a sig with no endpoint is
   *  an egg, per the byte-path model.) */
  public readonly enable = (selfDomain?: string): void => {
    try {
      if (selfDomain) localStorage.setItem(SELF_DOMAIN_KEY, selfDomain.trim())
      localStorage.setItem(ENABLED_KEY, 'true')
    } catch { /* private mode — caller still has to honor in-session */ }
    // Re-arm after a backoff: enable() is the operator's "I fixed the relay,
    // retry now" signal. Clears every host's window — worst case a
    // still-broken host costs one extra refusal before re-pausing.
    this.#hostBackoff.clear()
    this.#assertedAbsent.clear()
    this.#pageHosts.clear()
    this.#probedHosts.clear()
    this.#answersPage.clear()
    this.#putsThrew.clear()
    this.#resolver.clearDown()
    void this.drain()
  }

  /** Turn host backup off. Existing queued entries stay on disk (not
   *  destructive); they resume draining if the gate is flipped back on. */
  public readonly disable = (): void => {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ }
  }

  /** True iff the operator opted in to the PUBLIC content endpoint. */
  public readonly isPublicHostEnabled = (): boolean => this.#publicHostEnabled()

  /** Opt in to the public relay target (pluginthematrix.com). Published-public
   *  closures (and ONLY those — see markPublic) start draining there.
   *  Effect is immediate. Caller shows the "your public tiles will be
   *  posted to the public content endpoint" consent BEFORE invoking —
   *  same contract as enable(). */
  public readonly enablePublicHost = (): void => {
    if (this.#readonlyVisitor()) return
    try { localStorage.setItem(PUBLIC_HOST_KEY, '1') } catch { /* private mode — honor in-session */ }
    // The operator's "retry now" signal for THIS host.
    this.#hostBackoff.delete(this.publicHostDomain())
    this.#assertedAbsent.clear()
    this.#pageHosts.clear()
    this.#probedHosts.clear()
    this.#answersPage.clear()
    this.#putsThrew.clear()
    void this.drain()
  }

  /** Give this participant a durable place to put bytes before they share.
   *
   *  The swarm carries SIGNATURES, never bytes: peers resolve an image by
   *  fetching it from a host. A participant with no host therefore announces
   *  tiles whose pictures no one on earth can fetch — every candidate host
   *  404s and the tile renders bare. That is the whole "tiles show, images
   *  don't" bug.
   *
   *  Not everyone runs a host, and they don't need to: the public content
   *  endpoint auto-grants an unknown pubkey 100MB for 90 days on its first
   *  upload (public-content-endpoint.md — AUTO_GRANT), so a participant with
   *  nothing but a key has somewhere to put their pictures.
   *
   *  A participant who already has a target keeps it — their own host wins,
   *  and we never re-enable a CDN they deliberately turned off (`'0'` is a
   *  decision; absent is merely unasked).
   *
   *  CONSENT — AND WHY THIS NEVER FLIPS A SWITCH. Joining a swarm is the
   *  gesture "share these tiles with these people in this zone", and where
   *  they are kept is part of it: the swarm's hosts are RESOLVED from what
   *  the participant already chose — the page's publish domains, else their
   *  hosts pool, else a relay that says it hosts participants (#swarmSources)
   *  — and the join sheet names the host that keeps what you share. Uploading
   *  to some OTHER named party is a different act the participant never said,
   *  so this answers the question and provisions nothing: `'ready'` (a target
   *  exists), `'opted-out'` (they decided), or `'needs-host'` (not joined, or
   *  nothing to put the bytes on). The `host-sync:needs-target` effect it
   *  once emitted had no listener and is gone. */
  public readonly ensureSwarmTarget = (): 'ready' | 'opted-out' | 'needs-host' => {
    if (this.#anyEnabled()) return 'ready'
    let optedOut = false
    try { optedOut = localStorage.getItem(PUBLIC_HOST_KEY) === '0' } catch { /* treat as unasked */ }
    if (optedOut) return 'opted-out'
    return 'needs-host'
  }

  /** Opt out of the public CDN target. Queued entries and `.public`
   *  markers stay on disk (not destructive); public pushes stop until the
   *  gate is flipped back on. Bytes already on the CDN remain — the CDN
   *  has no delete surface (public-content-endpoint.md, deliberate). */
  public readonly disablePublicHost = (): void => {
    try { localStorage.setItem(PUBLIC_HOST_KEY, '0') } catch { /* ignore */ }
  }

  readonly #publicHostEnabled = (): boolean => {
    try { return localStorage.getItem(PUBLIC_HOST_KEY) === '1' } catch { return false }
  }

  /** The public host this participant publishes to. Falls back to the standing
   *  default, so an unset value and a never-asked participant behave alike. */
  public readonly publicHostDomain = (): string => {
    let stored = ''
    try { stored = foldContentLabel(localStorage.getItem(PUBLIC_HOST_DOMAIN_KEY) ?? '') }
    catch { /* storage unavailable */ }
    return HOST_DOMAIN_RE.test(stored) ? stored : DEFAULT_PUBLIC_HOST_DOMAIN
  }

  /** The standing default, so a caller can show what "unset" resolves to
   *  without hardcoding it a second time. */
  public readonly defaultPublicHostDomain = (): string => DEFAULT_PUBLIC_HOST_DOMAIN

  /**
   * Point publishing at a different host. Returns false and changes nothing
   * when the value is not a bare hostname.
   *
   * Re-pointing is additive, never destructive: receipts are per host, so the
   * old host keeps every confirmation it earned and the new one starts with
   * none. Bytes already pushed stay where they are — the endpoint has no
   * delete surface by design — so this is a change of destination, not a move.
   */
  public readonly setPublicHostDomain = (domain: string): boolean => {
    // Saved as the zone: a `content.` face typed or carried in is the zone.
    const clean = foldContentLabel(String(domain ?? '').trim().toLowerCase())
    if (!clean) {
      try { localStorage.removeItem(PUBLIC_HOST_DOMAIN_KEY) } catch { /* ignore */ }
      this.dispatchEvent(new CustomEvent('change'))
      return true
    }
    if (!HOST_DOMAIN_RE.test(clean)) return false
    try { localStorage.setItem(PUBLIC_HOST_DOMAIN_KEY, clean) } catch { return false }
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  /** A published website NEVER backs anything up. Its store is session
   *  memory that dies with the tab, its network profile is GET-only, and
   *  publisher writes belong to DCP — so every push here is guaranteed
   *  waste. Left ungated it was the visitor's single largest cost: the fold
   *  writes each layer, the queue re-reads every file to push it, the push
   *  is refused, and the whole store is walked again — two thirds of all CPU
   *  spent reading bytes that could never leave. Gated at the one predicate
   *  that fronts the content:wrote handler, the retry timer and the boot
   *  drains, so nothing downstream has to remember this rule. */
  readonly #readonlyVisitor = (): boolean =>
    (window as Window & { __HC_READONLY__?: boolean }).__HC_READONLY__ === true

  /** Any drain destination enabled at all? Gates the content:wrote
   *  handler, the retry timer, and the boot drains. */
  readonly #anyEnabled = (): boolean =>
    !this.#readonlyVisitor()
    && (this.#isEnabled() || this.#publicHostEnabled() || this.#publishNodes.size > 0 || this.#swarmSources().size > 0)

  /** THE SWARM'S HOSTS, while THIS tab is joined — empty otherwise: every
   *  write door a page this tab offers on resolves to (swarm-hosts.ts), plus
   *  the hive root's own answer (a root offered with no page — a publish, an
   *  invite — and the target a joined tab has before its first walk). Each
   *  door maps to the sources that named it. Synchronous: caches only, so a
   *  page whose hosts are still being read simply has none yet. */
  readonly #swarmSources = (): Map<string, Set<SwarmHostSource>> => {
    const out = new Map<string, Set<SwarmHostSource>>()
    if (!isJoinedHere()) return out
    const key = `${this.#resolver.version}|${this.#rootsVersion}|${this.#resolver.relayHost()}`
    if (this.#swarmSourcesMemo?.key === key) return this.#swarmSourcesMemo.value
    const add = (choice: SwarmHostChoice): void => {
      for (const door of choice.hosts) {
        let sources = out.get(door)
        if (!sources) { sources = new Set(); out.set(door, sources) }
        sources.add(choice.source)
      }
    }
    add(this.#resolver.hostsFor(null))
    for (const segments of this.#pages.values()) add(this.#resolver.hostsFor(segments))
    // The pages BELOW an offered branch (its own publish domains) — learnt
    // by the re-stage walk, so a subtree is a target even when the walk
    // never offered a root on one of its pages.
    for (const [root, pages] of this.#closurePagesOf) {
      if (!this.#publicRoots.has(root)) continue
      for (const segments of pages.values()) add(this.#resolver.hostsFor(segments))
    }
    this.#swarmSourcesMemo = { key, value: out }
    return out
  }

  /** The last answer, keyed by everything it reads: the drain asks once per
   *  entry per target, and the answer only moves when the resolver's caches,
   *  the offered roots, the meeting relay or this tab's membership do. */
  #swarmSourcesMemo: { key: string; value: Map<string, Set<SwarmHostSource>> } | null = null
  /** Bumped whenever the offered roots or their pages change. */
  #rootsVersion = 0

  /** Where THIS page's offered tiles go — synchronous, from caches (see
   *  swarm-hosts.ts). The swarm names these in its domain tags, asks them in
   *  its share gate and says them in its status line. Joined or not: the join
   *  sheet asks before the tab joins. */
  public readonly swarmHostsFor = (segments: readonly string[] | null | undefined): SwarmHostChoice =>
    this.#resolver.hostsFor(segments)

  /** Start reading where this page's tiles will go (its publish domains,
   *  the hosts pool) before anything asks — the swarm calls it on arriving at
   *  a page, so its walk finds the answer cached. Never waits. */
  public readonly warmSwarmHosts = (segments: readonly string[] | null | undefined): void =>
    this.#resolver.warm(segments)

  /** Every swarm host of this tab right now, primary first — what a reader
   *  in this room tries after a sig's advertised hosts. Empty unless joined. */
  public readonly swarmHosts = (): string[] => [...this.#swarmSources().keys()]

  readonly #isEnabled = (): boolean => {
    if (this.#readonlyVisitor()) return false
    let flag = ''
    try { flag = String(localStorage.getItem(ENABLED_KEY) ?? '').trim().toLowerCase() } catch { return false }
    if (flag !== 'true') return false
    return this.#hostBase().length > 0
  }

  // -------------------------------------------------
  // public API
  // -------------------------------------------------

  /** Queue a sig for remote backup. Idempotent (keyed by {sig}.{kind});
   *  skipped entirely if already receipted. Stores the bytes in the queue
   *  file so drain is self-contained and crash-safe. */
  public readonly enqueue = async (sig: string, kind: HostSyncKind, bytes: ArrayBuffer): Promise<void> => {
    if (this.#readonlyVisitor()) return
    if (!SIG_RE.test(sig)) return
    // CLOSURE WALK — runs even when this layer is already receipted: a
    // receipt proves THIS sig serves, not its refs. The doctrine is
    // "push set = the root's transitive closure minus what the host
    // holds"; without the walk, only what the authoring tab happens to
    // read/write gets staged, and a witnessing peer finds the root but
    // 404s on every child. Session-deduped, local-reads only.
    if (kind === 'layer') void this.#enqueueLayerRefs(sig, bytes)
    // Receipt short-circuit — MULTI-TARGET: skip the queue write only when
    // every currently-applicable target already holds its receipt. The
    // self-domain receipt is a CACHE of "the host serves this sig" — hosts
    // drift (content dirs move, protocol eras change, operators clean up),
    // so one about to suppress a push is re-verified ONCE per session with
    // a cheap HEAD (inside #fullyReceipted); a 404 revokes it and the push
    // proceeds. Granted-host receipts are trusted on existence — the CDN's
    // objects are immutable sig-named blobs.
    if (await this.#fullyReceipted(sig)) return
    const queueDir = await this.#getQueueDir()
    if (!queueDir) return // store not ready — silent no-op; boot drain catches up
    try {
      const handle = await queueDir.getFileHandle(`${sig}.${kind}`, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(bytes) } finally { await writable.close() }
    } catch { /* best-effort; next enqueue/drain retries */ }
    void this.drain()
  }

  /**
   * THE NODES A PUBLISH NAMED, THIS SESSION. A publish is one act with two
   * halves — put the bytes where the branch is served from, then advance the
   * index — and the branch's published nodes are where the bytes go. They are
   * added here for the act (`publishBranch` → `addPublishNodes`) and become
   * public-only targets exactly like the standing public host: only
   * `.public`-marked sigs travel to them. Nothing about a publish flips a
   * STANDING switch any more — the decision "use the public host from now on"
   * belongs to the hosts panel, never to a press that was about one branch.
   * Session memory: the branch's host MARKS are the durable record, and the
   * next publish names its nodes again.
   */
  readonly #publishNodes = new Set<string>()

  /** Name the nodes THIS publish puts its bytes on — content doors, bare
   *  hostnames. Idempotent. Kicks a drain so anything already staged and
   *  marked public starts moving. */
  public readonly addPublishNodes = (domains: readonly string[]): void => {
    let added = false
    for (const raw of domains) {
      // A node is a write door — the zone root, never a `content.` face.
      const domain = foldContentLabel(String(raw ?? '').trim().toLowerCase())
      if (!HOST_DOMAIN_RE.test(domain) || this.#publishNodes.has(domain)) continue
      this.#publishNodes.add(domain)
      added = true
    }
    if (added) void this.drain()
  }

  /** The nodes publishes have named this session — for a status line. */
  public readonly publishNodes = (): string[] => [...this.#publishNodes]

  /** The currently-enabled drain destinations: the swarm's hosts FIRST (while
   *  this tab is joined), the operator's self-domain (when configured AND
   *  opted in), the public CDN target (behind its own gate), and every node a
   *  publish named this session (`#publishNodes`). Empty when everything is
   *  off. */
  readonly #targets = async (): Promise<SyncTarget[]> => {
    const targets: SyncTarget[] = []
    for (const spec of this.#targetSpecs()) {
      const roles = { ...(spec.swarm ? { swarm: true as const } : {}), ...(spec.marker ? { marker: true as const } : {}) }
      if (spec.self) targets.push({ domain: spec.domain, hostHash: null, publicOnly: false, ...roles })
      // The relay's own heap has no retired content face.
      else if (spec.relay) targets.push({ domain: spec.domain, hostHash: await HostSyncService.#hostHash(spec.domain), publicOnly: true, ...roles })
      else targets.push({ ...await HostSyncService.#grantedTarget(spec.domain), ...roles })
    }
    return targets
  }

  /** The targets by name, in drain order — synchronous, so a memo check can
   *  notice a changed set before it trusts a verdict. The swarm's hosts come
   *  first; the self-domain, the public host and publish nodes are merged
   *  into a swarm host of the same name rather than listed twice. When the
   *  operator's own backup host is a swarm host, the self target carries both
   *  roles (bare receipts, everything it backs up); when the public host or a
   *  publish node is, that target is owed every marked sig as well. */
  readonly #targetSpecs = (): TargetSpec[] => {
    const specs: TargetSpec[] = []
    const self = this.#isEnabled() ? this.#hostBase() : ''
    // The meeting relay's own heap is not its zone's retired `content.` face,
    // whatever named it a host (the relay step, the pool, a publish domain):
    // receipts earned on that face must never count for it.
    const meetingRelay = this.#resolver.relayHost()
    for (const [domain, sources] of this.#swarmSources()) {
      const relay = domain === meetingRelay || (sources.size === 1 && sources.has('relay'))
      specs.push({ domain, self: domain === self, swarm: true, marker: false, relay })
    }
    if (self && !specs.some(s => s.domain === self)) specs.push({ domain: self, self: true, swarm: false, marker: false, relay: false })
    const granted = [...(this.#publicHostEnabled() ? [this.publicHostDomain()] : []), ...this.#publishNodes]
    for (const domain of granted) {
      const at = specs.find(s => s.domain === domain)
      if (!at) specs.push({ domain, self: false, swarm: false, marker: false, relay: false })
      else if (at.swarm) at.marker = true
    }
    this.#noteTargetSet(specs)
    return specs
  }

  /** The target set the memos were judged against, as a key. */
  #targetSetKey = ''

  /** A CHANGED TARGET SET re-opens the share gate's verdicts. A target that
   *  arrived (joining, a relay switch) may already serve what read
   *  unavailable, so the epoch advances and every negative memo goes; a
   *  target that LEFT may have been the one serving what read available, so
   *  the positive memos go too — no signature is announced that no current
   *  target serves. */
  readonly #noteTargetSet = (specs: readonly TargetSpec[]): void => {
    const key = specs.map(s => `${s.domain}${s.self ? '!' : ''}`).join(' ')
    if (key === this.#targetSetKey) return
    const before = this.#targetSetKey ? this.#targetSetKey.split(' ') : []
    this.#targetSetKey = key
    const now = new Set(key ? key.split(' ') : [])
    this.#receiptEpoch++
    this.#unavailableAtEpoch.clear()
    this.#nodeUnavailableAtEpoch.clear()
    if (before.some(k => !now.has(k))) {
      this.#availableClosures.clear()
      this.#nodeAvailable.clear()
    }
  }

  /** A granted (public-only) target, with the hash of its retired content
   *  face so receipts earned there before the retirement keep counting. */
  static #grantedTarget = async (domain: string): Promise<SyncTarget> => {
    const face = legacyContentFace(domain)
    return {
      domain,
      hostHash: await HostSyncService.#hostHash(domain),
      publicOnly: true,
      ...(face ? { legacyHostHash: await HostSyncService.#hostHash(face) } : {}),
    }
  }

  /** Receipt filename for a target: bare `{sig}` for the self-domain (no
   *  migration), `{sig}.{hostHash}` for granted hosts. */
  static #receiptName = (sig: string, target: SyncTarget): string =>
    target.hostHash === null ? sig : `${sig}.${target.hostHash}`

  /** Pure existence check for a target's receipt — pool first, then the
   *  legacy drain source while it exists (which only ever held bare
   *  self-domain names; hostHash-suffixed names simply never match there). */
  readonly #receiptExists = async (sig: string, target: SyncTarget): Promise<boolean> => {
    const names = [HostSyncService.#receiptName(sig, target)]
    // A receipt earned on the zone's retired `content.` face is the same
    // store's answer — honoured on read, never written again.
    if (target.legacyHostHash) names.push(`${sig}.${target.legacyHostHash}`)
    for (const dir of [await this.#getReceiptsDir(), await this.#getLegacyReceiptsDir()]) {
      if (!dir) continue
      for (const name of names) {
        try {
          await dir.getFileHandle(name, { create: false })
          return true
        } catch { /* not in this source */ }
      }
    }
    return false
  }

  /** True iff this target holds a receipt that should suppress a push.
   *  A self-domain receipt about to suppress is re-verified ONCE per
   *  session with a cheap HEAD (#receiptStillHonored) — hosts drift; a
   *  404 revokes it and the push proceeds. Granted-host receipts are
   *  trusted on existence — the CDN's objects are immutable sig-named
   *  blobs. */
  readonly #targetReceipted = async (sig: string, target: SyncTarget): Promise<boolean> => {
    if (!(await this.#receiptExists(sig, target))) return false
    if (target.hostHash === null) return this.#receiptStillHonored(sig)
    return true
  }

  /** Multi-target receipt check (see enqueue): the queue write is skipped
   *  only when EVERY currently-enabled applicable target holds its receipt.
   *  Public-only targets are applicable only to `.public`-marked sigs (the
   *  doctrine gate) — an unmarked sig with only the public host enabled has
   *  no destination, so it reads as fully receipted and never queues;
   *  markPublic restages it if a marker arrives later. With no target
   *  enabled at all, fall back to the bare self-domain receipt so the
   *  short-circuit keeps its prior behavior. */
  async #fullyReceipted(sig: string): Promise<boolean> {
    const targets = await this.#targets()
    if (targets.length === 0) return this.hasReceipt(sig)
    for (const target of targets) {
      if (target.publicOnly && !(await this.#isPublicMarked(sig))) continue
      if (this.#refusedEntries.has(`${target.domain}:${sig}`)) continue // the host said never
      if (!(await this.#targetReceipted(sig, target))) return false
    }
    return true
  }

  /** Layers whose refs were already walked this session (the walk is
   *  re-runnable but pointless to repeat — layer bytes are immutable). */
  #walkedLayers = new Set<string>()

  /** Decoration resources whose content-closure (website page body + the
   *  images/stylesheets that body embeds) was already staged this session.
   *  Dedups the descent so a chrome stylesheet shared across many pages is
   *  parsed once, not once per page. */
  #walkedResources = new Set<string>()

  /** Refs the closure walks could not read from ANY local store AND no
   *  enabled target holds a receipt for — the never-pushed-content hole
   *  behind a recipient's 404s. Recorded, never thrown: the rest of the
   *  walk proceeds. Per-session; a sig leaves the set when its bytes turn
   *  up on a later walk (import, self-heal). Surfaced by reDrain() /
   *  the /repush queen. */
  readonly #missingLocal = new Set<string>()

  /** Record a walk miss. A ref the host already serves (any enabled
   *  target's receipt exists) is NOT a hole — the recipient 200s on it —
   *  so only receipt-less misses are recorded. Emits
   *  `share:missing-local` ONCE per sig so shells can surface the hole. */
  readonly #noteWalkMiss = async (sig: string): Promise<void> => {
    if (this.#missingLocal.has(sig)) return
    for (const target of await this.#targets()) {
      if (await this.#receiptExists(sig, target)) return // host serves it
    }
    if (await this.hasReceipt(sig)) return // bare self-domain receipt (targets may be off)
    if (this.#missingLocal.has(sig)) return // re-check after the awaits above
    this.#missingLocal.add(sig)
    EffectBus.emit('share:missing-local', { sig })
    // The hole reaches the status line through the swarm hosts' state
    // (`missing`): a tile that waits on it is "not held here", not "uploading".
    for (const target of await this.#targets()) if (target.swarm) this.#emitSyncState(target)
  }

  /** Enqueue everything a layer references, recursively. Slot → kind:
   *  `cells`/`layers`/`children` are child LAYERS (recurse via enqueue →
   *  walk), `bees`/`dependencies` keep their kind, every other sig-array
   *  slot (properties, notes, decorations, qa, future slots) is a
   *  RESOURCE. Refs we don't hold locally are skipped — nothing to push;
   *  the kind only picks the local store to read from, since the host
   *  stores one flat heap regardless. */
  readonly #enqueueLayerRefs = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
    if (this.#walkedLayers.has(sig)) return
    this.#walkedLayers.add(sig)
    let layer: Record<string, unknown>
    try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return }
    if (!layer || typeof layer !== 'object') return
    // Meta envelope: one scalar incidence, no array slots. Stage it and stop —
    // the loop below would find nothing and drop the payload on the floor.
    const incidence = metaIncidence(layer)
    if (incidence) {
      try {
        const metaBytes = await this.#readLocalBytes(incidence.sig, incidence.kind)
        if (!metaBytes) return await this.#noteWalkMiss(incidence.sig)
        this.#missingLocal.delete(incidence.sig)
        await this.enqueue(incidence.sig, incidence.kind, metaBytes)
        if (incidence.kind === 'resource') await this.#enqueueResourceClosure(incidence.sig, metaBytes)
      } catch { await this.#noteWalkMiss(incidence.sig) }
      return
    }
    for (const [slot, value] of Object.entries(layer)) {
      if (!Array.isArray(value)) continue
      const kind: HostSyncKind = CHILD_SLOT_SET.has(slot) ? 'layer'
        : slot === 'bees' ? 'bee'
        : slot === 'dependencies' ? 'dependency'
        : 'resource'
      for (const raw of value) {
        const ref = String(raw ?? '').trim().toLowerCase()
        if (!SIG_RE.test(ref) || ref === sig) continue
        try {
          const refBytes = await this.#readLocalBytes(ref, kind)
          if (refBytes) {
            this.#missingLocal.delete(ref) // bytes turned up — no longer a hole
            await this.enqueue(ref, kind, refBytes)
            // Resource-content descent: a resource ref is an opaque leaf to the
            // slot walk, but its bytes can hold FURTHER resource sigs that must
            // ALSO reach the host or a witnessing/importing peer 404s on them —
            // a website page's htmlSig body + embedded assets (decoration
            // records), OR a tile's nested image sig inside its `properties`
            // blob (data resources). Covers both; a no-op for plain leaves.
            if (kind === 'resource') await this.#enqueueResourceClosure(ref, refBytes)
          } else {
            await this.#noteWalkMiss(ref) // nothing to push — record the hole, keep walking
          }
        } catch { await this.#noteWalkMiss(ref) /* not held locally — record, keep walking */ }
      }
    }
  }

  /** Stage a resource's nested content-closure to the host. Two mutually
   *  exclusive cases, both reading LOCAL bytes only (we stage what we HOLD, so
   *  this must run on the AUTHORING machine — an importing tab can't push bytes
   *  it doesn't have):
   *    - DECORATION record (has `kind`): the website page body (`payload.htmlSig`)
   *      + every image/stylesheet it embeds, plus any `refs` closure (an
   *      attachment's blob, a sequence set, an invite bundle).
   *    - DATA resource (no `kind`): a tile's `properties` blob, whose image is a
   *      nested `imageSig`/`small.image` the slot walk never reaches. Without
   *      this the host holds the properties JSON but 404s the image render asks
   *      for — the "adopted tile renders blank" bug.
   *  Session-deduped via #walkedResources. */
  readonly #enqueueResourceClosure = async (sig: string, recordBytes: ArrayBuffer): Promise<void> => {
    if (this.#walkedResources.has(sig)) return
    this.#walkedResources.add(sig)
    const nested = [
      ...await decorationClosureSigs(recordBytes, s => this.#readLocalBytes(s, 'resource')),
      ...nestedResourceSigs(recordBytes),
    ]
    for (const ref of nested) {
      if (!SIG_RE.test(ref) || ref === sig) continue
      try {
        const bytes = await this.#readLocalBytes(ref, 'resource')
        if (bytes) {
          this.#missingLocal.delete(ref) // bytes turned up — no longer a hole
          await this.enqueue(ref, 'resource', bytes)
        } else {
          await this.#noteWalkMiss(ref) // nothing to push — record the hole, keep walking
        }
      } catch { await this.#noteWalkMiss(ref) /* not held locally — record, keep walking */ }
    }
  }

  // -------------------------------------------------
  // public closure marking — the CDN doctrine gate
  // -------------------------------------------------

  /** Sigs confirmed to carry a `.public` marker (session cache — positive
   *  results only; a missing marker may be written later this session). */
  readonly #publicMarked = new Set<string>()

  /** Sigs whose public-closure walk already ran this session (bytes are
   *  immutable, so re-walking the same sig is pointless). A bare sig means
   *  the FULL-closure walk ran; `{sig}:tile` means only the tile-only walk
   *  (closure=false) ran — a later closure=true call still proceeds, since
   *  the full walk covers strictly more. */
  readonly #markedWalk = new Set<string>()

  /** WHAT THE ROOM IS STILL OWED — swarm hosts only. A `.public` marker
   *  lives on disk for good, and the queue does too, so a marker alone would
   *  carry a tile's bytes to a swarm host after its owner made it private
   *  again (an upload waiting out a 'full' backoff), or into the NEXT room
   *  days later. So a swarm host takes a sig only while some ROOT that needs
   *  it is current AND the sig is SHOWN on a page that host serves: a sig the
   *  walk named through `markPublic` THIS join, and has not since withdrawn
   *  (`withdrawPublic`, which the walk calls for every child it prunes as
   *  private). The edges are content facts — a layer's refs never change —
   *  recorded by the marking walk; the roots and their pages are this join's,
   *  and fall with a leave. The public CDN and publish nodes keep the marker
   *  rule unchanged.
   *
   *  WHERE A SIG IS SHOWN. A root offered on page P is a tile on P: its own
   *  layer and resources are P's. Its children are tiles on P/<its name>, and
   *  so on down — every child-slot edge is one page step, named by the parent
   *  layer. So a branch that wears its own publish domains keeps its subtree
   *  on them (jwize 2026-10-07: publish domains take precedence over pools),
   *  however far up the root that reached it was offered; only the branch
   *  tile itself goes where the page it sits on goes.
   *
   *  root → the keys of the pages it was offered on ('' = the hive root);
   *  page key → its segments, and → its current roots; root → whether any
   *  offer vouched for its whole closure (a tile-only root never reaches a
   *  child layer, whatever another walk once recorded). */
  readonly #publicRoots = new Map<string, Set<string>>()
  readonly #pages = new Map<string, readonly string[]>()
  readonly #rootsByPage = new Map<string, Set<string>>()
  readonly #rootClosure = new Map<string, boolean>()
  /** child → parent → the edge (see #linkRef). */
  readonly #parentsOf = new Map<string, Map<string, RefEdge>>()
  /** parent → child → the same edge, forward (the re-stage walk). */
  readonly #refsOf = new Map<string, Map<string, RefEdge>>()
  /** What kind each marked sig is (the re-stage reads its local bytes). */
  readonly #kindOf = new Map<string, HostSyncKind>()
  #rootsJoined: boolean | null = null

  /** One recorded ref. `step`: the page step from the parent's page to the
   *  ref's ('' when the ref is shown on the parent's own page — a resource,
   *  a meta incidence — else the parent layer's name). `child`: a child-slot
   *  edge, crossed only under branch closure. */
  readonly #linkRef = (parent: string, ref: string, kind: HostSyncKind, child: boolean, step: string): void => {
    const edge: RefEdge = { kind, child, step }
    let parents = this.#parentsOf.get(ref)
    if (!parents) { parents = new Map(); this.#parentsOf.set(ref, parents) }
    if (!parents.has(parent)) parents.set(parent, edge)
    let refs = this.#refsOf.get(parent)
    if (!refs) { refs = new Map(); this.#refsOf.set(parent, refs) }
    if (!refs.has(ref)) refs.set(ref, edge)
  }

  /** Offer `root` on `page` (segments; [] = the hive root). */
  readonly #offerRoot = (root: string, page: readonly string[], closure: boolean): void => {
    const segments = page.map(s => String(s ?? ''))
    const key = segments.join('\u0000')
    let pages = this.#publicRoots.get(root)
    if (!pages) { pages = new Set(); this.#publicRoots.set(root, pages) }
    if (!pages.has(key)) this.#rootsVersion++
    pages.add(key)
    if (closure) this.#rootClosure.set(root, true)
    else if (!this.#rootClosure.has(root)) this.#rootClosure.set(root, false)
    if (key) {
      this.#pages.set(key, segments)
      let roots = this.#rootsByPage.get(key)
      if (!roots) { roots = new Set(); this.#rootsByPage.set(key, roots) }
      roots.add(root)
    }
  }

  /** The pages `sig` is shown on, through the roots the room is offered now
   *  (see #publicRoots): each root's page plus the steps down to the sig. */
  readonly #pagesOf = (sig: string): string[][] => {
    const out: string[][] = []
    const seen = new Set<string>()
    const stack: { s: string; steps: string[]; viaChild: boolean }[] = [{ s: sig, steps: [], viaChild: false }]
    let budget = HostSyncService.#PAGES_WALK_MAX
    while (stack.length > 0 && budget-- > 0) {
      const { s, steps, viaChild } = stack.pop()!
      const key = `${s}\u0001${viaChild ? 1 : 0}\u0001${steps.join('\u0000')}`
      if (seen.has(key)) continue
      seen.add(key)
      const pages = this.#publicRoots.get(s)
      // A sig reached through a child slot is the room's only under a root
      // that was offered with its closure.
      if (pages && (!viaChild || this.#rootClosure.get(s) === true)) {
        for (const pageKey of pages) out.push([...(pageKey ? this.#pages.get(pageKey) ?? [] : []), ...steps])
      }
      for (const [p, edge] of this.#parentsOf.get(s) ?? []) {
        stack.push({ s: p, steps: edge.step ? [edge.step, ...steps] : steps, viaChild: viaChild || edge.child })
      }
    }
    return out
  }

  static readonly #PAGES_WALK_MAX = 4_096

  /** Is `sig` inside the closure of a root the room is currently offered —
   *  shown on a page whose hosts include `domain`, when one is named? */
  readonly #neededBySwarm = (sig: string, domain?: string): boolean => {
    const pages = this.#pagesOf(sig)
    if (domain === undefined) return pages.length > 0
    return pages.some(page => this.#resolver.hostsFor(page).hosts.includes(domain))
  }

  /** The walk pruned this child as private: what only it needed stops
   *  travelling to the swarm's hosts (markers and queue entries stay — the
   *  next `markPublic` of the same root resumes it). */
  public readonly withdrawPublic = (sig: string): void => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return
    const pages = this.#publicRoots.get(s)
    this.#publicRoots.delete(s)
    this.#rootClosure.delete(s)
    this.#restagedAt.delete(s)
    const hadPages = this.#closurePagesOf.delete(s)
    for (const key of pages ?? []) {
      const roots = this.#rootsByPage.get(key)
      roots?.delete(s)
      if (roots && roots.size === 0) { this.#rootsByPage.delete(key); this.#pages.delete(key) }
    }
    this.#rootsVersion++
    if (hadPages) this.#targetSpecs()
  }

  // ── RE-STAGING: a host that becomes owed what was already sent elsewhere ──
  //
  // The marking walk runs once per sig per session (#markedWalk), and the
  // drain retires an entry once every target owed it AT THAT MOMENT holds it.
  // With one swarm host that was enough. With hosts per page it is not: a
  // picture shared on /meetup (the pool host) and later on /shop (its publish
  // domain), a pool that changes, a branch given a publish domain, a pool host
  // passed over for the relay — each makes a host owed sigs whose queue
  // entries are long gone. So, per root, whenever the hosts its closure is
  // shown on may have moved (a resolver change, a new page), the closure is
  // walked again IN MEMORY over the recorded edges, and every sig a host is
  // owed but holds no receipt for, and that is not still queued, is queued
  // again from the local bytes. A pair proven once is never asked again.

  /** Bumped on every resolver change: where pages' bytes go may have moved. */
  #hostsEpoch = 0
  /** root → the epoch + page set its closure was last re-staged under. */
  readonly #restagedAt = new Map<string, string>()
  /** sig → the hosts it is known to be receipted on (positive only). */
  readonly #receiptedOnHost = new Map<string, Set<string>>()
  /** root → every page its closure is shown on (key → segments). Fixed for a
   *  root and its page set — the edges never change — while the HOSTS of
   *  those pages are resolved live: a branch's own publish domain is a target
   *  even when the walk never offered a root on one of its pages. */
  readonly #closurePagesOf = new Map<string, Map<string, readonly string[]>>()
  /** Roots being re-staged, and roots asked for again meanwhile. */
  readonly #restaging = new Set<string>()
  readonly #restageAgain = new Set<string>()

  static readonly #RESTAGE_WALK_MAX = 20_000

  /** The swarm hosts `sig`'s closure is shown on (its own page and every page
   *  below it, as last re-staged) — synchronous. For a page's domain tags: a
   *  receiver taking a branch learns where its subtree went. */
  public readonly closureHostsOf = (sig: string): string[] => {
    const pages = this.#closurePagesOf.get(String(sig ?? '').trim().toLowerCase())
    const out: string[] = []
    for (const segments of pages?.values() ?? []) {
      for (const host of this.#resolver.hostsFor(segments).hosts) if (!out.includes(host)) out.push(host)
    }
    return out
  }

  /** Re-stage every current root (a resolver change). Sequential: the I/O is
   *  one closure at a time. */
  readonly #restageAll = async (): Promise<void> => {
    for (const root of [...this.#publicRoots.keys()]) {
      try { await this.#restage(root) } catch { /* the next change asks again */ }
    }
  }

  readonly #restage = async (root: string): Promise<void> => {
    if (!isJoinedHere()) return
    if (this.#restaging.has(root)) { this.#restageAgain.add(root); return }
    const pages = this.#publicRoots.get(root)
    if (!pages) return
    const closure = this.#rootClosure.get(root) === true
    const stamp = `${this.#hostsEpoch}|${closure ? 1 : 0}|${[...pages].sort().join('\u0001')}`
    if (this.#restagedAt.get(root) === stamp) return
    this.#restagedAt.set(root, stamp)
    this.#restaging.add(root)
    try {
      const shown = new Map<string, readonly string[]>()
      let complete = true
      const targets = new Map((await this.#targets()).map(t => [t.domain, t] as const))
      const work: { s: string; kind: HostSyncKind; page: string[] }[] = []
      for (const pageKey of pages) work.push({ s: root, kind: this.#kindOf.get(root) ?? 'layer', page: pageKey ? [...(this.#pages.get(pageKey) ?? [])] : [] })
      const seen = new Set<string>()
      let budget = HostSyncService.#RESTAGE_WALK_MAX
      while (work.length > 0 && budget-- > 0) {
        const { s, kind, page } = work.pop()!
        const pageKey = page.join('\u0000')
        const key = `${s}\u0001${pageKey}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!shown.has(pageKey)) shown.set(pageKey, page)
        const choice = this.#resolver.hostsFor(page)
        if (choice.pending) complete = false
        if (choice.hosts.length > 0) await this.#stageFor(s, kind, choice.hosts, targets)
        for (const [ref, edge] of this.#refsOf.get(s) ?? []) {
          if (edge.child && !closure) continue
          work.push({ s: ref, kind: edge.kind, page: edge.step ? [...page, edge.step] : page })
        }
      }
      // A page still being read: this root is walked again when it lands.
      if (!complete) this.#restagedAt.delete(root)
      if (!this.#publicRoots.has(root)) return // withdrawn while we walked
      const before = this.#closurePagesOf.get(root)
      this.#closurePagesOf.set(root, shown)
      if (before && before.size === shown.size && [...shown.keys()].every(k => before.has(k))) return
      // New pages under this root: their hosts are targets now. A host that
      // was not one when this pass began could not be staged for — once more.
      this.#rootsVersion++
      this.#targetSpecs()
      const missed = [...shown.values()].some(page => this.#resolver.hostsFor(page).hosts.some(h => !targets.has(h)))
      if (missed) { this.#restagedAt.delete(root); this.#restageAgain.add(root) }
      if (this.#anyEnabled()) void this.drain()
      // The swarm names these hosts in its domain tags: walk again.
      EffectBus.emit('swarm:hosts-changed', { at: Date.now() })
    } finally {
      this.#restaging.delete(root)
      if (this.#restageAgain.delete(root)) void this.#restage(root)
    }
  }

  /** Make sure `sig` reaches each of `hosts` it is owed: a receipt there, or
   *  its entry still queued, already does; otherwise it is queued again from
   *  the local bytes (what this tab does not hold it never had to send). A
   *  host that is not a target yet is asked on the next pass. */
  readonly #stageFor = async (
    sig: string,
    kind: HostSyncKind,
    hosts: readonly string[],
    targets: ReadonlyMap<string, SyncTarget>,
  ): Promise<void> => {
    const proven = this.#receiptedOnHost.get(sig)
    let owed = false
    for (const host of hosts) {
      if (proven?.has(host)) continue
      const target = targets.get(host)
      if (!target) continue
      if (await this.#receiptExists(sig, target)) { this.#noteReceiptedOn(sig, host); continue }
      owed = true
    }
    if (!owed) return
    const queueDir = await this.#getQueueDir(false)
    if (queueDir) {
      try { await queueDir.getFileHandle(`${sig}.${kind}`, { create: false }); return } catch { /* not queued */ }
    }
    let bytes: ArrayBuffer | null = null
    try { bytes = await this.#readLocalBytes(sig, kind) } catch { bytes = null }
    if (bytes) await this.enqueue(sig, kind, bytes)
  }

  readonly #noteReceiptedOn = (sig: string, host: string): void => {
    let hosts = this.#receiptedOnHost.get(sig)
    if (!hosts) { hosts = new Set(); this.#receiptedOnHost.set(sig, hosts) }
    hosts.add(host)
  }

  /** Marker existence = "this sig is inside a published-public closure". */
  readonly #isPublicMarked = async (sig: string): Promise<boolean> => {
    if (this.#publicMarked.has(sig)) return true
    const dir = await this.#getQueueDir(false)
    if (!dir) return false
    try {
      await dir.getFileHandle(`${sig}.${PUBLIC_MARKER_SUFFIX}`, { create: false })
      this.#publicMarked.add(sig)
      return true
    } catch { return false }
  }

  readonly #writePublicMarker = async (sig: string): Promise<void> => {
    if (this.#publicMarked.has(sig)) return
    const dir = await this.#getQueueDir()
    if (!dir) return
    try {
      const handle = await dir.getFileHandle(`${sig}.${PUBLIC_MARKER_SUFFIX}`, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      this.#publicMarked.add(sig)
    } catch { /* best-effort; the next markPublic call retries */ }
  }

  /** Mark a sig — and, for layers, its transitive closure — as belonging
   *  to a PUBLISHED-PUBLIC closure, then (re-)stage any locally-held bytes.
   *
   *  This is the write side of the doctrine gate: the drain will only ever
   *  PUT a sig to a public-only target when its `{sig}.public` marker
   *  exists, and markers exist only through this method. The caller is the
   *  swarm publish walk (swarm.drone.ts), which enumerates EXACTLY the
   *  participant's public subset (isCellPublic-filtered children) — so
   *  private tiles, secrets, clipboard, settings, presence and every other
   *  participant-local kind can never acquire a marker: they are never in
   *  a public root's closure.
   *
   *  Markers persist on disk (crash-safe, like queue entries) so a closure
   *  marked in one session drains in the next. Flipping a tile back to
   *  private stops FUTURE closures (new sigs, new markers) — bytes already
   *  read back from the CDN are public by then; the CDN has no delete.
   *
   *  Also re-ENQUEUES held bytes: an entry drained to the self-domain
   *  before the public gate came on was removed from the queue, so marking
   *  must restage it for the public target (enqueue is idempotent and
   *  skips anything already fully receipted). Inert without the
   *  hc:public-host opt-in.
   *
   *  `closure` (PRIVACY-CRITICAL): true = the caller vouches the WHOLE
   *  subtree is public (a public-BRANCH root — isBranchPublic), so the walk
   *  recurses into child layers. false = only THIS tile is public
   *  (individually-marked), so the walk keeps the layer's own resource/
   *  bee/dependency refs and the resource content-descent but NEVER
   *  recurses into `cells`/`layers`/`children` — a tile-only public tile
   *  must never mark its private descendants' layers.
   *
   *  `page` (a joined tab): the page the walk offers the root ON — the root
   *  is a tile there, and where that page's bytes go decides where it goes
   *  (swarm-hosts.ts); its subtree goes where the pages below go. Omitted or
   *  null: the hive root. `false`: NOT a room offer at all — a publish, a
   *  vocabulary claim: its bytes go to the nodes that act named (the marker
   *  rule), never to the room's hosts. */
  public readonly markPublic = async (
    sig: string,
    kind: HostSyncKind = 'layer',
    closure = true,
    page?: readonly string[] | null | false,
  ): Promise<void> => {
    // A public-only target must exist, or be about to, for the marker to mean
    // anything: a swarm host while joined (resolved per page — a page whose
    // hosts are still being read stages now and drains when they land), the
    // standing public host, or a node a publish named for this act.
    if (!this.#publicHostEnabled() && this.#publishNodes.size === 0 && !isJoinedHere()) return
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return
    // A root the room is offered now, on this page — before the walk dedup,
    // so a root named again after a withdrawal resumes without re-reading
    // anything. `page` is where the walk offered it (its publish domains
    // decide where it goes).
    const offered = page !== false && isJoinedHere()
    const segments = page === false ? [] : (page ?? []).map(x => String(x ?? ''))
    if (offered) {
      // A LOOKUP, not a warm: a root staged while its page's hosts are still
      // being read waits on them, so their landing must kick the drain.
      void this.#resolver.hostsFor(segments)
      this.#offerRoot(s, segments, closure)
    }
    await this.#mark(s, kind, closure)
    // What was already sent elsewhere (or retired from the queue) reaches the
    // hosts this offer owes it to.
    if (offered) await this.#restage(s)
  }

  /** The marking walk below a root (see markPublic). */
  readonly #mark = async (s: string, kind: HostSyncKind, closure: boolean): Promise<void> => {
    // Walk dedup: a completed full-closure walk (bare `s`) covers both
    // shapes; a completed tile-only walk must not block a later
    // closure=true call (branch flipped public after the tile was).
    if (this.#markedWalk.has(s)) return
    const walkKey = closure ? s : `${s}:tile`
    if (this.#markedWalk.has(walkKey)) return
    this.#markedWalk.add(walkKey)
    if (!this.#kindOf.has(s)) this.#kindOf.set(s, kind)
    await this.#writePublicMarker(s)
    let bytes: ArrayBuffer | null = null
    try { bytes = await this.#readLocalBytes(s, kind) } catch { bytes = null }
    if (!bytes) return // not held locally — the marker waits for content:wrote
    void this.enqueue(s, kind, bytes)
    if (kind === 'layer') {
      // Same slot→kind classification as #enqueueLayerRefs, but marking:
      // the closure of a public-BRANCH layer is public in its entirety;
      // a tile-only layer shares its own refs but no child layers.
      let layer: Record<string, unknown>
      try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return }
      if (!layer || typeof layer !== 'object') return
      // Meta envelope: the incidence IS the whole reference set. Its
      // `relation` plays the part a slot name plays below, so the privacy
      // gate reads identically. The envelope stands for what it points at:
      // the same tile, on the same page.
      const incidence = metaIncidence(layer)
      if (incidence) {
        const childIncidence = metaIsChildIncidence(layer, incidence.kind)
        if (childIncidence && !closure) return
        const ref = String(incidence.sig ?? '').trim().toLowerCase()
        if (!SIG_RE.test(ref)) return
        this.#linkRef(s, ref, incidence.kind, childIncidence, '')
        return await this.#mark(ref, incidence.kind, closure)
      }
      // A child layer is a tile on THIS layer's own page, one step down.
      const name = typeof layer['name'] === 'string' ? String(layer['name']) : ''
      for (const [slot, value] of Object.entries(layer)) {
        if (!Array.isArray(value)) continue
        const isChildSlot = CHILD_SLOT_SET.has(slot)
        // PRIVACY GATE: without branch closure, descendant layers stay
        // private — skip the child slots entirely.
        if (isChildSlot && !closure) continue
        const refKind: HostSyncKind = isChildSlot ? 'layer'
          : slot === 'bees' ? 'bee'
          : slot === 'dependencies' ? 'dependency'
          : 'resource'
        for (const raw of value) {
          const ref = String(raw ?? '').trim().toLowerCase()
          if (!SIG_RE.test(ref) || ref === s) continue
          this.#linkRef(s, ref, refKind, isChildSlot, isChildSlot ? name : '')
          await this.#mark(ref, refKind, closure)
        }
      }
    } else if (kind === 'resource') {
      // Content descent — a website page body + its embedded assets, or a
      // properties blob's nested image sig, are part of the public closure
      // too (same reasoning as #enqueueResourceClosure).
      const nested = [
        ...await decorationClosureSigs(bytes, r => this.#readLocalBytes(r, 'resource')),
        ...nestedResourceSigs(bytes),
      ]
      for (const raw of nested) {
        const ref = String(raw ?? '').trim().toLowerCase()
        if (!SIG_RE.test(ref) || ref === s) continue
        this.#linkRef(s, ref, 'resource', false, '')
        await this.#mark(ref, 'resource', true)
      }
    }
  }

  /** Read a sig's bytes from the matching LOCAL store only — never the
   *  network (the walk pushes what we hold; it must not trigger fetches). */
  readonly #readLocalBytes = async (sig: string, kind: HostSyncKind): Promise<ArrayBuffer | null> => {
    const store = this.#ioc<{
      getLayerPoolBytes?: (s: string) => Promise<Uint8Array | null>
      getResourceLocal?: (s: string) => Promise<Blob | null>
      bees?: FileSystemDirectoryHandle
      dependencies?: FileSystemDirectoryHandle
      legacyBees?: FileSystemDirectoryHandle
      legacyDependencies?: FileSystemDirectoryHandle
    }>(STORE_KEY)
    if (!store) return null
    if (kind === 'layer') {
      const bytes = await store.getLayerPoolBytes?.(sig)
      return bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer : null
    }
    if (kind === 'resource') {
      const blob = await store.getResourceLocal?.(sig)
      return blob ? await blob.arrayBuffer() : null
    }
    // bee / dependency — sig-named files in the sign('bees')/sign('dependencies')
    // pools. UNION the pool handle with its legacy drain handle: absorbs are
    // detached, so mid-migration a record may still sit in the legacy dir. Reading
    // the pool alone would return null and host backup would silently stage
    // nothing. Both name shapes tried at each source: pools are bare-sig, the
    // legacy dirs used `{sig}.js`.
    const pool = kind === 'bee' ? store.bees : store.dependencies
    const legacy = kind === 'bee' ? store.legacyBees : store.legacyDependencies
    for (const dir of [pool, legacy]) {
      if (!dir) continue
      for (const name of [sig, `${sig}.js`]) {
        try {
          const handle = await dir.getFileHandle(name, { create: false })
          return await (await handle.getFile()).arrayBuffer()
        } catch { /* try next name shape / source */ }
      }
    }
    return null
  }

  /** Does a LOCAL store hold this sig? An existence test, never a read: a
   *  picture is a Blob handle here, not megabytes copied into the heap. The
   *  share gate asks this of every unreceipted node on every walk, and a
   *  receipt re-walk runs once per landed receipt while photos upload — with
   *  a full read per node each walk re-read every waiting picture. */
  readonly #holdsLocal = async (sig: string, kind: HostSyncKind): Promise<boolean> => {
    const store = this.#ioc<{
      getLayerPoolBytes?: (s: string) => Promise<Uint8Array | null>
      getResourceLocal?: (s: string) => Promise<Blob | null>
      bees?: FileSystemDirectoryHandle
      dependencies?: FileSystemDirectoryHandle
      legacyBees?: FileSystemDirectoryHandle
      legacyDependencies?: FileSystemDirectoryHandle
    }>(STORE_KEY)
    if (!store) return false
    if (kind === 'resource') return !!(await store.getResourceLocal?.(sig))
    if (kind === 'layer') return !!(await store.getLayerPoolBytes?.(sig))
    const pool = kind === 'bee' ? store.bees : store.dependencies
    const legacy = kind === 'bee' ? store.legacyBees : store.legacyDependencies
    for (const dir of [pool, legacy]) {
      if (!dir) continue
      for (const name of [sig, `${sig}.js`]) {
        try { await dir.getFileHandle(name, { create: false }); return true } catch { /* next */ }
      }
    }
    return false
  }

  /** Drain the queue to every enabled target. Single-flight (a call made
   *  while one runs is honoured once it ends). Per entry, each applicable
   *  target gets its own signed PUT + receipt (public-only targets require
   *  the `{sig}.public` marker — the doctrine gate — and are skipped silently
   *  without it). The entry leaves the queue only when EVERY currently-
   *  enabled applicable target holds its receipt (or refused that entry for
   *  good); failures leave it for the host's own backoff. Backoff is PER
   *  HOST — a paused public CDN never stalls the swarm's host or self-domain
   *  backup, and vice versa. No-op when no target is enabled. */
  public readonly drain = async (): Promise<void> => {
    // Belt and braces with #anyEnabled: drain is also called directly by
    // callers that know they just staged something. In a published website
    // there is nothing to stage and nowhere to send it.
    if (this.#readonlyVisitor()) return
    if (this.#draining) { this.#drainAgain = true; return }
    // Claimed BEFORE the first await: a burst of enqueues each kicks a drain,
    // and a flag set after `await #targets()` let every one of them through —
    // concurrent passes asking the host the same HEAD five times over.
    this.#draining = true
    try {
      let targets = await this.#targets()
      if (targets.length === 0) return // nothing enabled — stay inert
      // PER-HOST BACKOFF: a host that failed is asked nothing and sent
      // nothing until its window ends — and every read-triggered enqueue()
      // kicks a fresh drain, so without this gate each staged sig would cost
      // one more refusal. The window's end schedules the retry
      // (#scheduleRetry); a reopened mesh socket, enable(), enablePublicHost()
      // and reDrain() end it early. If every target is paused there is
      // nothing to do yet.
      // A swarm host stops being a target the moment this tab leaves (or no
      // offered page resolves to it): a pass that began joined must not keep
      // PUTting into the room.
      const active = (t: SyncTarget): boolean =>
        this.#hostActive(t.domain) && (!t.swarm || t.marker === true || this.#swarmSources().has(t.domain))
      if (!targets.some(active)) return
      // Absorb any legacy dirs into the pools first, under this same
      // single-flight guard so it can never race the queue removals below.
      await this.#absorbLegacy()
      for (;;) {
        const queue = await this.#listQueue()
        if (queue.length === 0) break
        // A target that has not answered yet goes first (#canariesFirst):
        // its first answer, or failure, never waits behind another's backlog.
        const entries = await this.#canariesFirst(queue, targets.filter(t => t.swarm === true && active(t)))
        // The target set this pass was planned for (see the batches below), in
        // the words #noteTargetSet keys it by.
        const plannedFor = targets.map(t => `${t.domain}${t.hostHash === null ? '!' : ''}`).join(' ')
        let regather = false
        let progressed = false
        // THE HOST IS THE TRUTH; the receipt is a memo of it. Before its
        // bytes are sent, every entry is reconciled against every target it
        // owes (a batch at a time — below): a receipt on file, or — lacking
        // one — the host asked directly (a HEAD). A host that already serves
        // the sig earns its receipt on the spot and is never sent the bytes
        // again. This is what a host is FOR: it is already up to date, and a
        // browser without the ledger (new profile, lost pool, a node named
        // for the first time) must discover that rather than re-upload its
        // hive.
        // The reconciliation is silent; only real uploads are painted.
        // A paused host is asked nothing and sent nothing this pass — a HEAD
        // per queued entry every tick against a capped Worker is not free.
        // Entries owed only to paused hosts wait, uncounted.
        type Owed = { entry: QueueEntry; applicable: SyncTarget[]; owed: SyncTarget[]; paused: number }
        const reconcile = async (entry: QueueEntry): Promise<Owed | null> => {
          // Applicable targets for THIS sig: a public-only target requires
          // the `.public` marker — skip silently without it (the doctrine
          // gate; the marker may arrive later via markPublic). A target that
          // refused this entry for good (413, 409) is not owed it.
          const applicable: SyncTarget[] = []
          let refused = 0
          for (const target of targets) {
            if (target.publicOnly && !(await this.#isPublicMarked(entry.sig))) continue
            if (!this.#owedBy(target, entry.sig)) continue
            if (this.#refusedEntries.has(`${target.domain}:${entry.sig}`)) { refused++; continue }
            applicable.push(target)
          }
          // No destination: wait for a marker — unless every destination
          // refused it, and then nothing is owed anywhere (retired below).
          if (applicable.length === 0) return refused > 0 ? { entry, applicable, owed: [], paused: 0 } : null
          const owed: SyncTarget[] = []
          let paused = 0
          for (const target of applicable) {
            if (await this.#targetReceipted(entry.sig, target)) continue
            if (!active(target)) { paused++; continue }
            if (await this.#hostHolds(entry.sig, target)) continue // served already — receipted just now
            owed.push(target)
          }
          return { entry, applicable, owed, paused }
        }
        // IN BATCHES, so the first byte never waits on the whole queue. A
        // reload re-stages a big hive's whole public closure for a host that
        // holds none of it — thousands of entries — and reconciling every one
        // of them (a receipt read and a HEAD each) before the first PUT held
        // the first receipt, or the first failure that passes a dead host
        // over, for minutes: the 2026-10-10 meeting read "uploading" for 40
        // of them. Each batch is reconciled CONCURRENTLY (the probes share the
        // verify cap, so a batch costs B/4 round trips, not B×T), then sent,
        // then the next — the same HEAD-before-PUT dedup, a batch at a time.
        // A pass that finds every target paused (a failure in this very pass)
        // stops there: the backoff retries, and the rest wait, unasked.
        //
        // Live progress for the surfaces that paint an upload (the presence
        // strip): `done` ticks AFTER an entry's sends resolve — so "k of M"
        // means k landed. M is what the batches reconciled so far found the
        // hosts lack, plus the entries not reconciled yet — an upper bound
        // that shrinks to the truth as the pass goes — so a big queue shows
        // its upload after its first batch, never after its last. Nothing is
        // painted until some host is found to lack something, and the strip
        // clears when the pass ends. Reports only — nothing waits on it.
        let done = 0
        let found = 0
        let unread = entries.length
        let shown = false
        const report = (): void => {
          if (found === 0 && !shown) return
          shown = true
          EffectBus.emit('host-sync:progress', { done, total: found + unread })
        }
        for (let at = 0; at < entries.length; at += HostSyncService.#DRAIN_BATCH) {
          if (!targets.some(active)) break // paused in this pass — the backoff retries
          // THE TARGETS MOVED since the pass was planned — a branch given its
          // publish domain, a pool host passed over for the next: the pass
          // starts over with the new set (its new host's canary first) rather
          // than finish a backlog the new host waits behind. Synchronous, from
          // caches; at least one batch goes per pass, so a flapping set still
          // moves.
          if (at > 0) {
            this.#targetSpecs()
            if (this.#targetSetKey !== plannedFor) { regather = true; break }
          }
          const batch = entries.slice(at, at + HostSyncService.#DRAIN_BATCH)
          const work: Owed[] = []
          for (const r of await HostSyncService.#mapConcurrently(batch, HostSyncService.#VERIFY_MAX_CONCURRENT, reconcile)) {
            if (!r) continue
            if (r.owed.length === 0 && r.paused === 0) {
              // Every target serves it (or refused it for good) — the entry's
              // job is done. Retire it exactly as a confirmed push would.
              await this.#removeEntry(r.entry)
              progressed = true
              if (r.applicable.length === 0) continue // refused everywhere — nothing was receipted
              this.dispatchEvent(new CustomEvent('receipt', { detail: { sig: r.entry.sig } }))
              EffectBus.emit('host:receipt', { sig: r.entry.sig })
              continue
            }
            if (r.owed.length === 0) continue // owed only to paused hosts — waits, uncounted
            work.push(r)
          }
          unread -= batch.length
          found += work.length
          report()
          // FOUR AT A TIME. Each entry's targets go in order; entries overlap,
          // so a page of tiles is one or two round trips, not one per tile.
          // Crash safety is per entry and unchanged: every receipt is written
          // before its entry is removed, so an interrupted pass re-checks them.
          await HostSyncService.#mapConcurrently(work, HostSyncService.#PUSH_MAX_CONCURRENT, async ({ entry, applicable, owed, paused }) => {
            try {
              // Settled = receipted, or refused for good by that target.
              let settled = applicable.length - owed.length - paused
              let served = settled > 0
              for (const target of owed) {
                if (!active(target)) continue // paused by a sibling's failure in THIS pass — entry stays
                const outcome = await this.#pushAndReceipt(target, entry)
                if (outcome === 'corrupt') {
                  // Local bytes for this sig don't hash to it — the host would
                  // (or did) 422. Retrying identical bytes can never succeed, so
                  // drop the entry and warn ONCE per sig, naming sig + kind so
                  // the upstream source of the bad bytes can be traced. A
                  // per-entry condition, never the host's — keep draining.
                  await this.#removeEntry(entry)
                  if (!this.#warnedCorrupt.has(entry.sig)) {
                    this.#warnedCorrupt.add(entry.sig)
                    console.warn(
                      `[host-sync] dropped ${entry.kind} ${entry.sig.slice(0, 12)}… from backup queue — ` +
                      `local bytes do not hash to this sig (would 422). The source store holds ` +
                      `non-canonical bytes for it; that sig is now unreachable for witnessing peers ` +
                      `until it is re-authored.`
                    )
                  }
                  return
                }
                if (outcome === 'local') continue // nothing was asked of the host — the timer retries
                if (outcome !== 'ok') {
                  if (outcome.drop) {
                    // About THIS entry only (too large, a reserved address):
                    // that target never owes it again; the host stays healthy.
                    this.#refusedEntries.add(`${target.domain}:${entry.sig}`)
                    this.#entryRefusal.set(target.domain, { status: outcome.status, reason: outcome.reason, sig: entry.sig })
                    this.#emitSyncState(target)
                    settled++
                    progressed = true
                  } else {
                    this.#noteHostFailure(target, outcome)
                  }
                  continue
                }
                this.#hostBackoff.delete(target.domain) // a success resets the host's ladder
                settled++
                served = true
                progressed = true
                // Attribution: a PUBLIC-target receipt means that host now
                // serves this sig — record it in the broker's address graph so
                // an adopt-click can answer getKnownDomains() without a mesh wait.
                if (target.publicOnly) this.#noteAttribution(entry.sig, target.domain)
              }
              if (settled === applicable.length) {
                // EVERY currently-enabled applicable target confirmed (or
                // refused for good) — the entry's job is done (crash-safe:
                // receipts land before this removal).
                await this.#removeEntry(entry)
                progressed = true
                if (served) {
                  this.dispatchEvent(new CustomEvent('receipt', { detail: { sig: entry.sig } }))
                  EffectBus.emit('host:receipt', { sig: entry.sig })
                }
              }
            } finally {
              done++
              report()
            }
          })
        }
        // A pass that stopped early leaves its unread entries for the next
        // one: the strip does not go on promising them.
        if (shown && done < found + unread) EffectBus.emit('host-sync:progress', { done, total: done })
        if (regather) {
          targets = await this.#targets()
          if (!targets.some(active)) break
          continue
        }
        if (!progressed) break // nothing advanced (hosts unreachable/paused) — stop; the backoff retries
      }
      // Per-host state: pending = entries THIS host still owes a receipt
      // for; a host with a standing failure reports that failure instead.
      const leftovers = await this.#listQueue()
      for (const target of targets) {
        let pending = 0
        for (const e of leftovers) {
          if (target.publicOnly && !(await this.#isPublicMarked(e.sig))) continue
          if (!this.#owedBy(target, e.sig)) continue
          if (this.#refusedEntries.has(`${target.domain}:${e.sig}`)) continue
          if (!(await this.#receiptExists(e.sig, target))) pending++
        }
        // Nothing owed: an earlier failure no longer describes this host (it
        // may have been answered by a HEAD that found the bytes already there).
        if (pending === 0) this.#hostBackoff.delete(target.domain)
        this.#emitSyncState(target, pending)
      }
    } finally {
      this.#draining = false
      this.#scheduleRetry()
      if (this.#drainAgain) { this.#drainAgain = false; void this.drain() }
    }
  }

  static readonly #PUSH_MAX_CONCURRENT = 4
  /** Entries reconciled before their sends go (see drain): eight HEAD round
   *  trips at the verify cap, whatever the queue holds. */
  static readonly #DRAIN_BATCH = 32

  /** ONE CANARY PER SWARM HOST THAT HAS NOT ANSWERED YET. The batches walk
   *  the queue oldest first, so a host whose entries were staged behind
   *  another's backlog — a branch given its publish domain (or a typo of one)
   *  while the pool host takes a whole hive — would be asked nothing until
   *  every earlier batch went, and until its first answer or failure the
   *  status lines have nothing true to say about it. The first entry each
   *  such host is owed (and holds no receipt for) is moved into the first
   *  batch; the rest keep their order. Local reads only, and a host is no
   *  longer asked about once it has answered or failed. */
  readonly #canariesFirst = async (entries: QueueEntry[], targets: readonly SyncTarget[]): Promise<QueueEntry[]> => {
    const lead: QueueEntry[] = []
    for (const target of targets) {
      const host = target.domain
      if (this.#answeredHosts.has(host) || this.#provenHosts.has(host) || this.#hostBackoff.has(host)) continue
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        if (!this.#owedBy(target, entry.sig) || this.#refusedEntries.has(`${host}:${entry.sig}`)) continue
        if (this.#receiptedOnHost.get(entry.sig)?.has(host)) continue
        if (target.publicOnly && !(await this.#isPublicMarked(entry.sig))) continue
        if (await this.#receiptExists(entry.sig, target)) { this.#noteReceiptedOn(entry.sig, host); continue }
        // Already in the first batch, or already a canary: nothing to move.
        if (i >= HostSyncService.#DRAIN_BATCH && !lead.includes(entry)) lead.push(entry)
        break
      }
    }
    if (lead.length === 0) return entries
    const moved = new Set(lead)
    return [...lead, ...entries.filter(entry => !moved.has(entry))]
  }

  /** A swarm host (as a public-only target) is owed only what a current root
   *  offered on a page it serves needs (#neededBySwarm); every other target —
   *  and a swarm host that is also the public host or a publish node —
   *  whatever its marker rule says. */
  readonly #owedBy = (target: SyncTarget, sig: string): boolean =>
    !(target.swarm && target.publicOnly) || target.marker === true || this.#neededBySwarm(sig, target.domain)

  /** Is this host taking requests right now? */
  readonly #hostActive = (domain: string): boolean => Date.now() >= (this.#hostBackoff.get(domain)?.until ?? 0)

  /** Record a host's failure and pause it (the classes: see BACKOFF_BASE_MS).
   *  One wave, one step: sends that were already in flight when a sibling
   *  paused the host do not each double the wait — they only lengthen it if
   *  their own answer asks for longer. */
  readonly #noteHostFailure = (target: SyncTarget, failure: PushFailure): void => {
    const now = Date.now()
    const prev = this.#hostBackoff.get(target.domain)
    const sameWave = prev !== undefined && now < prev.until
    const streak = sameWave ? prev.streak : (prev?.streak ?? 0) + 1
    const notLive = failure.status !== 'not-live' ? 0 : sameWave ? prev.notLive : (prev?.notLive ?? 0) + 1
    const ladder = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (streak - 1))
    // A refusal read from the browser's side (`threw`, #putThrew) is not the
    // host's own word: it waits on the ladder, never the refusal's 10 min.
    const wait = failure.status === 'refused' && !failure.threw ? REFUSED_BACKOFF_MS
      : failure.status === 'full' ? Math.max(FULL_MIN_BACKOFF_MS, failure.retryAfterMs ?? 0)
      : failure.status === 'not-live' && notLive <= NOT_LIVE_RETRIES ? NOT_LIVE_RETRY_MS
      : ladder + Math.floor(Math.random() * ladder * 0.25)
    const until = Math.max(now + wait, sameWave ? prev.until : 0)
    this.#hostBackoff.set(target.domain, { until, streak, notLive, status: failure.status, reason: failure.reason, ...(failure.threw ? { threw: true as const } : {}) })
    this.#notePoolHostFailure(target, failure, streak)
    if (!sameWave || prev.status !== failure.status) {
      this.#emitSyncState(target)
      // Once per episode: the ladder's later waves say nothing new.
      if (failure.threw) { if (!prev?.threw) console.warn(`[host-sync] ${target.domain} answers, but no upload from this page reaches it (its CORS preflight?) — retried on the ladder`) }
      // An operator fixing a writers list needs the exact key — once per episode.
      else if (failure.status === 'refused') void this.#getOwnPubkey().then(pk => console.warn(
        `[host-sync] ${target.domain} refused uploads (${failure.reason}) — paused ${REFUSED_BACKOFF_MS / 60_000} min; ` +
        `ioc.get('@diamondcoreprocessor.com/HostSyncService').enable() retries now. pubkey: ${pk || '(no signer available)'}`))
    }
    this.#scheduleRetry()
  }

  /** Pool hosts passed over for what may have been the PATH — silent, or
   *  answering a page, while the mesh was not open; or uploads that never
   *  left the browser (#putThrew) — given back when a socket comes back. */
  readonly #downWhileOffline = new Set<string>()
  /** Hosts that held a receipt this session: proven to take uploads, so a
   *  run of silence from one is the path, not the host. */
  readonly #provenHosts = new Set<string>()

  /** A POOL HOST THAT CANNOT TAKE UPLOADS MUST NOT STRAND THE ROOM. When one
   *  refuses (401/403 — the writers list, a closed door; or an upload its
   *  CORS preflight never lets leave while it answers everything else —
   *  #putThrew), or is full, the resolver passes it over at once; a page
   *  where a heap should be already was, at the HEAD (#hostHolds). One that
   *  has never answered an upload and stays silent while this tab is
   *  connected is passed over on its second wave. Then the next pool host,
   *  else a relay that hosts participants (swarm-hosts.ts). Publish domains
   *  are the participant's explicit choice for a branch and are never passed
   *  over; the status lines name the branch, the host and why instead. */
  readonly #notePoolHostFailure = (target: SyncTarget, failure: PushFailure, streak: number): void => {
    if (!target.swarm || !this.#resolver.isPoolHost(target.domain)) return
    const { status } = failure
    const reason = `${status}: ${failure.reason}`
    if (status === 'refused' || status === 'full') {
      // Only the host's OWN refusal (a 4xx) is remembered across a reload of
      // this tab. A full host named its own wait; an upload that never left
      // the browser may have been the path — this page's only, and given
      // back with the next socket.
      if (failure.threw) this.#downWhileOffline.add(target.domain)
      this.#resolver.markDown(target.domain, reason, status === 'refused' && !failure.threw)
      return
    }
    if (status !== 'unreachable' || this.#provenHosts.has(target.domain) || streak < 2) return
    // Silence is weak evidence — a 5xx while the host deploys, a timeout, or
    // the path itself down (given back with the next socket): this page's
    // only, never remembered across a reload.
    if (this.#meshState !== 'open') this.#downWhileOffline.add(target.domain)
    this.#resolver.markDown(target.domain, reason, false)
  }

  /** One timer for the earliest backoff that ends — the retry is the host's
   *  own window, never the 30 s sweep. */
  readonly #scheduleRetry = (): void => {
    const now = Date.now()
    let at = Infinity
    for (const b of this.#hostBackoff.values()) if (b.until > now && b.until < at) at = b.until
    if (at === Infinity) return
    if (this.#retryTimer !== undefined && this.#retryAt > now && this.#retryAt <= at) return
    clearTimeout(this.#retryTimer)
    this.#retryAt = at
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined
      this.#retryAt = 0
      if (this.#anyEnabled()) void this.drain()
    }, at - now)
  }

  /** Announce one host's state on `sync:state`: a standing failure wins, then
   *  an upload still owed ('syncing'), then the last per-entry refusal, else
   *  'backed-up'. `status` and `state` carry the same word (status for the
   *  older readers); `reason` is the host's own first line; `missing` counts
   *  closure refs no local store holds and no host serves ("not held here"). */
  readonly #emitSyncState = (target: SyncTarget, pending = this.#lastPending.get(target.domain) ?? 0): void => {
    this.#lastPending.set(target.domain, pending)
    const failure = this.#hostBackoff.get(target.domain)
    let refusal = this.#entryRefusal.get(target.domain)
    if (refusal && target.swarm && target.publicOnly && !target.marker && !this.#neededBySwarm(refusal.sig, target.domain)) {
      this.#entryRefusal.delete(target.domain)
      refusal = undefined
    }
    const status: SyncStatus = failure ? failure.status
      : pending > 0 ? 'syncing'
      : refusal ? refusal.status
      : 'backed-up'
    const reason = failure ? failure.reason : pending === 0 && refusal ? refusal.reason : ''
    const why = this.#whyOf(target.domain, status, reason)
    EffectBus.emit('sync:state', {
      host: target.domain, pending, status, state: status, reason,
      // Why it is not taking the bytes, as a person acts on it (#whyOf) —
      // absent while it is.
      ...(why ? { why } : {}),
      swarm: target.swarm === true, missing: this.#missingLocal.size,
      // Why this host: the page's publish domains, the hosts pool, or the
      // relay that allows participants (absent for every other target).
      ...(target.swarm ? { source: [...(this.#swarmSources().get(target.domain) ?? [])][0] ?? 'none' } : {}),
    })
  }

  /** WHY, in the words a person acts on (HostWhy). Only a failing status has
   *  one. A page where a heap answers bytes is `page`, whatever the push then
   *  said; `unreachable` from a host that never answered anything at all
   *  while this tab was online and its socket open is `unresolved` — the name
   *  does not reach a running host (the 2026-10-10 `hyperccomb.com` typo:
   *  NXDOMAIN read as "uploading" for ever; also a machine host that is
   *  switched off, whose edge's error page carries no CORS — the browser
   *  cannot tell them apart, so the line asks for both). A timeout is never
   *  `unresolved`: something answered the connection. */
  readonly #whyOf = (domain: string, status: SyncStatus, reason = ''): HostWhy | '' => {
    if (status === 'backed-up' || status === 'syncing') return ''
    if (status === 'too-large' || status === 'not-live' || status === 'full') return status
    if (this.#answersPage.has(domain)) return 'page'
    if (status === 'refused') return 'refused'
    const silent = !this.#answeredHosts.has(domain) && !this.#provenHosts.has(domain)
    return silent && reason !== 'timed out' && this.#meshState === 'open' && !HostSyncService.#offline() ? 'unresolved' : 'unreachable'
  }

  /** The browser says it has no network at all (navigator.onLine false) —
   *  then nothing that failed is the host's to answer for. */
  static #offline(): boolean {
    try { return globalThis.navigator?.onLine === false } catch { return false }
  }

  /**
   * WHAT STOPS A HOST TAKING THIS TAB'S UPLOADS, or null — synchronous, from
   * memory. Its standing failure, or (a pool host the resolver passed over
   * without a push — it answered a page) why it was passed over; and WHY, as
   * `sync:state` says it. A failure about one file, or one the host itself
   * clears in a moment (`too-large`, `not-live`), is no trouble of the
   * host's. The publish row asks it of each domain a branch publishes to, so
   * a branch whose domain can never take a write says so, by name, instead
   * of reading as uploading.
   */
  public readonly hostTrouble = (host: string): { host: string; status: SyncStatus; why: HostWhy; reason: string } | null => {
    const domain = foldContentLabel(String(host ?? '').trim().toLowerCase()
      .replace(/^(?:wss?|https?):\/\//, '').replace(/\/+$/, ''))
    if (!domain) return null
    const failure = this.#hostBackoff.get(domain)
    const down = this.#resolver.downReason(domain)
    if (failure) {
      const why = this.#whyOf(domain, failure.status, failure.reason)
      if (!why || why === 'too-large' || why === 'not-live') return null
      return { host: domain, status: failure.status, why, reason: failure.reason }
    }
    if (!down) return null
    // Passed over with no standing failure here: at its HEAD (a page where a
    // heap answers bytes), or before a reload of this tab — which remembers
    // why in the reason it was passed over with, never "check the name".
    const why: HostWhy = this.#answersPage.has(domain) ? 'page' : HostSyncService.#whyOfDown(down)
    const status: SyncStatus = why === 'full' ? 'full' : why === 'unreachable' ? 'unreachable' : 'refused'
    return { host: domain, status, why, reason: down }
  }

  /** Why a pool host was passed over, read back from the reason it was
   *  passed over with (#hostHolds, #notePoolHostFailure: the status word
   *  first) — all a reload of this tab still knows about it. */
  static #whyOfDown(reason: string): HostWhy {
    if (/answers a page/.test(reason)) return 'page'
    const word = (reason.split(':', 1)[0] ?? '').trim()
    return word === 'refused' || word === 'full' ? word : 'unreachable'
  }

  /** Fire-and-forget: after a PUBLIC-target receipt confirms, attribute
   *  the sig to that domain in the ContentBroker's address graph. Pure
   *  observability — never gates or delays the drain. */
  readonly #noteAttribution = (sig: string, domain: string): void => {
    try {
      this.#ioc<{ noteDomainsForSig?: (s: string, domains: string[]) => void }>(CONTENT_BROKER_KEY)
        ?.noteDomainsForSig?.(sig, [domain])
    } catch { /* attribution is best-effort */ }
  }

  /** Receipts re-verified against the live host this session (HEAD 200). */
  #verifiedOnHost = new Set<string>()

  /** In-flight verification promises, keyed by sig. The closure walk
   *  enqueues the SAME shared refs from many layers in parallel; without
   *  promise-level dedup every concurrent caller passed the result-memo
   *  check before any response landed and fired its own HEAD — observed
   *  as the same sig HEAD'd 8-14× during boot, hundreds of requests
   *  stampeding the service worker while first paint was rendering. */
  #verifyInFlight = new Map<string, Promise<boolean>>()

  /** Global cap on concurrent verification HEADs. The walk can surface
   *  hundreds of unique sigs in one burst; verification is a freshness
   *  check, not a render dependency — it must trickle, not stampede. */
  #verifySlots = 0
  static readonly #VERIFY_MAX_CONCURRENT = 4

  /** Host-down circuit breaker. An UNHEALTHY host (503s, timeouts) used to
   *  defeat the once-per-session memo — only 200 memoized, so every sweep
   *  re-HEAD'd every sig forever: a sustained ~11 req/s probe storm was
   *  measured against a 503ing host. Failures now ALSO memoize (the audit is
   *  freshness-only; absence must be asserted by the host, and a sick host
   *  asserts nothing), and a failure streak pauses ALL probing for a window. */
  #probeFailStreak = 0
  #probesPausedUntil = 0
  static readonly #PROBE_FAIL_STREAK_MAX = 10
  static readonly #PROBE_PAUSE_MS = 5 * 60 * 1000

  readonly #acquireVerifySlot = async (): Promise<void> => {
    while (this.#verifySlots >= HostSyncService.#VERIFY_MAX_CONCURRENT) {
      await new Promise(r => setTimeout(r, 50))
    }
    this.#verifySlots++
  }

  /** Re-check a receipted sig against the host: HEAD the flat address,
   *  once per session — promise-deduped and concurrency-capped. 404 →
   *  the receipt lied (host drift) → revoke it and return false so the
   *  caller re-stages. Network trouble or any non-404 keeps the receipt
   *  — absence must be asserted by the host, never inferred from
   *  failure. */
  readonly #receiptStillHonored = (sig: string): Promise<boolean> => {
    if (this.#verifiedOnHost.has(sig)) return Promise.resolve(true)
    if (Date.now() < this.#probesPausedUntil) return Promise.resolve(true) // breaker open — keep receipts, no probes
    const inFlight = this.#verifyInFlight.get(sig)
    if (inFlight) return inFlight
    const host = this.#hostBase()
    if (!host) return Promise.resolve(true) // nothing to check against — keep the receipt
    const run = (async (): Promise<boolean> => {
      await this.#acquireVerifySlot()
      try {
        // Re-check the breaker AFTER the slot wait: one sweep enqueues
        // hundreds of probes in a burst, and they all pass the entry check
        // before the streak opens the breaker — without this, the whole
        // queued burst still fired (measured: 1000 HEADs against a 503ing
        // host despite the breaker).
        if (Date.now() < this.#probesPausedUntil) { this.#verifiedOnHost.add(sig); return true }
        const url = `${HostSyncService.#schemeFor(host)}://${host}/${sig}`
        const res = await HostSyncService.#fetchWithin(url, { method: 'HEAD', cache: 'no-store' })
        if (await this.#servesSig(res, url, sig)) { this.#probeFailStreak = 0; this.#verifiedOnHost.add(sig); return true }
        // 404 — or a page where bytes should be (an SPA fallback) — is the
        // host ASSERTING the sig is not served: the receipt lied.
        if (res.status === 404 || res.ok) {
          this.#probeFailStreak = 0 // the host is alive and ASSERTING — not a failure
          // Revoke from BOTH the pool and the legacy dir — mid-migration the
          // receipt may still sit in the legacy source; leaving it there would
          // keep hasReceipt() true and suppress the re-stage.
          for (const dir of [await this.#getReceiptsDir(false), await this.#getLegacyReceiptsDir()]) {
            try { await dir?.removeEntry(sig) } catch { /* already gone */ }
          }
          // A revoke can flip a memoized-available closure back to
          // unavailable — drop the permanent memos and advance the epoch
          // so the share gate re-verifies before the next announce.
          this.#availableClosures.clear()
          this.#receiptEpoch++
          console.warn(`[host-sync] revoked stale receipt ${sig.slice(0, 12)} — host no longer serves it; re-staging`)
          // Surfaceable revocation signal — shells can toast/badge later.
          EffectBus.emit('share:receipt-revoked', { sig, host })
          return false
        }
        this.#noteProbeFailure(sig) // 5xx/etc — keep the receipt, don't re-probe this session
        return true
      } catch { this.#noteProbeFailure(sig); return true } // offline / CORS — keep the receipt
      finally {
        this.#verifySlots--
        this.#verifyInFlight.delete(sig)
      }
    })()
    this.#verifyInFlight.set(sig, run)
    return run
  }

  /** A probe failed without the host asserting anything. Memoize the sig as
   *  audited-this-session (re-probing a sick host gains nothing) and, on a
   *  streak, open the breaker so sweeps stop burning HEADs entirely. */
  #noteProbeFailure(sig: string): void {
    this.#verifiedOnHost.add(sig)
    if (++this.#probeFailStreak >= HostSyncService.#PROBE_FAIL_STREAK_MAX && Date.now() >= this.#probesPausedUntil) {
      this.#probesPausedUntil = Date.now() + HostSyncService.#PROBE_PAUSE_MS
      this.#probeFailStreak = 0
      console.warn(`[host-sync] host unhealthy — pausing receipt probes for ${HostSyncService.#PROBE_PAUSE_MS / 60000}min`)
    }
  }

  /** True iff the host has confirmed (read-back) this sig. Dual-read: the
   *  sign('host-receipts') pool first, then the legacy `__host_receipts__`
   *  drain source while it still exists — an empty pool must never read as
   *  "nothing receipted" mid-migration (that would re-PUT everything). */
  public readonly hasReceipt = async (sig: string): Promise<boolean> => {
    if (!SIG_RE.test(sig)) return false
    for (const dir of [
      await this.#getReceiptsDir(),
      await this.#getLegacyReceiptsDir(),
    ]) {
      if (!dir) continue
      try {
        await dir.getFileHandle(sig, { create: false })
        return true
      } catch { /* not in this source */ }
    }
    return false
  }

  /** All sigs queued for the host and not yet receipted, in enqueue order. */
  public readonly pending = async (): Promise<string[]> => {
    const queue = await this.#listQueue()
    const out: string[] = []
    for (const entry of queue) {
      if (!(await this.hasReceipt(entry.sig))) out.push(entry.sig)
    }
    return out
  }

  /** The sharer's re-push surface (the /repush queen). Re-walks the closure
   *  of every queued entry AND every previously-receipted sig, re-verifying
   *  self-domain receipts against the live host with the existing
   *  #receiptStillHonored machinery (a 404 revokes the receipt so the
   *  re-stage proceeds), enqueues anything missing, then drains.
   *
   *  Summary: `queued` = entries staged at drain time (deep new refs found
   *  by the detached recursive walk may land after the count — the retry
   *  timer drains stragglers), `pushed` = entries confirmed off the queue
   *  by THIS drain, `failed` = entries still queued (host unreachable,
   *  refusing or paused, or no target enabled), `skippedMissingLocal` = refs
   *  no local store holds and no host receipt covers — the genuine holes
   *  behind recipient 404s. */
  public readonly reDrain = async (): Promise<{ queued: number; pushed: number; failed: number; skippedMissingLocal: string[] }> => {
    // Fresh eyes: forget this session's walk dedup and the receipt HEAD
    // memo so closure walks and honor checks actually re-run. Also the
    // operator's "retry now" signal — clear every backoff and every
    // per-entry refusal, same contract as enable().
    this.#walkedLayers.clear()
    this.#walkedResources.clear()
    this.#verifiedOnHost.clear()
    this.#assertedAbsent.clear()
    this.#pageHosts.clear()
    this.#probedHosts.clear()
    this.#answersPage.clear()
    this.#putsThrew.clear()
    this.#hostBackoff.clear()
    this.#refusedEntries.clear()
    this.#entryRefusal.clear()
    this.#resolver.clearDown()

    // Every previously-receipted sig: pool + legacy source, both name
    // shapes (`{sig}` self-domain, `{sig}.{hostHash}` granted hosts).
    const receipted = new Set<string>()
    for (const dir of [await this.#getReceiptsDir(false), await this.#getLegacyReceiptsDir()]) {
      if (!dir) continue
      try {
        for await (const [name, handle] of (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (handle.kind !== 'file') continue
          const sig = name.slice(0, 64)
          if (SIG_RE.test(sig)) receipted.add(sig)
        }
      } catch { /* source vanished mid-walk (absorb finished) */ }
    }

    // Re-verify + re-walk each receipted sig. The walk runs BEFORE the
    // enqueue so the awaited pass (not enqueue's detached kick) covers the
    // refs; enqueue is idempotent and skips anything still fully receipted.
    for (const sig of receipted) {
      await this.#receiptStillHonored(sig)
      let bytes: ArrayBuffer | null = null
      try { bytes = await this.#readLocalBytes(sig, 'layer') } catch { bytes = null }
      if (bytes) {
        await this.#enqueueLayerRefs(sig, bytes)
        await this.enqueue(sig, 'layer', bytes)
        continue
      }
      try { bytes = await this.#readLocalBytes(sig, 'resource') } catch { bytes = null }
      if (bytes) {
        await this.#enqueueResourceClosure(sig, bytes)
        await this.enqueue(sig, 'resource', bytes)
        continue
      }
      // Held nowhere locally — fine while the host still serves it; a
      // genuine hole if the honor check just revoked the receipt.
      await this.#noteWalkMiss(sig)
    }

    // Re-walk what already sits in the queue (layers re-enumerate refs —
    // the original walk may have missed refs that were unreadable then).
    for (const entry of await this.#listQueue()) {
      if (entry.kind !== 'layer') continue
      try {
        const handle = await entry.dir.getFileHandle(entry.fileName, { create: false })
        await this.#enqueueLayerRefs(entry.sig, await (await handle.getFile()).arrayBuffer())
      } catch { /* entry drained mid-walk — nothing to re-walk */ }
    }

    const queued = (await this.#listQueue()).length
    await this.drain()
    const failed = (await this.#listQueue()).length
    return {
      queued,
      pushed: Math.max(0, queued - failed),
      failed,
      skippedMissingLocal: [...this.#missingLocal],
    }
  }

  // -------------------------------------------------
  // availability — the SHARE GATE (read side of receipts)
  // -------------------------------------------------
  //
  // Doctrine: "to share something in a swarm it already has to be
  // available." The publish walk (swarm.drone.ts) and the invite mint
  // consult THIS surface before announcing a sig to peers: a closure is
  // available once every sig in it holds a confirmed read-back receipt on
  // at least ONE enabled host. Receipts and bytes only accrue (content is
  // immutable), so a confirmed closure memoizes permanently; an
  // unavailable verdict is re-checked only after a NEW receipt lands (the
  // epoch), never re-walked on every publish heartbeat.

  /** Monotonic receipt epoch — bumped on every receipt write AND revoke,
   *  so unavailable-closure verdicts know when a re-check could differ. */
  #receiptEpoch = 0

  /** Closure walkKeys confirmed fully receipted (permanent). Same walkKey
   *  shape as #markedWalk: bare sig = full closure, `{sig}:tile` = the
   *  tile-only walk. */
  readonly #availableClosures = new Set<string>()

  /** walkKey → the receipt epoch at which it last read unavailable. */
  readonly #unavailableAtEpoch = new Map<string, number>()

  /** True when a durable host is configured (either opt-in) — the
   *  condition under which the announce gate is ACTIVE. With no host
   *  configured at all, mesh-only live sharing keeps its ungated
   *  behavior (dev/test: two browsers over a relay, sharer online). */
  public readonly isGateActive = (): boolean => this.#anyEnabled()

  /** Receipt on ANY enabled target — availability needs one serving host,
   *  not all of them (a 401-paused CDN must not hide content the
   *  self-domain already serves). Self-domain receipts get the
   *  once-per-session HEAD re-verify; granted-host receipts are trusted
   *  on existence (immutable sig-named CDN objects). */
  readonly #anyTargetReceipted = async (sig: string): Promise<boolean> => {
    for (const target of await this.#targets()) {
      if (await this.#targetReceipted(sig, target)) return true
    }
    return false
  }

  /** Is the full closure rooted at `sig` receipt-confirmed available?
   *  Mirrors markPublic's traversal exactly (child slots recurse only
   *  under branch `closure`; resources descend into their content
   *  closure), but READ-ONLY: no markers, no enqueues, no network beyond
   *  the throttled self-domain receipt re-verify. Conservative: a
   *  layer/resource whose bytes we don't hold locally can't vouch for its
   *  refs and reads unavailable. Memoized true is O(1) on the publish
   *  heartbeat. */
  public readonly isClosureAvailable = async (
    sig: string,
    kind: HostSyncKind = 'layer',
    closure = true,
  ): Promise<boolean> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return false
    // A target set that changed since the last verdict (joined, left, a new
    // relay) re-opens the memos BEFORE they are trusted below.
    this.#targetSpecs()
    const walkKey = closure ? s : `${s}:tile`
    // A confirmed FULL closure covers the tile-only question too.
    if (this.#availableClosures.has(walkKey) || this.#availableClosures.has(s)) return true
    // Nothing receipted since the last miss — the answer cannot have
    // changed; skip the walk (the drain's next receipt bumps the epoch).
    if (this.#unavailableAtEpoch.get(walkKey) === this.#receiptEpoch) return false
    const ok = await this.#closureReceipted(s, kind, closure, new Set<string>())
    if (ok) {
      this.#availableClosures.add(walkKey)
      this.#unavailableAtEpoch.delete(walkKey)
    } else {
      this.#unavailableAtEpoch.set(walkKey, this.#receiptEpoch)
    }
    return ok
  }

  /** The same question, asked of NAMED hosts only: is the closure rooted at
   *  `sig` receipt-confirmed on at least one of `domains`? The publish gate
   *  asks this of the nodes it is publishing to — a receipt on the meeting's
   *  host (first in drain order, so usually first to land) proves nothing
   *  about the node whose index is about to name the branch. The swarm
   *  host's vouch for unheld refs counts only when that host is one of the
   *  named. A domain that is not a current target answers false. */
  public readonly isClosureAvailableOn = async (
    sig: string,
    kind: HostSyncKind,
    closure: boolean,
    domains: readonly string[],
  ): Promise<boolean> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return false
    const wanted = new Set(domains.map(d => foldContentLabel(String(d ?? '').trim().toLowerCase())).filter(Boolean))
    const only = (await this.#targets()).filter(t => wanted.has(t.domain))
    if (only.length === 0) return false
    return await this.#closureReceipted(s, kind, closure, new Set<string>(), only)
  }

  /** THE SWARM'S GATE: is the closure rooted at `sig` — a tile offered on
   *  `page` — served where each part of it is SHOWN? The tile itself and its
   *  own resources by `page`'s swarm hosts; each child layer by the hosts of
   *  the page one step down; and so on (see #publicRoots). So a branch that
   *  wears its own publish domains is judged on them below its tile, which
   *  is where its bytes went. `extra` hosts count at every level (the
   *  sharer's own backup host, which its events also name). NULL when a page
   *  in the closure has hosts still being read: unknown, never "no". */
  public readonly isClosureAvailableAt = async (
    sig: string,
    kind: HostSyncKind,
    closure: boolean,
    page: readonly string[],
    extra: readonly string[] = [],
  ): Promise<boolean | null> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return false
    this.#targetSpecs()
    const at: ScopeAt = {
      page: (page ?? []).map(x => String(x ?? '')),
      extra: new Set(extra.map(d => foldContentLabel(String(d ?? '').trim().toLowerCase())).filter(Boolean)),
      targets: await this.#targets(),
      pending: { seen: false },
    }
    const ok = await this.#closureReceipted(s, kind, closure, new Set<string>(), undefined, at)
    return ok ? true : at.pending.seen ? null : false
  }

  /** Per-NODE closure verdicts, so a re-walk reuses the subtrees it already
   *  proved. `isClosureAvailable` memoizes only the ROOT it was asked about;
   *  every miss therefore re-walked the entire closure from scratch, reading
   *  the bytes of every node again (measured: 1,144 local reads on a single
   *  navigation, each one an ArrayBuffer copy — the garbage the participant
   *  can feel). Positive verdicts are permanent, exactly like the root memo:
   *  receipts and bytes only accrue. Negatives are epoch-stamped so a new
   *  receipt re-opens them. */
  readonly #nodeAvailable = new Set<string>()
  readonly #nodeUnavailableAtEpoch = new Map<string, number>()

  readonly #closureReceipted = async (
    sig: string,
    kind: HostSyncKind,
    closure: boolean,
    visited: Set<string>,
    only?: readonly SyncTarget[],
    at?: ScopeAt,
  ): Promise<boolean> => {
    const visitKey = at ? `${sig}\u0001${at.page.join('\u0000')}` : sig
    if (visited.has(visitKey)) return true
    visited.add(visitKey)
    if (at) {
      // This node is judged by the hosts of the page it is shown on.
      const choice = this.#resolver.hostsFor(at.page)
      if (choice.pending) { at.pending.seen = true; return false }
      only = at.targets.filter(t => choice.hosts.includes(t.domain) || at.extra.has(t.domain))
    }
    // Judged per page, a node's verdict also rests on the pages below it:
    // its key carries its own page, never shared with a whole-host verdict.
    const scope = (at ? `@${at.page.join('/')}@` : '') + (only ? only.map(t => t.domain).sort().join(',') + '|' : '')
    const nodeKey = `${scope}${sig}:${kind}:${closure ? 'c' : 't'}`
    if (this.#nodeAvailable.has(nodeKey)) return true
    if (this.#nodeUnavailableAtEpoch.get(nodeKey) === this.#receiptEpoch) return false
    const pendingBefore = at?.pending.seen ?? false
    const verdict = await this.#closureReceiptedUncached(sig, kind, closure, visited, only, at)
    if (verdict) this.#nodeAvailable.add(nodeKey)
    // A "no" that rests on a page still being read is not a verdict.
    else if (!at || at.pending.seen === pendingBefore) this.#nodeUnavailableAtEpoch.set(nodeKey, this.#receiptEpoch)
    return verdict
  }

  readonly #closureReceiptedUncached = async (
    sig: string,
    kind: HostSyncKind,
    closure: boolean,
    visited: Set<string>,
    only?: readonly SyncTarget[],
    at?: ScopeAt,
  ): Promise<boolean> => {
    const swarm = only ? (only.find(t => t.swarm) ?? null) : await this.#swarmTarget()
    if (!(only ? await this.#receiptedOn(sig, only) : await this.#anyTargetReceipted(sig))) {
      // Not receipted anywhere. Held here → the drain owes it: unavailable
      // until it lands. NOT held here — adopted or lazily-loaded content,
      // which this tab never had the bytes to upload — the swarm's host is
      // asked once (#vouchUnheld): a 200 mints the receipt and counts it.
      if (!swarm) return false
      if (await this.#holdsLocal(sig, kind).catch(() => false)) return false
      return await this.#vouchUnheld(sig, swarm)
    }
    let bytes: ArrayBuffer | null = null
    try { bytes = await this.#readLocalBytes(sig, kind) } catch { bytes = null }
    // Receipted but not held locally: the host serves THIS sig, but we
    // can't enumerate its refs to vouch for the rest of the closure.
    // Bees/dependencies are ref-less leaves — receipt suffices; layers
    // and resources read unavailable (conservative) — except on the swarm's
    // host, whose word for an unheld ref is the vouch above, kept as a
    // receipt so a reload judges it the same way.
    if (!bytes) return kind === 'bee' || kind === 'dependency' || (swarm !== null && await this.#receiptExists(sig, swarm))
    if (kind === 'layer') {
      let layer: Record<string, unknown>
      try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return true }
      if (!layer || typeof layer !== 'object') return true
      // Meta envelope: vouch for the incidence it stands for, or the gate
      // greenlights a branch whose children the host does not serve.
      const incidence = metaIncidence(layer)
      if (incidence) {
        if (metaIsChildIncidence(layer, incidence.kind) && !closure) return true
        return await this.#closureReceipted(incidence.sig, incidence.kind, closure, visited, at ? undefined : only, at)
      }
      // A child layer is shown one page down: on this layer's own page.
      const name = typeof layer['name'] === 'string' ? String(layer['name']) : ''
      const below: ScopeAt | undefined = at && name ? { ...at, page: [...at.page, name] } : at
      for (const [slot, value] of Object.entries(layer)) {
        if (!Array.isArray(value)) continue
        const isChildSlot = CHILD_SLOT_SET.has(slot)
        // Tile-only share: descendants are not part of the contract.
        if (isChildSlot && !closure) continue
        const refKind: HostSyncKind = isChildSlot ? 'layer'
          : slot === 'bees' ? 'bee'
          : slot === 'dependencies' ? 'dependency'
          : 'resource'
        for (const raw of value) {
          const ref = String(raw ?? '').trim().toLowerCase()
          if (!SIG_RE.test(ref) || ref === sig) continue
          if (!(await this.#closureReceipted(ref, refKind, closure, visited, at ? undefined : only, isChildSlot ? below : at))) return false
        }
      }
    } else if (kind === 'resource') {
      const nested = [
        ...await decorationClosureSigs(bytes, r => this.#readLocalBytes(r, 'resource')),
        ...nestedResourceSigs(bytes),
      ]
      for (const ref of nested) {
        if (!SIG_RE.test(ref) || ref === sig) continue
        if (!(await this.#closureReceipted(ref, 'resource', closure, visited, at ? undefined : only, at))) return false
      }
    }
    return true
  }

  /** A receipt on one of these targets (see #anyTargetReceipted). */
  readonly #receiptedOn = async (sig: string, targets: readonly SyncTarget[]): Promise<boolean> => {
    for (const target of targets) {
      if (await this.#targetReceipted(sig, target)) return true
    }
    return false
  }

  /** The first swarm host as a target, or null when this tab has none. */
  readonly #swarmTarget = async (): Promise<SyncTarget | null> =>
    (await this.#targets()).find(t => t.swarm) ?? null

  /** In-flight vouches, so concurrent walks over one shared ref ask once. */
  readonly #vouching = new Map<string, Promise<boolean>>()

  /** ONE QUESTION FOR WHAT WE DO NOT HOLD. A closure ref with no receipt and
   *  no local bytes (adopted or lazily-loaded content) was never this tab's to
   *  upload, so waiting for the drain would hold its branch name-only for
   *  ever. Ask the swarm's host — one HEAD, the same held-probe the drain's
   *  reconcile uses, so it is memoized per session the same way: a served
   *  answer becomes a receipt on disk (it counts after a reload too), an
   *  asserted absence is remembered (#assertedAbsent) and is a genuine hole —
   *  `share:missing-local`, "not held here". Network trouble memoizes nothing
   *  and is bounded by the host's held-probe breaker. */
  readonly #vouchUnheld = (sig: string, swarm: SyncTarget): Promise<boolean> => {
    const key = `${swarm.domain}:${sig}`
    const inFlight = this.#vouching.get(key)
    if (inFlight) return inFlight
    const run = (async (): Promise<boolean> => {
      try {
        if (await this.#hostHolds(sig, swarm)) { this.#missingLocal.delete(sig); return true }
        if (this.#assertedAbsent.has(key)) await this.#noteWalkMiss(sig)
        return false
      } finally { this.#vouching.delete(key) }
    })()
    this.#vouching.set(key, run)
    return run
  }

  /** True iff ANY enabled target has confirmed this sig. The honest public
   *  read: `hasReceipt` deliberately tests only the bare self-domain filename,
   *  so for a CDN-only publication — which needs no self-domain — it answers false
   *  for content the host demonstrably serves. Callers asking "is this
   *  hosted?" (rather than "is it on MY domain?") want this one. */
  public readonly hasAnyReceipt = async (sig: string): Promise<boolean> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return false
    return await this.#anyTargetReceipted(s)
  }

  /** The unreceipted sigs inside a closure — the same walk
   *  `#closureReceiptedUncached` performs, but COLLECTING the holes instead
   *  of short-circuiting on the first one. This is what turns "this branch
   *  isn't fully served" into "these three objects are missing", which is the
   *  only form a participant can act on.
   *
   *  Bounded by `limit` (the walk stops once that many gaps are found) because
   *  the caller is a status line, not an audit: knowing there are AT LEAST n
   *  holes is enough to refuse a green light. Reads local bytes across the
   *  closure, so it is on-demand only — never on a render path.
   *
   *  A ref whose bytes we do not hold locally and which is not receipted is
   *  itself a gap; a receipted-but-unheld layer/resource is reported as a gap
   *  too, matching the conservative verdict `#closureReceiptedUncached`
   *  returns, so the two can never disagree about whether a branch is whole. */
  public readonly closureGaps = async (
    sig: string,
    kind: HostSyncKind = 'layer',
    closure = true,
    limit = 24,
  ): Promise<string[]> => {
    const root = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(root)) return []
    const gaps: string[] = []
    const visited = new Set<string>()
    const cap = Math.max(1, limit)
    const swarm = await this.#swarmTarget()

    const walk = async (s: string, k: HostSyncKind): Promise<void> => {
      if (gaps.length >= cap || visited.has(s)) return
      visited.add(s)
      if (!(await this.#anyTargetReceipted(s))) {
        // An unheld ref the swarm's host vouches for is served — the same
        // verdict #closureReceiptedUncached reaches, so the two agree.
        if (swarm && !(await this.#holdsLocal(s, k).catch(() => false)) && await this.#vouchUnheld(s, swarm)) return
        gaps.push(s)
        // Unreceipted node: its refs are not independently actionable —
        // staging the parent re-walks them. Stop descending here.
        return
      }
      let bytes: ArrayBuffer | null = null
      try { bytes = await this.#readLocalBytes(s, k) } catch { bytes = null }
      if (!bytes) {
        // Receipted but unheld: leaves are complete, containers cannot vouch
        // for refs we cannot enumerate (the conservative verdict) — unless
        // the swarm's host vouched for them.
        if (k !== 'bee' && k !== 'dependency' && !(swarm && await this.#receiptExists(s, swarm))) gaps.push(s)
        return
      }
      if (k === 'layer') {
        let layer: Record<string, unknown>
        try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return }
        if (!layer || typeof layer !== 'object') return
        // Meta envelope: report the hole behind it, not the envelope that
        // resolves fine. This is the line that turned 4 missing children
        // into "0 gaps" on the live revolucion head.
        const incidence = metaIncidence(layer)
        if (incidence) {
          if (metaIsChildIncidence(layer, incidence.kind) && !closure) return
          return await walk(incidence.sig, incidence.kind)
        }
        for (const [slot, value] of Object.entries(layer)) {
          if (!Array.isArray(value)) continue
          const isChildSlot = CHILD_SLOT_SET.has(slot)
          if (isChildSlot && !closure) continue
          const refKind: HostSyncKind = isChildSlot ? 'layer'
            : slot === 'bees' ? 'bee'
            : slot === 'dependencies' ? 'dependency'
            : 'resource'
          for (const raw of value) {
            const ref = String(raw ?? '').trim().toLowerCase()
            if (!SIG_RE.test(ref) || ref === s) continue
            await walk(ref, refKind)
            if (gaps.length >= cap) return
          }
        }
      } else if (k === 'resource') {
        const nested = [
          ...await decorationClosureSigs(bytes, r => this.#readLocalBytes(r, 'resource')),
          ...nestedResourceSigs(bytes),
        ]
        for (const ref of nested) {
          if (!SIG_RE.test(ref) || ref === s) continue
          await walk(ref, 'resource')
          if (gaps.length >= cap) return
        }
      }
    }

    await walk(root, kind)
    return gaps
  }

  /** EVERY signature in a closure, from local bytes — the same walk as
   *  `closureGaps`, collecting instead of judging. `complete` is false when a
   *  layer or resource in the closure is not held here, so its refs could not
   *  be enumerated: a caller deciding what is safe to DELETE must treat an
   *  incomplete keep-set as "keep everything" (remove-from-hosts does). */
  public readonly closureSigs = async (
    sig: string,
    kind: HostSyncKind = 'layer',
  ): Promise<{ sigs: Set<string>; complete: boolean }> => {
    const root = String(sig ?? '').trim().toLowerCase()
    const sigs = new Set<string>()
    let complete = true
    if (!SIG_RE.test(root)) return { sigs, complete: false }

    const walk = async (s: string, k: HostSyncKind): Promise<void> => {
      if (sigs.has(s)) return
      sigs.add(s)
      if (k === 'bee' || k === 'dependency') return
      let bytes: ArrayBuffer | null = null
      try { bytes = await this.#readLocalBytes(s, k) } catch { bytes = null }
      if (!bytes) { complete = false; return }
      if (k === 'layer') {
        let layer: Record<string, unknown>
        try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return }
        if (!layer || typeof layer !== 'object') return
        const incidence = metaIncidence(layer)
        if (incidence) return await walk(incidence.sig, incidence.kind)
        for (const [slot, value] of Object.entries(layer)) {
          if (!Array.isArray(value)) continue
          const refKind: HostSyncKind = CHILD_SLOT_SET.has(slot) ? 'layer'
            : slot === 'bees' ? 'bee'
            : slot === 'dependencies' ? 'dependency'
            : 'resource'
          for (const raw of value) {
            const ref = String(raw ?? '').trim().toLowerCase()
            if (SIG_RE.test(ref) && ref !== s) await walk(ref, refKind)
          }
        }
      } else if (k === 'resource') {
        const nested = [
          ...await decorationClosureSigs(bytes, r => this.#readLocalBytes(r, 'resource')),
          ...nestedResourceSigs(bytes),
        ]
        for (const ref of nested) {
          if (SIG_RE.test(ref) && ref !== s) await walk(ref, 'resource')
        }
      }
    }

    await walk(root, kind)
    return { sigs, complete }
  }

  // ── read-only served probe (status surfaces) ──────────────────────────
  //
  // DELIBERATELY SEPARATE from #receiptStillHonored. That one is the drain's
  // self-domain freshness audit and is allowed to REVOKE receipts; this one
  // answers "does host H serve sig S right now?" for a status panel and must
  // never mutate receipt state. Three concrete reasons they cannot share
  // machinery:
  //
  //   1. #verifyInFlight / #verifiedOnHost are keyed by SIG ALONE, because the
  //      audit only ever talks to one host (the self-domain). A per-host probe
  //      sharing those maps would hand back another host's verdict.
  //   2. #noteProbeFailure marks a sig audited-for-the-session on ANY non-404.
  //      One CORS rejection from a status panel would then suppress the
  //      drain's own re-verification of that sig for the rest of the session.
  //   3. The drain's breaker exists to stop IT from hammering a sick host.
  //      Feeding it from a panel would let opening a window silently disable
  //      receipt auditing — while the breaker is open #receiptStillHonored
  //      returns true unconditionally.
  //
  // Shared with the audit: ONLY #acquireVerifySlot, the global 4-way
  // concurrency cap. That is a semaphore, not a verdict.
  #servedProbes = new Map<string, Promise<'served' | 'absent' | 'unknown'>>()
  #servedFailStreak = 0
  #servedPausedUntil = 0

  /** Does `host` serve the bytes for `sig` right now? Tri-state, and the
   *  distinction is the whole point:
   *
   *  - `served`  — 200. HONEST EVEN FROM A CACHE: the URL is the content hash,
   *                so an intermediary can only hold that object under that
   *                name because the origin served it.
   *  - `absent`  — 404. The only condition that ASSERTS absence.
   *  - `unknown` — offline, CORS, 5xx, timeout, or the local breaker. Nothing
   *                asserted; callers must render silence, not a red light.
   *
   *  Never throws, never writes receipt state, never revokes. A 404 here does
   *  NOT delete a granted-host receipt: an edge miss is far likelier than a
   *  deletion, and coupling a read-only surface to receipt destruction would
   *  let one bad response re-push an entire branch. */
  public readonly probeServed = async (host: string, sig: string): Promise<'served' | 'absent' | 'unknown'> => {
    const s = String(sig ?? '').trim().toLowerCase()
    const h = String(host ?? '').trim().toLowerCase()
      .replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '')
    if (!SIG_RE.test(s) || !h) return 'unknown'
    if (Date.now() < this.#servedPausedUntil) return 'unknown'
    const key = `${h}:${s}`
    const inFlight = this.#servedProbes.get(key)
    if (inFlight) return await inFlight

    const run = (async (): Promise<'served' | 'absent' | 'unknown'> => {
      await this.#acquireVerifySlot()
      try {
        if (Date.now() < this.#servedPausedUntil) return 'unknown'
        const res = await HostSyncService.#fetchWithin(`${HostSyncService.#schemeFor(h)}://${h}/${s}`, { method: 'HEAD', cache: 'no-store' })
        if (res.ok) { this.#servedFailStreak = 0; return 'served' }
        if (res.status === 404) { this.#servedFailStreak = 0; return 'absent' } // host alive and asserting
        this.#noteServedFailure()
        return 'unknown'
      } catch {
        this.#noteServedFailure()
        return 'unknown'
      } finally {
        this.#verifySlots--
        // Verdicts are NOT memoized across calls: unlike a receipt audit this
        // is a liveness question, and a panel refresh must be able to observe
        // recovery. In-flight dedup only.
        this.#servedProbes.delete(key)
      }
    })()
    this.#servedProbes.set(key, run)
    return await run
  }

  #noteServedFailure(): void {
    if (++this.#servedFailStreak >= HostSyncService.#PROBE_FAIL_STREAK_MAX && Date.now() >= this.#servedPausedUntil) {
      this.#servedPausedUntil = Date.now() + HostSyncService.#PROBE_PAUSE_MS
      this.#servedFailStreak = 0
      console.warn(`[host-sync] served-probe target unhealthy — pausing status probes for ${HostSyncService.#PROBE_PAUSE_MS / 60000}min`)
    }
  }

  /** Bounded wait for a sig's receipt on any enabled target — the invite
   *  mint's gate. Kicks a drain, then polls (receipts land via the
   *  drain's file write, not an awaitable). False on timeout or when no
   *  host is enabled; the queue keeps retrying after this returns either
   *  way, so a timed-out sig usually goes live shortly after. */
  public readonly ensureReceipt = async (sig: string, timeoutMs = 10_000): Promise<boolean> => {
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s) || !this.#anyEnabled()) return false
    const deadline = Date.now() + Math.max(0, timeoutMs)
    void this.drain()
    for (;;) {
      if (await this.#anyTargetReceipted(s)) return true
      if (Date.now() >= deadline) return false
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // -------------------------------------------------
  // transport — signed HTTP PUT + confirmed read-back
  // -------------------------------------------------

  /** One signed PUT + confirmed receipt against ONE target; on success
   *  writes THAT target's receipt (bare `{sig}` for self-domain,
   *  `{sig}.{hostHash}` for granted hosts). The swarm's host confirms in its
   *  own answer (`stored <sig>`); every other host is read back. Anything
   *  else comes back classified (#refusal) for the per-host backoff. */
  readonly #pushAndReceipt = async (target: SyncTarget, entry: QueueEntry): Promise<PushOutcome> => {
    const host = target.domain
    let bytes: ArrayBuffer
    try {
      // Read from the entry's OWN dir (pool or legacy) — mid-migration a queued
      // entry may still live in the legacy dir the union surfaced it from.
      const handle = await entry.dir.getFileHandle(entry.fileName, { create: false })
      bytes = await (await handle.getFile()).arrayBuffer()
    } catch { return 'local' }

    // Content-integrity precheck — the host rejects (422) any PUT whose body
    // doesn't hash to the URL sig (relay §21.12: sha256(body) === sig). We
    // run the SAME check here, before the network call, because a mismatch
    // can NEVER heal by retrying: the bytes we hold address different content
    // than the sig names. Without this, one corrupt/non-canonical local entry
    // 422s the host on every 30s drain forever, spamming the console. Catch
    // it client-side and let drain drop it — a permanent per-entry condition.
    const actual = await SignatureService.sign(bytes)
    if (actual !== entry.sig) return 'corrupt'

    const path = this.#pathFor(entry.sig)
    // Loopback hosts use plain http (content-side analog of allow-loopback);
    // real domains use https.
    const url = `${HostSyncService.#schemeFor(host)}://${host}${path}`

    const auth = await this.#nip98(url, 'PUT')
    if (!auth) {
      // Without this warning a missing/failed signer is INVISIBLE: every
      // push returns false, the retry timer spins forever, and nothing in
      // the console says why the host never receives bytes. Once per
      // session is enough — the condition doesn't change between entries.
      if (!this.#warnedNoSigner) {
        this.#warnedNoSigner = true
        console.warn('[host-sync] no Nostr signer available — backup PUTs cannot be signed; queue will retry once a signer registers')
      }
      return 'local'
    }

    let put: Response
    try {
      put = await HostSyncService.#fetchWithin(url, { method: 'PUT', headers: { Authorization: auth }, body: bytes }, bytes.byteLength)
    } catch (err) {
      return await this.#putThrew(target, url, bytes.byteLength, err)
    }
    this.#answeredHosts.add(host)
    this.#putsThrew.delete(host) // an upload reached it: the evidence of a block starts over

    try {
      // 422 = the host's own sha256(body)===sig check failed. The precheck
      // above normally catches this first; this covers the rare case where
      // the host canonicalizes differently than we do. Either way the bytes
      // can never satisfy this sig, so it's permanent — not a retry.
      if (put.status === 422) return 'corrupt'
      // Every other refusal is classified once, with the host's own words,
      // for the per-host backoff and the status line.
      if (!put.ok) return await HostSyncService.#refusal(put)
      // THE SWARM'S HOST ANSWERS FOR ITSELF. The relay hashes the body
      // against the URL before it writes, and says `stored <sig>` only after
      // the write — an answer naming the sig it verified and stored, which is
      // not the bare 200 the silent-drop lesson is about. The meeting point's
      // worker says `already held <sig>` when that sig is in its heap already
      // — the same statement about the same sig, made without a second write.
      // Either answer is the receipt: no read-back GET. Any other 2xx body
      // reads back as below.
      if (target.swarm) {
        let said = ''
        try { said = (await put.text()).trim() } catch { /* unreadable — read back */ }
        if (said === `stored ${entry.sig}` || said === `already held ${entry.sig}`) return (await this.#writeReceipt(entry.sig, target)) ? 'ok' : 'local'
      }
      // Confirmed read-back: a fresh GET (cache-bypassing) must show the
      // host actually serving the sig. A bare PUT 200 is NOT proof — the
      // silent-drop lesson. Only a served read-back closes the loop.
      // The receipt needs the ANSWER, not the bytes — cancel the body so
      // backup doesn't re-download every byte it just uploaded. An HTML
      // answer is checked against the sig (#servesSig): an SPA fallback
      // page must never mint a receipt.
      const back = await HostSyncService.#fetchWithin(url, { cache: 'no-store' })
      const served = await this.#servesSig(back, url, entry.sig)
      try { await back.body?.cancel() } catch { /* already drained/closed */ }
      if (!served) return { status: 'unreachable', reason: `${back.status} not served back` }
    } catch (err) {
      // The read-back: network, host down, or our own deadline — retry on
      // the ladder (the PUT itself was answered).
      const timedOut = (err as { name?: string } | null)?.name === 'AbortError'
      return { status: 'unreachable', reason: timedOut ? 'timed out' : 'unreachable' }
    }

    return (await this.#writeReceipt(entry.sig, target)) ? 'ok' : 'local'
  }

  /** A PUT that never got an answer, classified. Our own deadline, or a
   *  network error from a host that never answered anything, is the ladder's
   *  `unreachable`. But an upload its CORS preflight never lets leave the
   *  browser, from a SWARM host that answers everything else, is the host up
   *  and refusing (the hypercomb.com apex on 2026-10-10 blocked every upload
   *  and read as `unreachable` for 40 minutes) — and the browser shows that
   *  as the same TypeError a dropped network, a captive portal or an edge's
   *  CORS-less error page gives. So it is called a refusal only on evidence,
   *  gathered on this failure path and never on connect: the host had
   *  answered this session and never took an upload from this tab; this tab
   *  is online with its socket open; a SECOND upload to it never left since
   *  one last reached it (one error page is not a block); and the host
   *  answers a HEAD at that very address now (a dropped path does not). Even
   *  then it is `threw`: on the ladder, a pool host passed over for this page
   *  only, given back with the next socket (#notePoolHostFailure). A body
   *  larger than an edge takes is that one entry's fate, never the host's. */
  readonly #putThrew = async (target: SyncTarget, url: string, sent: number, err: unknown): Promise<PushFailure> => {
    if ((err as { name?: string } | null)?.name === 'AbortError') return { status: 'unreachable', reason: 'timed out' }
    const unreachable: PushFailure = { status: 'unreachable', reason: 'unreachable' }
    const host = target.domain
    if (!(err instanceof TypeError) || !target.swarm) return unreachable
    if (sent > EDGE_BODY_MAX_BYTES) return { status: 'too-large', reason: `${Math.ceil(sent / 1_048_576)} MB — more than an edge takes`, drop: true }
    if (this.#provenHosts.has(host) || !this.#answeredHosts.has(host)) return unreachable
    if (this.#meshState !== 'open' || HostSyncService.#offline()) return unreachable
    const threw = (this.#putsThrew.get(host) ?? 0) + 1
    this.#putsThrew.set(host, threw)
    if (threw < 2) return unreachable
    try { await HostSyncService.#fetchWithin(url, { method: 'HEAD', cache: 'no-store' }) } catch { return unreachable }
    return { status: 'refused', reason: `${host} answers, but lets no upload from this page through`, threw: true }
  }

  /** Uploads to a host that never left the browser since one last reached
   *  it — #putThrew's evidence that the host blocks them. Cleared by any
   *  answered PUT or receipt, a socket that comes back, and the retry. */
  readonly #putsThrew = new Map<string, number>()

  /** A host's non-2xx answer, classified. The reason is the status plus the
   *  first line of the body — the host's own words, never paraphrased. */
  static async #refusal(res: Response): Promise<PushFailure> {
    let line = ''
    try { line = ((await res.text()).split(/\r?\n/, 1)[0] ?? '').trim().slice(0, 160) } catch { /* no body */ }
    const reason = line ? `${res.status} ${line}` : String(res.status)
    const s = res.status
    // The relay has not seen this key send a verified EVENT yet — the
    // beacon is a moment behind the upload. Not a refusal; ask again soon.
    if (s === 401 && /^not-live\b/i.test(line)) return { status: 'not-live', reason }
    // About this entry, never the host: too large for it, or an address the
    // host reserves (a pool). That target never owes it again.
    if (s === 413) return { status: 'too-large', reason, drop: true }
    if (s === 409) return { status: 'refused', reason, drop: true }
    // Out of room (a quota, the disk): the host names its own wait.
    if (s === 429 || s === 507) return { status: 'full', reason, retryAfterMs: HostSyncService.#retryAfterMs(res) }
    // Any other 4xx is the host's decision (writers list, participants
    // closed, a read-only origin) — asked again in 10 min, not every tick.
    if (s >= 400 && s < 500) return { status: 'refused', reason }
    return { status: 'unreachable', reason }
  }

  /** Retry-After as milliseconds — delta-seconds or an HTTP date; 0 if absent. */
  static #retryAfterMs(res: Response): number {
    const raw = (res.headers.get('retry-after') ?? '').trim()
    if (!raw) return 0
    const seconds = Number(raw)
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
    const at = Date.parse(raw)
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0
  }

  /** fetch with a deadline: 15 s, plus 1 s per 100 KB sent. */
  static async #fetchWithin(url: string, init: RequestInit, sentBytes = 0): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS + Math.ceil(sentBytes / 102_400) * TIMEOUT_PER_100KB_MS)
    try { return await fetch(url, { ...init, signal: ctrl.signal }) }
    finally { clearTimeout(timer) }
  }

  /** Record that a target serves a sig. The receipt is a memo of the
   *  host's answer — written after a confirmed read-back or a HEAD that
   *  found the sig already served. */
  readonly #writeReceipt = async (sig: string, target: SyncTarget): Promise<boolean> => {
    try {
      const receiptsDir = await this.#getReceiptsDir()
      if (!receiptsDir) return false
      const handle = await receiptsDir.getFileHandle(HostSyncService.#receiptName(sig, target), { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      // A new receipt can flip a closure from unavailable → available:
      // advance the epoch so the share gate re-walks stale misses.
      this.#receiptEpoch++
      if (target.hostHash === null) this.#verifiedOnHost.add(sig)
      // THE SWARM'S HOST SERVES IT NOW — say so at once, per receipt. The
      // entry-settled `host:receipt` waits for EVERY target the entry owes,
      // and a second, refusing public-only target (an old /use-live-relay's
      // public host) would hold the room's name-only tiles until it relents.
      // This one is per target (`swarm: true`) — the swarm re-walks on it;
      // counters of settled entries skip it.
      if (target.swarm) {
        // Proof it takes bytes: whatever page it once answered (it was fixed),
        // and whatever uploads once never left, no longer describe it — and
        // it is probed (HEAD-before-PUT) like any heap again.
        this.#provenHosts.add(target.domain)
        this.#pageHosts.delete(target.domain)
        this.#answersPage.delete(target.domain)
        this.#putsThrew.delete(target.domain)
        this.#resolver.markUp(target.domain)
        EffectBus.emit('host:receipt', { sig, host: target.domain, swarm: true })
      }
      this.#noteReceiptedOn(sig, target.domain)
      return true
    } catch { return false }
  }

  /** Does this answer prove the host SERVES the sig? Bytes at the flat
   *  address (any non-HTML type) do. An HTML answer is ambiguous — an SPA
   *  fallback page, or a held HTML resource (a website page body) — and the
   *  primitive tells them apart: an ETag naming the sig, else the body
   *  hashing to it. Anything else is not the sig. */
  readonly #servesSig = async (res: Response, url: string, sig: string): Promise<boolean> => {
    if (!res.ok) return false
    const type = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!type.includes('text/html')) return true
    const etag = (res.headers.get('etag') ?? '').replace(/^W\//i, '').replace(/"/g, '').trim().toLowerCase()
    if (etag === sig) return true
    try {
      const body = await fetch(url, { cache: 'no-store' })
      if (!body.ok) return false
      return (await SignatureService.sign(await body.arrayBuffer())) === sig
    } catch { return false }
  }

  /** Loopback answers over plain http — including any `*.localhost` name
   *  (RFC 6761), the shape a zone's content face takes on one machine. One
   *  rule for the probe, the push, the read-back and the audit, so they can
   *  never disagree about which origin is "the host". */
  static #schemeFor(host: string): 'http' | 'https' {
    return /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
  }

  /** Bounded fan-out that keeps the input order. */
  static async #mapConcurrently<T, R>(items: readonly T[], width: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i]!)
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(width, items.length)) }, worker))
    return out
  }

  /** Probe health for the HEAD-before-PUT gate, PER HOST — its own state,
   *  never the self-domain receipt audit's (#probeFailStreak and
   *  #verifiedOnHost are keyed to #hostBase() alone, and a sick public CDN
   *  must not blind the audit of a healthy self-domain, or vice versa). */
  readonly #holdsHealth = new Map<string, { streak: number; pausedUntil: number }>()

  /** Absence a host ASSERTED this session (404, or a page where bytes should
   *  be), keyed host:sig. A push that then fails for its own reason (no
   *  signer, host down) must not cost a fresh HEAD on every 30 s tick.
   *  Cleared when something could have changed what the host holds:
   *  reDrain(), enable(), enablePublicHost(); a landed receipt supersedes
   *  it on its own. */
  readonly #assertedAbsent = new Set<string>()

  /** Pool hosts that answered a page where a sig's bytes should be — not
   *  probed again this session (#hostHolds). Cleared with #assertedAbsent. */
  readonly #pageHosts = new Set<string>()

  /** Swarm hosts of any kind (pool hosts and publish domains) that answered
   *  a page where a sig's bytes should be — the status lines' `page` (#whyOf).
   *  Cleared with #pageHosts. */
  readonly #answersPage = new Set<string>()

  /** Hosts that ANSWERED a request this session — a HEAD of any status, or a
   *  PUT's response. The path to them has worked: later uploads that never
   *  leave the browser may be the host's CORS refusing them (#putThrew asks
   *  for more evidence), and a host never in here while this tab is online
   *  may not resolve at all (#whyOf). Session memory, never cleared: an
   *  answer stays an answer. */
  readonly #answeredHosts = new Set<string>()

  /** ASK THE HOST before sending: does it already serve this sig? One HEAD
   *  on the flat address, under the verify concurrency cap and this host's
   *  own breaker. A served answer (#servesSig) mints the receipt and returns
   *  true — the bytes are never sent. 404, or a page instead of bytes, is
   *  the host asserting absence → remembered, false, push. Network trouble
   *  or 5xx asserts nothing → false; the push that follows fails the same
   *  way and waits for the retry timer, and a streak pauses this host's
   *  probes.
   *
   *  THE FIRST QUESTION TO A HOST GOES ALONE. Its answer — bytes, a 404, a
   *  page where bytes should be, nothing — says how to treat every address
   *  after it, so while this tab's first probe of a host is in flight the
   *  rest of its batch waits on that one answer instead of asking the same
   *  question four times over: a page host costs ONE HEAD, and is passed over
   *  before a second is asked. Settled either way, it is never waited on
   *  again — a host that does not answer is then asked at the full cap, never
   *  one entry behind another. */
  readonly #hostHolds = async (sig: string, target: SyncTarget): Promise<boolean> => {
    const host = target.domain
    const key = `${host}:${sig}`
    if (this.#assertedAbsent.has(key)) return false
    if (this.#pageHosts.has(host)) return false // it answers every address with a page
    if (!this.#probedHosts.has(host)) {
      const first = this.#firstProbe.get(host)
      if (first) {
        await first
        if (this.#assertedAbsent.has(key) || this.#pageHosts.has(host)) return false
      } else {
        let settle!: () => void
        this.#firstProbe.set(host, new Promise<void>(resolve => { settle = resolve }))
        try { return await this.#probeHolds(sig, target) } finally {
          this.#probedHosts.add(host)
          this.#firstProbe.delete(host)
          settle()
        }
      }
    }
    return this.#probeHolds(sig, target)
  }

  /** This tab's first probe of a host, while it is in flight (#hostHolds). */
  readonly #firstProbe = new Map<string, Promise<void>>()
  /** Hosts whose first probe settled — asked at the full cap from then on.
   *  Cleared with #pageHosts, so a host given back is asked alone again. */
  readonly #probedHosts = new Set<string>()

  /** One held-probe (#hostHolds): the HEAD, under the verify cap and this
   *  host's breaker. */
  readonly #probeHolds = async (sig: string, target: SyncTarget): Promise<boolean> => {
    const host = target.domain
    const key = `${host}:${sig}`
    const health = this.#holdsHealth.get(host) ?? { streak: 0, pausedUntil: 0 }
    this.#holdsHealth.set(host, health)
    if (Date.now() < health.pausedUntil) return false // breaker open — no probes; the push will tell
    await this.#acquireVerifySlot()
    try {
      if (Date.now() < health.pausedUntil) return false // re-check after the slot wait (burst)
      const url = `${HostSyncService.#schemeFor(host)}://${host}${this.#pathFor(sig)}`
      const res = await HostSyncService.#fetchWithin(url, { method: 'HEAD', cache: 'no-store' })
      this.#answeredHosts.add(host) // whatever it said, the path to it works
      if (res.ok || res.status === 404) health.streak = 0 // the host is alive and ASSERTING
      if (await this.#servesSig(res, url, sig)) {
        if (!(await this.#writeReceipt(sig, target))) return false
        // A public-target receipt means the CDN serves this sig — the same
        // attribution a confirmed push records, so adopt can answer
        // getKnownDomains() without a mesh wait.
        if (target.publicOnly) this.#noteAttribution(sig, host)
        return true
      }
      if (res.ok && (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
        // A PAGE WHERE BYTES SHOULD BE: a site's fallback for every address
        // (the hypercomb.com apex answered the Azure shell until 2026-10-10).
        // Any host keeps its per-sig probe — a static door may hold some sigs
        // as files and fall back for the rest — and is pushed to; a publish
        // domain is the participant's choice and is never passed over, only
        // named honestly when its push fails (`page`, #whyOf).
        // A host that already took this tab's uploads and answers a page
        // once is a hiccup (a route or a deploy), never a page host.
        if (target.swarm && !this.#provenHosts.has(host)) {
          this.#answersPage.add(host)
          if (this.#resolver.isPoolHost(host)) {
            // A POOL host is different: a host that cannot take uploads is
            // passed over, and a heap answers bytes or 404 — never a page.
            // THIS HEAD, the one the drain makes anyway, is the probe: passed
            // over now, before a single PUT waits on it (the 2026-10-10
            // meeting sat 40 minutes behind two whole failure waves of it).
            // Its answer to the next sig would be the same page, so it is not
            // asked again this session; a receipt from it, or the
            // participant's retry, gives it back. Remembered across a reload
            // of this tab — unless the socket was down (then the page may
            // have been the path's, and the next socket gives it back).
            const pathDown = this.#meshState !== 'open'
            this.#pageHosts.add(host)
            if (pathDown) this.#downWhileOffline.add(host)
            this.#resolver.markDown(host, `${host} answers a page — takes no uploads`, !pathDown)
          }
        }
        this.#assertedAbsent.add(key)
        return false
      }
      if (res.ok || res.status === 404) { this.#assertedAbsent.add(key); return false }
      this.#noteHoldsFailure(host, health)
      return false
    } catch { this.#noteHoldsFailure(host, health); return false }
    finally { this.#verifySlots-- }
  }

  /** A held-probe failed without the host asserting anything; on a streak,
   *  pause THIS host's probes so a sick host stops costing HEADs. */
  #noteHoldsFailure(host: string, health: { streak: number; pausedUntil: number }): void {
    if (++health.streak >= HostSyncService.#PROBE_FAIL_STREAK_MAX && Date.now() >= health.pausedUntil) {
      health.pausedUntil = Date.now() + HostSyncService.#PROBE_PAUSE_MS
      health.streak = 0
      console.warn(`[host-sync] ${host} unhealthy — pausing held-probes for ${HostSyncService.#PROBE_PAUSE_MS / 60000}min; pushes will tell`)
    }
  }

  /**
   * PUBLISH THESE FILES NOW, to one host, because the participant said so
   * (`module commit`). Not the backup queue: that drains in the background
   * behind its own opt-in, and a commit must know, before it moves the
   * install pointer, that every file the new package holds is served. The
   * participant's word is the consent; the same transport and the same proof
   * apply — sha256 checked before sending, a NIP-98 signed PUT, and a fresh
   * read-back. A file the host already serves is not sent again.
   *
   * Stops at the first file that cannot be published, and says which.
   */
  readonly publishAtoms = async (
    host: string,
    sigs: readonly string[],
    bytesOf: (sig: string) => Promise<Uint8Array | null>,
  ): Promise<{ ok: true; sent: number; held: number } | { ok: false; error: string; sig?: string }> => {
    // A write goes to the zone root — a `content.` face handed in folds to it.
    const domain = foldContentLabel(String(host ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''))
    if (!domain) return { ok: false, error: 'no host to publish to' }
    // Any *.localhost name is loopback (RFC 6761): a zone's content face on
    // one machine is content.localhost.
    const scheme = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(domain) ? 'http' : 'https'
    let sent = 0
    let held = 0
    for (const sig of sigs) {
      const url = `${scheme}://${domain}${this.#pathFor(sig)}`
      // HELD ALREADY? A HEAD, not a download: a commit publishes the whole
      // package so any door can serve it, and most of it is usually there.
      // The host checked every body against its name when it took it; a page
      // (an SPA fallback answering 200) is not a held file.
      try {
        const there = await fetch(url, { method: 'HEAD', cache: 'no-store' })
        if (there.ok && !(there.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) { held++; continue }
      } catch { /* not reachable yet — the PUT below says so */ }
      const bytes = await bytesOf(sig)
      if (!bytes) return { ok: false, error: `${sig.slice(0, 12)}… is not held here`, sig }
      const body = bytes.slice().buffer as ArrayBuffer
      if (await SignatureService.sign(body) !== sig) return { ok: false, error: `${sig.slice(0, 12)}… held here does not hash to its name`, sig }
      const auth = await this.#nip98(url, 'PUT')
      if (!auth) return { ok: false, error: 'no Nostr signer is available to sign the upload' }
      try {
        const put = await fetch(url, { method: 'PUT', headers: { Authorization: auth }, body })
        if (put.status === 401 || put.status === 403) return { ok: false, error: `${domain} does not accept uploads from this key`, sig }
        if (!put.ok) return { ok: false, error: `${domain} refused ${sig.slice(0, 12)}… (HTTP ${put.status})`, sig }
        const back = await fetch(url, { cache: 'no-store' })
        if (!back.ok || await SignatureService.sign(await back.arrayBuffer()) !== sig) {
          return { ok: false, error: `${domain} accepted ${sig.slice(0, 12)}… but does not serve it back`, sig }
        }
      } catch {
        return { ok: false, error: `${domain} could not be reached`, sig }
      }
      sent++
    }
    return { ok: true, sent, held }
  }

  /** sig → host URL path. ONE FLAT HEAP: every sig lives at `/<sig>` —
   *  no typed pools, no extensions. The consumer knows the type (it holds
   *  the referring layer), the bytes authenticate themselves (sha256 ===
   *  sig), so the URL carries identity only. `kind` still rides the queue
   *  entry for bookkeeping but never shapes the address. */
  readonly #pathFor = (sig: string): string => `/${sig}`

  /** Cache for the signer's pubkey. NostrSigner.getPublicKeyHex() is
   *  async (may dial out to a NIP-07 extension); we want #pathFor to be
   *  cheap on the hot path. First lookup pays the cost, subsequent
   *  lookups are O(1). Reset on disable() so a key change between sessions
   *  is respected. */
  #ownPubkey: string | null = null

  readonly #getOwnPubkey = async (): Promise<string> => {
    if (this.#ownPubkey) return this.#ownPubkey
    const signer = this.#getSigner() as (SignerLike & { getPublicKeyHex?: () => Promise<string | null> }) | undefined
    if (!signer?.getPublicKeyHex) return ''
    try {
      const pk = await signer.getPublicKeyHex()
      if (pk && /^[0-9a-f]{64}$/i.test(pk)) {
        this.#ownPubkey = pk.toLowerCase()
        return this.#ownPubkey
      }
    } catch { /* fall through */ }
    return ''
  }

  /** Build a NIP-98 Authorization header: a kind-27235 Nostr event signed
   *  by the participant's key, binding method + url, base64'd. Returns null
   *  if no signer is available. `created_at` is the RELAY'S time when the
   *  mesh knows it (the hc:host card on connect): a device clock minutes off
   *  must not fail the host's freshness window. */
  readonly #nip98 = async (url: string, method: string): Promise<string | null> => {
    const signer = this.#getSigner()
    if (!signer?.signEvent) return null
    let nowMs = Date.now()
    try {
      const relayNow = this.#ioc<{ now?: () => number }>(NOSTR_MESH_KEY)?.now?.()
      if (typeof relayNow === 'number' && Number.isFinite(relayNow) && relayNow > 0) nowMs = relayNow
    } catch { /* no mesh — the local clock */ }
    const evt = {
      kind: NIP98_KIND,
      created_at: Math.floor(nowMs / 1000),
      tags: [['u', url], ['method', method]],
      content: '',
    }
    try {
      const signed = await signer.signEvent(evt)
      const json = JSON.stringify(signed)
      return 'Nostr ' + btoa(unescape(encodeURIComponent(json)))
    } catch {
      return null
    }
  }

  /** The participant's host, scheme/slash stripped (e.g. 'jwize.com').
   *  Read straight from localStorage — the runtime initializer ensures
   *  the key is populated with window.location.origin on first boot, so
   *  this never returns "" except in private-mode storage edge cases. */
  readonly #hostBase = (): string => {
    let raw = ''
    try { raw = String(localStorage.getItem(SELF_DOMAIN_KEY) ?? '').trim() } catch { return '' }
    // The zone root is the write door; a stored `content.` face folds to it.
    return foldContentLabel(raw.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim())
  }

  // -------------------------------------------------
  // internal — directory resolution + queue ops
  // (its own pool meanings — nothing else writes them)
  // -------------------------------------------------

  readonly #getPool = async (meaning: string, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      return await root.getDirectoryHandle(await HostSyncService.#poolSignature(meaning), { create })
    } catch { return null }
  }

  readonly #getQueueDir = (create = true): Promise<FileSystemDirectoryHandle | null> =>
    this.#getPool(PUSH_MEANING, create)

  readonly #getReceiptsDir = (create = true): Promise<FileSystemDirectoryHandle | null> =>
    this.#getPool(RECEIPTS_MEANING, create)

  /** Legacy `__host_push__/queue/` — drain source, opened without create. */
  readonly #getLegacyQueueDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      const push = await root.getDirectoryHandle(LEGACY_PUSH_DIR, { create: false })
      return await push.getDirectoryHandle(LEGACY_QUEUE_SUBDIR, { create: false })
    } catch { return null }
  }

  /** Legacy `__host_receipts__/` — drain source, opened without create. */
  readonly #getLegacyReceiptsDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = await this.#getOpfsRoot()
    if (!root) return null
    try {
      return await root.getDirectoryHandle(LEGACY_RECEIPTS_DIR, { create: false })
    } catch { return null }
  }

  readonly #getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
    const store = this.#ioc<{ opfsRoot?: FileSystemDirectoryHandle }>(STORE_KEY)
    return store?.opfsRoot ?? null
  }

  // -------------------------------------------------
  // internal — self-cleaning legacy absorb
  // -------------------------------------------------

  /** Drain the legacy `__host_push__/queue/` and `__host_receipts__/` dirs
   *  into their sign(meaning) pools, then remove the emptied dirs. Runs
   *  under drain()'s single-flight guard. Per-entry copy→remove; the final
   *  removeEntry calls are non-recursive ON PURPOSE — they only succeed once
   *  a dir is truly empty, so a straggler is never destroyed. Nothing is
   *  removed before its copy is confirmed in the pool; an interrupted absorb
   *  resumes on a later drain, with dual-reads correct meanwhile. */
  readonly #absorbLegacy = async (): Promise<void> => {
    if (this.#legacyDrained) return
    const root = await this.#getOpfsRoot()
    if (!root) return
    let clean = true

    const legacyQueue = await this.#getLegacyQueueDir()
    if (legacyQueue) {
      const pool = await this.#getQueueDir(true)
      if (!pool) return
      let ok = await this.#absorbDir(legacyQueue, pool)
      if (ok) {
        try {
          const legacyPush = await root.getDirectoryHandle(LEGACY_PUSH_DIR, { create: false })
          await legacyPush.removeEntry(LEGACY_QUEUE_SUBDIR)
          await root.removeEntry(LEGACY_PUSH_DIR)
        } catch { ok = false }
      }
      clean = ok && clean
    }

    const legacyReceipts = await this.#getLegacyReceiptsDir()
    if (legacyReceipts) {
      const pool = await this.#getReceiptsDir(true)
      if (!pool) return
      let ok = await this.#absorbDir(legacyReceipts, pool)
      if (ok) {
        try { await root.removeEntry(LEGACY_RECEIPTS_DIR) } catch { ok = false }
      }
      clean = ok && clean
    }

    this.#legacyDrained = clean
  }

  /** Copy every plain file from `legacy` into `pool` (an existing pool
   *  entry wins — same-name means same record: queue bytes are
   *  sig-addressed, receipts are presence-only), removing each source entry
   *  only after its copy is confirmed present. Returns true iff the source
   *  dir ended fully drained. */
  readonly #absorbDir = async (
    legacy: FileSystemDirectoryHandle,
    pool: FileSystemDirectoryHandle,
  ): Promise<boolean> => {
    let drained = true
    try {
      for await (const [name, handle] of (legacy as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (handle.kind !== 'file') { drained = false; continue }
        try {
          let present = true
          try { await pool.getFileHandle(name, { create: false }) } catch { present = false }
          if (!present) {
            const file = await (handle as FileSystemFileHandle).getFile()
            const dest = await pool.getFileHandle(name, { create: true })
            const writable = await dest.createWritable()
            try { await writable.write(await file.arrayBuffer()) } finally { await writable.close() }
          }
          await legacy.removeEntry(name)
        } catch { drained = false /* straggler — absorbed on a later drain */ }
      }
    } catch { drained = false }
    return drained
  }

  // -------------------------------------------------
  // internal — queue ops
  // -------------------------------------------------

  /** List queued entries: the sign('host-push') pool UNIONED with the
   *  legacy queue while that drain source still exists (an entry must never
   *  vanish from view mid-migration). Each entry carries the dir it lives in
   *  so read/remove target the right source; on a same-name collision the
   *  pool copy wins. */
  readonly #listQueue = async (): Promise<QueueEntry[]> => {
    // A published website has no queue and never will: nothing may leave it.
    // Gated HERE rather than at each caller because the walk is the expensive
    // part (a getFile per entry per pass, just for mtime) and status surfaces
    // poll `pending()` on their own schedule — one of them kept the visitor's
    // main thread busy long after every push path was already refused.
    if (this.#readonlyVisitor()) return []
    const byName = new Map<string, QueueEntry>()
    const collect = async (dir: FileSystemDirectoryHandle | null): Promise<void> => {
      if (!dir) return
      try {
        for await (const [name, handle] of (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (handle.kind !== 'file') continue
          const m = name.match(ENTRY_RE)
          if (!m || byName.has(name)) continue
          try {
            const file = await (handle as FileSystemFileHandle).getFile()
            byName.set(name, { sig: m[1], kind: m[2] as HostSyncKind, fileName: name, mtime: file.lastModified, dir })
          } catch { /* skip unreadable */ }
        }
      } catch { /* dir vanished mid-walk (absorb finished) — pool has it */ }
    }
    await collect(await this.#getQueueDir(false))
    await collect(await this.#getLegacyQueueDir())
    const items = [...byName.values()]
    items.sort((a, b) => a.mtime - b.mtime)
    return items
  }

  readonly #removeEntry = async (entry: { dir: FileSystemDirectoryHandle; fileName: string }): Promise<void> => {
    try {
      await entry.dir.removeEntry(entry.fileName)
    } catch { /* already gone */ }
  }

  readonly #getSigner = (): SignerLike | undefined => this.#ioc<SignerLike>(NOSTR_SIGNER_KEY)

  readonly #ioc = <T>(key: string): T | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(key) as T | undefined
}

/** The one host sync. sharing.boot.drone.ts registers it — under its IoC key
 *  and the runtime contract key `@HostSyncService` the store stages through —
 *  in the boot lane (atomic-modules-plan.md): a dependency registers nothing. */
export const hostSyncService = new HostSyncService()
const _hostSync = hostSyncService

// On boot, drain anything left from a prior session — only if the operator
// has explicitly opted in. Visitors with no host configured (or who haven't
// flipped the gate) skip the drain entirely, so the signer is never invoked
// at startup and no Nostr-signer prompt appears. The drain also self-cleans
// the legacy `__host_push__`/`__host_receipts__` dirs into the pools.
if (_hostSync.isEnabled()) void _hostSync.drain()

// Delayed re-kick: the boot drain above usually fires before Store has
// resolved its OPFS root (module-load order), silently no-oping. Re-run once
// the shell has settled so the legacy dir absorb happens even in an
// opted-in session that never writes new content. Detached + delayed clear
// of first paint and the warmup walk, mirroring Store's content self-clean
// and the retired-push collector. Gated on isEnabled() so an un-opted-in
// visitor never triggers the signer.
setTimeout(() => { if (_hostSync.isEnabled()) void _hostSync.drain() }, 20_000)
