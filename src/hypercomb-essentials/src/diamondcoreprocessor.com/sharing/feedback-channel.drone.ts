// diamondcoreprocessor.com/sharing/feedback-channel.drone.ts
//
// Durable, store-and-forward, round-trip transport for the feedback LOOP's
// own records (the optimization substrate) through jwize.com — so feedback a
// user submits in one OPFS reaches a feedback-loop routine running in another
// (a headless renderer, a second device, the cloud), and the dashboard
// questions that routine mints come back. See documentation/feedback-channel.md.
//
// WHY this is needed: the optimization substrate is strictly local. Host-sync's
// closure walk never references it; the swarm lists it in SYSTEM_DIR_NAMES and
// skips it. So the loop's feedback/qa/qa-answer records never cross OPFS — the
// routine reads an empty inbox and writes cards the user never sees. This
// drone is the missing transport.
//
// STORE-AND-FORWARD WITHOUT A TYPED FOLDER: the substrate already holds every
// record's bytes (putOptimization wrote them — that write is what fires
// optimization:wrote). So the durable outbox is BOOKKEEPING ONLY: the set of
// sigs not yet relay-confirmed, kept as a localStorage pending map
// (sig → first-attempt ms). At drain time the bytes are re-read from the
// substrate by sig and republished. No OPFS directory is ever minted —
// signature pools are the only structure (sign-meaning-pool-migration-plan.md);
// bookkeeping never gets a folder. An earlier build minted __feedback_outbox__;
// #absorbLegacyOutbox drains and DELETES it on sight.
//
// v1 rides the relay AT jwize.com (wss://jwize.com) — which already accepts
// event publishes permissionlessly (FeedbackSwarmDrone proves it). No operator
// writer-auth is required for v1. The HTTP byte-rest hardening (survives relay
// eviction) is documented in feedback-channel.md and gated behind its own host
// config; it is intentionally NOT wired through host-sync's `self-domain` knob,
// which doubles as the essentials installer's Tier-0 (pointing it at jwize.com
// has historically 404'd the installer).
//
// TWO ROLES on ONE fixed community channel:
//   • CONTRIBUTE — publish MY feedback to the host. Default ON on your own hive
//     (a visitor of another hive uses the FeedbackSwarmDrone consent handshake
//     instead). Publishing only happens when a feedback/qa/qa-answer record is
//     actually written, so a dev hot-reload sends nothing.
//   • HOST — subscribe + ingest + render the aggregated dashboard. OFF unless
//     localStorage['hc:feedback-channel:enabled'] = 'true' (you + the routine).
//     `/feedback-host on` sets it. So a participant contributes their feedback
//     but never ingests anyone else's.

import { Drone, EffectBus, SignatureService } from '@hypercomb/core'

// NIP-33 parameterized-replaceable kind. MUST be in SwarmDrone.configureKinds()
// or the relay filter drops it (same rule as the FEEDBACK_*_KIND family).
export const FEEDBACK_ITEM_KIND = 30213

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const STORE_KEY = '@hypercomb.social/Store'

