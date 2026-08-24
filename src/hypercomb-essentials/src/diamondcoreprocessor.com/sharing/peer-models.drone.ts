// diamondcoreprocessor.com/sharing/peer-models.drone.ts
//
// LEND THE SWARM YOUR GPU — a model running on one participant's machine,
// answering for another, over the mesh.
//
// A local model (Ollama and friends) is the one tier nobody can share by
// publishing an address: `localhost:11434` means something different on every
// machine, and a peer's browser cannot reach it. So the MACHINE answers, not
// the address. Three records, one shape each, on room+secret-scoped channels
// exactly like feedback-swarm and client-presence:
//
//   OFFER   30215  broadcast, replaceable per pubkey, short TTL.
//                  "these models can answer from my machine right now."
//   REQUEST 30216  addressed to one offering peer. The turns to answer.
//   REPLY   30217  addressed back to the asker. The text, or a refusal.
//
// The offer's SHORT TTL is the availability signal. A laptop that sleeps, a
// tab that closes, a participant who switches lending off — none of them can
// send a retraction, and all of them stop re-publishing. An offer nobody
// renews expires, the provider disappears from the console, and no request is
// ever sent into a void. Presence by heartbeat, not by promise.
//
// ── what may be lent, and what may never be ──────────────────────────────
//
// ONLY MODELS THAT COST NOTHING TO RUN — `requiresKey === false`. A keyed
// provider is somebody's bill: offering it to the swarm would spend the
// host's money on a stranger's prompt, silently, which is exactly the kind of
// thing this system must never do by default. The gate is mechanical, not a
// warning in a dialog.
//
// LENDING IS OFF UNTIL IT IS SWITCHED ON (`hc:llm:peer-offer`), device-local
// like every other credential-adjacent fact. And a host that IS lending still
// answers only one request at a time and only when it has not used the model
// itself in the last little while — "if they're not busy with the AI" is the
// whole point, so the participant's own work always wins.
//
// ── what a requester gets ────────────────────────────────────────────────
//
// Each live offer becomes an ordinary provider in the registry, transport
// `peer-swarm`, requiring no key and reading no hive, labelled with whose
// machine it is. It appears in `/providers` beside everything else and the
// dispatch routes it here. Nothing else in the app learns that peers exist.

import { Drone, EffectBus, isSignature } from '@hypercomb/core'
import { setPeerModelCaller } from '../assistant/llm-dispatch.js'
import { llmProviderRegistry } from '../assistant/llm-provider-registry.js'
import { compileProviderSpec, parseProviderSpec } from '../assistant/providers/provider-spec.js'
import type {
  LlmCallResult, LlmProviderDescriptor, LlmRequest,
} from '../assistant/providers/llm-provider.types.js'

/** Keep in sync with SwarmDrone.configureKinds() or the relay filters them. */
export const PEER_MODEL_OFFER_KIND = 30215
export const PEER_MODEL_REQUEST_KIND = 30216
export const PEER_MODEL_REPLY_KIND = 30217

const MESH_KEY = '@diamondcoreprocessor.com/NostrMeshDrone'
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const SIGSTORE_KEY = '@hypercomb/SignatureStore'
const ROOM_KEY = '@hypercomb.social/RoomStore'
const SECRET_KEY = '@hypercomb.social/SecretStore'

/** Device-local: is this participant lending their machine? Off by default. */
export const PEER_OFFER_STORAGE_KEY = 'hc:llm:peer-offer'

/** How long an offer stands before it must be renewed. Short: this is a
 *  liveness claim, and a stale one sends requests to a closed laptop. */
const OFFER_TTL_SEC = 12 * 60
const OFFER_REPUBLISH_MS = 5 * 60_000
/** A request is worth answering for this long; past it the asker gave up. */
const REQUEST_TTL_SEC = 120
/** How long a requester waits before calling it a miss. */
const REPLY_TIMEOUT_MS = 90_000
/** The host answers one at a time — a lent machine is still being used. */
const MAX_CONCURRENT_JOBS = 1
/** After the participant uses the model themselves, peers wait this long. */
const OWN_USE_COOLDOWN_MS = 60_000
/** Nobody's prompt may cost the host an unbounded generation. */
const MAX_PEER_TOKENS = 1024
/** Bound the text a peer may push through a host's model in one request. */
const MAX_PROMPT_CHARS = 8_000

