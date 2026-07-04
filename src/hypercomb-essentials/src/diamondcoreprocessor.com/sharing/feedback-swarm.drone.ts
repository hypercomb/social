// diamondcoreprocessor.com/sharing/feedback-swarm.drone.ts
//
// Secure remote-feedback handshake over the swarm — the "approve each person
// once" model. Mirrors the subscribe-consent flow (swarm.drone +
// subscribe-consent.drone) but for the right to POST FEEDBACK to a host:
//
//   1. A VISITOR (a participant subscribed to someone else's hive) clicks the
//      feedback button. If they aren't yet granted, the button publishes a
//      FEEDBACK_REQUEST to the host's request channel and shows "asking the
//      host's permission". The button stays inert for posting until granted.
//   2. The HOST receives the request, the consent toast offers Accept / No
//      thanks (exactly like subscribe consent). Accept adds the visitor's
//      pubkey to `hc:feedback-allowed` AND publishes a FEEDBACK_GRANT to the
//      visitor's grant channel.
//   3. The visitor receives the grant → marks the host granted → the button
//      activates. Submitting now publishes a FEEDBACK_POST to the host's post
//      channel.
//   4. The HOST receives posts ONLY from allow-listed pubkeys and ingests each
//      into `__optimization__` as `kind:'feedback'` — the exact shape the
//      feedback button writes locally — so the existing loop takes over.
//
// Channel sigs are deterministic (sha256 of a labelled string scoped to the
// active room+secret), so both sides address the same channel with no
// out-of-band handshake — identical to swarm.drone's #computeChannelSig.
//
// All transport rides NostrMeshDrone (NIP-33 replaceable events). The new event
// kinds MUST be in SwarmDrone's mesh.configureKinds() allowlist or the relay
// filters them out (see swarm.drone.ts).

import { Drone, EffectBus } from '@hypercomb/core'
import type { ToastRequest } from '../commands/toast.drone.js'

// New NIP-33 parameterized-replaceable kinds (30206-30209 are free; 30210+ used
// here to leave headroom). Keep in sync with SwarmDrone.configureKinds().
export const FEEDBACK_REQUEST_KIND = 30210
export const FEEDBACK_GRANT_KIND = 30211
export const FEEDBACK_POST_KIND = 30212

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SIGSTORE_KEY = '@hypercomb/SignatureStore'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'
const STORE_KEY = '@hypercomb.social/Store'
const I18N_KEY = '@hypercomb.social/I18n'

const ALLOWED_LIST = 'hc:feedback-allowed'   // host: pubkeys allowed to post to me
const DECLINED_LIST = 'hc:feedback-declined'  // host: pubkeys I declined
const GRANTED_LIST = 'hc:feedback-granted'    // visitor: host pubkeys that granted me
// Durable retention: a granted visitor's post (and a pending request/grant) must
// survive on the relay until the other side is next online — the same 7-day
// window the owner channel uses. The old 90s ephemeral window silently LOST
// visitor feedback whenever the host tab wasn't open in that exact 90s (the
// relay's deleteExpired purged it first). Re-publish slides the window forward.
const EVENT_TTL_SECS = 7 * 24 * 60 * 60

type MeshEvt = { relay: string; sig: string; event: { kind?: number; pubkey?: string } | null; payload: unknown }
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}
interface SignatureStoreLike { signText: (s: string) => Promise<string> }
interface ValueStoreLike { value?: string }
interface SignerLike { getPublicKeyHex: () => Promise<string | null> }
interface SwarmLike { subscribedTo?: () => string | null }
interface StoreLike { putOptimization?: (blob: Blob) => Promise<string> }
interface I18nLike { t: (key: string, params?: Record<string, unknown>) => string }

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const HEX64 = /^[0-9a-f]{64}$/

