// diamondcoreprocessor.com/sharing/host-sync.service.ts
//
// Remote backup: signed HTTP push of committed content to the operator's
// OWN host (e.g. jwize.com), with confirmed-read-back receipts.
//
// This is the REMOTE counterpart to PushQueueService's DCP-iframe path.
// Same trigger (`content:wrote`) and the same crash-safe
// queue-with-receipts shape, but a different, fully isolated destination
// and transport:
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
// Store uses (no typed __folders__, ever). Isolated from
// PushQueueService's pools (distinct meanings) so the two backup channels
// never interfere:
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
// grants exactly one standing host: the PUBLIC content endpoint
// content.jwize.com (documentation/public-content-endpoint.md — Blossom/
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

import { EffectBus, SignatureService } from '@hypercomb/core'
import { decorationClosureSigs, nestedResourceSigs } from './decoration-closure.js'

export type HostSyncKind = 'layer' | 'bee' | 'dependency' | 'resource'

interface SignerLike {
  signEvent: (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<Record<string, unknown>>
}

const SIG_RE = /^[a-f0-9]{64}$/
const ENTRY_RE = /^([a-f0-9]{64})\.(layer|bee|dependency|resource)$/
// Pool meanings — sign(meaning) IS the pool address (see #poolSignature).
// Distinct from PushQueueService's 'push'/'receipts' meanings so the two
// backup channels' pools never collide.
const PUSH_MEANING = 'host-push'
const RECEIPTS_MEANING = 'host-receipts'
// Legacy drain sources — pre-pool dirs. Opened WITHOUT create (a drained
// dir stays gone); read/absorb only, never written.
const LEGACY_PUSH_DIR = '__host_push__'
const LEGACY_QUEUE_SUBDIR = 'queue'
const LEGACY_RECEIPTS_DIR = '__host_receipts__'
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
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
const PUBLIC_HOST_DOMAIN = 'content.jwize.com'
// Queue-pool sidecar marker: `{sig}.public` = this sig belongs to a
// published-public closure. THE doctrine gate for the CDN target — written
// only by markPublic() (fed by the swarm publish walk, which enumerates
// exactly the participant's public subset), never by the generic
// content:wrote enqueue. `.public` deliberately fails ENTRY_RE, so markers
// coexist in the push pool without ever being listed as queue entries.
const PUBLIC_MARKER_SUFFIX = 'public'
const NIP98_KIND = 27235
const RETRY_MS = 30_000
// After a writer-auth rejection (401/403) the channel goes quiet for this
// long — the fix is operator action on the relay (--writers), so retrying
// every enqueue/timer tick only spams the console. enable() clears it.
const UNAUTHORIZED_BACKOFF_MS = 300_000

type QueueEntry = { sig: string; kind: HostSyncKind; fileName: string; mtime: number; dir: FileSystemDirectoryHandle }

/** A drain destination. `hostHash === null` marks the SELF-DOMAIN target —
 *  its receipt stays the bare `{sig}` file (no migration). Granted hosts
 *  receipt as `{sig}.{hostHash}`. `publicOnly` targets may only receive
 *  sigs carrying a `{sig}.public` marker — the doctrine gate that keeps
 *  private/group bytes off the public endpoint. Future consent-granted
 *  hosts (30411 records) append here with their own scoping. */
type SyncTarget = { domain: string; hostHash: string | null; publicOnly: boolean }

export class HostSyncService extends EventTarget {

  /** sign(meaning) → pool address, memoized. Same derivation as
   *  Store.poolSignature — reimplemented because essentials must never
   *  import shared. */
  static readonly #poolSigs = new Map<string, Promise<string>>()
  static #poolSignature = (meaning: string): Promise<string> => {
    let sig = HostSyncService.#poolSigs.get(meaning)
    if (!sig) {
      sig = SignatureService.sign(new TextEncoder().encode(meaning).buffer as ArrayBuffer)
      HostSyncService.#poolSigs.set(meaning, sig)
    }
    return sig
  }

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

  /** True once both legacy dirs are confirmed gone — skips the absorb
   *  probe on subsequent drains. */
  #legacyDrained = false

  /** PER-HOST writer-auth backoff: domain → epoch ms until which PUTs to
   *  THAT host are suppressed after a 401/403. Per-host on purpose — a
   *  paused public CDN (quota, grant expiry) must never stall self-domain
   *  backup, and vice versa. Absent = no suppression. */
  readonly #unauthorizedUntil = new Map<string, number>()

  /** One-time "no signer" console warning latch (see #pushAndReceipt). */
  #warnedNoSigner = false

  /** Sigs whose local bytes failed the sha256===sig precheck — warned once
   *  each, then dropped from the queue. A mismatch is permanent for the
   *  bytes we hold, so re-warning every retry tick is just noise. */
  #warnedCorrupt = new Set<string>()

