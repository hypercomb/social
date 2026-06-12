// diamondcoreprocessor.com/sharing/content-broker.drone.ts
//
// Content-addressed fetch with two transports:
//   1. HTTP-direct (preferred) — fetch from operator domains' HTTP
//      content endpoints. Used for ALL content types (layer, resource,
//      dependency). Self-domain + community-trusted + mesh-learned
//      domains, tried in trust order; first verified-bytes wins.
//   2. Mesh broker (layer-only fallback) — broadcast a sig request on
//      the Nostr mesh and let any peer who has the bytes respond.
//      Resources and dependencies do NOT use the mesh — they're heavy
//      bytes that belong on direct HTTPS, per the doctrine in
//      project_public_navigation_lineage_filter.md:
//        "Mesh transports LAYER SIGS ONLY — layers are tiny directories;
//         resources / deps / bees / blobs travel via direct HTTPS
//         fetches to the domains the mesh told you about."
//
// Why this exists: the swarm publish path (kind 30200 etc.) is
// LOCATION-keyed and depth-bounded (MAX_PUBLISH_DEPTH = 3 in
// swarm.drone.ts). When an adopter wants a LAYER the original
// publisher hasn't re-walked recently — or wants it from a peer
// who joined long after the publisher left — the location-keyed flow
// has nothing for them. The broker replaces "ask the one publisher"
// with "ask the swarm" for layer sigs. Resources/deps are served by
// the operator's own HTTP endpoint (jwize.com etc.) on signature URLs,
// learned via the `{ bytes, domains }` response primitive on layer
// fetches.
//
// Wire shape (layer-only on the mesh):
//
//   REQUEST  kind 20400, tags [['x', BROADCAST_TAG], ['d', sig], ['t', 'layer']]
//            content empty; the sig travels as a tag.
//            Broadcast to every participant subscribed on BROADCAST_TAG.
//            `t` field retained for forward compatibility but the
//            responder ignores any value other than 'layer'.
//
//   RESPONSE kind 30401 (parameterized-replaceable),
//            tags [['d', sig], ['t', 'layer'],
//                  ['expiration', secs],
//                  ['domain', wssOrHostUrl]?]
//            content base64 of bytes.
//            The ['domain', ...] tag is the optional address-graph
//            attribution — operators set hc:nostrmesh:self-domain in
//            localStorage to advertise themselves; clients leave it
//            empty. Receivers accumulate domains into
//            #knownDomainsBySig for future HTTP-direct queries.
//
//   CANCEL   kind 20402, tags [['d', sig], ['expiration', secs]]
//            Published by the asker once a sig is satisfied. Peers
//            preparing responses for the same sig abort before
//            committing bandwidth. Best-effort coordination.
//
// Content verification: the requester recomputes sha256 of the
// response bytes and compares to the requested sig. Mismatched bytes
// (malicious peer, transmission corruption) are discarded. Result is
// content-address-clean: a fetch never returns bytes that don't match
// the sig the caller asked for. Trust ordering in HTTP-direct adds
// a complementary protection — it bounds the TIME wasted on bad
// hosts before sig-verification rejects their bytes.
//
// Self-skip: requesters filter their own pubkey out of inbound events
// so we don't loop on our own broadcasts. Local-fanout events arrive
// without a pubkey (pre-sign) — also dropped.
//
// On dependency fetches: stored at `__dependencies__/<sig>` (Store
// doesn't expose a getDependencyBytes yet, so we read the file handle
// directly through Store.opfsRoot fallback). Layer/resource paths use
// the canonical Store APIs.

import { Drone } from '@hypercomb/core'

const NOSTR_MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'

const KIND_FETCH_REQUEST = 20400
// Responses are PARAMETERIZED-REPLACEABLE (30000-39999 range). The
// relay enforces one stored event per (pubkey, kind, d-tag=sig), so
// each responder's bytes for a given sig live in the relay cache and
// survive across sessions. Newcomers subscribed to the sig get cached
// responses via REQ replay — no broadcast needed for the second-onward
// requester. The relay IS the cache; we don't have to coordinate.
//
// Coordination: see KIND_FETCH_CANCEL below. The asker publishes a
// cancel signal once it has verified bytes for a sig, and any other
// peer mid-preparation (between readLocal and publish) aborts. This
// implements the doctrine's "live shrinking broadcast" — first valid
// wins, others stand down, bandwidth converges to 1x per resource
// regardless of peer count.
const KIND_FETCH_RESPONSE = 30401

// Cancel signals — published by an asker once a sig has been resolved
// with verified bytes. Any peer currently preparing a response for that
// sig (between #readLocal and the publish call) checks the cancelled
// set before committing bandwidth and aborts if the sig is now done.
//
// The cancel event flows on BROADCAST_TAG (same channel as requests) so
// every broker already subscribed there sees it without needing
// per-sig subscriptions. Short expiration — just long enough to outlast
// in-flight preparations.
const KIND_FETCH_CANCEL = 20402
const CANCEL_TTL_MS = 30_000  // 30s — enough to cover any reasonable readLocal duration

// Long expiration on responses. Content is sig-addressed and immutable,
// so technically a response could live forever — but most relays
// garbage-collect old events. 1 day keeps newcomers' REQ replays useful
// for an active session window without piling up indefinitely.
const RESPONSE_TTL_SECS = 86_400

// Well-known broadcast channel. Every participant subscribes here at
// boot; every request publishes here. Could be made room-scoped later
// if we want network partitioning by zone, but plain global works for
// the layer/resource/dependency space since content is content-
// addressed (sig collision across zones is cryptographically absent).
const BROADCAST_TAG = 'broker:fetch'

// Hard ceiling for response bytes. Mirrors swarm.drone.ts
// MAX_RESOURCE_BYTES — at this size the base64-encoded content is
// ~340KB on the wire, which most relays accept without complaint. A
// requester that needs a larger blob should use the resource pipeline
// (out-of-band URL referencing the sig).
const MAX_RESPONSE_BYTES = 256 * 1024

// How long fetchBySig waits for the first valid response. The relay
// fans the request to every subscriber within one round-trip; valid
// responders publish back within their own round-trip + a small
// local lookup. 2s is a comfortable cap for local-relay dev and
// public relays alike; raise via the optional `timeoutMs` arg when
// a caller knows their content is rare in the swarm.
const DEFAULT_TIMEOUT_MS = 2000

// Hard cap on a single HTTP-direct probe. DEFAULT_TIMEOUT_MS bounds only
// the MESH wait; the HTTP cascade's fetches had no timeout at all, so one
// hung/unreachable host wedged every awaiting caller for the browser's
// connect timeout (tens of seconds). 3s comfortably covers a healthy
// host's 404 (~50-250ms observed) while bounding the pathological case.
const HTTP_PROBE_TIMEOUT_MS = 3000

// How long a FULL-CASCADE miss (HTTP tiers exhausted; for layers, mesh
// timed out too) suppresses re-dialing for that sig. Render passes ask
// for the same missing sigs on every synchronize — without this window
// each pass re-paid the whole cascade (for layers: up to the 2s mesh
// wait, serially per sig). Cleared early by new domain knowledge.
const FETCH_MISS_TTL_MS = 60_000

export type ContentType = 'layer' | 'resource' | 'dependency'

