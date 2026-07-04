// diamondcoreprocessor.com/sharing/feedback-channel.drone.ts
//
// Durable, store-and-forward, round-trip transport for the feedback LOOP's
// own records (the optimization substrate) through jwize.com — so feedback a
// user submits in one OPFS reaches a feedback-loop routine running in another
// (a headless renderer, a second device, the cloud), and the dashboard
// questions that routine mints come back. See documentation/feedback-channel.md.
//
// WHY this is needed: __optimization__ is strictly local. Host-sync's closure
// walk never references it; the swarm lists it in SYSTEM_DIR_NAMES and skips
// it. So the loop's feedback/qa/qa-answer records never cross OPFS — the
// routine reads an empty inbox and writes cards the user never sees. This
// drone is the missing transport.
//
// v1 rides the relay AT jwize.com (wss://jwize.com) — which already accepts
// event publishes permissionlessly (FeedbackSwarmDrone proves it). No operator
// writer-auth is required for v1. The HTTP byte-rest hardening (survives relay
// eviction) is documented in feedback-channel.md and gated behind its own host
// config; it is intentionally NOT wired through host-sync's `self-domain` knob,
// which doubles as the essentials installer's Tier-0 (pointing it at jwize.com
// has historically 404'd the installer).
//
// INERT BY DEFAULT. Like HostSyncService, the drone does nothing until the
// operator opts in:
//
//   localStorage['hc:feedback-channel:enabled'] = 'true'
//
// This keeps a hot-reload into a running dev session — and a casual visitor —
// from publishing anything to the relay.

import { Drone, EffectBus, SignatureService } from '@hypercomb/core'

// NIP-33 parameterized-replaceable kind. MUST be in SwarmDrone.configureKinds()
// or the relay filter drops it (same rule as the FEEDBACK_*_KIND family).
export const FEEDBACK_ITEM_KIND = 30213

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const STORE_KEY = '@hypercomb.social/Store'

// Owner-default-on: unset ⇒ ON for the owner on their own hive, OFF for a
// visitor of someone else's hive. Explicit 'true' force-on (the loop routine,
// a dev opting in); explicit 'false' force-off (a dev opting out).
const ENABLED_KEY = 'hc:feedback-channel:enabled'
const CHANNEL_ID_KEY = 'hc:feedback-channel:id'    // explicit channel override
// Canonical host domain this hive uses (e.g. 'jwize.com'). runtime-initializer
// seeds it from the page origin on a real host, or DEV_DEFAULT_HOST=jwize.com on
// loopback — so the owner app, granted visitors' host, and the loop routine all
// derive the SAME feedback channel with no key exchange.
const SELF_DOMAIN_KEY = 'hc:nostrmesh:self-domain'
const OUTBOX_DIR = '__feedback_outbox__'
const RETRY_MS = 30_000
const MAX_OUTBOX_AGE_MS = 24 * 60 * 60 * 1000      // backstop sweep
// NIP-40 relay retention for a published item. Each item carries a unique
// d-tag (`i:<sig>`), so items never NIP-33-replace one another — without an
// expiration they accumulate on the relay forever. The window must outlast a
// consumer that connects late (the feedback-loop routine may run only every
// few hours), so 7 days. Re-publish refreshes created_at AND this expiration
// each tick, so a still-pending item keeps sliding its window forward; once
// read-back-confirmed and dropped from the outbox, the last published window
// stands.
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
  subscribe: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
  query?: (sig: string, timeoutMs?: number) => Promise<MeshEvt[]>
  isNetworkEnabled?: () => boolean
  setNetworkEnabled?: (enabled: boolean, persist?: boolean) => void
}
interface SignerLike { getPublicKeyHex: () => Promise<string | null> }
interface SwarmLike { subscribedTo?: () => string | null }
interface StoreLike {
  putOptimization?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getOptimization?: (sig: string) => Promise<Blob | null>
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
    'Durable store-and-forward transport for the feedback loop’s optimization records (feedback/qa/qa-answer) through the jwize.com relay, so a routine in another OPFS can read submitted feedback and the dashboard questions it mints come back. Inert until hc:feedback-channel:enabled.'

  protected override listens: string[] = ['optimization:wrote']
  protected override emits: string[] = ['feedback:channel-state', 'feedback:channel-ingested', 'feedback:channel-receipt']

