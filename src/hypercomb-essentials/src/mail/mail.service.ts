// mail/mail.service.ts
//
// THE MAIL CLIENT'S HANDS. It talks to the mail Worker on the domain's own host
// (hypercomb-relay/mail-worker/, documentation/inbound-mail.md): which addresses
// does this key own, what is in a box, one message, and send. Every request is
// signed (NIP-98) by the hive's NostrSigner; every message is opened through it.
//
// ── THE KEY NEVER ARRIVES HERE ──────────────────────────────────────────────
//
// Signing and the one decryption step both go through the signer, which keeps
// the secret to itself (or hands the work to a NIP-07 extension). This file
// reads no key, stores nothing, and caches nothing: a message is decrypted into
// memory when it is opened and is gone when the window closes.
//
// ── OPENING MAIL NEVER MINTS AN IDENTITY ────────────────────────────────────
//
// The signer will mint a fresh device key on first use. Reading mail must not be
// the act that makes the participant an author, so a key is checked FIRST
// (knownPublicKeyHex, which never mints) and a device without one is told so.
//
// ── ONLY OUR OWN HOST ───────────────────────────────────────────────────────
//
// The origin is the domain's own host. No other host is contacted
// (no-third-party-requests.md).

import { nip98Authorization, nip98Template } from '@hypercomb/core'
import { fetchWithDeadline } from '../sharing/bounded-fetch.js'
import { openEnvelope, openMetaToken, type Decrypt, type MailMeta } from './envelope.js'
import { parseMail, type ParsedMail } from './mime.js'

export const MAIL_ORIGIN = 'https://hypercomb.com'
export const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

export type Folder = 'box' | 'sent'

export interface MailListItem {
  readonly sig: string
  readonly at: number
  readonly meta: MailMeta | null
}

/** What the Worker keeps of a message this participant sent (sealed, in their Sent folder). */
export interface SentRecord {
  readonly id: string | null
  readonly from: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html: string
  readonly inReplyTo: string | null
  readonly references: string | null
  readonly at: number
}

export interface SendRequest {
  readonly from: string
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject: string
  readonly text: string
  readonly inReplyTo?: string
  readonly references?: string
}

export type MailErrorCode =
  | 'no-signer'     // the hive's signer is not loaded
  | 'no-key'        // this device holds no key (and none is made for reading mail)
  | 'unauthorized'  // the host does not know this key as that address's owner
  | 'not-found'
  | 'limit'         // a daily or rate limit
  | 'refused'       // the host or Cloudflare refused the message itself
  | 'bad-message'   // sealed bytes that do not open
  | 'unavailable'   // the host did not answer

export class MailError extends Error {
  constructor(readonly code: MailErrorCode, readonly detail = '') {
    super(detail || code)
    this.name = 'MailError'
  }
}

/** THE SEAM. Replaced wholesale in the spec, so no network and no signer are reached there. */
export interface MailSigner {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<unknown>
  nip44Decrypt(peerPubkeyHex: string, payload: string): Promise<string | null>
  getPublicKeyHex(): Promise<string | null>
  knownPublicKeyHex(): Promise<string | null>
}

export interface MailIo {
  readonly fetch: (url: string, init: RequestInit, options?: { timeoutMs?: number }) => Promise<Response>
  readonly signer: () => MailSigner | undefined
  /** Is a NIP-07 browser extension answering for the key? (Then asking it is the only way to know it.) */
  readonly extension: () => boolean
  readonly now: () => number
}

