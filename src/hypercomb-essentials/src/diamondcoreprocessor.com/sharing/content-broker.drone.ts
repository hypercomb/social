// diamondcoreprocessor.com/sharing/content-broker.drone.ts
//
// Content-addressed fetch over the Nostr mesh. Decentralised lookup —
// any participant in the swarm who has a piece of content (a layer
// blob, a resource blob, a dependency bundle) can serve it; the
// requester broadcasts a sig, listens for the first valid response,
// and verifies it cryptographically.
//
// Why this exists: the swarm publish path (kind 30200 etc.) is
// LOCATION-keyed and depth-bounded (MAX_PUBLISH_DEPTH = 3 in
// swarm.drone.ts). When an adopter wants content the original
// publisher hasn't re-walked recently — or wants content from a peer
// who joined long after the publisher left — the location-keyed flow
// has nothing for them. The broker replaces "ask the one publisher"
// with "ask the swarm" and lets ANY participant who's cached the bytes
// respond. Resilient, depth-independent, single primitive that
// generalises across layer / resource / dependency fetches.
//
// Wire shape:
//
//   REQUEST  kind 20400, tags [['x', BROADCAST_TAG], ['d', sig], ['t', type]]
//            content empty; the sig + type travel as tags.
//            Broadcast to every participant subscribed on BROADCAST_TAG.
//
//   RESPONSE kind 20401, tags [['x', sig], ['t', type]]
//            content base64 of bytes.
//            Targeted at the requester via the sig channel — any peer
//            also listening on the same sig (e.g. another requester
//            who fired the same fetch) gets a free copy too.
//
// Content verification: the requester recomputes sha256 of the
// response bytes and compares to the requested sig. Mismatched bytes
// (malicious peer, transmission corruption) are discarded. Result is
// content-address-clean: a fetch never returns bytes that don't match
// the sig the caller asked for.
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
// Trade-off: we don't try to prevent multiple responders publishing
// duplicate bytes (no jitter, no check-before-publish). With N peers
// holding the same sig, we get up to N responses on the wire per
// uncached request. The requester takes the first valid one; the
// others are wasted bandwidth but harmless. "First valid wins" stays
// the simplest and lowest-latency design — useful coordination only
// matters at large swarm sizes, which we can layer in later if needed.
const KIND_FETCH_RESPONSE = 30401

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
  protected override emits: string[] = ['broker:fetched']

  #broadcastSub: MeshSubLike | null = null
  #myPubkey: string | null = null
  #initialized = false

  // Pending fetch promises, keyed by sig. Multiple concurrent fetches
  // for the same sig share one in-flight subscription + request,
  // resolving from a single response. Cleaned up when the fetch
  // settles.
  #pendingFetches = new Map<string, Promise<Uint8Array | null>>()

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

  // Read the operator's own domain from localStorage. A relay host that
  // wants to advertise itself in responses sets this key (e.g. to
  // `wss://jwize.com`). Regular clients leave it empty and emit
  // domain-less responses — their attribution is implicit in the
  // WebSocket source endpoint.
  #getSelfDomain = (): string => {
    try { return String(localStorage.getItem('hc:nostrmesh:self-domain') ?? '').trim() }
    catch { return '' }
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
    if (local) return local

    const fetchPromise = this.#fetchOverMesh(s, type, timeoutMs)
    this.#pendingFetches.set(s, fetchPromise)
    try { return await fetchPromise }
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
            cleanup()
            resolve(bytes)
          }
          // If the bytes failed verification we DON'T resolve — keep
          // waiting; some other (honest) responder may still answer
          // before the timeout.
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
        const blob = store.getResource ? await store.getResource(sig) : null
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
    this.#broadcastSub = mesh.subscribe(BROADCAST_TAG, (evt) => void this.#handleRequest(evt))
  }

  #handleRequest = async (evt: MeshEvtLike): Promise<void> => {
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

    if (typeTag !== 'layer' && typeTag !== 'resource' && typeTag !== 'dependency') return

    const bytes = await this.#readLocal(sigTag, typeTag as ContentType)
    if (!bytes) return  // we don't have it — silent no-op
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return

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