  #initialized = false
  #channelId: string | null = null
  #sub: MeshSub | null = null
  #timer: ReturnType<typeof setInterval> | null = null
  #ingested = 0
  /** Outbox entries re-published this session (sig → first-attempt epoch ms),
   *  to drive the age-sweep without an extra stat() per tick. */
  #firstAttemptAt = new Map<string, number>()

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The local-write hook fires regardless of the gate (cheap), but only
    // ACTS when enabled — so toggling the flag on takes effect on the next
    // submit without a reload, mirroring HostSyncService.
    this.onEffect<{ sig: string; bytes: ArrayBuffer }>('optimization:wrote', (p) => {
      if (!this.#isEnabled() || !p?.sig) return
      void this.#onLocalWrite(p.sig, p.bytes)
    })

    if (!this.#isEnabled()) return
    await this.#start()
  }

  // ── gate ────────────────────────────────────────────────
  public readonly isEnabled = (): boolean => this.#isEnabled()
  readonly #isEnabled = (): boolean => {
    // Explicit flag wins both ways.
    let raw = ''
    try { raw = String(localStorage.getItem(ENABLED_KEY) ?? '').trim().toLowerCase() } catch { return false }
    if (raw === 'true') return true
    if (raw === 'false') return false
    // Unset ⇒ default ON for the OWNER on their own hive, so submitting always
    // crosses and returned qa always renders without a hidden flag. A VISITOR
    // (subscribed to another hive) stays OFF — their feedback rides the consent
    // handshake (FeedbackSwarmDrone) instead of this channel.
    return this.#isOwnerContext()
  }