// Two roles, one fixed channel:
//  • CONTRIBUTE (publish MY feedback to the host) — default ON for anyone on
//    their own hive; a visitor of another hive stays OFF (their feedback rides
//    the FeedbackSwarmDrone consent handshake). Explicit 'false' opts out.
//  • HOST (subscribe + ingest + render the aggregated dashboard) — OFF unless
//    explicitly enabled. That is YOU (the host) + the loop routine. So a
//    participant publishes their feedback but never ingests anyone else's.
const ENABLED_KEY = 'hc:feedback-channel:enabled'   // HOST mode gate (subscribe/ingest/render)
const CHANNEL_ID_KEY = 'hc:feedback-channel:id'     // explicit 64-hex channel override
const CHANNEL_HOST_KEY = 'hc:feedback-channel:host' // canonical anchor override (default below)
// Pending-publish bookkeeping: { [sig]: firstAttemptMs }. The sigs still
// awaiting a relay read-back receipt — the BYTES stay in the substrate.
const PENDING_KEY = 'hc:feedback-channel:pending'
// Sigs the relay has CONFIRMED holding — { [sig]: confirmedAtMs }. Written on
// every receipt (read-back, live echo) AND on every item that ARRIVES from a
// real relay (it is relay-held by definition; a peer's item must never be
// re-published under OUR key). The permanent complement of the pending map:
// it is what lets the substrate reconcile below re-pend everything else
// without re-flooding the channel every session.
const CONFIRMED_KEY = 'hc:feedback-channel:confirmed'
// '1' once a COMPLETE substrate reconcile has run in this browser. The 24h
// pending sweep clears it, so a swept item is re-discovered next session
// instead of being lost.
const RECONCILED_KEY = 'hc:feedback-channel:reconciled'
// The feedback channel is a SINGLE FIXED rendezvous for the whole community —
// NOT the per-origin self-domain. Everyone (participants, the host, the routine)
// computes the identical channel id from this constant regardless of which
// origin loaded the app, so all feedback converges to one place. It is a
// rendezvous LABEL, not a fetch target — the transport is still wss://jwize.com.
const CANONICAL_FEEDBACK_HOST = 'hypercomb.io'
// Retired typed folder from an earlier build — absorbed into the pending map
// and DELETED on sight. Exists here only so we can remove it.
const LEGACY_OUTBOX_DIR = '__feedback_outbox__'
const RETRY_MS = 30_000
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000     // backstop sweep
// Confirmed-ledger prune horizon. An entry pruned here can only cause a
// single harmless re-publish (add-only channel, content-addressed dedup) and
// only if the reconcile is ever re-armed — the ledger stays bounded.
const CONFIRMED_PRUNE_MS = 180 * 24 * 60 * 60 * 1000
// Mirror of Store.#SYNCABLE_OPTIMIZATION_KINDS (modules must never import
// from shared): the record kinds that cross OPFS boundaries on this channel.
const SYNCABLE_KINDS = new Set(['feedback', 'qa', 'qa-answer'])
// NIP-40 relay retention for a published item. Each item carries a unique
// d-tag (`i:<sig>`), so items never NIP-33-replace one another — without an
// expiration they accumulate on the relay forever. The window must outlast a
// consumer that connects late (the feedback-loop routine may run only every
// few hours), so 7 days. Re-publish refreshes created_at AND this expiration
// each tick, so a still-pending item keeps sliding its window forward; once
// read-back-confirmed and dropped from the pending map, the last published
// window stands.
const ITEM_TTL_SEC = 7 * 24 * 60 * 60
const HEX64 = /^[0-9a-f]{64}$/

type MeshEvt = {
  relay: string
  sig: string
  event: { kind?: number; pubkey?: string; tags?: string[][] } | null
  payload: unknown
}
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void, opts?: { sinceSec?: number | null }) => MeshSub
  query?: (sig: string, timeoutMs?: number, sinceSec?: number | null) => Promise<MeshEvt[]>
  isNetworkEnabled?: () => boolean
  setNetworkEnabled?: (enabled: boolean, persist?: boolean) => void
}
interface SignerLike { getPublicKeyHex: () => Promise<string | null> }
interface SwarmLike { subscribedTo?: () => string | null }
interface StoreLike {
  putOptimization?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getOptimization?: (sig: string) => Promise<Blob | null>
  listOptimizations?: () => Promise<string[]>
  opfsRoot?: FileSystemDirectoryHandle
}

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const enc = new TextEncoder()
const dec = new TextDecoder()