// Visuals-by-composedSig is the second flavor of fetch this drone
// handles. Unlike layer/resource/dependency (content-addressed by
// merkle hash), visuals are LOCATION-addressed — the sig is
// sha256(path + room + secret), what the swarm publishes events
// against on kind 30200. The broker serves the latest cached event
// per pubkey from any participant who's seen the location recently,
// so a peer whose original publisher has gone offline (NIP-40
// expiration past at the relay) is still reachable through anyone
// else in the swarm who saw their visuals. "Swarm memory" without
// any dedicated host role.
//
// Wire-shape difference from the content-addressed flavor:
//   - Response content is NOT verified against the sig hash (the
//     sig isn't a content hash; it's a location). Trust comes from
//     the responder being a swarm member at the same room+secret —
//     they can already publish under their own pubkey freely, so
//     forwarding cached events is no worse than re-publishing them.
//   - Response content is a JSON array of per-pubkey visuals records
//     so the requester can preserve peer attribution in their cache.
export interface CachedVisualsEntry {
  pubkey: string
  content: string  // The original kind-30200 event content (visuals JSON string).
  created_at: number
  tags: string[][]
}

interface NostrEventLike {
  id?: string
  pubkey?: string
  kind?: number
  tags?: string[][]
  content?: string
  created_at?: number
}

interface MeshEvtLike {
  relay: string
  sig: string
  event: NostrEventLike
  payload: unknown
}

interface MeshSubLike { close: () => void }

interface MeshApi {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvtLike) => void) => MeshSubLike
  ensureStartedForSig?: (sig: string) => void
  // Read cached non-expired events for a sig. Backed by the mesh's
  // own per-sig cache (itemsBySig, TTL-bounded by configureExpiry).
  // The broker uses this to serve 'visuals' requests without keeping
  // its own LRU — the mesh already does the work.
  getNonExpired?: (sig: string) => readonly { event: NostrEventLike }[]
}

interface SignerApi {
  getPublicKeyHex: () => Promise<string | null>
}

interface StoreApi {
  opfsRoot?: FileSystemDirectoryHandle
  getResource?: (sig: string) => Promise<Blob | null>
  getResourceLocal?: (sig: string) => Promise<Blob | null>
  putResource?: (blob: Blob) => Promise<string>
  getLayerBytes?: (sig: string) => Promise<Uint8Array | null>
  getLayerPoolBytes?: (sig: string) => Promise<Uint8Array | null>
  writeLayerBytes?: (sig: string, bytes: ArrayBuffer) => Promise<void>
}

// ── helpers ─────────────────────────────────────────────────────────

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)))
  }
  return btoa(s)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
  const view = new Uint8Array(hash)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += view[i].toString(16).padStart(2, '0')
  return hex
}

const SIG_RE = /^[0-9a-f]{64}$/

// ── drone ───────────────────────────────────────────────────────────