export class FeedbackSwarmDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Secure remote-feedback handshake: visitors request permission, the host approves once (consent toast), then allow-listed visitors’ feedback is ingested into the host’s feedback inbox for the loop.'

  protected override listens: string[] = ['feedback:request-access', 'feedback:remote-post', 'feedback:consent-accept', 'feedback:consent-decline']
  protected override emits: string[] = ['toast:show', 'feedback:access-granted', 'feedback:access-state']

  #initialized = false
  #myPubkey: string | null = null
  #reqSub: MeshSub | null = null
  #postSub: MeshSub | null = null
  #grantSub: MeshSub | null = null
  /** Session-level dedup of ingested posts (from:itemId). Durable posts are
   *  replayed on every (re)subscribe; this skips the redundant work + toast
   *  before touching the store (cross-session dedup is content-addressing). */
  #seenPosts = new Set<string>()

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // Visitor-side actions, driven by the feedback button.
    this.onEffect<{ host?: string; label?: string }>('feedback:request-access', (p) => void this.requestAccess(p?.host, p?.label))
    this.onEffect<{ host?: string; payload?: unknown }>('feedback:remote-post', (p) => void this.postFeedback(p?.host, p?.payload))

    // Host-side consent decisions, from the toast action buttons.
    this.onEffect<{ pubkey?: string }>('feedback:consent-accept', (p) => void this.accept(String(p?.pubkey ?? '')))
    this.onEffect<{ pubkey?: string }>('feedback:consent-decline', (p) => this.decline(String(p?.pubkey ?? '')))

    await this.#ensureSubscriptions()
    // Re-derive channels when the room / secret / identity changes.
    EffectBus.on('mesh:public-changed', () => void this.#ensureSubscriptions())
    EffectBus.on('mesh:room', () => void this.#ensureSubscriptions())
    EffectBus.on('mesh:secret', () => void this.#ensureSubscriptions())
  }

  // ── service resolution ──────────────────────────────────
  #mesh = (): MeshLike | undefined => ioc()?.get<MeshLike>(MESH_KEY)
  #sig = (): SignatureStoreLike | undefined => ioc()?.get<SignatureStoreLike>(SIGSTORE_KEY)
  #room = (): string => (ioc()?.get<ValueStoreLike>(ROOM_KEY)?.value ?? '').trim()
  #secret = (): string => (ioc()?.get<ValueStoreLike>(SECRET_KEY)?.value ?? '').trim()
  #swarm = (): SwarmLike | undefined => ioc()?.get<SwarmLike>(SWARM_KEY)

  async #pubkey(): Promise<string | null> {
    if (this.#myPubkey) return this.#myPubkey
    const signer = ioc()?.get<SignerLike>(SIGNER_KEY)
    this.#myPubkey = (await signer?.getPublicKeyHex?.()) ?? null
    return this.#myPubkey
  }

  // Deterministic channel sigs — identical algorithm on both peers.
  async #channelSig(prefix: 'feedback-request' | 'feedback-grant' | 'feedback-post', pubkey: string): Promise<string> {
    const sig = this.#sig(); const room = this.#room(); const secret = this.#secret()
    if (!sig?.signText || !room || !secret || !HEX64.test(pubkey)) return ''
    try { return await sig.signText(`${prefix}:${pubkey}\0${room}\0${secret}`) } catch { return '' }
  }

  #label(): string {
    try { return String(localStorage.getItem('hc:user-label') ?? '').trim().slice(0, 64) } catch { return '' }
  }
  #readList(key: string): Set<string> {
    try {
      const raw = String(localStorage.getItem(key) ?? '').trim()
      if (!raw) return new Set()
      return new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(s => HEX64.test(s)))
    } catch { return new Set() }
  }
  #writeList(key: string, set: Set<string>): void {
    try { localStorage.setItem(key, Array.from(set).join(',')) } catch { /* ignore */ }
  }

  /** Host: subscribe to my request + post channels (to receive requests +
   *  posts). Visitor: subscribe to my grant channel (to learn I was approved).
   *  All three are mine — any participant can be host and visitor at once. */
  async #ensureSubscriptions(): Promise<void> {
    const mesh = this.#mesh()
    const pk = await this.#pubkey()
    if (!mesh?.subscribe || !pk) return
    if (!this.#room() || !this.#secret()) return   // channels are room+secret scoped

    const reqSig = await this.#channelSig('feedback-request', pk)
    const postSig = await this.#channelSig('feedback-post', pk)
    const grantSig = await this.#channelSig('feedback-grant', pk)

    this.#reqSub?.close(); this.#postSub?.close(); this.#grantSub?.close()
    if (reqSig) this.#reqSub = mesh.subscribe(reqSig, (e) => this.#onRequest(e))
    if (postSig) this.#postSub = mesh.subscribe(postSig, (e) => this.#onPost(e))
    if (grantSig) this.#grantSub = mesh.subscribe(grantSig, (e) => this.#onGrant(e))
  }

  // ── HOST: receive a request → consent toast ─────────────
  #onRequest(e: MeshEvt): void {
    if (Number(e.event?.kind) !== FEEDBACK_REQUEST_KIND) return
    const requester = String(e.event?.pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(requester)) return
    if (this.#readList(DECLINED_LIST).has(requester)) return   // already said no
    if (this.#readList(ALLOWED_LIST).has(requester)) { void this.#publishGrant(requester); return } // re-grant silently
    const label = (e.payload && typeof e.payload === 'object')
      ? String((e.payload as { label?: unknown }).label ?? '').trim().slice(0, 64) : ''
    this.#showConsentToast(requester, label)
  }

  #showConsentToast(pubkey: string, label: string): void {
    const i18n = ioc()?.get<I18nLike>(I18N_KEY)
    const who = label || `${pubkey.slice(0, 8)}…`
    EffectBus.emit('toast:show', {
      type: 'info',
      title: i18n?.t('feedback.consent.title') ?? 'Feedback request',
      message: i18n?.t('feedback.consent.message', { requester: who }) ?? `${who} is asking to share feedback with you`,
      duration: 0,
      actions: [
        { label: i18n?.t('feedback.consent.accept') ?? 'Allow', effect: 'feedback:consent-accept', payload: { pubkey }, kind: 'primary' },
        { label: i18n?.t('feedback.consent.decline') ?? 'No thanks', effect: 'feedback:consent-decline', payload: { pubkey }, kind: 'secondary' },
      ],
    } as ToastRequest)
  }

  /** Host: allow a pubkey to post feedback + tell them they're approved. */
  async accept(pubkey: string): Promise<void> {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(pk)) return
    const allowed = this.#readList(ALLOWED_LIST); const declined = this.#readList(DECLINED_LIST)
    allowed.add(pk); declined.delete(pk)
    this.#writeList(ALLOWED_LIST, allowed); this.#writeList(DECLINED_LIST, declined)
    await this.#publishGrant(pk)
  }

  decline(pubkey: string): void {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(pk)) return
    const allowed = this.#readList(ALLOWED_LIST); const declined = this.#readList(DECLINED_LIST)
    declined.add(pk); allowed.delete(pk)
    this.#writeList(ALLOWED_LIST, allowed); this.#writeList(DECLINED_LIST, declined)
  }

  /** Host: publish a grant to the requester's grant channel. */
  async #publishGrant(requesterPubkey: string): Promise<void> {
    const mesh = this.#mesh(); const me = await this.#pubkey()
    if (!mesh?.publish || !me) return
    const grantSig = await this.#channelSig('feedback-grant', requesterPubkey)
    if (!grantSig) return
    const exp = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    await mesh.publish(FEEDBACK_GRANT_KIND, grantSig, { host: me }, [['d', `${grantSig}:${me}`], ['expiration', String(exp)]])
  }

  // ── HOST: receive a post from an allow-listed visitor → ingest ──
  async #onPost(e: MeshEvt): Promise<void> {
    if (Number(e.event?.kind) !== FEEDBACK_POST_KIND) return
    const from = String(e.event?.pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(from) || !this.#readList(ALLOWED_LIST).has(from)) return   // gate: only granted pubkeys
    const p = (e.payload && typeof e.payload === 'object') ? e.payload as Record<string, unknown> : null
    if (!p) return
    // Dedup: derive the ingested record's identity from the SENDER's own stable
    // id + timestamp (never Date.now()), so a re-delivered durable post hashes to
    // the SAME optimization sig and putOptimization no-ops. The session seen-set
    // skips the redundant work + toast before we even touch the store.
    const srcId = typeof p['id'] === 'string' && p['id'] ? String(p['id']) : `fb-remote-${from.slice(0, 8)}`
    const postKey = `${from}:${srcId}`
    if (this.#seenPosts.has(postKey)) return
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.putOptimization) return
    // Same record shape the local feedback button writes, tagged with the
    // sender so the host can see who it came from. Deterministic id/at ⇒
    // content-addressed idempotence across sessions.
    const record = {
      kind: 'feedback',
      appliesTo: Array.isArray(p['appliesTo']) ? p['appliesTo'] : [],
      payload: {
        id: srcId,
        category: typeof p['category'] === 'string' ? p['category'] : 'idea',
        text: String(p['text'] ?? '').slice(0, 4000),
        route: typeof p['route'] === 'string' ? p['route'] : '',
        at: typeof p['at'] === 'number' ? p['at'] : 0,
        from,
        remote: true,
      },
      mark: 'persistent',
    }
    try {
      await store.putOptimization(new Blob([new TextEncoder().encode(JSON.stringify(record)) as BlobPart]))
      this.#seenPosts.add(postKey)
      EffectBus.emit('feedback:submitted', {})
    } catch { /* ignore */ }
  }

  // ── VISITOR: request access + receive grant + post ──────
  isGrantedBy(host: string): boolean {
    const h = String(host ?? '').trim().toLowerCase()
    return HEX64.test(h) && this.#readList(GRANTED_LIST).has(h)
  }

  /** Visitor: publish a request to the host's request channel. */
  async requestAccess(host?: string, label?: string): Promise<void> {
    const hostPk = String(host ?? this.#swarm()?.subscribedTo?.() ?? '').trim().toLowerCase()
    const mesh = this.#mesh(); const me = await this.#pubkey()
    if (!mesh?.publish || !me || !HEX64.test(hostPk)) return
    const reqSig = await this.#channelSig('feedback-request', hostPk)
    if (!reqSig) return
    const exp = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    await mesh.publish(FEEDBACK_REQUEST_KIND, reqSig, { label: label ?? this.#label() }, [['d', `${reqSig}:${me}`], ['expiration', String(exp)]])
  }

  /** Visitor: a grant arrived from a host → remember it; button activates. */
  #onGrant(e: MeshEvt): void {
    if (Number(e.event?.kind) !== FEEDBACK_GRANT_KIND) return
    const host = String(e.event?.pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(host)) return
    const granted = this.#readList(GRANTED_LIST)
    if (granted.has(host)) return
    granted.add(host); this.#writeList(GRANTED_LIST, granted)
    EffectBus.emit('feedback:access-granted', { host })
    EffectBus.emit('feedback:access-state', { host, granted: true })
  }

  /** Visitor: publish a feedback post to the host (only if granted). */
  async postFeedback(host?: string, payload?: unknown): Promise<boolean> {
    const hostPk = String(host ?? this.#swarm()?.subscribedTo?.() ?? '').trim().toLowerCase()
    if (!HEX64.test(hostPk) || !this.isGrantedBy(hostPk)) return false
    const mesh = this.#mesh(); const me = await this.#pubkey()
    if (!mesh?.publish || !me) return false
    const postSig = await this.#channelSig('feedback-post', hostPk)
    if (!postSig) return false
    // Unique d-tag PER POST (…:me:itemId) so a burst of posts from one visitor
    // accumulate on the relay instead of NIP-33-replacing each other. itemId is
    // the button's own stable id, so re-publishing the same post stays idempotent.
    const itemId = (payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string')
      ? String((payload as { id: string }).id) : `p-${Date.now().toString(36)}`
    const exp = Math.floor(Date.now() / 1000) + EVENT_TTL_SECS
    return mesh.publish(FEEDBACK_POST_KIND, postSig, payload ?? {}, [['d', `${postSig}:${me}:${itemId}`], ['expiration', String(exp)]])
  }
}

const _feedbackSwarm = new FeedbackSwarmDrone()
window.ioc.register('@diamondcoreprocessor.com/FeedbackSwarmDrone', _feedbackSwarm)
