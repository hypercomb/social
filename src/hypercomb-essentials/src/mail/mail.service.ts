// mail/mail.service.ts
//
// THE MAIL CLIENT'S HANDS. It talks to the mail Worker (hypercomb-relay/
// mail-worker/, documentation/inbound-mail.md, mail-plan.md §3): which addresses
// does this key own (and under what names), what is in a box, one message, its
// marks, forgetting it, drafts, and send. Every request is signed (NIP-98) by
// the hive's NostrSigner; every message is opened through it.
//
// ── THE KEY NEVER ARRIVES HERE ──────────────────────────────────────────────
//
// Signing and the one decryption step both go through the signer, which keeps
// the secret to itself (or hands the work to a NIP-07 extension). This file
// reads no key, stores nothing, and caches no mail: a message is decrypted into
// memory when it is opened and is gone when the window closes. The one thing it
// remembers is ROUTING — which host answered for which address — so a second
// call does not ask a host that already said "not here".
//
// ── OPENING MAIL NEVER MINTS AN IDENTITY ────────────────────────────────────
//
// The signer will mint a fresh device key on first use. Reading mail must not be
// the act that makes the participant an author, so a key is checked FIRST
// (knownPublicKeyHex, which never mints) and a device without one is told so.
//
// ── ONLY MAIL HOSTS ─────────────────────────────────────────────────────────
//
// Any zone may run the Worker, so an address is asked of its own domain first
// (`https://<domain>`) and of the hosts this service was given after
// (hypercomb.com by default). `addresses()` asks only the given hosts, and an
// address it learned stays with the host that claimed it. No other host is
// contacted (no-third-party-requests.md).

