// sharing/feedback-reply.drone.ts
//
// The RETURN channel of the feedback loop: when the host resolves an issue (or
// just wants to respond), the answer travels BACK to the participant who sent
// the feedback, and lands in THEIR feedback window.
//
// ADDRESSING — "each instance provides a code": it already does. Every
// instance mints a nostr keypair (NostrSigner), and every feedback item now
// carries the sender's pubkey in `payload.from` (the display name in
// `payload.by` rides on top). That pubkey IS the code. The reply channel is
// derived from it the same way the consent handshake derives its channels:
//
//   replyChannel(pubkey) = sha256("hc:feedback-reply\0" + pubkey)
//
// Both sides compute it with no exchange and no registry — the host publishes
// a reply on sha256(…sender's pubkey…), and every participant subscribes to
// the channel of their OWN pubkey. Names stay display-only: two participants
// named "Sam" have two different pubkeys and two different reply channels, so
// a reply can never land on the wrong Sam.
//
// Unlike the handshake channels (room+secret scoped), this is UNSCOPED like
// the community feedback channel: feedback arrives over the fixed rendezvous
// from any origin, so the reply must be routable without a shared room. The
// transport is the same relay (wss://jwize.com via NostrMeshDrone).
//
// DURABILITY (v1): the same 7-day story as the visitor-post path — a unique
// d-tag per reply + a NIP-40 expiration, so the reply rests on the relay
// until the recipient is next online within the window; ingest is
// content-addressed (sha256 of the exact JSON text), so replay is idempotent.
// No pending-map here yet; if replies start mattering more than 7 days out,
// graft the FeedbackChannelDrone read-back-confirm loop.
//
// KIND 30214 — MUST stay in SwarmDrone.configureKinds() or the relay filter
// drops it (same rule as the whole FEEDBACK_* family).

import { Drone, EffectBus, SignatureService } from '@hypercomb/core'

export const FEEDBACK_REPLY_KIND = 30214

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const STORE_KEY = '@hypercomb.social/Store'
const I18N_KEY = '@hypercomb.social/I18n'

const HEX64 = /^[0-9a-f]{64}$/
// Relay retention per reply — matches the community channel / visitor posts.
const REPLY_TTL_SEC = 7 * 24 * 60 * 60

type MeshEvt = { relay: string; sig: string; event: { kind?: number; pubkey?: string } | null; payload: unknown }
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void, opts?: { sinceSec?: number | null }) => MeshSub
  isNetworkEnabled?: () => boolean
  setNetworkEnabled?: (enabled: boolean, persist?: boolean) => void
}
interface SignerLike { getPublicKeyHex: () => Promise<string | null> }
interface StoreLike {
  putOptimization?: (blob: Blob, options?: { emit?: boolean }) => Promise<string>
  getOptimization?: (sig: string) => Promise<Blob | null>
}
interface I18nLike { t: (key: string, params?: Record<string, unknown>) => string }

/** What the feedback window sends when the host replies to an item. */
export type ReplyRequest = {
  /** Recipient pubkey — the original item's `payload.from`. */
  to?: string
  /** The reply text. */
  text?: string
  /** The original item's id (fb-… / qId) so the recipient's window can say
   *  what this is in reply to. */
  reId?: string
  /** A short quote of the original text, carried for display. */
  re?: string
  /** Sender identity (the host's name + pubkey). */
  by?: string
  from?: string
}

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

const enc = new TextEncoder()