const defaultIo = (): MailIo => ({
  fetch: fetchWithDeadline,
  signer: () => (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(SIGNER_KEY) as MailSigner | undefined,
  extension: () => !!(window as { nostr?: unknown }).nostr,
  now: () => Date.now(),
})

const enc = new TextEncoder()
const dec = new TextDecoder()
const SIG = /^[a-f0-9]{64}$/

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')

/** What a refusal from the host means to the person, whatever words the host used. */
async function refusal(response: Response): Promise<MailError> {
  let said = ''
  try { said = (await response.text()).slice(0, 200) } catch { /* no body */ }
  let detail = said
  try { const parsed = JSON.parse(said) as { error?: string }; if (parsed?.error) detail = parsed.error } catch { /* plain text */ }
  switch (response.status) {
    case 401: case 403: return new MailError('unauthorized', detail)
    case 404: return new MailError('not-found', detail)
    case 429: return new MailError('limit', detail)
    case 413: case 415: case 422: return new MailError('refused', detail)
    default: return new MailError('unavailable', detail)
  }
}

export class MailService extends EventTarget {
  readonly #io: MailIo
  readonly #origin: string

  constructor(io: Partial<MailIo> = {}, origin: string = MAIL_ORIGIN) {
    super()
    this.#io = { ...defaultIo(), ...io }
    this.#origin = origin
  }

  /** The signer, once a key is known to be held. Never mints one. */
  async #signer(): Promise<MailSigner> {
    const signer = this.#io.signer()
    if (!signer) throw new MailError('no-signer')
    const held = this.#io.extension() ? await signer.getPublicKeyHex() : await signer.knownPublicKeyHex()
    if (!held) throw new MailError('no-key')
    return signer
  }

  /** This device's public key, to show so a host can be told to recognise it. Null when none is held. */
  async publicKey(): Promise<string | null> {
    try {
      const signer = this.#io.signer()
      if (!signer) return null
      return this.#io.extension() ? await signer.getPublicKeyHex() : await signer.knownPublicKeyHex()
    } catch { return null }
  }

  async #request(path: string, init: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<Response> {
    const signer = await this.#signer()
    const url = new URL(path, this.#origin).href
    const method = init.method ?? 'GET'
    const body = init.body === undefined ? undefined : enc.encode(init.body)
    const payload = body ? await sha256Hex(body) : undefined

    let signed: unknown
    try { signed = await signer.signEvent(nip98Template(url, method, this.#io.now() / 1000, payload)) } catch { throw new MailError('no-key') }
    const headers: Record<string, string> = { authorization: nip98Authorization(signed) }
    if (body) headers['content-type'] = 'application/json'

    let response: Response
    try { response = await this.#io.fetch(url, { method, headers, body: body as BodyInit | undefined }, { timeoutMs: init.timeoutMs }) } catch { throw new MailError('unavailable') }
    if (!response.ok) throw await refusal(response)
    return response
  }

  /** The addresses this key owns on the host. Empty means the host does not know this key. */
  async addresses(): Promise<string[]> {
    const body = await (await this.#request('/mail/me')).json() as { addresses?: unknown }
    return Array.isArray(body.addresses) ? body.addresses.filter((a): a is string => typeof a === 'string') : []
  }

  /** One page of a box, newest first. The metadata is opened here; the server never saw it. */
  async list(address: string, folder: Folder, cursor?: string | null): Promise<{ items: MailListItem[]; cursor: string | null }> {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('cursor', cursor)
    const response = await this.#request(`/mail/${folder}/${encodeURIComponent(address)}?${query}`)
    const body = await response.json() as { items?: { sig: string; at: number; meta: string }[]; cursor?: string | null }
    const signer = await this.#signer()
    const decrypt: Decrypt = (peer, payload) => signer.nip44Decrypt(peer, payload)
    const items = await Promise.all((body.items ?? []).filter(item => SIG.test(String(item?.sig))).map(async item => ({
      sig: item.sig, at: Number(item.at) || 0, meta: await openMetaToken(String(item.meta ?? ''), decrypt),
    })))
    items.sort((a, b) => (b.meta?.at ?? b.at) - (a.meta?.at ?? a.at))
    return { items, cursor: body.cursor ?? null }
  }

  async #open(address: string, folder: Folder, sig: string): Promise<Uint8Array> {
    if (!SIG.test(sig)) throw new MailError('not-found')
    const response = await this.#request(`/mail/${folder}/${encodeURIComponent(address)}/${sig}`, { timeoutMs: 20_000 })
    const signer = await this.#signer()
    try {
      return (await openEnvelope(new Uint8Array(await response.arrayBuffer()), (peer, payload) => signer.nip44Decrypt(peer, payload))).bytes
    } catch (error) {
      throw new MailError('bad-message', error instanceof Error ? error.message : '')
    }
  }

  /** A received message, opened and read. */
  async read(address: string, sig: string): Promise<ParsedMail> {
    return parseMail(await this.#open(address, 'box', sig))
  }

  /** A message this participant sent. */
  async readSent(address: string, sig: string): Promise<SentRecord> {
    try { return JSON.parse(dec.decode(await this.#open(address, 'sent', sig))) as SentRecord } catch (error) {
      throw error instanceof MailError ? error : new MailError('bad-message')
    }
  }

  /** Send as `request.from`. The host sends it and files a sealed copy in Sent. */
  async send(request: SendRequest): Promise<{ messageId: string | null; sig: string | null }> {
    const body = JSON.stringify({
      from: request.from,
      to: request.to,
      ...(request.cc?.length ? { cc: request.cc } : {}),
      ...(request.bcc?.length ? { bcc: request.bcc } : {}),
      subject: request.subject,
      text: request.text,
      ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
      ...(request.references ? { references: request.references } : {}),
    })
    const out = await (await this.#request('/mail/send', { method: 'POST', body, timeoutMs: 20_000 })).json() as { messageId?: string | null; sig?: string | null }
    this.dispatchEvent(new CustomEvent('change', { detail: { sent: true } }))
    return { messageId: out.messageId ?? null, sig: out.sig ?? null }
  }
}