import { nip98Authorization, nip98Template } from '@hypercomb/core'
import { fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { openEnvelope, openItemMeta, type Decrypt, type MailMeta, type MailWrap } from './envelope.js'
import { parseMail, type ParsedMail } from './mime.js'

export const MAIL_ORIGIN = 'https://hypercomb.com'
export const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

export type Folder = 'box' | 'sent' | 'drafts'

/** What the Worker takes and refuses, so the window can say so before anything is sent. */
export const MAIL_LIMITS = Object.freeze({
  attachments: 10,
  attachmentBytes: 6 * 1024 * 1024, // decoded, all together
  recipients: 20,
  // 6 MiB of attachments is 8 MiB of base64, with room left for the text.
  sendBytes: 10 * 1024 * 1024,
  draftBytes: 1024 * 1024,
})

/**
 * What this client reads of a host's answer, whatever the host sends. The host is not trusted with
 * the participant's memory or their signer: a page is cut to the rows asked for, an answer is read
 * through a counter that stops at its cap, and an error says at most a sentence.
 */
export const MAIL_READ_CAPS = Object.freeze({
  /** The largest message the Worker stores (its MAX_STORE_BYTES default). */
  messageBytes: 10 * 1024 * 1024,
  /** An envelope is the message plus its header and tag; this is room for the header. */
  envelopeSlack: 64 * 1024,
  /** A list page or /mail/me: 100 rows of at most 2 KiB metadata each is a fraction of this. */
  answerBytes: 2 * 1024 * 1024,
  /** An error body; 200 characters of it are kept. */
  errorBytes: 1024,
  /** The rows one list page asks for. */
  rows: 100,
  /** Addresses taken from /mail/me, across every host. */
  addresses: 50,
})

/** The owner's marks on a message. Plain on the host: they say read/hidden/flagged, never what the mail says. */
export interface MailMarks {
  readonly read?: boolean
  readonly hidden?: boolean
  readonly flagged?: boolean
  readonly deletable?: boolean
  /** When they last changed, ms (the host stamps it). */
  readonly at?: number
}

export type MarkName = 'read' | 'hidden' | 'flagged' | 'deletable'

export interface MailListItem {
  readonly sig: string
  readonly at: number
  /** Which envelope sealed it: 1 (older objects) or 2. */
  readonly v: 1 | 2
  /** Opened here; null when it does not open with this key. */
  readonly meta: MailMeta | null
  /** Null when the owner never marked it (and always for drafts). */
  readonly marks: MailMarks | null
  /** v2 only: the owners' wraps of the message key, public, needed to open the metadata. */
  readonly wraps?: readonly MailWrap[]
}

/** What a key may do at an address. The host refuses the rest with 403, so a window leaves those buttons out. */
export type MailAct = 'read' | 'mark' | 'draft' | 'delete' | 'send'
export const MAIL_ACTS: readonly MailAct[] = Object.freeze(['read', 'mark', 'draft', 'delete', 'send'] as MailAct[])

/** An address this key owns, the name it sends under there, the host that serves it, and what this key may do there. */
export interface Mailbox {
  readonly address: string
  readonly name?: string
  readonly host: string
  /** A host from before roles says nothing, and then every key it knows could do everything: all five. */
  readonly can: readonly MailAct[]
}

/**
 * `MailError('conflict')` details the window words differently from "hide it first". Every write is
 * spent once on the host (a signed request seen again answers 409 and does nothing), so these mean
 * the host already acted on this very request: a send that already went, a mark or delete already made.
 */
export const ALREADY_SENT = 'already sent'
export const ALREADY_DONE = 'already done'

/** An attachment as the participant picked it: bytes, or base64 already. */
export interface MailAttachmentInput {
  readonly filename: string
  readonly type: string
  readonly content: Uint8Array | string
}

/** An attachment as the host keeps it (base64). `sentAttachmentBytes` turns it back into bytes. */
export interface SentAttachment {
  readonly filename: string
  readonly type: string
  readonly content: string
}

/** What the Worker keeps of a message this participant sent (sealed, in their Sent folder). */
export interface SentRecord {
  readonly id: string | null
  readonly from: string
  /** The name it went out under, when the host has one for the address. */
  readonly name?: string | null
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly bcc: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html: string
  readonly inReplyTo: string | null
  readonly references: string | null
  /** Always an array in copies the v2 Worker filed; missing on older ones. */
  readonly attachments?: readonly SentAttachment[]
  readonly at: number
}

export interface SendRequest {
  readonly from: string
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject: string
  readonly text: string
  readonly html?: string
  readonly replyTo?: string
  readonly inReplyTo?: string
  readonly references?: string
  readonly attachments?: readonly MailAttachmentInput[]
}

/** A draft as it is kept: the window's own JSON, sealed by the host like a sent copy. */
export interface MailDraft {
  readonly to?: readonly string[] | string
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject?: string
  readonly text?: string
  readonly html?: string
  readonly inReplyTo?: string
  readonly references?: string
  readonly attachments?: readonly SentAttachment[]
  readonly at?: number
}

export interface MailDraftInput extends Omit<MailDraft, 'attachments'> {
  readonly attachments?: readonly MailAttachmentInput[]
}

/** How far a list has got opening its rows: `opened` of `total`. */
export interface ListProgress {
  readonly opened: number
  readonly total: number
}

export type MailErrorCode =
  | 'no-signer'     // the hive's signer is not loaded
  | 'no-key'        // this device holds no key (and none is made for reading mail)
  | 'unauthorized'  // the host does not know this key as that address's owner
  | 'not-found'
  | 'limit'         // a daily or rate limit
  | 'refused'       // the host or Cloudflare refused the request itself (bad input, too large, not allowed here)
  | 'bad-message'   // sealed bytes that do not open
  | 'unavailable'   // the host did not answer (or is not a mail host)
  | 'conflict'      // delete refused: hide it and mark it deletable first; or ALREADY_SENT / ALREADY_DONE
  | 'forbidden'     // the host knows this key at that address, but not for this act (detail: the act)

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
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const MARK_NAMES: readonly MarkName[] = ['read', 'hidden', 'flagged', 'deletable']
// Each row's metadata is one ask of the signer (an extension may prompt for each), so they are
// opened a few at a time rather than all at once.
const OPEN_AT_ONCE = 4

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')

const toBase64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

const base64Bytes = (text: string): number =>
  text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0)

/** A kept attachment's bytes (for a download link); null when its content is not base64. */
export function sentAttachmentBytes(attachment: Pick<SentAttachment, 'content'>): Uint8Array | null {
  try { return Uint8Array.from(atob(String(attachment.content).replace(/\s+/g, '')), c => c.charCodeAt(0)) } catch { return null }
}