  constructor() {
    super()
    // Auto-enqueue every committed sig — gated on #isEnabled(). With the
    // gate off, the handler exits before reaching enqueue/signer, so no
    // permission prompt can fire. Subscription stays live so toggling the
    // gate takes effect without reload.
    EffectBus.on<{ sig: string; kind: HostSyncKind; bytes: ArrayBuffer }>(
      'content:wrote',
      ({ sig, kind, bytes }) => {
        if (!this.#anyEnabled()) return
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
    // Re-arm after a writer-auth backoff: enable() is the operator's
    // "I fixed the relay, retry now" signal. Clears every host's window —
    // worst case a still-broken host costs one extra 401 before re-pausing.
    this.#unauthorizedUntil.clear()
    void this.drain()
  }

  /** Turn host backup off. Existing queued entries stay on disk (not
   *  destructive); they resume draining if the gate is flipped back on. */
  public readonly disable = (): void => {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ }
  }

  /** True iff the operator opted in to the PUBLIC content endpoint. */
  public readonly isPublicHostEnabled = (): boolean => this.#publicHostEnabled()

  /** Opt in to the public CDN target (content.jwize.com). Published-public
   *  closures (and ONLY those — see markPublic) start draining there.
   *  Effect is immediate. Caller shows the "your public tiles will be
   *  posted to the public content endpoint" consent BEFORE invoking —
   *  same contract as enable(). */
  public readonly enablePublicHost = (): void => {
    try { localStorage.setItem(PUBLIC_HOST_KEY, '1') } catch { /* private mode — honor in-session */ }
    // The operator's "retry now" signal for THIS host.
    this.#unauthorizedUntil.delete(PUBLIC_HOST_DOMAIN)
    void this.drain()
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

  /** Any drain destination enabled at all? Gates the content:wrote
   *  handler, the retry timer, and the boot drains. */
  readonly #anyEnabled = (): boolean => this.#isEnabled() || this.#publicHostEnabled()

  readonly #isEnabled = (): boolean => {
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

  /** Multi-target receipt check (see enqueue). INTERIM: delegates to the
   *  single-receipt read so the short-circuit keeps its prior behavior;
   *  the per-target aggregation + once-per-session HEAD re-verify the
   *  enqueue comment describes is still to be wired. */
  async #fullyReceipted(sig: string): Promise<boolean> {
    return this.hasReceipt(sig)
  }

  /** Layers whose refs were already walked this session (the walk is
   *  re-runnable but pointless to repeat — layer bytes are immutable). */
  #walkedLayers = new Set<string>()

  /** Decoration resources whose content-closure (website page body + the
   *  images/stylesheets that body embeds) was already staged this session.
   *  Dedups the descent so a chrome stylesheet shared across many pages is
   *  parsed once, not once per page. */
  #walkedResources = new Set<string>()

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
    const CHILD_SLOTS = new Set(['cells', 'layers', 'children'])
    for (const [slot, value] of Object.entries(layer)) {
      if (!Array.isArray(value)) continue
      const kind: HostSyncKind = CHILD_SLOTS.has(slot) ? 'layer'
        : slot === 'bees' ? 'bee'
        : slot === 'dependencies' ? 'dependency'
        : 'resource'
      for (const raw of value) {
        const ref = String(raw ?? '').trim().toLowerCase()
        if (!SIG_RE.test(ref) || ref === sig) continue
        try {
          const refBytes = await this.#readLocalBytes(ref, kind)
          if (refBytes) {
            await this.enqueue(ref, kind, refBytes)
            // Resource-content descent: a resource ref is an opaque leaf to the
            // slot walk, but its bytes can hold FURTHER resource sigs that must
            // ALSO reach the host or a witnessing/importing peer 404s on them —
            // a website page's htmlSig body + embedded assets (decoration
            // records), OR a tile's nested image sig inside its `properties`
            // blob (data resources). Covers both; a no-op for plain leaves.
            if (kind === 'resource') await this.#enqueueResourceClosure(ref, refBytes)
          }
        } catch { /* not held locally — nothing to push */ }
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
        if (bytes) await this.enqueue(ref, 'resource', bytes)
      } catch { /* not held locally — nothing to push */ }
    }
  }

  // -------------------------------------------------
  // public closure marking — the CDN doctrine gate
  // -------------------------------------------------

  /** Sigs confirmed to carry a `.public` marker (session cache — positive
   *  results only; a missing marker may be written later this session). */
  readonly #publicMarked = new Set<string>()

  /** Sigs whose public-closure walk already ran this session (bytes are
   *  immutable, so re-walking the same sig is pointless). */
  readonly #markedWalk = new Set<string>()

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
   *  hc:public-host opt-in. */
  public readonly markPublic = async (sig: string, kind: HostSyncKind = 'layer'): Promise<void> => {
    if (!this.#publicHostEnabled()) return
    const s = String(sig ?? '').trim().toLowerCase()
    if (!SIG_RE.test(s)) return
    if (this.#markedWalk.has(s)) return
    this.#markedWalk.add(s)
    await this.#writePublicMarker(s)
    let bytes: ArrayBuffer | null = null
    try { bytes = await this.#readLocalBytes(s, kind) } catch { bytes = null }
    if (!bytes) return // not held locally — the marker waits for content:wrote
    void this.enqueue(s, kind, bytes)
    if (kind === 'layer') {
      // Same slot→kind classification as #enqueueLayerRefs, but marking:
      // the closure of a public layer is public in its entirety.
      let layer: Record<string, unknown>
      try { layer = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> } catch { return }
      if (!layer || typeof layer !== 'object') return
      const CHILD_SLOTS = new Set(['cells', 'layers', 'children'])
      for (const [slot, value] of Object.entries(layer)) {
        if (!Array.isArray(value)) continue
        const refKind: HostSyncKind = CHILD_SLOTS.has(slot) ? 'layer'
          : slot === 'bees' ? 'bee'
          : slot === 'dependencies' ? 'dependency'
          : 'resource'
        for (const raw of value) {
          const ref = String(raw ?? '').trim().toLowerCase()
          if (!SIG_RE.test(ref) || ref === s) continue
          await this.markPublic(ref, refKind)
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
      for (const ref of nested) {
        if (!SIG_RE.test(ref) || ref === s) continue
        await this.markPublic(ref, 'resource')
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

  /** Drain the queue to the host. Single-flight. Each entry: signed PUT +
   *  confirmed read-back; on success writes a receipt and drops the entry;
   *  on failure leaves it for the retry timer. No-op when no host is
   *  configured. */
  public readonly drain = async (): Promise<void> => {
    if (this.#draining) return
    // Writer-auth backoff: a 401 is a HOST config gap (writers list), not
    // something that heals in seconds — and every read-triggered enqueue()
    // kicks a fresh drain, so without this gate each staged sig costs one
    // more 401 in the console. One rejection silences the channel for the
    // backoff window; enable() clears it so an operator who just fixed the
    // relay retries immediately.
    const host = this.#hostBase()
    if (!host) return // no host named — stay inert
    if (Date.now() < (this.#unauthorizedUntil.get(host) ?? 0)) return
    this.#draining = true
    try {
      // Absorb any legacy dirs into the pools first, under this same
      // single-flight guard so it can never race the queue removals below.
      await this.#absorbLegacy()
      for (;;) {
        const entries = await this.#listQueue()
        if (entries.length === 0) break
        let progressed = false
        for (const entry of entries) {
          if (await this.hasReceipt(entry.sig)) { await this.#removeEntry(entry); continue }
          const ok = await this.#pushAndReceipt(host, entry)
          if (ok === 'unauthorized') {
            // The host refused our writer key — a config gap, not a
            // per-entry failure. One rejection covers the whole queue;
            // stop the pass, back off, and surface the EXACT pubkey to
            // whitelist. enable() clears the backoff for an instant retry
            // once the operator fixes the relay.
            this.#unauthorizedUntil.set(host, Date.now() + UNAUTHORIZED_BACKOFF_MS)
            const pubkey = await this.#getOwnPubkey()
            console.warn(
              `[host-sync] ${host} rejected writer auth (401) — drain paused for ` +
              `${Math.round(UNAUTHORIZED_BACKOFF_MS / 60_000)} min. Add this browser's pubkey to the relay's ` +
              `--writers list (configure-writers.bat), then call ` +
              `ioc.get('@diamondcoreprocessor.com/HostSyncService').enable() to retry now: ` +
              `${pubkey || '(no signer available)'}`
            )
            EffectBus.emit('sync:state', { host, pending: entries.length, status: 'unauthorized' })
            return
          }
          if (ok === 'corrupt') {
            // Local bytes for this sig don't hash to it — the host would (or
            // did) 422. Retrying identical bytes can never succeed, so drop
            // the entry and warn ONCE per sig, naming sig + kind so the
            // upstream source of the bad bytes can be traced. Unlike the 401
            // case this is per-entry, not a whole-queue gap — keep draining.
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
            continue
          }
          if (!ok) continue // leave entry; retry timer handles offline/host-down
          await this.#removeEntry(entry)
          progressed = true
          this.dispatchEvent(new CustomEvent('receipt', { detail: { sig: entry.sig } }))
          EffectBus.emit('host:receipt', { sig: entry.sig })
        }
        if (!progressed) break // nothing advanced (host unreachable) — stop; timer retries
      }
      const remaining = (await this.#listQueue()).length
      EffectBus.emit('sync:state', { host, pending: remaining, status: remaining === 0 ? 'backed-up' : 'syncing' })
    } finally {
      this.#draining = false
    }
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
    const inFlight = this.#verifyInFlight.get(sig)
    if (inFlight) return inFlight
    const host = this.#hostBase()
    if (!host) return Promise.resolve(true) // nothing to check against — keep the receipt
    const run = (async (): Promise<boolean> => {
      await this.#acquireVerifySlot()
      try {
        const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
        const res = await fetch(`${scheme}://${host}/${sig}`, { method: 'HEAD', cache: 'no-store' })
        if (res.ok) { this.#verifiedOnHost.add(sig); return true }
        if (res.status === 404) {
          // Revoke from BOTH the pool and the legacy dir — mid-migration the
          // receipt may still sit in the legacy source; leaving it there would
          // keep hasReceipt() true and suppress the re-stage.
          for (const dir of [await this.#getReceiptsDir(false), await this.#getLegacyReceiptsDir()]) {
            try { await dir?.removeEntry(sig) } catch { /* already gone */ }
          }
          console.warn(`[host-sync] revoked stale receipt ${sig.slice(0, 12)} — host no longer serves it; re-staging`)
          return false
        }
        return true
      } catch { return true } // offline / CORS — keep the receipt
      finally {
        this.#verifySlots--
        this.#verifyInFlight.delete(sig)
      }
    })()
    this.#verifyInFlight.set(sig, run)
    return run
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

  // -------------------------------------------------
  // transport — signed HTTP PUT + confirmed read-back
  // -------------------------------------------------

  readonly #pushAndReceipt = async (host: string, entry: QueueEntry): Promise<boolean | 'unauthorized' | 'corrupt'> => {
    let bytes: ArrayBuffer
    try {
      // Read from the entry's OWN dir (pool or legacy) — mid-migration a queued
      // entry may still live in the legacy dir the union surfaced it from.
      const handle = await entry.dir.getFileHandle(entry.fileName, { create: false })
      bytes = await (await handle.getFile()).arrayBuffer()
    } catch { return false }

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
    const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
    const url = `${scheme}://${host}${path}`

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
      return false
    }

    try {
      const put = await fetch(url, { method: 'PUT', headers: { Authorization: auth }, body: bytes })
      // Writer-auth rejection applies to EVERY queued entry equally — the
      // caller stops the whole drain pass instead of 401-spamming one PUT
      // per entry every retry tick.
      if (put.status === 401 || put.status === 403) return 'unauthorized'
      // 422 = the host's own sha256(body)===sig check failed. The precheck
      // above normally catches this first; this covers the rare case where
      // the host canonicalizes differently than we do. Either way the bytes
      // can never satisfy this sig, so it's permanent — not a retry.
      if (put.status === 422) return 'corrupt'
      if (!put.ok) return false
      // Confirmed read-back: a fresh GET (cache-bypassing) must show the
      // host actually serving the sig. A bare PUT 200 is NOT proof — the
      // silent-drop lesson. Only a served read-back closes the loop.
      // The receipt needs the STATUS, not the bytes — cancel the body so
      // backup doesn't re-download every byte it just uploaded.
      const back = await fetch(url, { cache: 'no-store' })
      try { await back.body?.cancel() } catch { /* already drained/closed */ }
      if (!back.ok) return false
    } catch {
      return false // network/CORS/host-down — retry later
    }

    try {
      const receiptsDir = await this.#getReceiptsDir()
      if (!receiptsDir) return false
      const handle = await receiptsDir.getFileHandle(entry.sig, { create: true })
      const writable = await handle.createWritable()
      try { await writable.write(new Uint8Array(0)) } finally { await writable.close() }
      return true
    } catch { return false }
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
   *  if no signer is available. */
  readonly #nip98 = async (url: string, method: string): Promise<string | null> => {
    const signer = this.#getSigner()
    if (!signer?.signEvent) return null
    const evt = {
      kind: NIP98_KIND,
      created_at: Math.floor(Date.now() / 1000),
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
    return raw.replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/+$/, '').trim()
  }

  // -------------------------------------------------
  // internal — directory resolution + queue ops
  // (mirrors PushQueueService; distinct pool meanings)
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

const _hostSync = new HostSyncService()
window.ioc.register('@diamondcoreprocessor.com/HostSyncService', _hostSync)

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
// and PushQueueService's boot kick. Gated on isEnabled() so an un-opted-in
// visitor never triggers the signer.
setTimeout(() => { if (_hostSync.isEnabled()) void _hostSync.drain() }, 20_000)