export class FeedbackReplyDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Return channel of the feedback loop: replies to a feedback item travel back to the sender over a channel derived from their pubkey (sha256("hc:feedback-reply\\0"+pubkey)) and land in their feedback window. Every instance listens on its own channel; names are display-only, the pubkey is the address.'

  protected override listens: string[] = ['feedback:send-reply']
  protected override emits: string[] = ['feedback:reply-ingested', 'feedback:reply-sent', 'toast:show']

  #initialized = false
  #sub: MeshSub | null = null
  #myPubkey: string | null = null

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The host's feedback window replies through this effect.
    this.onEffect<ReplyRequest>('feedback:send-reply', (p) => void this.sendReply(p))

    // Listen on MY OWN reply channel the moment the mesh is up (fires
    // immediately when it already is). Idempotent.
    const reg = (window as { ioc?: { whenReady?: (key: string, cb: (v: unknown) => void) => void } }).ioc
    reg?.whenReady?.(MESH_KEY, () => void this.#ensureSubscribed())
    await this.#ensureSubscribed()
  }

  async #pubkey(): Promise<string | null> {
    if (this.#myPubkey) return this.#myPubkey
    const signer = ioc()?.get<SignerLike>(SIGNER_KEY)
    const pk = String((await signer?.getPublicKeyHex?.()) ?? '').trim().toLowerCase()
    this.#myPubkey = HEX64.test(pk) ? pk : null
    return this.#myPubkey
  }

  /** The deterministic per-recipient channel — both sides compute this. */
  static async channelFor(pubkey: string): Promise<string | null> {
    const pk = String(pubkey ?? '').trim().toLowerCase()
    if (!HEX64.test(pk)) return null
    return SignatureService.sign(enc.encode(`hc:feedback-reply\0${pk}`).buffer as ArrayBuffer)
  }

  // ── receive: my own reply channel → local pool ──────────
  readonly #ensureSubscribed = async (): Promise<void> => {
    if (this.#sub) return
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    const pk = await this.#pubkey()
    if (!mesh?.subscribe || !pk) return   // signer/mesh not up — whenReady retries
    const channel = await FeedbackReplyDrone.channelFor(pk)
    if (!channel) return
    // Full-TTL replay window: a reply published while this browser was closed
    // must still arrive on the next open (the relay holds it 7 days).
    this.#sub = mesh.subscribe(channel, (e) => void this.#onReply(e), { sinceSec: REPLY_TTL_SEC })
  }

  readonly #onReply = async (e: MeshEvt): Promise<void> => {
    if (!e || Number(e.event?.kind) !== FEEDBACK_REPLY_KIND) return
    const p = (e.payload && typeof e.payload === 'object') ? e.payload as { t?: unknown; s?: unknown } : null
    const text = typeof p?.t === 'string' ? p.t : null
    const claimed = typeof p?.s === 'string' ? p.s.trim().toLowerCase() : ''
    if (!text || !HEX64.test(claimed)) return

    // Content-address re-check — tampered / non-canonical bytes are dropped.
    const bytes = enc.encode(text)
    const actual = await SignatureService.sign(bytes.buffer as ArrayBuffer)
    if (actual !== claimed) return

    let record: { kind?: unknown } | null = null
    try { record = JSON.parse(text) } catch { return }
    if (record?.kind !== 'feedback-reply') return

    // Ingest, content-addressed dedup (replay-safe): already held ⇒ done.
    const store = ioc()?.get<StoreLike>(STORE_KEY)
    if (!store?.putOptimization || !store.getOptimization) return
    if (await store.getOptimization(claimed)) return
    try {
      // emit:false — a reply is FOR this participant; it must not ride back
      // out over the community feedback channel's optimization:wrote hook.
      await store.putOptimization(new Blob([bytes as BlobPart]), { emit: false })
    } catch { return }

    // Surface it: the open feedback window refreshes; a closed one gets a toast.
    EffectBus.emit('feedback:reply-ingested', { sig: claimed })
    const payload = (record as { payload?: { by?: unknown; text?: unknown } }).payload
    const who = String(payload?.by ?? '').trim() || 'the host'
    const i18n = ioc()?.get<I18nLike>(I18N_KEY)
    EffectBus.emit('toast:show', {
      type: 'info',
      title: i18n?.t('feedback.reply.received.title') ?? 'Reply received',
      message: i18n?.t('feedback.reply.received.message', { who }) ?? `${who} replied to your feedback — open the feedback window.`,
    })
  }

  // ── send: host → sender's reply channel ─────────────────
  /** Publish a reply to the sender's channel. Returns false when the address
   *  is missing/invalid or the mesh isn't up — the caller toasts. */
  public readonly sendReply = async (req: ReplyRequest | undefined): Promise<boolean> => {
    const to = String(req?.to ?? '').trim().toLowerCase()
    const text = String(req?.text ?? '').trim().slice(0, 4000)
    if (!HEX64.test(to) || !text) return false
    const mesh = ioc()?.get<MeshLike>(MESH_KEY)
    const channel = await FeedbackReplyDrone.channelFor(to)
    if (!mesh?.publish || !channel) return false
    // Sending a reply is an explicit "I want this delivered" — bring the
    // socket up if the mesh is idle (persist=false, same as the channel drone).
    if (mesh.isNetworkEnabled && mesh.setNetworkEnabled && !mesh.isNetworkEnabled()) {
      mesh.setNetworkEnabled(true, false)
    }
    const record = {
      kind: 'feedback-reply',
      appliesTo: [],
      payload: {
        reId: String(req?.reId ?? ''),
        re: String(req?.re ?? '').slice(0, 280),
        text,
        by: String(req?.by ?? '').trim().slice(0, 64),
        from: HEX64.test(String(req?.from ?? '')) ? String(req?.from) : '',
        at: Date.now(),
      },
      mark: 'persistent',
    }
    const json = JSON.stringify(record)
    const sig = await SignatureService.sign(enc.encode(json).buffer as ArrayBuffer)
    const expiresAt = Math.floor(Date.now() / 1000) + REPLY_TTL_SEC
    // Unique d-tag per reply so replies accumulate (never NIP-33-replace),
    // idempotent re-publish (same bytes → same sig → same d-tag).
    const ok = await mesh.publish(FEEDBACK_REPLY_KIND, channel, { t: json, s: sig }, [['d', `r:${sig}`], ['expiration', String(expiresAt)]])
    if (ok) EffectBus.emit('feedback:reply-sent', { to, sig })
    return ok
  }
}

const _feedbackReply = new FeedbackReplyDrone()
window.ioc.register('@diamondcoreprocessor.com/FeedbackReplyDrone', _feedbackReply)