/** How many rows of an inbox page are unread: never marked read, and not hidden. */
export const unreadCount = (items: readonly Pick<MailListItem, 'marks'>[]): number =>
  items.filter(item => !item.marks?.read && !item.marks?.hidden).length

/** Attachments for the wire: base64, the bytes counted, the caps checked before a byte is sent. */
function wireAttachments(list: readonly MailAttachmentInput[] | undefined): SentAttachment[] {
  if (!list?.length) return []
  if (list.length > MAIL_LIMITS.attachments) throw new MailError('refused', 'too many attachments')
  let total = 0
  return list.map(item => {
    const content = typeof item.content === 'string' ? item.content.replace(/\s+/g, '') : toBase64(item.content)
    total += typeof item.content === 'string' ? base64Bytes(content) : item.content.length
    if (total > MAIL_LIMITS.attachmentBytes) throw new MailError('refused', 'attachments too large')
    return { filename: item.filename, type: item.type, content }
  })
}

const marksOf = (value: unknown): MailMarks | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const out: Record<string, boolean | number> = {}
  for (const name of MARK_NAMES) if (typeof source[name] === 'boolean') out[name] = source[name] as boolean
  if (typeof source['at'] === 'number' && Number.isFinite(source['at'])) out['at'] = source['at'] as number
  return out as MailMarks
}

// What /mail/me says this key may do at `address`. A host that answers no `can` at all predates
// roles, when every key it knew could do everything; a host that answers `can` but leaves the
// address out, or sends something that is not a list, gets read only (the Worker's own default).
const actsOf = (can: Record<string, unknown> | null, address: string): readonly MailAct[] => {
  if (!can) return MAIL_ACTS
  const listed = can[address] ?? can[address.toLowerCase()]
  if (!Array.isArray(listed)) return ['read']
  return MAIL_ACTS.filter(act => listed.includes(act))
}

const randomHex = (bytes: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('')

// A Sent copy or a draft opened here is the host's JSON, and the window draws it as it comes: a
// `to` that is a string or a `cc` that is null would throw mid-render. So each is given its shape
// here, as `marksOf` gives the marks theirs: lists of strings, strings, attachments of strings,
// and anything else left out.
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const strs = (value: unknown): string[] =>
  typeof value === 'string' ? (value ? [value] : []) : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const attachmentsOf = (value: unknown): SentAttachment[] =>
  (Array.isArray(value) ? value : []).flatMap(item => {
    const a = item as Partial<Record<'filename' | 'type' | 'content', unknown>> | null
    if (!a || typeof a !== 'object' || typeof a.content !== 'string') return []
    return [{ filename: str(a.filename) ?? '', type: str(a.type) || 'application/octet-stream', content: a.content }]
  })

const sentRecordOf = (raw: Record<string, unknown>): SentRecord => ({
  id: str(raw['id']) ?? null,
  from: str(raw['from']) ?? '',
  ...(raw['name'] !== undefined ? { name: str(raw['name']) ?? null } : {}),
  to: strs(raw['to']),
  cc: strs(raw['cc']),
  bcc: strs(raw['bcc']),
  subject: str(raw['subject']) ?? '',
  text: str(raw['text']) ?? '',
  html: str(raw['html']) ?? '',
  inReplyTo: str(raw['inReplyTo']) ?? null,
  references: str(raw['references']) ?? null,
  ...(raw['attachments'] !== undefined ? { attachments: attachmentsOf(raw['attachments']) } : {}),
  at: num(raw['at']) ?? 0,
})

const draftOf = (raw: Record<string, unknown>): MailDraft => {
  const out: Record<string, unknown> = {}
  // A draft's `to` may be what the participant typed (one string) or a list; either is kept as it was.
  if (typeof raw['to'] === 'string') out['to'] = raw['to']
  else if (raw['to'] !== undefined) out['to'] = strs(raw['to'])
  for (const key of ['cc', 'bcc'] as const) if (raw[key] !== undefined) out[key] = strs(raw[key])
  for (const key of ['subject', 'text', 'html', 'inReplyTo', 'references'] as const) {
    const value = str(raw[key])
    if (value !== undefined) out[key] = value
  }
  if (raw['attachments'] !== undefined) out['attachments'] = attachmentsOf(raw['attachments'])
  const at = num(raw['at'])
  if (at !== undefined) out['at'] = at
  return out as MailDraft
}

/** The origin an address's own domain would serve mail from; null for anything that is not a hostname. */
const domainOrigin = (address: string): string | null => {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase()
  return HOSTNAME.test(domain) ? `https://${domain}` : null
}

const originOf = (host: string): string => {
  try { return new URL(host).origin } catch { return new URL(`https://${host}`).origin }
}

/**
 * A body, read through a counter. Past `cap` the read stops and the rest is never pulled: with
 * `truncate` the first `cap` bytes are the answer, otherwise it is `tooLarge`. A Content-Length
 * already past the cap stops it before a byte is read.
 */
async function readCapped(response: Response, cap: number, tooLarge: MailError | 'truncate'): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (tooLarge !== 'truncate' && Number.isFinite(declared) && declared > cap) {
    try { await response.body?.cancel() } catch { /* already closed */ }
    throw tooLarge
  }
  // No stream to count (a hand-made Response in a test, a null body): it is already in memory.
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer())
    if (all.length <= cap) return all
    if (tooLarge === 'truncate') return all.slice(0, cap)
    throw tooLarge
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (total + value.length > cap) {
        if (tooLarge === 'truncate') chunks.push(value.subarray(0, cap - total))
        total = cap + 1
        try { await reader.cancel() } catch { /* the stream is gone either way */ }
        break
      }
      chunks.push(value)
      total += value.length
    }
  } finally {
    try { reader.releaseLock() } catch { /* cancelled */ }
  }
  if (total > cap && tooLarge !== 'truncate') throw tooLarge
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}