export class FeedbackChannelDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Durable transport for the feedback loop’s records (feedback/qa/qa-answer) over a FIXED community channel through the jwize.com relay. Contributors publish their feedback by default; the host + routine (hc:feedback-channel:enabled) subscribe, ingest, and render the aggregated dashboard — so a participant sends feedback but never ingests anyone else’s.'

  protected override listens: string[] = ['optimization:wrote']
  protected override emits: string[] = ['feedback:channel-state', 'feedback:channel-ingested', 'feedback:channel-receipt']

  #initialized = false
  #channelId: string | null = null
  #sub: MeshSub | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  #ingested = 0
  /** Sigs published but not yet relay-confirmed (sig → first-attempt epoch ms).
   *  The durable outbox, minus the folder: bytes live in the substrate, this
   *  map is the only state — persisted to localStorage, in-session on private
   *  mode. */
  #pending = new Map<string, number>()
  /** Sigs the relay confirmed holding (sig → epoch ms) — persisted. The
   *  substrate reconcile skips these, so nothing confirmed is ever
   *  re-published. */
  #confirmed = new Map<string, number>()
  #reconciled = false
  #legacyAbsorbed = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.#loadPending()
    this.#loadConfirmed()

    // Contributor path: publish MY feedback/qa-answer as it is written. The hook
    // is always registered (cheap) but only ACTS when contributing, so flipping
    // a flag takes effect on the next write without a reload.
    this.onEffect<{ sig: string; bytes: ArrayBuffer }>('optimization:wrote', (p) => {
      if (!this.#shouldPublish() || !p?.sig) return
      void this.#onLocalWrite(p.sig, p.bytes)
    })

    await this.#ensureActive()

    // Bee load order is not deterministic (the web shell loads bees from
    // OPFS) — if the mesh wasn't on ioc yet, #ensureActive returned before
    // opening the socket or starting the drain timer, and nothing retried:
    // an enabled HOST sat dark for the whole session while relay-held
    // feedback expired unread. Re-arm activation the moment the mesh
    // registers (fires immediately when it already has); idempotent.
    const reg = (window as { ioc?: { whenReady?: (key: string, cb: (v: unknown) => void) => void } }).ioc
    reg?.whenReady?.(MESH_KEY, () => void this.#ensureActive())

    // Off the boot path: rescue STRANDED records — see #reconcileOnce.
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
      ?? ((cb: () => void) => window.setTimeout(cb, 4_000))
    idle(() => void this.#reconcileOnce())
  }

  // ── roles ───────────────────────────────────────────────
  /** HOST mode: subscribe + ingest + render the aggregated dashboard — you and
   *  the routine. isEnabled() keeps its name for callers (dashboard producer,
   *  bridge status): it means "am I a receiving host". */
  public readonly isEnabled = (): boolean => this.#shouldSubscribe()
  public readonly isSubscribing = (): boolean => this.#shouldSubscribe()
  public readonly isPublishing = (): boolean => this.#shouldPublish()

  readonly #flag = (): string => {
    try { return String(localStorage.getItem(ENABLED_KEY) ?? '').trim().toLowerCase() } catch { return '' }
  }
  /** RECEIVE (ingest) only when explicitly enabled — the host + routine. */
  readonly #shouldSubscribe = (): boolean => this.#flag() === 'true'
  /** CONTRIBUTE (publish my own feedback) by default on my own hive; never as a
   *  visitor of another hive (that rides the consent handshake); never when the
   *  flag is an explicit 'false'. The host publishes its qa/qa-answer too. */
  readonly #shouldPublish = (): boolean => {
    const f = this.#flag()
    if (f === 'false') return false
    if (f === 'true') return true
    return this.#isOwnerContext()
  }

  /** Owner context = NOT a visitor of another hive. SwarmDrone.subscribedTo()
   *  is the host pubkey we're visiting (null/empty on our own hive). Absent
   *  swarm drone (early boot) ⇒ treat as owner, the common case. */
  readonly #isOwnerContext = (): boolean => {
    try { return !ioc()?.get<SwarmLike>(SWARM_KEY)?.subscribedTo?.() }
    catch { return false }
  }

  /** Turn on HOST mode (subscribe + ingest + render). Immediate — no reload. */
  public readonly enable = async (channelId?: string): Promise<void> => {
    try {
      if (channelId && HEX64.test(channelId)) localStorage.setItem(CHANNEL_ID_KEY, channelId)
      localStorage.setItem(ENABLED_KEY, 'true')
    } catch { /* private mode — honor in-session */ }
    this.#channelId = null
    await this.#ensureActive()
    void this.#reconcileOnce()
  }

  public readonly disable = (): void => {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ }
    this.#sub?.close(); this.#sub = null
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null }
  }

  /** Manual flush of the pending set — (re)publish pending items from the
   *  substrate and clear those the relay confirms via read-back. Runs on a 30s
   *  timer too; exposed for an immediate flush and for tests. */
  public readonly drain = (): Promise<void> => this.#drainPending()

  /** Rescue pass for STRANDED records — see #reconcileOnce. Exposed for tests
   *  and the bridge. */
  public readonly reconcile = (): Promise<void> => this.#reconcileOnce()

  /** Mark a sig relay-held: out of pending, into the confirmed ledger. Emits
   *  the receipt only when it actually was pending (it was OURS to deliver).
   *  Callers batch #savePending()/#saveConfirmed() after their loop. */
  readonly #confirm = (sig: string): void => {
    const wasPending = this.#pending.delete(sig)
    this.#confirmed.set(sig, Date.now())
    if (wasPending) EffectBus.emit('feedback:channel-receipt', { sig })
  }

  /** Pend + publish every syncable record in the local substrate that the
   *  relay was never CONFIRMED to hold. This closes the three loss windows the
   *  pending map alone cannot: (1) feedback written by an OLDER bundle with no
   *  channel code — it was never pended at all (the push-only web install
   *  means such bundles linger for months); (2) items the 24h backstop swept
   *  while the relay was unreachable; (3) a browser closed before the first
   *  drain confirmed delivery. Runs once per browser (RECONCILED_KEY), off the
   *  boot path; the sweep re-arms it. The relay query up front confirms
   *  whatever is already held so nothing is re-published needlessly. */
  readonly #reconcileOnce = async (): Promise<void> => {
    if (this.#reconciled) return
    if (!this.#shouldPublish() && !this.#shouldSubscribe()) return
    try { if (localStorage.getItem(RECONCILED_KEY) === '1') { this.#reconciled = true; return } } catch { /* ignore */ }
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.listOptimizations || !store.getOptimization) return   // store not ready — the drain tick retries
    this.#reconciled = true                                           // one attempt per session

    // 1) Confirm everything the relay ALREADY serves — full-TTL window, so an
    //    alive-but-old item is confirmed rather than re-published.
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    const channelId = await this.#resolveChannelId()
    if (mesh?.query && channelId) {
      try {
        for (const it of await mesh.query(channelId, 5_000, ITEM_TTL_SEC)) {
          if (!it || it.relay === 'local') continue
          const s = (it.payload && typeof it.payload === 'object') ? (it.payload as { s?: unknown }).s : null
          if (typeof s === 'string' && HEX64.test(s.toLowerCase())) this.#confirm(s.toLowerCase())
        }
      } catch { /* relay down — proceed; the drain confirms later */ }
    }

    // 2) Pend every unconfirmed, unpended syncable record. A READ failure
    //    marks the pass incomplete (retry next session); a PARSE failure just
    //    means "not a loop record".
    let complete = true
    let rescued = 0
    for (const sig of await store.listOptimizations()) {
      if (this.#pending.has(sig) || this.#confirmed.has(sig)) continue
      let text: string
      try {
        const blob = await store.getOptimization(sig)
        if (!blob) continue
        text = await blob.text()
      } catch { complete = false; continue }
      try {
        const rec = JSON.parse(text) as { kind?: unknown }
        if (typeof rec?.kind !== 'string' || !SYNCABLE_KINDS.has(rec.kind)) continue
      } catch { continue }
      this.#pending.set(sig, Date.now())
      rescued++
    }
    this.#savePending()
    this.#saveConfirmed()
    if (complete) { try { localStorage.setItem(RECONCILED_KEY, '1') } catch { /* ignore */ } }
    if (rescued > 0) console.log(`[feedback-channel] reconcile rescued ${rescued} stranded record(s) — publishing`)
    await this.#drainPending()
  }

  // ── lifecycle ───────────────────────────────────────────
  #starting = false
  /** Bring up whichever role is active: HOST subscribes to ingest peers' items;
   *  EITHER role runs the drain timer (publish retry + boot flush). Idempotent. */
  readonly #ensureActive = async (): Promise<void> => {
    if (this.#starting) return
    const sub = this.#shouldSubscribe(); const pub = this.#shouldPublish()
    if (!sub && !pub) return
    this.#starting = true
    try {
      const channelId = await this.#resolveChannelId()
      const mesh = ioc()?.get<MeshLike>(MESH_KEY)
      if (!channelId || !mesh?.subscribe) return  // not ready — heartbeat/enable retries
      // A live socket is needed to publish OR receive. Being active is an
      // explicit "I want this live", so bring the network up (persist=false — we
      // don't rewrite the global mesh preference other features own).
      if (mesh.isNetworkEnabled && mesh.setNetworkEnabled && !mesh.isNetworkEnabled()) {
        mesh.setNetworkEnabled(true, false)
      }
      // HOST only: subscribe to ingest peers' items. A contributor never
      // subscribes, so it never sees anyone else's feedback. The replay
      // window matches the item TTL: the relay must REPLAY every stored item
      // it still holds — the routine may connect hours or days after the
      // contributor published (the mesh default of 15 min silently lost
      // everything in between).
      if (sub && !this.#sub) this.#sub = mesh.subscribe(channelId, (e) => void this.#onChannelEvent(e), { sinceSec: ITEM_TTL_SEC })
      // Either role: the drain timer (re)publishes pending items and clears the
      // read-back-confirmed ones — the store-and-forward guarantee. The
      // reconcile piggybacks so a store that wasn't ready at the idle callback
      // still gets its rescue pass (it self-guards to one attempt per session).
      if (!this.#timer) this.#timer = setInterval(() => { void this.#drainPending(); void this.#reconcileOnce() }, RETRY_MS)
      await this.#drainPending()
    } finally {
      this.#starting = false
    }
  }

  /** The channel address — a SINGLE FIXED rendezvous for the whole community.
   *   1. explicit override (hc:feedback-channel:id);
   *   2. canonical host (hc:feedback-channel:host, default CANONICAL_FEEDBACK_HOST
   *      = 'hypercomb.io') → sha256("hc:feedback-channel\0" + host). Fixed, so
   *      every participant + the host + the routine compute the identical id
   *      regardless of which origin loaded the app — all feedback converges to
   *      one place. (Not the per-origin self-domain, which diverges.) */
  readonly #resolveChannelId = async (): Promise<string | null> => {
    if (this.#channelId) return this.#channelId
    let override = ''
    try { override = String(localStorage.getItem(CHANNEL_ID_KEY) ?? '').trim().toLowerCase() } catch { /* ignore */ }
    if (HEX64.test(override)) { this.#channelId = override; return override }
    const host = this.#canonicalHost()
    this.#channelId = await SignatureService.sign(enc.encode(`hc:feedback-channel\0${host}`).buffer as ArrayBuffer)
    return this.#channelId
  }

  /** The canonical rendezvous host — a fixed community-wide constant, overridable
   *  via hc:feedback-channel:host. Scheme/slash-stripped, lowercased. */
  readonly #canonicalHost = (): string => {
    let h = ''
    try { h = String(localStorage.getItem(CHANNEL_HOST_KEY) ?? '').trim() } catch { /* ignore */ }
    h = h.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
    return h || CANONICAL_FEEDBACK_HOST
  }

  // ── publish (local write → channel) ─────────────────────
  readonly #onLocalWrite = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
    if (!HEX64.test(sig)) return
    // Bookkeep FIRST — if the relay is down, the sig rests in the pending map
    // and the timer republishes it from the substrate on reconnect.
    if (!this.#pending.has(sig)) { this.#pending.set(sig, Date.now()); this.#savePending() }
    await this.#ensureActive()   // ensure the drain timer / socket are live
    await this.#publishItem(sig, dec.decode(bytes))
  }

  readonly #publishItem = async (sig: string, text: string): Promise<boolean> => {
    const channelId = await this.#resolveChannelId()
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    if (!channelId || !mesh?.publish) return false
    // payload.t carries the EXACT stored JSON text (lossless through the
    // event content round-trip) so the receiver reconstructs identical bytes.
    // The expiration tag bounds relay retention (see ITEM_TTL_SEC) — each
    // re-publish slides the window forward, so a still-pending item never
    // expires out from under a yet-to-connect consumer.
    const expiresAt = Math.floor(Date.now() / 1000) + ITEM_TTL_SEC
    return mesh.publish(FEEDBACK_ITEM_KIND, channelId, { t: text, s: sig }, [['d', `i:${sig}`], ['expiration', String(expiresAt)]])
  }

  /** (Re)publish every pending item from the substrate, then confirm delivery
   *  by a relay READ-BACK and clear whatever the relay actually serves. The
   *  reconnect flush and the periodic retry are one loop (NIP-33 replace =
   *  free). The receipt is the relay returning our item on a fresh REQ — never
   *  a bare send-ok — because relay.js does not echo a publisher's own event
   *  back to it live (HostSyncService's "confirmed read-back" discipline). */
  readonly #drainPending = async (): Promise<void> => {
    if (!this.#shouldPublish() && !this.#shouldSubscribe()) return
    await this.#absorbLegacyOutbox()
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.getOptimization) return

    // collect publishable entries, sweeping aged and locally-retired sigs
    const pending: Array<{ sig: string; text: string }> = []
    for (const [sig, first] of [...this.#pending]) {
      if (Date.now() - first > MAX_PENDING_AGE_MS) {
        // Backstop: 24h without a confirmed read-back means something is
        // structurally wrong; stop retrying rather than spin forever. The
        // bytes stay in the substrate and the sig is NOT confirmed, so
        // re-arming the reconcile hands the item to a future session
        // instead of losing it.
        this.#pending.delete(sig)
        try { localStorage.removeItem(RECONCILED_KEY) } catch { /* ignore */ }
        console.warn(`[feedback-channel] dropped pending item ${sig.slice(0, 12)}… after 24h with no relay receipt — re-armed the substrate reconcile`)
        continue
      }
      const blob = await store.getOptimization(sig)
      // Retired locally (resolved/removed) while pending ⇒ nothing left to sync.
      if (!blob) { this.#pending.delete(sig); continue }
      pending.push({ sig, text: await blob.text() })
    }
    this.#savePending()
    if (pending.length === 0) { this.#emitState(); return }

    // 1) (re)publish — refreshes each event's created_at so the read-back REQ's
    //    15-min `since` window returns it; idempotent (NIP-33 replace by d-tag).
    for (const e of pending) await this.#publishItem(e.sig, e.text)

    // 2) confirmed read-back: a fresh one-shot REQ replays the relay's STORED
    //    events (incl. our own, which the relay does NOT echo live). Anything
    //    the relay actually serves from a non-'local' relay clears its entry.
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    const channelId = await this.#resolveChannelId()
    if (mesh?.query && channelId) {
      const served = new Set<string>()
      for (const it of await mesh.query(channelId)) {
        if (!it || it.relay === 'local') continue   // local fanout ≠ relay-held
        const s = (it.payload && typeof it.payload === 'object') ? (it.payload as { s?: unknown }).s : null
        if (typeof s === 'string' && HEX64.test(s)) served.add(s.toLowerCase())
      }
      for (const e of pending) {
        if (!served.has(e.sig)) continue
        this.#confirm(e.sig)
      }
      this.#savePending()
      this.#saveConfirmed()
    }

    this.#emitState()
  }

  // ── receive (channel → local ingest + receipt) ──────────
  readonly #onChannelEvent = async (e: MeshEvt): Promise<void> => {
    if (!e || Number(e.event?.kind) !== FEEDBACK_ITEM_KIND) return
    const p = (e.payload && typeof e.payload === 'object') ? e.payload as { t?: unknown; s?: unknown } : null
    const text = typeof p?.t === 'string' ? p.t : null
    const claimed = typeof p?.s === 'string' ? p.s.trim().toLowerCase() : ''
    if (!text || !HEX64.test(claimed)) return

    // Content-address re-check: the bytes must hash to the advertised sig, or
    // it is tampered / non-canonical — drop it.
    const bytes = enc.encode(text)
    const actual = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    if (actual !== claimed) {
      console.warn(`[feedback-channel] dropped channel item — bytes hash ${actual.slice(0, 12)}… ≠ claimed ${claimed.slice(0, 12)}…`)
      return
    }

    // Any item a REAL relay serves is relay-held by definition — record it in
    // the confirmed ledger. For OUR pending item this is the live receipt; for
    // a peer's item it guarantees the reconcile never re-publishes someone
    // else's record under OUR key. (Local fanout — e.relay === 'local' — is
    // not proof the relay holds it.)
    if (e.relay && e.relay !== 'local') {
      this.#confirm(claimed)
      this.#savePending()
      this.#saveConfirmed()
    }

    // Ingest: write into the local substrate if we don't already hold it.
    // emit:false so a pulled item never echoes straight back out.
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.putOptimization || !store.getOptimization) return
    if (await store.getOptimization(claimed)) return       // dedup — already have it
    try {
      await store.putOptimization(new Blob([bytes as BlobPart]), { emit: false })
      this.#ingested++
      // Let the loop / dashboard know a new record arrived (e.g. a qa card to
      // surface, or fresh feedback for the routine to process next cycle).
      EffectBus.emit('feedback:channel-ingested', { sig: claimed })
      this.#emitState()
    } catch { /* best-effort; relay still holds the replaceable event for retry */ }
  }

  // ── introspection (tests / UI) ──────────────────────────
  public readonly status = async (): Promise<{ enabled: boolean; publishing: boolean; channelId: string | null; pending: number; ingested: number; confirmed: number; reconciled: boolean }> => ({
    enabled: this.#shouldSubscribe(),
    publishing: this.#shouldPublish(),
    channelId: await this.#resolveChannelId(),
    pending: this.#pending.size,
    ingested: this.#ingested,
    confirmed: this.#confirmed.size,
    reconciled: this.#reconciled,
  })

  readonly #emitState = (): void => {
    EffectBus.emit('feedback:channel-state', { pending: this.#pending.size, ingested: this.#ingested })
  }

  // ── pending-map bookkeeping (localStorage; no OPFS folder) ─
  readonly #loadPending = (): void => {
    try {
      const raw = localStorage.getItem(PENDING_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, number>
      for (const [sig, at] of Object.entries(obj)) {
        if (HEX64.test(sig) && Number.isFinite(at)) this.#pending.set(sig, at)
      }
    } catch { /* private mode / corrupt — in-session map only */ }
  }

  readonly #savePending = (): void => {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(Object.fromEntries(this.#pending))) } catch { /* ignore */ }
  }

  readonly #loadConfirmed = (): void => {
    try {
      const raw = localStorage.getItem(CONFIRMED_KEY)
      if (!raw) return
      const obj = JSON.parse(raw) as Record<string, number>
      const cutoff = Date.now() - CONFIRMED_PRUNE_MS
      for (const [sig, at] of Object.entries(obj)) {
        if (HEX64.test(sig) && Number.isFinite(at) && at > cutoff) this.#confirmed.set(sig, at)
      }
    } catch { /* private mode / corrupt — in-session map only */ }
  }

  readonly #saveConfirmed = (): void => {
    try { localStorage.setItem(CONFIRMED_KEY, JSON.stringify(Object.fromEntries(this.#confirmed))) } catch { /* ignore */ }
  }

  /** One-time: an earlier build persisted the outbox as a typed OPFS folder
   *  (__feedback_outbox__). Absorb any leftover sigs into the pending map and
   *  DELETE the folder — typed folders are banned; signature pools are the only
   *  structure. Self-cleaning, mirroring Store's absorb: per-entry
   *  record-into-pending → remove the source file, then a gated non-recursive
   *  removeEntry that only succeeds once the dir is empty (a straggler is never
   *  destroyed). Safe: the folder held only bookkeeping copies of substrate
   *  bytes — the real bytes live in the sign('optimization') pool — so an
   *  entry recorded in the pending map is fully preserved before its file is
   *  removed. Nothing is removed before it is recorded. */
  readonly #absorbLegacyOutbox = async (): Promise<void> => {
    if (this.#legacyAbsorbed) return
    const root = ioc()?.get<StoreLike>(STORE_KEY)?.opfsRoot
    if (!root) return                       // store not ready — retry next drain
    let dir: FileSystemDirectoryHandle
    try {
      dir = await root.getDirectoryHandle(LEGACY_OUTBOX_DIR, { create: false })
    } catch { this.#legacyAbsorbed = true; return }   // no legacy folder — nothing to absorb
    let drained = true
    try {
      const entries = (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()
      for await (const [name, handle] of entries) {
        if (handle.kind !== 'file' || !HEX64.test(name)) { drained = false; continue }
        // Record into the pending map (the "target") — the sig is now tracked and
        // its bytes are already durable in the substrate — THEN drop the source
        // file. A sig already pending needs no re-record; still remove its file.
        if (!this.#pending.has(name)) {
          let first = Date.now()
          try { first = (await (handle as FileSystemFileHandle).getFile()).lastModified } catch { /* keep now */ }
          this.#pending.set(name, first)
        }
        try { await dir.removeEntry(name) } catch { drained = false /* straggler — next drain */ }
      }
    } catch { drained = false }
    this.#savePending()
    if (drained) {
      // Non-recursive on purpose: only succeeds once the dir is truly empty.
      try { await root.removeEntry(LEGACY_OUTBOX_DIR); this.#legacyAbsorbed = true } catch { /* not empty — retry */ }
    }
  }
}

const _feedbackChannel = new FeedbackChannelDrone()
window.ioc.register('@diamondcoreprocessor.com/FeedbackChannelDrone', _feedbackChannel)