  /** Owner context = NOT a visitor of another hive. SwarmDrone.subscribedTo()
   *  is the host pubkey we're visiting (null/empty on our own hive). Absent
   *  swarm drone (early boot) ⇒ treat as owner, the common case. */
  readonly #isOwnerContext = (): boolean => {
    try { return !ioc()?.get<SwarmLike>(SWARM_KEY)?.subscribedTo?.() }
    catch { return false }
  }

  /** Operator opt-in. Effect is immediate — no reload. */
  public readonly enable = async (channelId?: string): Promise<void> => {
    try {
      if (channelId && HEX64.test(channelId)) localStorage.setItem(CHANNEL_ID_KEY, channelId)
      localStorage.setItem(ENABLED_KEY, 'true')
    } catch { /* private mode — honor in-session */ }
    this.#channelId = null
    await this.#start()
  }

  public readonly disable = (): void => {
    try { localStorage.setItem(ENABLED_KEY, 'false') } catch { /* ignore */ }
    this.#sub?.close(); this.#sub = null
    if (this.#timer) { clearInterval(this.#timer); this.#timer = null }
  }

  /** Manual flush of the durable outbox — (re)publish pending items and clear
   *  those the relay confirms via read-back. Runs on a 30s timer too; exposed
   *  for an immediate flush and for tests. */
  public readonly drain = (): Promise<void> => this.#drainOutbox()

  // ── lifecycle ───────────────────────────────────────────
  #starting = false
  readonly #start = async (): Promise<void> => {
    if (this.#starting || this.#sub) return
    this.#starting = true
    try {
      const channelId = await this.#resolveChannelId()
      const mesh = ioc()?.get<MeshLike>(MESH_KEY)
      if (!channelId || !mesh?.subscribe) return  // not ready — heartbeat/enable retries
      // The channel can't receive while the mesh network is off — a subscribe
      // with no live socket only registers a local bucket. Enabling the channel
      // is an explicit "I want this host live", so bring the network up. We do
      // NOT persist (persist=false): a host that opted into the channel keeps
      // it live every boot via this path WITHOUT permanently rewriting the
      // global mesh network preference (other features own that knob). Disabling
      // the channel therefore leaves the network pref exactly as it was.
      if (mesh.isNetworkEnabled && mesh.setNetworkEnabled && !mesh.isNetworkEnabled()) {
        mesh.setNetworkEnabled(true, false)
      }
      this.#sub = mesh.subscribe(channelId, (e) => void this.#onChannelEvent(e))
      if (!this.#timer) this.#timer = setInterval(() => void this.#drainOutbox(), RETRY_MS)
      // Boot flush: re-publish anything left from a prior session (offline
      // submits, a crash mid-publish) — the store-and-forward guarantee.
      await this.#drainOutbox()
    } finally {
      this.#starting = false
    }
  }

  /** The channel address. Resolution order:
   *   1. explicit override (hc:feedback-channel:id) — a routine pinned to a
   *      specific hive's channel;
   *   2. HOST DOMAIN (hc:nostrmesh:self-domain, e.g. 'jwize.com') — the channel
   *      belongs to the HOST, not to any one browser's ephemeral key, so every
   *      context using this host (the owner on any origin/device, a granted
   *      visitor's host, and the loop routine) derives the SAME id with no key
   *      exchange. This is what makes "the host receives all feedback" hold
   *      regardless of which OPFS submitted it;
   *   3. own pubkey — fallback for a bare local dev with no host configured. */
  readonly #resolveChannelId = async (): Promise<string | null> => {
    if (this.#channelId) return this.#channelId
    let override = ''
    try { override = String(localStorage.getItem(CHANNEL_ID_KEY) ?? '').trim().toLowerCase() } catch { /* ignore */ }
    if (HEX64.test(override)) { this.#channelId = override; return override }
    const host = this.#hostDomain()
    if (host) {
      this.#channelId = await SignatureService.sign(enc.encode(`hc:feedback-channel\0${host}`).buffer as ArrayBuffer)
      return this.#channelId
    }
    const pk = (await ioc()?.get<SignerLike>(SIGNER_KEY)?.getPublicKeyHex?.()) ?? null
    if (!pk || !HEX64.test(pk)) return null
    this.#channelId = await SignatureService.sign(enc.encode(`hc:feedback-channel\0${pk}`).buffer as ArrayBuffer)
    return this.#channelId
  }

  /** Canonical host domain (hc:nostrmesh:self-domain), scheme/slash-stripped
   *  and lowercased. Empty when unset. */
  readonly #hostDomain = (): string => {
    try {
      return String(localStorage.getItem(SELF_DOMAIN_KEY) ?? '').trim()
        .replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()
    } catch { return '' }
  }

  // ── publish (local write → channel) ─────────────────────
  readonly #onLocalWrite = async (sig: string, bytes: ArrayBuffer): Promise<void> => {
    if (!HEX64.test(sig)) return
    // Persist to the durable outbox FIRST — if the relay is down, the item
    // rests here and the timer flushes it on reconnect.
    const text = dec.decode(bytes)
    await this.#writeOutbox(sig, text)
    await this.#start()       // ensure subscription/timer are live
    await this.#publishItem(sig, text)
  }

  readonly #publishItem = async (sig: string, text: string): Promise<boolean> => {
    const channelId = await this.#resolveChannelId()
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    if (!channelId || !mesh?.publish) return false
    if (!this.#firstAttemptAt.has(sig)) this.#firstAttemptAt.set(sig, Date.now())
    // payload.t carries the EXACT stored JSON text (lossless through the
    // event content round-trip) so the receiver reconstructs identical bytes.
    // The expiration tag bounds relay retention (see ITEM_TTL_SEC) — each
    // re-publish slides the window forward, so a still-pending item never
    // expires out from under a yet-to-connect consumer.
    const expiresAt = Math.floor(Date.now() / 1000) + ITEM_TTL_SEC
    return mesh.publish(FEEDBACK_ITEM_KIND, channelId, { t: text, s: sig }, [['d', `i:${sig}`], ['expiration', String(expiresAt)]])
  }

  /** (Re)publish every pending outbox item, then confirm delivery by a relay
   *  READ-BACK and clear whatever the relay actually serves. The reconnect
   *  flush and the periodic retry are one loop (NIP-33 replace = free). The
   *  receipt is the relay returning our item on a fresh REQ — never a bare
   *  send-ok — because relay.js does not echo a publisher's own event back to
   *  it live (HostSyncService's "confirmed read-back" discipline). */
  readonly #drainOutbox = async (): Promise<void> => {
    if (!this.#isEnabled()) return
    const dir = await this.#outboxDir()
    if (!dir) return

    // collect pending entries, sweeping anything past the 24h backstop
    const pending: Array<{ sig: string; text: string }> = []
    for await (const [name, handle] of this.#entries(dir)) {
      if (!HEX64.test(name) || handle.kind !== 'file') continue
      let text = ''
      let mtime = 0
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        text = await file.text(); mtime = file.lastModified
      } catch { continue }
      const first = this.#firstAttemptAt.get(name) ?? mtime
      if (Date.now() - first > MAX_OUTBOX_AGE_MS) {
        // Backstop: 24h without a confirmed read-back means something is
        // structurally wrong; stop retrying rather than spin forever.
        await this.#removeOutbox(name)
        this.#firstAttemptAt.delete(name)
        console.warn(`[feedback-channel] dropped outbox item ${name.slice(0, 12)}… after 24h with no relay receipt`)
        continue
      }
      pending.push({ sig: name, text })
    }
    if (pending.length === 0) { this.#emitState(0); return }

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
        await this.#removeOutbox(e.sig)
        this.#firstAttemptAt.delete(e.sig)
        EffectBus.emit('feedback:channel-receipt', { sig: e.sig })
      }
    }

    // recount what's still pending after the read-back
    let remaining = 0
    const dir2 = await this.#outboxDir()
    if (dir2) for await (const [n, h] of this.#entries(dir2)) if (HEX64.test(n) && h.kind === 'file') remaining++
    this.#emitState(remaining)
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

    // Receipt: a real-relay echo of one of OUR pending items clears the outbox.
    // (Local fanout — e.relay === 'local' — is not proof the relay holds it.)
    if (e.relay && e.relay !== 'local') {
      if (await this.#hasOutbox(claimed)) {
        await this.#removeOutbox(claimed)
        this.#firstAttemptAt.delete(claimed)
        EffectBus.emit('feedback:channel-receipt', { sig: claimed })
      }
    }

    // Ingest: write into local __optimization__ if we don't already hold it.
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
  public readonly status = async (): Promise<{ enabled: boolean; channelId: string | null; pending: number; ingested: number }> => {
    const dir = await this.#outboxDir()
    let pending = 0
    if (dir) for await (const [name, h] of this.#entries(dir)) if (HEX64.test(name) && h.kind === 'file') pending++
    return { enabled: this.#isEnabled(), channelId: await this.#resolveChannelId(), pending, ingested: this.#ingested }
  }

  readonly #emitState = (pending?: number): void => {
    void (async () => {
      let n = pending
      if (n === undefined) {
        const dir = await this.#outboxDir()
        n = 0
        if (dir) for await (const [name, h] of this.#entries(dir)) if (HEX64.test(name) && h.kind === 'file') n++
      }
      EffectBus.emit('feedback:channel-state', { pending: n, ingested: this.#ingested })
    })()
  }

  // ── OPFS outbox helpers ─────────────────────────────────
  readonly #outboxDir = async (): Promise<FileSystemDirectoryHandle | null> => {
    const root = ioc()?.get<StoreLike>(STORE_KEY)?.opfsRoot
    if (!root) return null
    try { return await root.getDirectoryHandle(OUTBOX_DIR, { create: true }) }
    catch { return null }
  }

  readonly #writeOutbox = async (sig: string, text: string): Promise<void> => {
    const dir = await this.#outboxDir()
    if (!dir) return
    try {
      const handle = await dir.getFileHandle(sig, { create: true })
      const w = await handle.createWritable()
      try { await w.write(text) } finally { await w.close() }
    } catch { /* best-effort; next write/drain retries */ }
  }

  readonly #hasOutbox = async (sig: string): Promise<boolean> => {
    const dir = await this.#outboxDir()
    if (!dir) return false
    try { await dir.getFileHandle(sig, { create: false }); return true } catch { return false }
  }

  readonly #removeOutbox = async (sig: string): Promise<void> => {
    const dir = await this.#outboxDir()
    if (!dir) return
    try { await dir.removeEntry(sig) } catch { /* already gone */ }
  }

  readonly #entries = (dir: FileSystemDirectoryHandle): AsyncIterable<[string, FileSystemHandle]> =>
    (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()
}

const _feedbackChannel = new FeedbackChannelDrone()
window.ioc.register('@diamondcoreprocessor.com/FeedbackChannelDrone', _feedbackChannel)