/** What a refusal from the host means to the person, whatever words the host used. */
async function refusal(response: Response): Promise<MailError> {
  let said = ''
  try { said = dec.decode(await readCapped(response, MAIL_READ_CAPS.errorBytes, 'truncate')) } catch { /* no body */ }
  let detail = said
  try { const parsed = JSON.parse(said) as { error?: string }; if (typeof parsed?.error === 'string') detail = parsed.error } catch { /* plain text */ }
  detail = detail.slice(0, 200)
  // 401 text is the same "not authorized" for every stranger on purpose (it must not tell which
  // addresses exist), so nothing is read from it. A 403 that names an act is a key with a role.
  const may = /may not (read|mark|draft|delete|send)\b/i.exec(detail)
  switch (response.status) {
    case 401: return new MailError('unauthorized', detail)
    case 403: return may ? new MailError('forbidden', may[1]!.toLowerCase()) : new MailError('unauthorized', detail)
    case 404: return new MailError('not-found', detail)
    case 409: return new MailError('conflict', /already used/i.test(detail) ? ALREADY_DONE : detail)
    case 429: return new MailError('limit', detail)
    case 400: case 405: case 413: case 415: case 422: return new MailError('refused', detail)
    default: return new MailError('unavailable', detail)
  }
}

// When an address is not yet known to a host, these answers mean "not here", and the next host is
// asked; any other answer came from a host that serves the address, and is the answer. Of the "not
// here" answers the most telling one is passed on: a host that does not know the key says what the
// participant can act on (give the operator their key); a host that never answered says least.
const PASSES_ON: Partial<Record<MailErrorCode, number>> = { unauthorized: 2, 'not-found': 1, unavailable: 0 }
// A send that timed out may have gone: asking a second host could send it twice. Only a host that
// plainly refused it (it does not know the key, or has no such route) lets the next one be asked.
const SEND_PASSES_ON: Partial<Record<MailErrorCode, number>> = { unauthorized: 2, 'not-found': 1 }

interface Held { readonly signer: MailSigner; readonly pub: string }

export class MailService extends EventTarget {
  readonly #io: MailIo
  readonly #hosts: readonly string[]
  // Routing, not mail: the host that answered for an address. Learned from /mail/me, or from the
  // first host that served it.
  readonly #served = new Map<string, string>()