const HEX64 = /^[0-9a-f]{64}$/

type MeshEvt = {
  relay: string
  sig: string
  event: { kind?: number; pubkey?: string } | null
  payload: unknown
}
type MeshSub = { close: () => void }
interface MeshLike {
  publish: (kind: number, sig: string, payload: unknown, extraTags?: string[][]) => Promise<boolean>
  subscribe: (sig: string, cb: (e: MeshEvt) => void, opts?: { sinceSec?: number | null }) => MeshSub
}
interface SignatureStoreLike { signText: (s: string) => Promise<string> }
interface SignerLike { getPublicKeyHex: () => Promise<string | null> }
interface ValueLike { value?: string }

const ioc = (): { get: <T>(k: string) => T | undefined } | undefined =>
  (window as { ioc?: { get: <T>(k: string) => T | undefined } }).ioc

/** One model as offered by a peer. */
type OfferedModel = { name: string; id: string; tier?: string }

/** The offer record's payload. */
type OfferPayload = {
  label?: string
  models?: OfferedModel[]
}

const readFlag = (key: string): boolean => {
  try { return /^(1|true|yes|on)$/i.test(String(globalThis.localStorage?.getItem(key) ?? '')) }
  catch { return false }
}

/** Is this participant lending their machine to the swarm? */
export const isLendingModels = (): boolean => readFlag(PEER_OFFER_STORAGE_KEY)

/** Turn lending on or off. The offer stops being renewed either way. */
export const setLendingModels = (on: boolean): void => {
  try { globalThis.localStorage?.setItem(PEER_OFFER_STORAGE_KEY, on ? 'true' : 'false') } catch { /* session */ }
  EffectBus.emit('peer-models:lending', { lending: on })
}