export class ContentBrokerDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Decentralised content-addressed fetch over the swarm. Any participant with the bytes can respond to a sig request; the requester verifies sha256 before accepting. Same primitive serves layer, resource, and dependency fetches.'

  public override effects = ['network'] as const

  protected override deps = {
    mesh: NOSTR_MESH_KEY,
    signer: NOSTR_SIGNER_KEY,
  }
  protected override listens: string[] = []
  protected override emits: string[] = ['broker:fetched', 'adopt:progress', 'adopt:done']

  #broadcastSub: MeshSubLike | null = null
  #myPubkey: string | null = null
  #initialized = false

  // Pending fetch promises, keyed by sig. Multiple concurrent fetches
  // for the same sig share one in-flight subscription + request,
  // resolving from a single response. Cleaned up when the fetch
  // settles.
  #pendingFetches = new Map<string, Promise<Uint8Array | null>>()

  // Full-cascade miss window per sig (egg semantics — see fetchBySig).
  // Cleared by new knowledge (#noteDomains / noteDomain) or lapse.
  #fetchMissUntil = new Map<string, number>()

  // Same coalescing for visuals fetches — distinct map because the
  // return shape is different (CachedVisualsEntry[] vs Uint8Array).
  #pendingVisuals = new Map<string, Promise<readonly CachedVisualsEntry[] | null>>()

  // Per the response-primitive doctrine, every broker response carries
  // BOTH bytes (synchronous: hatch the egg now) AND domains (async:
  // accumulate the address graph for future direct queries). This map
  // is the receiver-side accumulator — each domain we've seen serve
  // a given sig gets recorded here. Future HTTP-direct fetch code
  // queries this map to know which domains to try directly without
  // re-broadcasting on the mesh.
  //
  // See: project_public_navigation_lineage_filter.md / "The response
  // primitive: { bytes, domains }".
  #knownDomainsBySig = new Map<string, Set<string>>()

  // Session-scoped fetch sources — domains noted as places to HTTP-direct
  // fetch from, for THIS session, independent of the per-sig mesh-learned
  // map. Seeded by noteDomain() — e.g. the adopt handoff passes the
  // publisher's domain here so the installer (a fresh iframe context that
  // has observed no mesh responses) still knows where to fetch the adopted
  // content's resources from. This is a FETCH source, NOT a trust grant:
  // sha256 verification gates acceptance regardless, so noting a domain
  // can only ever speed up finding correct bytes, never accept wrong ones.
  #sessionKnownDomains = new Set<string>()

  // Cancelled sigs — populated by inbound KIND_FETCH_CANCEL events.
  // Used by #handleFetchRequest to abort preparation when an asker has
  // already received valid bytes from another peer. Keyed by sig, value
  // is the local-time expiration (ms epoch). Stale entries are pruned
  // lazily before each check.
  #cancelledSigs = new Map<string, number>()

  constructor() {
    super()
    queueMicrotask(() => this.#resolveMyPubkeyWithRetry(0))
    queueMicrotask(() => this.#subscribeBroadcastWithRetry(0))
  }

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
  }

  // ─────────────────────────────────────────────────────────────────
  // Domain accumulation — the `{ bytes, domains }` response primitive
  // ─────────────────────────────────────────────────────────────────

  // Read the participant's host directly from localStorage. The single
  // key `hc:nostrmesh:self-domain` is the canonical "one place" — every
  // reader pulls from it. The runtime initializer pre-populates the key
  // with window.location.origin on first boot so this never returns ""
  // for any participant.
  #getSelfDomain = (): string => {
    try { return String(localStorage.getItem('hc:nostrmesh:self-domain') ?? '').trim() }
    catch { return '' }
  }

  // ─────────────────────────────────────────────────────────────────
  // Community-trust gate — the binary in-community trust formula
  // ─────────────────────────────────────────────────────────────────
  //
  // The operator declares their trusted-community as a list of domain
  // strings in localStorage['hc:community:domains'] (JSON array).
  // Examples:
  //   '["alice.dev", "bob.io"]'              — endorsed by domain
  //   '["wss://alice.dev", "https://bob.io"] ' — same; scheme is stripped
  //
  // This list is THE trust signal. The doctrine in
  // project_public_navigation_lineage_filter.md says trust accrues via
  // the community graph; this implementation collapses that to its
  // simplest binary form: a domain is either in your community
  // (endorsed) or not. That's enough to:
  //   - protect HTTP-direct fetch ordering against adversarial mesh
  //     advertisements (community-trusted hosts are tried first)
  //   - try community hosts even when they haven't witnessed a given
  //     sig via the mesh (endorsement carries weight on its own)
  //
  // Future refinements (graph-distance, overlap-count, explicit-
  // endorsement) layer on top by re-ranking inside the community tier
  // without changing the binary in/out gate.
  #getCommunityDomains = (): Set<string> => {
    try {
      const raw = String(localStorage.getItem('hc:community:domains') ?? '').trim()
      if (!raw) return new Set<string>()
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return new Set<string>()
      const out = new Set<string>()
      for (const entry of parsed) {
        const host = this.#domainToHost(String(entry ?? ''))
        if (host) out.add(host)
      }
      return out
    } catch { return new Set<string>() }
  }

  // Optional fallback hosts — Tier 3 of the HTTP-direct cascade. EMPTY by
  // default: there is no public default registry (domain-as-identity —
  // bootstrap is an operator domain, and every participant's self-domain
  // already sits at Tier 0). The old hard-coded Azure CDN default is
  // retired — a self-hosting operator must never see the app dial central
  // storage. Operators who WANT extra last-resort mirrors set
  // `hc:fallback-domains` in localStorage as a JSON array — same shape as
  // hc:community:domains, just used at a lower-priority tier; sha256 still
  // gates acceptance.
  #getFallbackDomains = (): string[] => {
    try {
      const raw = String(localStorage.getItem('hc:fallback-domains') ?? '').trim()
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      const out: string[] = []
      for (const entry of parsed) {
        const host = this.#domainToHost(String(entry ?? ''))
        if (host) out.push(host)
      }
      return out
    } catch { return [] }
  }

  // Pull all `['domain', host]` tags out of an incoming response event.
  // The protocol's optional-domains-list half: any host that knows about
  // canonical hosts for this sig can include them here, and the receiver
  // accumulates the resulting address graph.
  #extractDomains = (evt: MeshEvtLike): string[] => {
    const tags = evt.event?.tags
    if (!Array.isArray(tags)) return []
    const out: string[] = []
    for (const t of tags) {
      if (!Array.isArray(t) || t.length < 2) continue
      if (String(t[0]) !== 'domain') continue
      const v = String(t[1] ?? '').trim()
      if (v) out.push(v)
    }
    return out
  }

  // Record a sig→domain mapping. Called whenever a response carrying
  // domain attributions arrives. Domains are deduped per-sig; the map
  // grows monotonically until the drone restarts.
  #noteDomains = (sig: string, domains: string[]): void => {
    if (!domains.length) return
    const set = this.#knownDomainsBySig.get(sig) ?? new Set<string>()
    for (const d of domains) set.add(d)
    this.#knownDomainsBySig.set(sig, set)
    // New address knowledge for this sig — its egg may now hatch; lift
    // the miss window so the next ask re-dials immediately.
    this.#fetchMissUntil.delete(sig)
  }

  /** §21.14 — parse a verified layer's sig-array slots and attribute the
   *  serving host to every ref. The branch-closure hosting standard says
   *  the host of a root serves the root's whole closure, so one layer
   *  fetch teaches the address graph where the entire subtree lives.
   *  Best-effort: malformed JSON attributes nothing. */
  #attributeClosure = (bytes: Uint8Array, host: string): void => {
    try {
      const layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
      if (!layer || typeof layer !== 'object') return
      for (const value of Object.values(layer)) {
        if (!Array.isArray(value)) continue
        for (const raw of value) {
          const ref = String(raw ?? '').trim().toLowerCase()
          if (/^[a-f0-9]{64}$/.test(ref)) this.#noteDomains(ref, [host])
        }
      }
    } catch { /* not a JSON layer — nothing to attribute */ }
  }

  // Map a domain advertisement (which may be wss://host, https://host,
  // or bare host) to a hostname suitable for building HTTPS URLs.
  // Strips scheme prefix, trims trailing slash.
  #domainToHost = (domain: string): string => {
    return String(domain ?? '')
      .replace(/^wss?:\/\//, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '')
      .trim()
  }

  // Standard URL path for each content type on a host's HTTP endpoint.
  // Matches the layout served by hypercomb-relay's HTTP file handler.
  #httpPathForType = (sig: string, type: ContentType): string => {
    switch (type) {
      case 'layer':      return `/__layers__/${sig}.json`
      case 'resource':   return `/__resources__/${sig}`
      case 'dependency': return `/__dependencies__/${sig}.js`
      default:           return ''
    }
  }

  // Verify bytes hash to the claimed sig. Defense against any host
  // (canonical or not) serving incorrect bytes for a given URL.
  #verifyBytes = async (bytes: Uint8Array, expectedSig: string): Promise<boolean> => {
    try {
      const actual = await sha256Hex(bytes)
      return actual === expectedSig
    } catch {
      return false
    }
  }

  // HTTP-direct fetch from learned domains + self-domain. Tries each
  // domain in sequence; first verified-bytes wins. Falls through to
  // null if all domains 404 or fail verification — the caller (fetchBySig)
  // then falls back to the mesh broker path.
  //
  // Per the layer-only-mesh / HTTP-for-everything-else doctrine, this
  // is the preferred path for resources/deps — they're heavy bytes
  // and shouldn't ride the mesh. Layers go HTTP too here when a
  // domain's known to host them; the doctrine just says they CAN go
  // mesh-only, not that they MUST. A working HTTP path is faster.
  //
  // Candidate ordering — the binary in-community trust formula:
  //   Tier 0  Self-domain        (you; instant on operator's own machine)
  //   Tier 1  Community-trusted  (operator-endorsed; tried whether or not
  //                               they've been mesh-witnessed for this sig
  //                               — endorsement carries weight on its own)
  //   Tier 2  Mesh-learned       (witnessed via prior response for this
  //                               sig but NOT in the operator's community)
  //
  // Within a tier, insertion order. This protects fetch latency against
  // adversarial mesh advertisements: a malicious peer flooding fake
  // `domain` tags into responses can only push their host into Tier 2,
  // never ahead of community-trusted hosts. sha256 verification of bytes
  // is the absolute backstop — wrong bytes are dropped regardless of
  // which tier they came from — but trust-ordering protects time and
  // bandwidth, which sig-verification alone cannot.
  /** Sigs already handed to the host-sync queue this session (dedupe —
   *  receipts make staging idempotent; this avoids re-resolving the
   *  service on every read). */
  #stagedToHost = new Set<string>()

  /** Read-triggered staging: bytes we hold locally are handed to
   *  HostSyncService so the participant's own host (self-domain) serves
   *  them — signed NIP-98 PUT, durable queue, read-back receipts. The
   *  app NEVER dials localhost or any host other than the configured
   *  self-domain; with host-sync disabled (the default) this is a no-op
   *  and witnessing tabs simply can't pull these bytes — functionality
   *  lost, not redirected. This is the swarm byte-path's PUSH half. */
  #stageToHost = (sig: string, type: ContentType, bytes: Uint8Array): void => {
    try {
      if (this.#stagedToHost.has(sig)) return
      const hostSync = window.ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as
        | { isEnabled?: () => boolean; enqueue?: (sig: string, kind: string, bytes: ArrayBuffer) => Promise<void> }
        | undefined
      if (!hostSync?.isEnabled?.() || !hostSync.enqueue) return
      this.#stagedToHost.add(sig)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      void hostSync.enqueue(sig, type, buffer)
        .catch(() => { this.#stagedToHost.delete(sig) })  // enqueue hiccup → retry on next read
    } catch { /* non-fatal */ }
  }

  #fetchOverHttp = async (sig: string, type: ContentType): Promise<Uint8Array | null> => {
    const path = this.#httpPathForType(sig, type)
    if (!path) return null

    const ordered: string[] = []
    const seen = new Set<string>()
    const push = (raw: string): void => {
      const host = this.#domainToHost(raw)
      if (!host || seen.has(host)) return
      seen.add(host)
      ordered.push(host)
    }

    // Tier 0 — self-domain. There is NO localhost tier: the app only ever
    // dials real domains. The operator's own domain resolves locally anyway
    // when the tunnel terminates on this machine (e.g. jwize.com →
    // cloudflared → the local relay), so a localhost shortcut buys nothing
    // and costs the guarantee that local ports are never fetched directly.
    push(this.#getSelfDomain())

    // Tier 1 — community-trusted domains. Always included regardless
    // of whether they've witnessed this sig via the mesh: the operator
    // endorsed them, so they're worth a direct query.
    const community = this.#getCommunityDomains()
    for (const host of community) push(host)

    // Tier 2 — mesh-learned domains that aren't in the community set.
    // (Domains in community already landed in Tier 1; the `seen` guard
    // deduplicates.)
    for (const domain of this.getKnownDomains(sig)) push(domain)

    // Tier 2.5 — session-noted fetch sources (e.g. the publisher's domain
    // handed through the adopt flow). Tried before the public fallback so a
    // freshly-opened installer fetches adopted resources from the source
    // host rather than failing through to the CDN. sha256 still gates.
    for (const host of this.#sessionKnownDomains) push(host)

    // Tier 3 — operator-configured fallback hosts (hc:fallback-domains).
    // Empty unless the operator deliberately added extra mirrors — there
    // is no hard-coded public CDN. sha256 verification still gates
    // acceptance — a wrong-bytes fallback is rejected like any other tier.
    for (const host of this.#getFallbackDomains()) push(host)

    if (ordered.length === 0) return null

    for (const host of ordered) {
      // Loopback hosts are served over plain http — the content-side analog
      // of the mesh's allow-loopback. Real domains always use https.
      const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
      // Flat heap first — `/<sig>` is the canonical address (§21.10): one
      // bucket, no typed pools, no extensions; the consumer knows the type
      // and sha256 gates the bytes. The typed path is the legacy fallback
      // for static layouts that can't resolve flat (Azure blob, ng-serve
      // public/content), kept during the migration.
      for (const tryPath of [`/${sig}`, path]) {
        const url = `${scheme}://${host}${tryPath}`
        // Bounded probe: a dead/hung host must cost at most
        // HTTP_PROBE_TIMEOUT_MS, never the browser's connect timeout —
        // callers on the render path await this cascade.
        const probeCtrl = new AbortController()
        const probeTimer = setTimeout(() => probeCtrl.abort(), HTTP_PROBE_TIMEOUT_MS)
        try {
          const res = await fetch(url, { cache: 'no-store', signal: probeCtrl.signal })
          if (!res.ok) continue
          // SPA fallback guard: sig-addressed bytes are never text/html —
          // skip before hashing (an extension-less /<sig> on a dev-server
          // origin 200s with index.html).
          if ((res.headers.get('content-type') || '').toLowerCase().includes('text/html')) continue
          const buf = await res.arrayBuffer()
          const bytes = new Uint8Array(buf)
          if (!await this.#verifyBytes(bytes, sig)) continue
          // Branch-closure attribution (§21.14): a host serving a LAYER is
          // presumed to serve the layer's entire closure — the standard is
          // "a branch merkle signature hosts all its contents". Every ref
          // in the layer learns this host as a first-try fetch source, so
          // resolving a branch collapses to ONE host instead of per-sig
          // discovery. sha256 still gates every byte; a non-conforming
          // host costs a 404 and the tier cascade takes over (the 1%).
          if (type === 'layer') this.#attributeClosure(bytes, host)
          return bytes
        } catch {
          // network error / CORS / cert issue / probe timeout — try next
          // path / host
          continue
        } finally {
          clearTimeout(probeTimer)
        }
      }
    }
    return null
  }

  // ─────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────

  /**
   * Return all known domains that have served a given sig. Future
   * HTTP-direct fetch code (per the layer-only-mesh / HTTP-for-everything-else
   * doctrine) uses this to pick which domains to GET resources from
   * without re-broadcasting on the mesh. Empty array if no responses
   * have been observed yet for this sig.
   */
  public getKnownDomains = (sig: string): string[] => {
    const set = this.#knownDomainsBySig.get(sig)
    return set ? Array.from(set) : []
  }

  /**
   * Note a domain as a session-scoped HTTP-direct fetch source. Used by the
   * adopt handoff: the publisher's domain (learned from the swarm at click
   * time) is noted here so a freshly-opened installer — which has observed
   * no mesh responses of its own — still knows where to fetch the adopted
   * content's resources from. A FETCH source, not a trust grant: sha256
   * verification gates acceptance, so this can only speed finding correct
   * bytes. Accepts a host or URL; normalises to a bare host. No-op on empty.
   */
  public noteDomain = (domain: string): void => {
    const host = this.#domainToHost(String(domain ?? ''))
    if (host) {
      this.#sessionKnownDomains.add(host)
      // A new session-wide fetch source can satisfy ANY pending egg —
      // clear all miss windows (rare event: adopt handoff, config).
      this.#fetchMissUntil.clear()
    }
  }

  /**
   * Record domain attributions for a specific sig — the public face of the
   * address graph's accumulate step. The swarm calls this when a peer's
   * layer event carries a ['domain', …] tag: each visual's layerSig gets
   * attributed to the publisher's advertised host, so an adopt-click can
   * answer getKnownDomains(layerSig) without waiting for a 30401 response.
   * Attribution only — fetch candidates land in Tier 2 and sha256 still
   * gates every byte.
   */
  public noteDomainsForSig = (sig: string, domains: string[]): void => {
    const clean = String(sig ?? '').trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(clean)) return
    this.#noteDomains(clean, Array.isArray(domains) ? domains : [])
  }

  /**
   * Ask the swarm for content addressed by sig. Returns the verified
   * bytes when the first valid response arrives, or null on timeout /
   * no responder. Idempotent across concurrent callers for the same
   * sig — they share one in-flight request.
   *
   * Verification: the returned bytes are guaranteed to hash to `sig`
   * (sha256). Malicious or corrupted responses are discarded silently
   * and we keep waiting for a valid one (until timeout).
   *
   * Side effects on success — bytes are written to the local Store at
   * the canonical location for their type so future calls hit the
   * cache and the local participant can now serve the same sig to
   * future requesters.
   */
  public fetchBySig = async (
    sig: string,
    type: ContentType,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Uint8Array | null> => {
    const s = String(sig ?? '').toLowerCase().trim()
    if (!SIG_RE.test(s)) return null

    // Coalesce concurrent fetches for the same sig.
    const inFlight = this.#pendingFetches.get(s)
    if (inFlight) return inFlight

    // Fast path — already in local store.
    const local = await this.#readLocal(s, type)
    if (local) {
      // A tab that HAS the bytes (the author) stages them on its own host
      // so a witnessing tab can fetch them (the missing half of the swarm
      // byte-path — the mesh carries layer sigs only). Routed through
      // HostSyncService: signed, queued, receipted, self-domain only.
      this.#stageToHost(s, type, local)
      return local
    }

    // MISS WINDOW (egg semantics): a sig the full cascade could not
    // resolve recently answers null instantly instead of re-dialing
    // HTTP (and, for layers, the mesh's multi-second wait) — render
    // passes re-ask for the same missing sig on every synchronize, and
    // without this window each pass re-paid the entire cascade. The
    // window clears when new knowledge arrives (#noteDomains attribution,
    // noteDomain session source) or simply lapses — "not yet delivered",
    // never "failed".
    const missUntil = this.#fetchMissUntil.get(s)
    if (missUntil !== undefined) {
      if (Date.now() < missUntil) return null
      this.#fetchMissUntil.delete(s)
    }

    // HTTP-direct path — try known domains' content endpoints first.
    // Per the layer-only-mesh doctrine, heavy bytes (resources, deps)
    // travel via HTTP exclusively; layers can fall back to mesh.
    // Self-domain + community + mesh-learned domains form the
    // candidate set (see #fetchOverHttp); first verified-bytes wins.
    const fromHttp = await this.#fetchOverHttp(s, type)
    if (fromHttp) return fromHttp

    // Layer-only mesh transport. Per the doctrine in
    // project_public_navigation_lineage_filter.md:
    //   "Mesh transports LAYER SIGS ONLY — layers are tiny directories;
    //    resources / deps / bees / blobs travel via direct HTTPS fetches
    //    to the domains the mesh told you about."
    // Resources and dependencies have no mesh fallback. If they aren't
    // available via HTTP-direct, the asker simply doesn't get them —
    // they'll be re-tried after the miss window, by which point HTTP-
    // direct may have learned new domains via subsequent layer fetches.
    if (type !== 'layer') {
      this.#fetchMissUntil.set(s, Date.now() + FETCH_MISS_TTL_MS)
      return null
    }

    // Mesh broker fallback for layers only. Used when HTTP-direct
    // returns nothing (no known domains, or every candidate 404'd /
    // failed verify). Layers are tiny — typically <2KB of refs — so
    // the mesh round-trip is cheap.
    const fetchPromise = this.#fetchOverMesh(s, type, timeoutMs)
    this.#pendingFetches.set(s, fetchPromise)
    try {
      const bytes = await fetchPromise
      if (!bytes) this.#fetchMissUntil.set(s, Date.now() + FETCH_MISS_TTL_MS)
      return bytes
    }
    finally { this.#pendingFetches.delete(s) }
  }

  /**
   * Fetch the cached visuals for a composedSig from any participant
   * in the swarm. Returns an array of per-pubkey visuals entries —
   * the requester feeds these into their own swarm peer cache so
   * show-cell renders them as if the original publishes had just
   * arrived. Returns null on timeout or no responder.
   *
   * Coalesced like fetchBySig: concurrent callers for the same
   * composedSig share one in-flight broadcast.
   *
   * Unlike layer/resource/dependency, no sha256 verification — the
   * sig isn't a content hash. Trust comes from swarm membership
   * (matching room+secret); content sanitisation happens at the
   * swarm cache injection point, not here.
   */
  public fetchVisualsAt = async (
    composedSig: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<readonly CachedVisualsEntry[] | null> => {
    const s = String(composedSig ?? '').toLowerCase().trim()
    if (!SIG_RE.test(s)) return null

    const inFlight = this.#pendingVisuals.get(s)
    if (inFlight) return inFlight

    const fetchPromise = this.#fetchVisualsOverMesh(s, timeoutMs)
    this.#pendingVisuals.set(s, fetchPromise)
    try { return await fetchPromise }
    finally { this.#pendingVisuals.delete(s) }
  }

  /**
   * Adopt a hive (or any subtree) by signature: recursively pull a root
   * layer's transitive closure into the local pool so it renders and
   * serves locally — the daisy-chain mirror (protocol-spec §21.8).
   *
   * This is NOT a bespoke walker — it reuses the existing layer-signature
   * cycle. `fetchBySig` fills each sig (local → HTTP-direct → mesh for
   * layers; HTTP-direct for resources), verifies it against its sha256,
   * and stores it. We expand each layer, recurse into its child layers,
   * and fetch its referenced resources. Once the bytes are in the pool an
   * adopted cell is indistinguishable from a locally-authored one — same
   * machinery, remote source. The root layer fills first (instantly
   * renderable); resources sprout in behind it.
   *
   * Classification from the layer shape:
   *   - children slot (cells / layers / children) → child LAYERS → recurse
   *   - bees slot → skipped: bees are package content the adopter already
   *     has from install (the broker has no 'bee' fetch type by design)
   *   - every other referenced sig → resource leaf → fetchBySig(_, 'resource')
   *
   * Idempotent + dedup via a visited set; fetchBySig's local fast-path
   * makes already-present sigs free. Emits `adopt:progress` as it fills
   * and `adopt:done` at the end (UI can sprout the cell as counts climb).
   */
  public adopt = async (rootSig: string): Promise<{ layers: number; leaves: number; failed: number }> => {
    const root = String(rootSig ?? '').toLowerCase().trim()
    const stats = { layers: 0, leaves: 0, failed: 0 }
    if (!SIG_RE.test(root)) return stats
    const visited = new Set<string>()

    // Announce the rootSig + every known source domain BEFORE the walk
    // starts, so DCP can open to that domain's installer section and
    // create a pending row in the same frame. The domains come from the
    // {bytes, domains} address graph we've accumulated from prior mesh
    // responses; if we have no domain attribution for the root yet we
    // emit an empty array and the UI falls back to trusted-domain
    // heuristics (e.g. the operator's self-domain, or "via swarm host").
    //
    // Multiple domains is the normal case — the address graph grows
    // monotonically as more peers attribute the same sig. Letting DCP
    // see the full list means it can pick its preferred mirror, show all
    // sources to the user, and fall back across them if any fail.
    const knownDomains = this.#knownDomainsBySig.get(root)
    const domains: string[] = knownDomains && knownDomains.size ? [...knownDomains] : []
    this.emitEffect('adopt:meta', { rootSig: root, domains })

    const asSigs = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(x => String(x).toLowerCase().trim()).filter(s => SIG_RE.test(s)) : []

    const walkLayer = async (sig: string): Promise<void> => {
      if (visited.has(sig)) return
      visited.add(sig)
      const bytes = await this.fetchBySig(sig, 'layer') // fill + verify + store
      if (!bytes) { stats.failed++; return }
      stats.layers++
      this.emitEffect('adopt:progress', { sig, ...stats })

      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> }
      catch { return } // not a parseable layer — nothing to recurse

      const children = asSigs(parsed['cells']).length ? asSigs(parsed['cells'])
        : asSigs(parsed['layers']).length ? asSigs(parsed['layers'])
        : asSigs(parsed['children'])
      const childSet = new Set(children)
      const bees = new Set(asSigs(parsed['bees'])) // skip — installed package content

      // Every sig the layer references, recursively (covers resources
      // nested in cell properties), minus child layers and bees.
      const referenced = new Set<string>()
      this.#collectSigs(parsed, referenced)
      for (const r of referenced) {
        if (childSet.has(r) || bees.has(r) || visited.has(r)) continue
        visited.add(r)
        const got = await this.fetchBySig(r, 'resource')
        if (got) stats.leaves++; else stats.failed++
      }

      for (const c of children) await walkLayer(c)
    }

    await walkLayer(root)
    this.emitEffect('adopt:done', { root, ...stats })
    return stats
  }

  /** Recursively collect every 64-hex signature reachable inside a value
   *  (strings, arrays, object values). Used by adopt() to find a layer's
   *  referenced resources wherever they sit, including nested in cell
   *  properties — not just top-level slots. */
  #collectSigs = (value: unknown, out: Set<string>): void => {
    if (typeof value === 'string') {
      const s = value.toLowerCase()
      if (SIG_RE.test(s)) out.add(s)
      return
    }
    if (Array.isArray(value)) { for (const v of value) this.#collectSigs(v, out); return }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) this.#collectSigs(v, out)
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  #fetchOverMesh = async (sig: string, type: ContentType, timeoutMs: number): Promise<Uint8Array | null> => {
    const mesh = this.#getMesh()
    if (!mesh) return null

    return new Promise<Uint8Array | null>((resolve) => {
      let settled = false
      const cleanup = (): void => {
        if (settled) return
        settled = true
        try { sub?.close() } catch { /* ignore */ }
      }

      // Subscribe to responses on this sig's channel BEFORE publishing
      // the request — if the responder is fast (local fanout from a
      // co-resident broker, or sub-100ms relay round-trip) we don't
      // want to race past the EVENT and miss it.
      const sub: MeshSubLike = mesh.subscribe(sig, (evt) => {
        if (settled) return
        if (Number(evt.event?.kind) !== KIND_FETCH_RESPONSE) return
        const pubkey = String(evt.event?.pubkey ?? '').toLowerCase()
        if (!pubkey) return  // local fanout (our own publish), pre-sign — skip
        if (this.#myPubkey && pubkey === this.#myPubkey) return  // our own echo
        const typeTag = evt.event?.tags?.find(t => t[0] === 't')?.[1]
        if (typeTag !== type) return  // wrong content kind

        // Accumulate domain attributions regardless of whether the bytes
        // verify. The address graph is informational — a domain that
        // responded once for this sig is worth recording even if their
        // particular byte payload was malformed.
        this.#noteDomains(sig, this.#extractDomains(evt))

        const b64 = String(evt.event?.content ?? '')
        if (!b64) return
        void this.#acceptResponseBytes(sig, type, b64).then((bytes) => {
          if (bytes) {
            // Cooperative-cancellable broadcast: signal that the sig
            // is satisfied so other in-flight preparers abort before
            // committing duplicate bandwidth. Fire-and-forget — we
            // don't await; the fetch itself resolves immediately.
            void this.#publishCancel(sig)
            cleanup()
            resolve(bytes)
          }
          // If the bytes failed verification we DON'T resolve — keep
          // waiting; some other (honest) responder may still answer
          // before the timeout. We also don't cancel — other peers may
          // still legitimately need to send.
        })
      })

      // Broadcast the request.
      void mesh.publish(KIND_FETCH_REQUEST, BROADCAST_TAG, '', [
        ['d', sig],
        ['t', type],
      ])

      // Timeout safety net.
      setTimeout(() => {
        if (settled) return
        cleanup()
        resolve(null)
      }, Math.max(100, timeoutMs))
    })
  }

  #fetchVisualsOverMesh = async (composedSig: string, timeoutMs: number): Promise<readonly CachedVisualsEntry[] | null> => {
    const mesh = this.#getMesh()
    if (!mesh) return null

    return new Promise<readonly CachedVisualsEntry[] | null>((resolve) => {
      let settled = false
      const cleanup = (): void => {
        if (settled) return
        settled = true
        try { sub?.close() } catch { /* ignore */ }
      }

      // Subscribe to responses on the composedSig channel BEFORE
      // publishing the request — same fast-path concern as the
      // content-by-sig flow above.
      const sub: MeshSubLike = mesh.subscribe(composedSig, (evt) => {
        if (settled) return
        if (Number(evt.event?.kind) !== KIND_FETCH_RESPONSE) return
        const pubkey = String(evt.event?.pubkey ?? '').toLowerCase()
        if (!pubkey) return  // local fanout, pre-sign
        if (this.#myPubkey && pubkey === this.#myPubkey) return  // self-echo
        const typeTag = evt.event?.tags?.find(t => t[0] === 't')?.[1]
        if (typeTag !== 'visuals') return

        // Accumulate domain attributions from visuals responses too —
        // a peer who can serve visuals for this location is worth
        // remembering as a future address.
        this.#noteDomains(composedSig, this.#extractDomains(evt))

        const b64 = String(evt.event?.content ?? '')
        if (!b64) return
        try {
          const bytes = base64ToBytes(b64)
          const decoded = new TextDecoder().decode(bytes)
          const parsed = JSON.parse(decoded)
          if (!Array.isArray(parsed)) return
          // Light shape validation — entries must have pubkey + content
          // strings. Anything else gets filtered out.
          const entries: CachedVisualsEntry[] = []
          for (const raw of parsed) {
            if (!raw || typeof raw !== 'object') continue
            const pk = String(raw.pubkey ?? '').toLowerCase()
            if (!/^[0-9a-f]{64}$/.test(pk)) continue
            const content = typeof raw.content === 'string' ? raw.content : ''
            const createdAt = Number(raw.created_at ?? 0)
            const tags = Array.isArray(raw.tags) ? raw.tags : []
            entries.push({ pubkey: pk, content, created_at: createdAt, tags })
          }
          if (entries.length === 0) return
          // Cooperative cancellation for visuals too — signal that this
          // composedSig has been resolved so other peers preparing
          // visuals responses can abort.
          void this.#publishCancel(composedSig)
          cleanup()
          resolve(entries)
        } catch { /* malformed — keep waiting for another responder */ }
      })

      // Broadcast the request.
      void mesh.publish(KIND_FETCH_REQUEST, BROADCAST_TAG, '', [
        ['d', composedSig],
        ['t', 'visuals'],
      ])

      setTimeout(() => {
        if (settled) return
        cleanup()
        resolve(null)
      }, Math.max(100, timeoutMs))
    })
  }

  /**
   * Verify a response payload against the requested sig and, on
   * success, persist to the local Store at the canonical location for
   * its type. Returns the bytes (verified) on hit, null on mismatch.
   */
  #acceptResponseBytes = async (sig: string, type: ContentType, b64: string): Promise<Uint8Array | null> => {
    let bytes: Uint8Array
    try { bytes = base64ToBytes(b64) } catch { return null }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return null

    const computed = await sha256Hex(bytes)
    if (computed !== sig) {
      console.warn('[content-broker] response sig mismatch — discarding', {
        requested: sig.slice(0, 12),
        actual: computed.slice(0, 12),
        type,
      })
      return null
    }

    // Persist to local store so subsequent reads are cache hits and
    // we can serve this sig to future requesters.
    const store = this.#getStore()
    try {
      if (type === 'layer' && store?.writeLayerBytes) {
        await store.writeLayerBytes(sig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      } else if (type === 'resource' && store?.putResource) {
        await store.putResource(new Blob([bytes as BlobPart]))
      } else if (type === 'dependency') {
        await this.#writeDependencyBytes(sig, bytes)
      }
    } catch (err) {
      console.warn('[content-broker] persist failed (still returning bytes)', { sig: sig.slice(0, 12), type, err })
    }

    this.emitEffect('broker:fetched', { sig, type, bytes: bytes.byteLength })
    return bytes
  }

  /**
   * Read the local copy of a sig at the canonical location for its
   * type. Returns the bytes on hit, null when absent. Used both as
   * the fast-path in fetchBySig and as the responder's lookup when
   * handling inbound requests.
   */
  #readLocal = async (sig: string, type: ContentType): Promise<Uint8Array | null> => {
    const store = this.#getStore()
    if (!store) return null
    try {
      if (type === 'layer') {
        if (store.getLayerBytes) return (await store.getLayerBytes(sig)) ?? null
        if (store.getLayerPoolBytes) return (await store.getLayerPoolBytes(sig)) ?? null
        return null
      }
      if (type === 'resource') {
        // Pure-local read ONLY — getResourceLocal never falls back to the
        // host. Calling getResource here would re-enter the broker
        // (getResource → #fetchResourceFromHost → fetchBySig → #readLocal)
        // and deadlock on the coalesced pending fetch.
        const blob = store.getResourceLocal ? await store.getResourceLocal(sig) : null
        if (!blob) return null
        return new Uint8Array(await blob.arrayBuffer())
      }
      if (type === 'dependency') {
        return await this.#readDependencyBytes(sig)
      }
    } catch { /* fall through */ }
    return null
  }

  // Dependencies live at `__dependencies__/<sig>` per CLAUDE.md OPFS
  // layout, but Store doesn't expose a typed accessor for them yet,
  // so we reach in via opfsRoot. Read-only and write paths are kept
  // local so a future Store.getDependencyBytes refactor only needs to
  // replace these two helpers.

  #readDependencyBytes = async (sig: string): Promise<Uint8Array | null> => {
    const root = this.#getStore()?.opfsRoot
    if (!root) return null
    try {
      const deps = await root.getDirectoryHandle('__dependencies__', { create: false })
      const handle = await deps.getFileHandle(sig, { create: false })
      const file = await handle.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch { return null }
  }

  #writeDependencyBytes = async (sig: string, bytes: Uint8Array): Promise<void> => {
    const root = this.#getStore()?.opfsRoot
    if (!root) return
    try {
      const deps = await root.getDirectoryHandle('__dependencies__', { create: true })
      const handle = await deps.getFileHandle(sig, { create: true })
      const w = await handle.createWritable()
      try { await w.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) }
      finally { await w.close() }
    } catch { /* best-effort */ }
  }

  // ─────────────────────────────────────────────────────────────────
  // Responder path
  // ─────────────────────────────────────────────────────────────────

  /** Subscribe to the broadcast channel. Every participant runs this
   *  on boot so every fetch request reaches the whole swarm. */
  #subscribeBroadcastWithRetry = (attempts: number): void => {
    const mesh = this.#getMesh()
    if (!mesh?.subscribe) {
      if (attempts >= 50) return
      setTimeout(() => this.#subscribeBroadcastWithRetry(attempts + 1), 100)
      return
    }
    if (this.#broadcastSub) return  // already subscribed
    this.#broadcastSub = mesh.subscribe(BROADCAST_TAG, (evt) => void this.#handleBroadcast(evt))
  }

  // Dispatch inbound broadcast events by kind. Requests get handled
  // by #handleFetchRequest; cancel signals update #cancelledSigs so
  // any preparation-in-flight aborts before publishing duplicate bytes.
  #handleBroadcast = async (evt: MeshEvtLike): Promise<void> => {
    const kind = Number(evt.event?.kind)
    if (kind === KIND_FETCH_REQUEST) return void this.#handleFetchRequest(evt)
    if (kind === KIND_FETCH_CANCEL)  return void this.#handleFetchCancel(evt)
  }

  // Record a cancel signal. The sig tag identifies which fetch has
  // already been satisfied; any in-flight preparation for that sig
  // should now abort. Stored with a TTL so the entry self-cleans.
  #handleFetchCancel = (evt: MeshEvtLike): void => {
    const pubkey = String(evt.event?.pubkey ?? '').toLowerCase()
    if (!pubkey) return  // local fanout of our own publish — no need to act on it
    if (this.#myPubkey && pubkey === this.#myPubkey) return  // self-echo

    const sigTag = evt.event?.tags?.find(t => t[0] === 'd')?.[1]
    if (!sigTag || !SIG_RE.test(sigTag)) return

    this.#cancelledSigs.set(sigTag, Date.now() + CANCEL_TTL_MS)
    this.#pruneStaleCancellations()
  }

  // Lazy cleanup — called whenever we touch the cancelled set so
  // entries that have aged out don't linger forever. O(N) but the
  // set should stay small (only sigs currently being raced for).
  #pruneStaleCancellations = (): void => {
    const now = Date.now()
    for (const [sig, expiresAt] of this.#cancelledSigs) {
      if (expiresAt <= now) this.#cancelledSigs.delete(sig)
    }
  }

  // Is a sig currently in the "just-resolved, don't bother sending"
  // window? Called by #handleFetchRequest before committing to a
  // publish.
  #isCancelled = (sig: string): boolean => {
    this.#pruneStaleCancellations()
    const expiresAt = this.#cancelledSigs.get(sig)
    return expiresAt != null && expiresAt > Date.now()
  }

  // Asker-side: publish a cancel signal so any other peer currently
  // preparing a response for the same sig can abort before committing
  // bandwidth. Fire-and-forget — best-effort coordination, not a
  // correctness primitive (workers that miss the cancel just publish
  // an extra response, which the relay's parameterized-replaceable
  // semantics dedup at storage anyway).
  #publishCancel = async (sig: string): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    if (!SIG_RE.test(sig)) return

    // Also note locally so a self-fanout of the cancel (which would
    // skip the pubkey check in #handleFetchCancel) still has the
    // intended effect on subsequent #isCancelled checks.
    this.#cancelledSigs.set(sig, Date.now() + CANCEL_TTL_MS)

    const expirationSecs = Math.floor((Date.now() + CANCEL_TTL_MS) / 1000)
    try {
      await mesh.publish(KIND_FETCH_CANCEL, BROADCAST_TAG, '', [
        ['d', sig],
        ['expiration', String(expirationSecs)],
      ])
    } catch (err) {
      // best-effort; do nothing on failure — extra response events
      // are harmless under the parameterized-replaceable storage rules
      void err
    }
  }

  #handleFetchRequest = async (evt: MeshEvtLike): Promise<void> => {
    if (Number(evt.event?.kind) !== KIND_FETCH_REQUEST) return
    const pubkey = String(evt.event?.pubkey ?? '').toLowerCase()
    if (!pubkey) return  // local fanout of our own publish
    if (this.#myPubkey && pubkey === this.#myPubkey) return  // self-skip

    const sigTag = evt.event?.tags?.find(t => t[0] === 'd')?.[1]
    const typeTag = evt.event?.tags?.find(t => t[0] === 't')?.[1]
    if (!sigTag || !SIG_RE.test(sigTag)) return

    // Visuals path — fetch from the mesh's per-sig cache and serve
    // whatever kind-30200 events we have cached for this composedSig.
    // The mesh's TTL window (ttlMs in nostr-mesh.drone) bounds how
    // long a peer can serve as proxy for another peer's view.
    if (typeTag === 'visuals') {
      await this.#serveVisuals(sigTag)
      return
    }

    // Layer-only mesh transport. Per the doctrine in
    // project_public_navigation_lineage_filter.md, the mesh carries
    // layer sigs only — resources, dependencies, bees, and blobs
    // travel via direct HTTPS fetches to the domains the mesh told
    // you about. We silently ignore any inbound `t=resource` or
    // `t=dependency` request — those are protocol violations now,
    // and the asker should be using HTTP-direct against the domains
    // they learned about. (Legacy peers that haven't been rebuilt
    // yet may still send them; ignoring is the kindest forward-
    // compatible response.)
    if (typeTag !== 'layer') return

    // Early cancel-check: if some other peer has already satisfied this
    // sig (we saw their cancel signal), skip the readLocal+publish
    // pipeline entirely. Saves a disk read and a publish round-trip.
    if (this.#isCancelled(sigTag)) return

    const bytes = await this.#readLocal(sigTag, typeTag as ContentType)
    if (!bytes) return  // we don't have it — silent no-op
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return

    // Re-check cancellation AFTER the readLocal await — a cancel may
    // have arrived during the async disk read. This is the window the
    // doctrine's "cooperative cancellable broadcast" closes; without
    // this check, every peer that races the readLocal commits bytes
    // even after the first responder has already resolved the sig.
    if (this.#isCancelled(sigTag)) return

    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const content = arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    // Parameterized-replaceable: ['d', sig] makes the relay store
    // exactly one of these per (pubkey, kind, sig). Future requesters
    // for the same sig hit the cached event via REQ replay — they
    // don't even need to publish a request, the relay just delivers
    // what's already there. ['expiration', ...] lets the relay garbage-
    // collect after RESPONSE_TTL_SECS so the cache doesn't grow
    // unbounded.
    const expirationSecs = Math.floor(Date.now() / 1000) + RESPONSE_TTL_SECS
    // Doctrine: response carries { bytes, domains }. Include our own
    // domain when set so requesters accumulate it into their address
    // graph for future direct queries. Operators publish via
    // localStorage['hc:nostrmesh:self-domain'] (e.g. 'wss://jwize.com');
    // regular peers leave it empty and emit domain-less responses.
    const selfDomain = this.#getSelfDomain()
    const responseTags: string[][] = [
      ['d', sigTag],
      ['t', typeTag],
      ['expiration', String(expirationSecs)],
    ]
    if (selfDomain) responseTags.push(['domain', selfDomain])
    try {
      await mesh.publish(KIND_FETCH_RESPONSE, sigTag, content, responseTags)
    } catch (err) {
      console.warn('[content-broker] response publish failed', { sig: sigTag.slice(0, 12), err })
    }
  }

  /**
   * Serve a visuals broker request from the mesh's cached events.
   * Reads non-expired events at the composedSig, filters to kind-30200,
   * packages them into the CachedVisualsEntry[] wire shape, publishes
   * as a parameterized-replaceable response keyed on the sig.
   *
   * Silent no-op when we have nothing cached — keeps the swarm quiet
   * when only some peers can serve a given location.
   */
  #serveVisuals = async (composedSig: string): Promise<void> => {
    const mesh = this.#getMesh()
    if (!mesh?.getNonExpired || !mesh?.publish) return

    const cached = mesh.getNonExpired(composedSig)
    // Only the swarm's layer kind. Hide events (30202), resource events
    // (30201), and other kinds at this sig aren't part of the "what's
    // here" surface — they have their own broker types if needed later.
    const visualEvents = cached.filter(e => Number(e.event?.kind) === 30200)
    if (visualEvents.length === 0) return

    // Dedupe by pubkey, keeping the latest per peer. The relay's
    // parameterized-replaceable rules already enforce this on its
    // side, but our local cache (mesh.itemsBySig) keeps the full
    // multi-pubkey list — so we squash on the way out.
    const latestByPubkey = new Map<string, NostrEventLike>()
    for (const item of visualEvents) {
      const pk = String(item.event?.pubkey ?? '').toLowerCase()
      if (!pk) continue
      const prev = latestByPubkey.get(pk)
      if (!prev || Number(item.event?.created_at ?? 0) > Number(prev.created_at ?? 0)) {
        latestByPubkey.set(pk, item.event)
      }
    }

    const entries: CachedVisualsEntry[] = []
    for (const [pubkey, ev] of latestByPubkey) {
      entries.push({
        pubkey,
        content: String(ev.content ?? ''),
        created_at: Number(ev.created_at ?? 0),
        tags: Array.isArray(ev.tags) ? ev.tags : [],
      })
    }
    if (entries.length === 0) return

    const packed = JSON.stringify(entries)
    const bytes = new TextEncoder().encode(packed)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return

    const content = arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const expirationSecs = Math.floor(Date.now() / 1000) + RESPONSE_TTL_SECS
    // Same { bytes, domains } shape on visuals responses — include our
    // own domain when set so requesters learn we serve this location.
    const selfDomain = this.#getSelfDomain()
    const visualsTags: string[][] = [
      ['d', composedSig],
      ['t', 'visuals'],
      ['expiration', String(expirationSecs)],
    ]
    if (selfDomain) visualsTags.push(['domain', selfDomain])
    try {
      await mesh.publish(KIND_FETCH_RESPONSE, composedSig, content, visualsTags)
    } catch (err) {
      console.warn('[content-broker] visuals response publish failed', { sig: composedSig.slice(0, 12), err })
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Pubkey resolution (with retry — signer registration order race)
  // ─────────────────────────────────────────────────────────────────

  #resolveMyPubkeyWithRetry = async (attempts: number): Promise<void> => {
    if (this.#myPubkey) return
    const signer = this.#getSigner()
    if (signer?.getPublicKeyHex) {
      try {
        const pk = await signer.getPublicKeyHex()
        if (pk) { this.#myPubkey = pk.toLowerCase(); return }
      } catch { /* fall through */ }
    }
    if (attempts >= 100) return  // ~10s of retries
    setTimeout(() => { void this.#resolveMyPubkeyWithRetry(attempts + 1) }, 100)
  }

  // ─────────────────────────────────────────────────────────────────
  // IoC resolvers
  // ─────────────────────────────────────────────────────────────────

  #getMesh = (): MeshApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_MESH_KEY) as MeshApi | undefined

  #getSigner = (): SignerApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NOSTR_SIGNER_KEY) as SignerApi | undefined

  #getStore = (): StoreApi | undefined =>
    (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(STORE_KEY) as StoreApi | undefined
}

const _broker = new ContentBrokerDrone()
window.ioc.register('@diamondcoreprocessor.com/ContentBrokerDrone', _broker)
