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
const KIND_FETCH_RESPONSE = 20401

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
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
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
  // Public API
  // ─────────────────────────────────────────────────────────────────

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
        await store.writeLayerBytes(sig, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      } else if (type === 'resource' && store?.putResource) {
        await store.putResource(new Blob([bytes]))
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
      try { await w.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) }
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
    if (typeTag !== 'layer' && typeTag !== 'resource' && typeTag !== 'dependency') return

    const bytes = await this.#readLocal(sigTag, typeTag as ContentType)
    if (!bytes) return  // we don't have it — silent no-op
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return

    const mesh = this.#getMesh()
    if (!mesh?.publish) return
    const content = arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    try {
      await mesh.publish(KIND_FETCH_RESPONSE, sigTag, content, [['t', typeTag]])
    } catch (err) {
      console.warn('[content-broker] response publish failed', { sig: sigTag.slice(0, 12), err })
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