export class PeerModelsDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  override description =
    'Offers this machine’s local models to the swarm when idle, and turns other participants’ offers into providers'

  protected override listens = ['peer-models:lend', 'llm:local-used']
  protected override emits = ['peer-models:lending', 'peer-models:offers', 'toast:show']

  #initialized = false
  #myPubkey: string | null = null
  #offerSub: MeshSub | null = null
  #requestSub: MeshSub | null = null
  #replySub: MeshSub | null = null
  #offerTimer: ReturnType<typeof setInterval> | null = null

  /** Live offers by peer pubkey → the provider ids they produced. */
  readonly #offered = new Map<string, { ids: string[]; expiresAt: number }>()
  /** Requests in flight, by job id, on the ASKING side. */
  readonly #waiting = new Map<string, (result: { ok: boolean; payload: Record<string, unknown> }) => void>()
  /** Jobs this machine is currently running for peers. */
  #serving = 0
  /** When the participant last used a local model themselves. */
  #ownUseAt = 0
  /** Offers already turned into providers this session (dedup of replays). */
  readonly #seenOffers = new Set<string>()

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // The dispatch's peer transport IS this drone. Installed even before the
    // mesh is up: a call that arrives early gets an honest "no offer" rather
    // than a URL error from a fetch that should never have been attempted.
    setPeerModelCaller((provider, request, signal) => this.#askPeer(provider, request, signal))

    this.onEffect<{ on?: boolean }>('peer-models:lend', p => {
      setLendingModels(p?.on !== false)
      void this.#publishOffer()
    })
    // The dispatch stamps this whenever the participant runs a local model
    // themselves — their work is why the cooldown exists.
    this.onEffect('llm:local-used', () => { this.#ownUseAt = Date.now() })

    await this.#resubscribe()
    EffectBus.on('mesh:public-changed', () => void this.#resubscribe())
    EffectBus.on('mesh:room', () => void this.#resubscribe())
    EffectBus.on('mesh:secret', () => void this.#resubscribe())

    // Renew while the tab is open; expire what peers stopped renewing.
    this.#offerTimer = setInterval(() => {
      void this.#publishOffer()
      this.#expireOffers()
    }, OFFER_REPUBLISH_MS)
  }

  // ── addressing ──────────────────────────────────────────

  #mesh = (): MeshLike | undefined => ioc()?.get<MeshLike>(MESH_KEY)

  /** Channel sigs, derived exactly like feedback-swarm's: a label, scoped to
   *  the room+secret, so every participant in one room computes the same
   *  address with no exchange. The broadcast channel names no peer. */
  async #channel(label: string, pubkey = ''): Promise<string> {
    const sig = ioc()?.get<SignatureStoreLike>(SIGSTORE_KEY)
    const room = ioc()?.get<ValueLike>(ROOM_KEY)?.value ?? ''
    const secret = ioc()?.get<ValueLike>(SECRET_KEY)?.value ?? ''
    if (!sig?.signText || !room || !secret) return ''
    if (pubkey && !HEX64.test(pubkey)) return ''
    try { return await sig.signText(`${label}:${pubkey}\0${room}\0${secret}`) } catch { return '' }
  }

  async #me(): Promise<string> {
    if (this.#myPubkey) return this.#myPubkey
    const key = await ioc()?.get<SignerLike>(SIGNER_KEY)?.getPublicKeyHex?.() ?? null
    this.#myPubkey = key && HEX64.test(key) ? key : null
    return this.#myPubkey ?? ''
  }

  async #resubscribe(): Promise<void> {
    const mesh = this.#mesh()
    const me = await this.#me()
    this.#offerSub?.close(); this.#offerSub = null
    this.#requestSub?.close(); this.#requestSub = null
    this.#replySub?.close(); this.#replySub = null
    if (!mesh || !me) return

    const offers = await this.#channel('peer-models')
    if (offers) this.#offerSub = mesh.subscribe(offers, e => void this.#onOffer(e))

    // Requests addressed to me — only meaningful while lending, but the
    // subscription is cheap and a refusal is a better answer than silence.
    const inbox = await this.#channel('peer-model-request', me)
    if (inbox) this.#requestSub = mesh.subscribe(inbox, e => void this.#onRequest(e))

    const replies = await this.#channel('peer-model-reply', me)
    if (replies) this.#replySub = mesh.subscribe(replies, e => this.#onReply(e))

    void this.#publishOffer()
  }

  // ── the lending side ────────────────────────────────────

  /** The local providers this machine may lend: registered, usable without a
   *  key, and reachable from here. A keyed provider is never in this list. */
  #lendableProviders(): LlmProviderDescriptor[] {
    return llmProviderRegistry().all().filter(p =>
      p.transport === 'browser-http' && p.requiresKey === false)
  }

  /** Am I free to answer for someone else right now? */
  #available(): boolean {
    return isLendingModels()
      && this.#serving < MAX_CONCURRENT_JOBS
      && Date.now() - this.#ownUseAt > OWN_USE_COOLDOWN_MS
  }

  async #publishOffer(): Promise<void> {
    const mesh = this.#mesh()
    const me = await this.#me()
    if (!mesh || !me) return
    // Not lending, or nothing lendable → publish NOTHING. Silence is how an
    // offer is withdrawn; the last one expires on its own.
    if (!isLendingModels()) return
    const models = this.#lendableProviders().flatMap(p =>
      p.models.map(m => ({ name: m.name, id: m.id, tier: m.tier })))
    if (!models.length) return

    const channel = await this.#channel('peer-models')
    if (!channel) return
    const exp = Math.floor(Date.now() / 1000) + OFFER_TTL_SEC
    const payload: OfferPayload = { label: this.#label(), models }
    await mesh.publish(PEER_MODEL_OFFER_KIND, channel, payload,
      [['d', `${channel}:${me}`], ['expiration', String(exp)]])
  }

  #label(): string {
    try {
      const name = String(globalThis.localStorage?.getItem('hc:display-name') ?? '').trim()
      if (name) return name
    } catch { /* no storage */ }
    return 'a participant'
  }

  /** A peer asked this machine to answer. */
  async #onRequest(evt: MeshEvt): Promise<void> {
    const from = String(evt.event?.pubkey ?? '')
    const payload = (evt.payload ?? {}) as Record<string, unknown>
    const jobId = String(payload['jobId'] ?? '')
    if (!HEX64.test(from) || !jobId) return
    const me = await this.#me()
    if (from === me) return                       // my own request, replayed

    const reply = (body: Record<string, unknown>): Promise<void> =>
      this.#reply(from, { jobId, ...body })

    if (!this.#available()) { void reply({ ok: false, error: 'busy' }); return }

    const messages = Array.isArray(payload['messages']) ? payload['messages'] as unknown[] : []
    const turns = messages
      .map(m => ({
        role: String((m as { role?: unknown })?.role ?? 'user') === 'assistant' ? 'assistant' as const : 'user' as const,
        content: String((m as { content?: unknown })?.content ?? ''),
      }))
      .filter(m => m.content)
    const size = turns.reduce((n, m) => n + m.content.length, 0)
    if (!turns.length || size > MAX_PROMPT_CHARS) {
      void reply({ ok: false, error: turns.length ? 'too long' : 'empty' })
      return
    }

    const wanted = String(payload['model'] ?? '')
    const provider = this.#lendableProviders()
      .find(p => p.models.some(m => m.id === wanted || m.name === wanted))
    if (!provider) { void reply({ ok: false, error: 'no such model here' }); return }

    this.#serving++
    try {
      // Imported lazily: the dispatch pulls in every vendor adapter, and a
      // shell that never serves a peer should not pay for that at boot.
      const { callModel } = await import('../assistant/llm-dispatch.js')
      const result = await callModel({
        providerId: provider.id,
        model: wanted,
        messages: turns,
        system: typeof payload['system'] === 'string' ? payload['system'] as string : undefined,
        maxTokens: Math.min(MAX_PEER_TOKENS, Number(payload['maxTokens']) || MAX_PEER_TOKENS),
      })
      await reply({
        ok: true,
        text: result.text,
        model: result.model,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
    } catch (err) {
      // The host's own error text can name their filesystem or their host —
      // a peer gets the fact, not the diagnostics.
      console.warn('[peer-models] a peer request failed locally:', err)
      await reply({ ok: false, error: 'the model failed here' })
    } finally {
      this.#serving--
      // Answering made this machine busy; renew the offer so the next asker
      // sees a fresh liveness claim rather than a lapsing one.
      void this.#publishOffer()
    }
  }

  async #reply(to: string, payload: Record<string, unknown>): Promise<void> {
    const mesh = this.#mesh()
    const me = await this.#me()
    const channel = await this.#channel('peer-model-reply', to)
    if (!mesh || !me || !channel) return
    const exp = Math.floor(Date.now() / 1000) + REQUEST_TTL_SEC
    await mesh.publish(PEER_MODEL_REPLY_KIND, channel, payload,
      [['d', `${channel}:${me}:${String(payload['jobId'] ?? '')}`], ['expiration', String(exp)]])
  }

  // ── the asking side ─────────────────────────────────────

  /** Someone's offer arrived: turn it into providers, or refresh its clock. */
  async #onOffer(evt: MeshEvt): Promise<void> {
    const from = String(evt.event?.pubkey ?? '')
    if (!HEX64.test(from)) return
    const me = await this.#me()
    if (from === me) return                       // my own offer, echoed back

    const payload = (evt.payload ?? {}) as OfferPayload
    const models = (Array.isArray(payload.models) ? payload.models : [])
      .map(m => ({
        name: String(m?.name ?? '').trim(),
        id: String(m?.id ?? '').trim(),
        ...(m?.tier ? { tier: String(m.tier) } : {}),
      }))
      .filter(m => m.id && m.name)
      .slice(0, 24)
    if (!models.length) return

    const label = String(payload.label ?? '').trim().slice(0, 40) || 'a participant'
    const short = from.slice(0, 8)
    const id = `peer-${short}`
    const fingerprint = `${id}:${models.map(m => m.id).join(',')}`

    this.#offered.set(from, {
      ids: [id],
      expiresAt: Date.now() + OFFER_TTL_SEC * 1000,
    })

    if (this.#seenOffers.has(fingerprint)) return  // same offer, renewed
    this.#seenOffers.add(fingerprint)

    try {
      // THROUGH THE SAME VALIDATOR as a pasted spec and a domain's published
      // one. A peer is a stranger with a keyboard; nothing they send skips
      // the checks the rest of the system runs.
      const spec = parseProviderSpec({
        format: 'llm-provider@1',
        id,
        label: `${label}’s models`,
        shape: 'peer-swarm',
        peer: from,
        models,
        defaultModel: models[0].id,
        docsUrl: 'https://hypercomb.io/',
        requiresKey: false,
      })
      llmProviderRegistry().register(compileProviderSpec(spec))
      EffectBus.emit('peer-models:offers', { peers: this.#offered.size })
    } catch (err) {
      console.warn(`[peer-models] ignoring an offer from ${short}:`, err)
    }
  }

  /** Drop providers whose offer nobody renewed — the availability signal. */
  #expireOffers(): void {
    const now = Date.now()
    for (const [peer, entry] of [...this.#offered]) {
      if (entry.expiresAt > now) continue
      this.#offered.delete(peer)
      for (const id of entry.ids) llmProviderRegistry().unregister(id)
      for (const key of [...this.#seenOffers]) {
        if (key.startsWith(`${entry.ids[0]}:`)) this.#seenOffers.delete(key)
      }
    }
    EffectBus.emit('peer-models:offers', { peers: this.#offered.size })
  }

  #onReply(evt: MeshEvt): void {
    const payload = (evt.payload ?? {}) as Record<string, unknown>
    const jobId = String(payload['jobId'] ?? '')
    const settle = this.#waiting.get(jobId)
    if (!settle) return                            // not ours, or already done
    this.#waiting.delete(jobId)
    settle({ ok: payload['ok'] === true, payload })
  }

  /** The dispatch's peer transport: send the turns to the machine that owns
   *  this provider and wait for its reply. */
  async #askPeer(
    provider: LlmProviderDescriptor,
    request: LlmRequest,
    signal?: AbortSignal,
  ): Promise<LlmCallResult> {
    const peer = String(provider.peer ?? '')
    const mesh = this.#mesh()
    const me = await this.#me()
    if (!HEX64.test(peer) || !mesh || !me) {
      throw new Error(`[${provider.id}] the swarm is not available here`)
    }
    const channel = await this.#channel('peer-model-request', peer)
    if (!channel) throw new Error(`[${provider.id}] no shared room with that participant`)

    // A job id nobody else can guess or collide with — the reply is matched
    // on it, and a peer that answers a job we never asked is ignored.
    const jobId = await this.#jobId()
    const exp = Math.floor(Date.now() / 1000) + REQUEST_TTL_SEC
    const sent = mesh.publish(PEER_MODEL_REQUEST_KIND, channel, {
      jobId,
      model: request.model,
      messages: request.messages.map(m => ({ role: m.role, content: m.content })),
      ...(request.system ? { system: request.system } : {}),
      maxTokens: Math.min(MAX_PEER_TOKENS, request.maxTokens ?? MAX_PEER_TOKENS),
    }, [['d', `${channel}:${me}:${jobId}`], ['expiration', String(exp)]])

    const answer = await new Promise<{ ok: boolean; payload: Record<string, unknown> } | null>(resolve => {
      const timer = setTimeout(() => { this.#waiting.delete(jobId); resolve(null) }, REPLY_TIMEOUT_MS)
      const onAbort = (): void => { clearTimeout(timer); this.#waiting.delete(jobId); resolve(null) }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.#waiting.set(jobId, value => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      })
      void sent
    })

    if (!answer) throw new Error(`[${provider.id}] the participant did not answer in time`)
    if (!answer.ok) {
      throw new Error(`[${provider.id}] ${String(answer.payload['error'] ?? 'declined')}`)
    }
    return {
      text: String(answer.payload['text'] ?? ''),
      stopReason: String(answer.payload['stopReason'] ?? 'stop'),
      inputTokens: Number(answer.payload['inputTokens']) || 0,
      outputTokens: Number(answer.payload['outputTokens']) || 0,
      model: String(answer.payload['model'] ?? request.model),
    }
  }

  async #jobId(): Promise<string> {
    const bytes = new Uint8Array(16)
    globalThis.crypto?.getRandomValues?.(bytes)
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  }

  /** Peers currently offering, for a surface that wants to say so. */
  offeringPeers(): number { return this.#offered.size }

  override dispose(): void {
    if (this.#offerTimer) clearInterval(this.#offerTimer)
    this.#offerSub?.close()
    this.#requestSub?.close()
    this.#replySub?.close()
    setPeerModelCaller(null)
    super.dispose?.()
  }
}

const _peerModels = new PeerModelsDrone()
window.ioc.register('@diamondcoreprocessor.com/PeerModelsDrone', _peerModels)

/** Signature-shaped ids only, for the harness and any future caller. */
export const isPeerId = (value: string): boolean => isSignature(String(value ?? ''))