  /** `hosts`: the mail hosts to ask (one origin, or a list), hypercomb.com when none is given. */
  constructor(io: Partial<MailIo> = {}, hosts: string | readonly string[] = [MAIL_ORIGIN]) {
    super()
    this.#io = { ...defaultIo(), ...io }
    const list = (typeof hosts === 'string' ? [hosts] : hosts).map(originOf)
    this.#hosts = [...new Set(list.length ? list : [MAIL_ORIGIN])]
  }

  /** The hosts this service asks, in order. */
  get hosts(): readonly string[] { return this.#hosts }

  /** The signer and its public key, once a key is known to be held. Never mints one. */
  async #held(): Promise<Held> {
    const signer = this.#io.signer()
    if (!signer) throw new MailError('no-signer')
    const pub = this.#io.extension() ? await signer.getPublicKeyHex() : await signer.knownPublicKeyHex()
    if (!pub) throw new MailError('no-key')
    return { signer, pub: pub.toLowerCase() }
  }

  /** This device's public key, to show so a host can be told to recognise it. Null when none is held. */
  async publicKey(): Promise<string | null> {
    try {
      const signer = this.#io.signer()
      if (!signer) return null
      return this.#io.extension() ? await signer.getPublicKeyHex() : await signer.knownPublicKeyHex()
    } catch { return null }
  }

  async #request(held: Held, origin: string, path: string, init: { method?: string; body?: string; timeoutMs?: number } = {}): Promise<Response> {
    const url = new URL(path, origin).href
    const method = init.method ?? 'GET'
    const body = init.body === undefined ? undefined : enc.encode(init.body)
    const payload = body ? await sha256Hex(body) : undefined

    // Every write is spent once by its event id. Two identical writes in the same second would have
    // the same id (the signature differs, the id does not), and the second would be refused as a
    // replay — so a write carries a random nonce. A read is not spent and needs none.
    const extra = method === 'GET' ? [] : [['nonce', randomHex(16)]]
    let signed: unknown
    try { signed = await held.signer.signEvent(nip98Template(url, method, this.#io.now() / 1000, payload, extra)) } catch { throw new MailError('no-key') }
    const headers: Record<string, string> = { authorization: nip98Authorization(signed) }
    if (body) headers['content-type'] = 'application/json'

    let response: Response
    try { response = await this.#io.fetch(url, { method, headers, body: body as BodyInit | undefined }, { timeoutMs: init.timeoutMs }) } catch { throw new MailError('unavailable') }
    if (!response.ok) throw await refusal(response)
    return response
  }

  // A static host answers a path it does not have with its own page, 200 and HTML: that is a host
  // with no mail, not a broken answer.
  async #json<T>(response: Response): Promise<T> {
    if (!/json/i.test(response.headers.get('content-type') ?? '')) throw new MailError('unavailable', 'not a mail host')
    const bytes = await readCapped(response, MAIL_READ_CAPS.answerBytes, new MailError('unavailable', 'answer too large'))
    try { return JSON.parse(dec.decode(bytes)) as T } catch { throw new MailError('unavailable', 'not a mail host') }
  }

  /** Runs `act` against the host that serves `address`: the one it is known at, else its domain, then the given hosts. */
  async #at<T>(address: string, act: (origin: string) => Promise<T>, passesOn: Partial<Record<MailErrorCode, number>> = PASSES_ON): Promise<T> {
    const known = this.#served.get(address.toLowerCase())
    if (known) return act(known)
    // Only the hosts the participant gave are asked. The address's own domain goes first when it is
    // one of them, but is never contacted on its own: a signed request carries the key and the address,
    // and gmail.com is not a place the participant chose to tell that to.
    const own = domainOrigin(address)
    const candidates = own && this.#hosts.includes(own) ? [own, ...this.#hosts.filter(h => h !== own)] : [...this.#hosts]
    let best: MailError | null = null
    for (const origin of candidates) {
      try {
        const out = await act(origin)
        this.#served.set(address.toLowerCase(), origin)
        return out
      } catch (error) {
        const rank = error instanceof MailError ? passesOn[error.code] : undefined
        if (rank === undefined) throw error
        if (!best || rank > (passesOn[best.code] ?? 0)) best = error as MailError
      }
    }
    throw best ?? new MailError('unavailable')
  }

  #path(folder: Folder, address: string, sig?: string, rest = ''): string {
    return `/mail/${folder}/${encodeURIComponent(address)}${sig ? `/${sig}` : ''}${rest}`
  }

  /**
   * Every address this key owns, across the hosts, with its name and its host. A host that does not
   * answer leaves out only its own addresses; when none answers, that is the error.
   */
  async mailboxes(): Promise<Mailbox[]> {
    const held = await this.#held()
    const answers = await Promise.all(this.#hosts.map(async origin => {
      try {
        const body = await this.#json<{ addresses?: unknown; names?: unknown; can?: unknown }>(await this.#request(held, origin, '/mail/me'))
        return { origin, body }
      } catch (error) {
        return { origin, error: error instanceof MailError ? error : new MailError('unavailable') }
      }
    }))
    if (answers.every(answer => 'error' in answer)) {
      const errors = answers.map(answer => (answer as { error: MailError }).error)
      throw errors.find(e => e.code !== 'unavailable') ?? errors[0] ?? new MailError('unavailable')
    }
    const found = new Map<string, Mailbox>()
    for (const answer of answers) {
      if (!('body' in answer) || !answer.body) continue
      const names = answer.body.names && typeof answer.body.names === 'object' ? answer.body.names as Record<string, unknown> : {}
      const can = answer.body.can && typeof answer.body.can === 'object' ? answer.body.can as Record<string, unknown> : null
      const addresses = Array.isArray(answer.body.addresses)
        ? answer.body.addresses.slice(0, MAIL_READ_CAPS.addresses).filter((a): a is string => typeof a === 'string')
        : []
      for (const address of addresses) {
        const key = address.toLowerCase()
        if (found.has(key)) continue // the first host to claim an address serves it
        // Every address is listed again on every poll; a host does not get to make that thousands.
        if (found.size >= MAIL_READ_CAPS.addresses) break
        const name = typeof names[address] === 'string' && names[address] ? names[address] as string : undefined
        found.set(key, { address, host: answer.origin, can: actsOf(can, address), ...(name ? { name } : {}) })
        this.#served.set(key, answer.origin)
      }
    }
    return [...found.values()].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
  }

  /** The addresses this key owns. Empty means no host knows this key. */
  async addresses(): Promise<string[]> {
    return (await this.mailboxes()).map(box => box.address)
  }

  /**
   * One page of a folder, newest first (by the sealed `at`, else arrival: the host lists by
   * signature). Each row's metadata is opened here — the server never saw it — and `onItem` hears
   * each row the moment its metadata opens, so a window can fill in as it goes instead of waiting
   * for the slowest row.
   */
  async list(
    address: string,
    folder: Folder,
    cursor?: string | null,
    onItem?: (item: MailListItem, progress: ListProgress) => void,
  ): Promise<{ items: MailListItem[]; cursor: string | null }> {
    const held = await this.#held()
    const query = new URLSearchParams({ limit: String(MAIL_READ_CAPS.rows) })
    if (cursor) query.set('cursor', cursor)
    type Row = { sig?: unknown; at?: unknown; v?: unknown; meta?: unknown; wraps?: unknown; marks?: unknown }
    const body = await this.#at(address, async origin =>
      this.#json<{ items?: Row[]; cursor?: string | null }>(await this.#request(held, origin, `${this.#path(folder, address)}?${query}`)))
    // The rows asked for and no more, each once: every row is up to three signer asks (an extension
    // may prompt for each), so a page of 5,000 or the same row 5,000 times is the host's to keep.
    const seen = new Set<string>()
    const rows = (Array.isArray(body.items) ? body.items : [])
      .filter(row => SIG.test(String(row?.sig)) && !seen.has(String(row.sig)) && !!seen.add(String(row.sig)))
      .slice(0, MAIL_READ_CAPS.rows)
    const decrypt: Decrypt = (peer, payload) => held.signer.nip44Decrypt(peer, payload)

    let opened = 0
    const items = (await mapBounded(rows, OPEN_AT_ONCE, async row => {
      const v: 1 | 2 = Number(row.v) === 2 ? 2 : 1
      const wraps = v === 2 && Array.isArray(row.wraps) ? row.wraps as MailWrap[] : undefined
      const meta = await openItemMeta({ sig: String(row.sig), v, meta: String(row.meta ?? ''), wraps }, decrypt, held.pub)
      const item: MailListItem = { sig: String(row.sig), at: Number(row.at) || 0, v, meta, marks: marksOf(row.marks), ...(wraps ? { wraps } : {}) }
      opened++
      // A listener that throws is the window's trouble; it must not lose the page.
      try { onItem?.(item, { opened, total: rows.length }) } catch { /* the page still lands */ }
      return item
    })).filter((item): item is MailListItem => !!item)

    items.sort((a, b) => (b.meta?.at ?? b.at) - (a.meta?.at ?? a.at) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0))
    return { items, cursor: typeof body.cursor === 'string' && body.cursor ? body.cursor : null }
  }

  async #open(address: string, folder: Folder, sig: string): Promise<Uint8Array> {
    if (!SIG.test(sig)) throw new MailError('not-found')
    const held = await this.#held()
    const response = await this.#at(address, async origin => {
      const answer = await this.#request(held, origin, this.#path(folder, address, sig), { timeoutMs: 20_000 })
      if (/text\/html/i.test(answer.headers.get('content-type') ?? '')) throw new MailError('unavailable', 'not a mail host')
      return answer
    })
    let opened: { sig: string; bytes: Uint8Array }
    try {
      const envelope = await readCapped(response, MAIL_READ_CAPS.messageBytes + MAIL_READ_CAPS.envelopeSlack, new MailError('bad-message', 'message too large'))
      opened = await openEnvelope(envelope, (peer, payload) => held.signer.nip44Decrypt(peer, payload), held.pub, sig)
    } catch (error) {
      if (error instanceof MailError) throw error
      throw new MailError('bad-message', error instanceof Error ? error.message : '')
    }
    // The bytes asked for, not other bytes the host chose to hand back.
    if (opened.sig !== sig) throw new MailError('bad-message', 'signature mismatch')
    return opened.bytes
  }

  async #openJson<T>(address: string, folder: Folder, sig: string): Promise<T> {
    const bytes = await this.#open(address, folder, sig)
    let value: unknown
    try { value = JSON.parse(dec.decode(bytes)) } catch { throw new MailError('bad-message') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MailError('bad-message')
    return value as T
  }

  /** A received message, opened and read. */
  async read(address: string, sig: string): Promise<ParsedMail> {
    return parseMail(await this.#open(address, 'box', sig))
  }

  /** The received message's own bytes, opened: what `attachmentBytes`, a forward and "Save to hive" work from.
   *  The same bytes `read` parses; nothing is kept between the two calls. */
  async readRaw(address: string, sig: string): Promise<Uint8Array> {
    return this.#open(address, 'box', sig)
  }

  /** A message this participant sent. */
  async readSent(address: string, sig: string): Promise<SentRecord> {
    return sentRecordOf(await this.#openJson<Record<string, unknown>>(address, 'sent', sig))
  }

  /** A draft, as the window saved it. */
  async readDraft(address: string, sig: string): Promise<MailDraft> {
    return draftOf(await this.#openJson<Record<string, unknown>>(address, 'drafts', sig))
  }

  /**
   * Sets marks on a message (merged over what was there) and answers the marks as they now stand.
   * Only the four marks travel; drafts carry none (the host refuses: `refused`).
   */
  async setMarks(address: string, folder: Folder, sig: string, marks: Partial<Record<MarkName, boolean>>): Promise<MailMarks> {
    if (!SIG.test(sig)) throw new MailError('not-found')
    const held = await this.#held()
    const fields: Record<string, boolean> = {}
    for (const name of MARK_NAMES) if (typeof marks[name] === 'boolean') fields[name] = marks[name] as boolean
    const body = JSON.stringify(fields)
    const merged = await this.#at(address, async origin =>
      this.#json<unknown>(await this.#request(held, origin, this.#path(folder, address, sig, '/marks'), { method: 'PUT', body })))
    const out = marksOf(merged) ?? {}
    this.dispatchEvent(new CustomEvent('change', { detail: { marked: sig, folder } }))
    return out
  }

  /**
   * Forgets a message on the host. Hide first, delete second (H4): a received or sent message goes
   * only once it is marked hidden AND deletable (else `conflict`); a draft goes on request.
   */
  async remove(address: string, folder: Folder, sig: string): Promise<void> {
    if (!SIG.test(sig)) throw new MailError('not-found')
    const held = await this.#held()
    await this.#at(address, origin => this.#request(held, origin, this.#path(folder, address, sig), { method: 'DELETE' }))
    this.dispatchEvent(new CustomEvent('change', { detail: { removed: sig, folder } }))
  }

  /**
   * Keeps a draft, sealed on the host. A draft is named by its bytes, so an edited draft is a new
   * one: pass the signature it `replaces` and the old one is forgotten once the new one is kept
   * (`replaced` says whether it went; the new one is kept either way).
   */
  async saveDraft(address: string, draft: MailDraftInput, replaces?: string | null): Promise<{ sig: string; replaced: boolean }> {
    const attachments = wireAttachments(draft.attachments)
    const body = JSON.stringify({ ...draft, ...(draft.attachments ? { attachments } : {}) })
    if (enc.encode(body).length > MAIL_LIMITS.draftBytes) throw new MailError('refused', 'draft too large')
    const held = await this.#held()
    const out = await this.#at(address, async origin =>
      this.#json<{ sig?: unknown }>(await this.#request(held, origin, this.#path('drafts', address), { method: 'PUT', body })))
    const sig = String(out.sig ?? '')
    if (!SIG.test(sig)) throw new MailError('unavailable', 'no draft signature')
    let replaced = false
    if (replaces && replaces !== sig && SIG.test(replaces)) {
      try { await this.remove(address, 'drafts', replaces); replaced = true } catch (error) {
        // Already gone is as good as gone.
        replaced = error instanceof MailError && error.code === 'not-found'
      }
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { draft: sig } }))
    return { sig, replaced }
  }

  /** Forgets a draft. */
  async removeDraft(address: string, sig: string): Promise<void> {
    return this.remove(address, 'drafts', sig)
  }

  /** Send as `request.from`. The host sends it and files a sealed copy (attachments and all) in Sent. */
  async send(request: SendRequest): Promise<{ messageId: string | null; sig: string | null }> {
    const attachments = wireAttachments(request.attachments)
    const body = JSON.stringify({
      from: request.from,
      to: request.to,
      ...(request.cc?.length ? { cc: request.cc } : {}),
      ...(request.bcc?.length ? { bcc: request.bcc } : {}),
      subject: request.subject,
      text: request.text,
      ...(request.html ? { html: request.html } : {}),
      ...(request.replyTo ? { replyTo: request.replyTo } : {}),
      ...(request.inReplyTo ? { inReplyTo: request.inReplyTo } : {}),
      ...(request.references ? { references: request.references } : {}),
      ...(attachments.length ? { attachments } : {}),
    })
    if (enc.encode(body).length > MAIL_LIMITS.sendBytes) throw new MailError('refused', 'message too large')
    const held = await this.#held()
    const timeoutMs = attachments.length ? 60_000 : 20_000
    let out: { messageId?: string | null; sig?: string | null }
    try {
      out = await this.#at(request.from, async origin =>
        this.#json<{ messageId?: string | null; sig?: string | null }>(await this.#request(held, origin, '/mail/send', { method: 'POST', body, timeoutMs })), SEND_PASSES_ON)
    } catch (error) {
      // A send has no other 409: the host already took this very request. It went; sending it again
      // would send it twice. Sent has the copy, so the window refreshes it.
      if (error instanceof MailError && error.code === 'conflict') {
        this.dispatchEvent(new CustomEvent('change', { detail: { sent: true } }))
        throw new MailError('conflict', ALREADY_SENT)
      }
      throw error
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { sent: true } }))
    return { messageId: out.messageId ?? null, sig: out.sig ?? null }
  }
}
