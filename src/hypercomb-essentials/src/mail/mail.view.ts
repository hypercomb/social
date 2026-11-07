// mail/mail.view.ts
//
// THE MAIL WINDOW — your inbox, what you sent, your drafts, what you hid, a
// message, and a message being written.
//
// ── IT SAYS WHAT IT IS DOING ────────────────────────────────────────────────
//
// jwize, 2026-11-06: "the info shows up late so we need some cue to see that
// is happening." Every act shows itself in the same frame it was pressed in:
// a line under the header says what is happening, with a thin bar that fills
// as rows open (or slides while nobody can know how long); the pressed button
// says what it is doing and cannot be pressed twice; the result is said in
// words. A list never starts blank: placeholder rows stand where rows will be,
// and each real row takes a placeholder's place the moment its metadata opens,
// already where the finished page will put it (mail-threads.ts), so nothing
// jumps when the page lands. A message shows what its row already knew (who,
// subject, when) while its body is fetched and opened.
//
// ── A PRESS SENDS; THE COMMAND LINE OPENS ───────────────────────────────────
//
// The word `mail` only opens this window (mail.queen.ts). Sending is a press on
// Send, on a draft the participant can read: an act that speaks as the
// participant to someone else is never a word typed at a prompt. An arrival
// never opens the window either: it lights a pill in the header (the house's
// `indicator:set`), and only a press on that pill opens it.
//
// ── NOTHING IS KEPT HERE ────────────────────────────────────────────────────
//
// Messages are opened into memory and shown. This window writes nothing to
// local storage, a pool or a layer; drafts and marks are kept by the HOST,
// sealed or plain as the wire contract says (mail-plan.md §3), and a message
// enters the hive only on the "Save to hive" press (mail-to-hive.ts). Closing
// the window drops every decrypted byte it held.
//
// ── A STRANGER'S HTML CANNOT ACT ────────────────────────────────────────────
//
// HTML mail is made safe in mail-html.ts and shown in a sandboxed, script-less
// iframe that may load nothing but a data: image. Plain text is shown as text
// (textContent), never as markup. Every other string here is textContent too.
// An attachment downloads as opaque bytes; a picture attachment is shown only
// inside the same kind of frame, from its own bytes. Nothing is fetched from
// anywhere but the mail host.
//
// ── AN ELEMENT, NOT A COMPONENT ─────────────────────────────────────────────
//
// Module chrome is a framework-free custom element added to the
// ShellSurfaceRegistry over IoC — never a tag in either app.html. The queen
// registers it; this file only defines it.

import { EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { contactsIn, knownAddresses, type ContactSeed } from './contacts.js'
import { DRAFT_SAVE_MS, Debounced, POLL_EVERY_MS, POLL_MAX_ERRORS, Poller, progressShare, sizeLabel } from './cue.js'
import { formatMessage } from './format.js'
import { mailFrameDocument, makeMailHtmlSafe } from './mail-html.js'
import { matchesWords, mergeNewestFirst, newestFirst, searchWords, threadsOf, timeOf, type Thread } from './mail-threads.js'
import type { SaveMessageInput, SaveMessageResult } from './mail-to-hive.js'
import {
  ALREADY_DONE, ALREADY_SENT, MAIL_ACTS, MAIL_LIMITS, MailError, MailService, sentAttachmentBytes, unreadCount,
  type Folder, type MailAct, type MailAttachmentInput, type MailDraft, type MailDraftInput, type MailListItem, type Mailbox, type MarkName,
  type SentAttachment, type SentRecord,
} from './mail.service.js'
import { attachmentBytes, attachmentsBytes, parseMail, type ParsedMail } from './mime.js'
import { forwardDraft, recipientsIn, replyDraft, replySubject, type Draft } from './reply.js'

export const MAIL_OPEN = 'mail:open'
/** An open request older than this is stale — a replayed last value, not a press. */
export const OPEN_STAMP_MS = 5_000
/** How many messages wait unread, said while the window is shut: `{ count }`. */
export const MAIL_UNREAD = 'mail:unread'
/** The header pill that says so. A press on it opens the window; an arrival never does. */
export const UNREAD_INDICATOR = 'mail:unread'

const SURFACE = 'hc-mail'
const STYLE_ID = 'hc-mail-style'
const KNOWN_LIST_ID = 'hc-mail-known'
const FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox'

const STEEL = '126, 182, 214'
const ACCENT = '201, 162, 39'

/** Placeholder rows drawn before the host has said how many rows a page holds. */
const PLACEHOLDER_GUESS = 3
/** A picture attachment is shown in the window up to these sizes; above them it is only listed. */
const PREVIEW_ONE = 2 * 1024 * 1024
const PREVIEW_ALL = 8 * 1024 * 1024
const PREVIEW_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
/** At most this many pictures are shown; the rest are listed with the other files. */
const PREVIEW_MOST = 12
/**
 * Above this many bytes of message, its pictures wait for a press ("Show pictures"): finding them is one
 * more walk over every byte, and a stranger chooses how many bytes there are (R2 #1).
 */
const PREVIEW_ON_PRESS = 2 * 1024 * 1024
/** The compose preview is redrawn once the typing pauses this long (the frame reloads on each draw). */
const PREVIEW_DRAW_MS = 200
const WIRE_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const interpolate = (text: string, params?: Record<string, string | number>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, name) => String(params[name] ?? whole)) : text

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  try {
    const text = ioc<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return text && text !== key ? text : interpolate(fallback, params)
  } catch { return interpolate(fallback, params) }
}

/** What the window was doing when it failed, so the words can name it. */
export interface ExplainContext {
  readonly act?: MailAct
  readonly address?: string
}

/**
 * A key the host knows at an address, but not for this act. Nothing on this device can change that:
 * the operator gives a key its acts (`MAIL_CONFIG`), so the words say who can.
 */
const forbidden = (act: string, address: string): string => {
  const params = { address: address || '—' }
  switch (act) {
    case 'read': return t('mail.error.forbidden.read', 'This key may not read the mail of {address}. Whoever runs the mail host can give it more.', params)
    case 'mark': return t('mail.error.forbidden.mark', 'This key may not mark mail at {address} (read, flag or hide). Whoever runs the mail host can give it more.', params)
    case 'draft': return t('mail.error.forbidden.draft', 'This key may not keep drafts at {address}. Whoever runs the mail host can give it more.', params)
    case 'delete': return t('mail.error.forbidden.delete', 'This key may not delete mail at {address}. Whoever runs the mail host can give it more.', params)
    case 'send': return t('mail.error.forbidden.send', 'This key may not send from {address}. Whoever runs the mail host can give it more.', params)
    default: return t('mail.error.forbidden', 'This key may not do that at {address}. Whoever runs the mail host can give it more.', params)
  }
}

/**
 * A refusal, in the hive's own words. The reasons are the ones the mail Worker gives
 * (hypercomb-relay/mail-worker/worker.js) and the ones the service gives before a byte is sent,
 * plus Cloudflare's codes, which the Worker passes on bare. A reason not on this list is NEVER shown:
 * the window speaks in the hive's voice, and a host can write anything into its answer — "your key
 * expired, paste it at …" included (R2 #7). Every such refusal gets the one plain sentence.
 */
const refusedWords = (detail: string): string => {
  const reason = detail.trim()
  if (/^too many attachments$/i.test(reason)) return t('mail.error.refused.too-many-files', 'The host takes at most {count} files in a message.', { count: MAIL_LIMITS.attachments })
  if (/^attachments too large$/i.test(reason)) return t('mail.error.refused.files-too-large', 'The host takes at most {size} of files in a message.', { size: sizeLabel(MAIL_LIMITS.attachmentBytes) })
  if (/^bad attachments?( type| content)?$/i.test(reason) || /^E_ATTACHMENT/.test(reason)) return t('mail.error.refused.bad-file', 'The host would not take one of the files as it is.')
  if (/^bad recipients$/i.test(reason) || /^E_RECIPIENT/.test(reason)) return t('mail.error.refused.recipients', 'The host would not take these recipients: To and Cc must hold addresses, at most {count} in all.', { count: MAIL_LIMITS.recipients })
  if (/^bad subject$/i.test(reason)) return t('mail.error.refused.subject', 'The host needs a subject, on one line.')
  if (/^no body$/i.test(reason)) return t('mail.error.refused.empty', 'The host will not send a message with nothing in it.')
  if (/^bad (reply-to|in-reply-to|references)$/i.test(reason) || /^E_HEADER/.test(reason)) return t('mail.error.refused.headers', 'The host would not take this message’s reply headers.')
  if (/^(message|draft) too large$/i.test(reason)) return t('mail.error.refused.too-large', 'This is larger than the host takes.')
  if (/^E_SENDER/.test(reason)) return t('mail.error.refused.sender', 'Cloudflare will not send from this address yet.')
  if (/^E_[A-Z_]+$/.test(reason)) return t('mail.error.refused.cloudflare', 'Cloudflare would not send this message as it is.')
  return t('mail.error.refused', 'The mail host refused this.')
}

/** What a failure means to the person, in words. */
export const explain =(error: unknown, sending = false, recipients: readonly string[] = [], context: ExplainContext = {}): string => {
  const code = error instanceof MailError ? error.code : 'unavailable'
  const detail = error instanceof MailError ? error.detail : ''
  switch (code) {
    case 'no-signer': return t('mail.error.no-signer', 'The signing service is not loaded yet. Try again in a moment.')
    case 'no-key': return t('mail.error.no-key', 'This device holds no key, and opening mail never makes one. Open mail on the device that holds your key.')
    case 'unauthorized': return t('mail.error.unauthorized', 'The mail host does not know this key as the owner of that address.')
    case 'forbidden': return forbidden(detail || context.act || '', context.address ?? '')
    case 'not-found': return t('mail.error.not-found', 'That message is not there.')
    case 'limit':
      if (!sending && context.act === 'delete') return t('mail.error.limit-delete', 'The host’s daily delete limit was reached. Try again tomorrow.')
      if (!sending && context.act && context.act !== 'send') return t('mail.error.limit-other', 'The host’s limit for this was reached. Try again later.')
      return t('mail.error.limit', 'A sending limit was reached. Try again later.')
    case 'conflict':
      // The host has spent this very request once already (every signed write is used once).
      if (detail === ALREADY_SENT) return t('mail.error.already-sent', 'This message was already sent; it is in Sent.')
      if (detail === ALREADY_DONE) return t('mail.error.already-done', 'That was already done.')
      return t('mail.error.conflict', 'A message can be deleted only once it is hidden and marked “may be deleted”.')
    case 'refused':
      // Cloudflare learns an address that bounced and will not try it again. Which address is not in the answer, so name
      // the ones in this draft; a typo is by far the usual cause.
      if (detail === 'E_RECIPIENT_SUPPRESSED') {
        return t('mail.error.suppressed', 'Cloudflare will not send to one of these addresses, because it bounced before: {to}. Check To and Cc for a typo.', { to: recipients.join(', ') || '—' })
      }
      return refusedWords(detail)
    case 'bad-message': return t('mail.error.bad-message', 'This message could not be opened with this key.')
    default: return sending
      ? t('mail.error.unavailable-send', 'The mail host did not answer. Nothing was sent.')
      : t('mail.error.unavailable', 'The mail host did not answer.')
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// One formatter for every row: toLocaleString builds a new one per call, and a page has thousands of rows.
let whenFormat: Intl.DateTimeFormat | null = null
const when = (at: number | undefined): string => {
  if (!at) return ''
  whenFormat ??= new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  try { return whenFormat.format(new Date(at)) } catch { return '' }
}

const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)

const base64Of = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const base64Size = (text: string): number => {
  const clean = text.replace(/\s+/g, '')
  return Math.max(0, Math.floor(clean.length / 4 * 3) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0))
}

/** A media type the host takes: `type/subtype`, lowercase, no parameters. */
const wireType = (type: string): string => {
  const bare = String(type ?? '').toLowerCase().split(';')[0]!.trim()
  return WIRE_TYPE.test(bare) ? bare : 'application/octet-stream'
}

/** A download name that is only a name: no folders, no control characters. */
const fileName = (name: string): string =>
  String(name ?? '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 120) || 'attachment'

/** jsdom and older engines have no Blob.arrayBuffer; FileReader is everywhere. */
const fileBytes = (file: File): Promise<Uint8Array> =>
  typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer().then(buffer => new Uint8Array(buffer))
    : new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })

/**
 * Which attachments are worth showing as pictures, by index: one of the four picture types, within the
 * caps by the size the message declares, and no more than PREVIEW_MOST. Chosen BEFORE a byte is read,
 * so a message of 190 tiny pictures costs what a message of twelve does.
 */
function pictureCandidates(files: readonly { readonly type: string; readonly size: number }[]): number[] {
  const picked: number[] = []
  let total = 0
  files.forEach((file, index) => {
    if (picked.length >= PREVIEW_MOST) return
    if (!PREVIEW_TYPES.has(wireType(file.type)) || !(file.size <= PREVIEW_ONE) || total + file.size > PREVIEW_ALL) return
    total += file.size
    picked.push(index)
  })
  return picked
}

/**
 * The chosen pictures, as a frame document of data: images. The caps are asked again of the bytes
 * themselves (a declared size is the sender's word), and nothing a stranger wrote enters the markup:
 * the type comes from the fixed set and the bytes are base64.
 */
function previewDocument(files: readonly { readonly type: string; readonly bytes: Uint8Array | null | undefined }[]): string | null {
  let total = 0
  const pictures: string[] = []
  for (const file of files) {
    const type = wireType(file.type)
    const bytes = file.bytes
    if (pictures.length >= PREVIEW_MOST || !PREVIEW_TYPES.has(type) || !bytes || bytes.length > PREVIEW_ONE || total + bytes.length > PREVIEW_ALL) continue
    total += bytes.length
    pictures.push(`<p><img src="data:${type};base64,${base64Of(bytes)}"></p>`)
  }
  return pictures.length ? mailFrameDocument(pictures.join('')) : null
}

/** A received message's pictures: the candidates first, then ONE walk of the message for all their bytes. */
function receivedPreviews(mail: ParsedMail, raw: Uint8Array): string | null {
  const indices = pictureCandidates(mail.attachments)
  if (!indices.length) return null
  const found = attachmentsBytes(raw, indices)
  return previewDocument(indices.map(index => ({ type: mail.attachments[index]!.type, bytes: found.get(index) })))
}

/**
 * The bytes of several attachments, read in ONE walk of the message on the first ask and kept for the
 * asks after it. Save to hive and a forward ask for every file; one walk per file was R2 #1 again.
 */
const oneWalk = (raw: Uint8Array, indices: readonly number[]): ((index: number) => Uint8Array | null) => {
  let found: Map<number, Uint8Array> | null = null
  return index => (found ??= attachmentsBytes(raw, indices)).get(index) ?? null
}

/** A sent copy's pictures: its files are already base64 in the record, so only the chosen ones are decoded. */
function sentPreviews(files: readonly SentAttachment[]): string | null {
  const sized = files.map(file => ({ type: file.type, size: base64Size(file.content) }))
  return previewDocument(pictureCandidates(sized).map(index => ({ type: files[index]!.type, bytes: sentAttachmentBytes(files[index]!) })))
}

/** A Sent copy's address list as one line, whatever shape the host gave it. */
const joined = (value: unknown): string =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join(', ') : typeof value === 'string' ? value : ''

/** A Sent copy's files, only those with the shape a file has: a host can hand back anything. */
const sentFiles = (record: SentRecord | undefined): SentAttachment[] =>
  (Array.isArray(record?.attachments) ? record.attachments : []).filter((file): file is SentAttachment =>
    !!file && typeof file === 'object' && typeof file.content === 'string' && typeof file.type === 'string')

/** What a list row says, decoded once per message for as long as the window is open. */
interface Readable { readonly from: string; readonly to: string; readonly subject: string; readonly preview: string }

const encoder = new TextEncoder()

/**
 * The sealed metadata keeps From, To and Subject as the sender wrote them, RFC 2047 words and all.
 * mime.ts keeps its header decoder to itself, so a three-line header is read through parseMail — the
 * same decoder that reads the message, rather than a second copy of it here.
 */
function readableMeta(meta: MailListItem['meta']): Readable {
  if (!meta) return { from: '', to: '', subject: '', preview: '' }
  const line = (value: unknown): string => String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, 2000)
  const preview = line(meta.preview)
  try {
    const head = parseMail(encoder.encode(`From: ${line(meta.from)}\r\nTo: ${line(meta.to)}\r\nSubject: ${line(meta.subject)}\r\n\r\n`))
    return { from: head.from, to: head.to, subject: head.subject, preview }
  } catch {
    return { from: line(meta.from), to: line(meta.to), subject: line(meta.subject), preview }
  }
}

/**
 * A display name that carries an at sign reads as an address, and the sender chose it:
 * `"boss@corp.example" <evil@attacker.example>` would wear the boss's address as its name (R2 #5).
 * Such a name is not a name; the address is shown alone. The full-width and small at signs read the same.
 */
const namesAnAddress = (name: string): boolean => /[@＠﹫]/.test(name)

/** "Name <address>" for each mailbox in a header field, else the field as it is. */
const withNames = (field: string): string => {
  const people = contactsIn(field, 'shown')
  if (!people.length) return field.trim()
  return people.map(p => (p.name && !namesAnAddress(p.name) ? `${p.name} <${p.address}>` : p.address)).join(', ')
}

const mailboxLabel = (box: Pick<Mailbox, 'address' | 'name'>): string => (box.name ? `${box.name} <${box.address}>` : box.address)

type Said = { text: string; tone: 'ok' | 'quiet' | 'bad' }
type Phase = 'loading' | 'ready' | 'problem' | 'no-mailbox'
type Tab = 'inbox' | 'sent' | 'drafts' | 'hidden'

const FOLDERS_OF: Readonly<Record<Tab, readonly Folder[]>> = {
  inbox: ['box'], sent: ['sent'], drafts: ['drafts'], hidden: ['box', 'sent'],
}

interface Loading {
  readonly first: boolean
  readonly quiet: boolean
  total: number | null
  opened: number
  /** Rows opened since the last drawn frame, by signature: drawn together on the next one. */
  readonly arriving: Map<string, MailListItem>
  /** What the cue line says while this page opens, and under which cue. */
  readonly what: string
  readonly cue: string
}

interface FolderList {
  items: MailListItem[]
  cursor: string | null
  loaded: boolean
  failed: boolean
  loading: Loading | null
  token: number
}

interface Attached {
  readonly filename: string
  readonly type: string
  readonly size: number
  /** The bytes (or base64), read when a send or a draft save needs them — never before. */
  readonly content: () => Uint8Array | string | null
}

interface ReadPane {
  readonly kind: 'read'
  readonly folder: Folder
  readonly tab: Tab
  item: MailListItem
  mail?: ParsedMail
  /** The message's own bytes, held beside `mail`: downloads, a forward's files and Save to hive read them. */
  raw?: Uint8Array
  sent?: SentRecord
  previews?: string | null
  /** A large message's pictures, not yet looked for: a press on "Show pictures" reads them. */
  picturesWait?: boolean
  failed?: string
  asText: boolean
}

interface ComposePane {
  readonly kind: 'compose'
  draft: Draft
  from: string
  formatted: boolean
  attached: Attached[]
  draftSig: string | null
  /** The address the kept draft lives under. */
  savedFrom: string | null
  /** What was last kept, so an unchanged draft is never sent again. */
  savedAs: string | null
  saving: boolean
  /** Changed while a save was on its way: save once more when it lands. */
  again: boolean
  discarded: boolean
  status: Said | null
  failed?: string
  note?: string
  sending: boolean
  readonly back: Pane
}

type Pane = { readonly kind: 'list' } | ReadPane | ComposePane

type Entry =
  | { readonly key: string; readonly kind: 'skeleton' }
  | { readonly key: string; readonly kind: 'thread'; readonly folder: Folder; readonly thread: Thread<MailListItem>; readonly open: boolean }
  | { readonly key: string; readonly kind: 'row'; readonly folder: Folder; readonly item: MailListItem; readonly member: boolean; readonly hidden: boolean }

interface Cue { readonly text: string; readonly share: number | null; readonly quiet: boolean }

interface BusyButton { readonly button: HTMLButtonElement; readonly idle: string; readonly busy: string }

export class MailElement extends HTMLElement {

  #panel: HTMLElement | null = null
  #cleanup: (() => void)[] = []
  #phase: Phase = 'loading'
  #problem = ''
  #key: string | null = null
  #boxes: Mailbox[] = []
  #address = ''
  #tab: Tab = 'inbox'
  #lists = new Map<Folder, FolderList>()
  #readables = new Map<string, Readable>()
  #threadKeys = new Map<string, string>()
  #expanded = new Set<string>()
  #query = ''
  #pane: Pane = { kind: 'list' }
  #said: Said | null = null
  // Everything in flight belongs to one opening of the window for one address; closing or switching
  // address starts a new epoch, and an answer from an older one finds nobody waiting.
  #epoch = 0
  #paneToken = 0
  #cues = new Map<string, Cue>()
  #busy = new Set<string>()
  #busyButtons = new Map<string, BusyButton>()
  /** The redraw waiting for the next frame, if one is (see #drawSoon). */
  #frame: { readonly cancel: () => void } | null = null

  // The painted parts that change in place, so a row arriving never redraws (and unfocuses) the rest.
  #cueEl: HTMLElement | null = null
  #saidEl: HTMLElement | null = null
  #listEl: HTMLUListElement | null = null
  #noticeEl: HTMLElement | null = null
  #moreEl: HTMLElement | null = null
  #refreshEl: HTMLButtonElement | null = null
  #tabEls = new Map<Tab, HTMLButtonElement>()
  #rowEls = new Map<string, HTMLLIElement>()
  #formEl: HTMLFormElement | null = null
  #previewEl: HTMLElement | null = null
  #attachedEl: HTMLElement | null = null
  #composeSaidEl: HTMLElement | null = null
  #statusEl: HTMLElement | null = null
  #knownEl: HTMLDataListElement | null = null
  #listScroll = 0
  #focusKey: string | null = null
  #returning = false

  #saver: Debounced | null = null
  #previewer = new Debounced(() => this.#paintPreview(), PREVIEW_DRAW_MS)
  #poller: Poller | null = null
  #unreadBy = new Map<string, number>()
  #unread = 0

  /** THE SEAM. Replaced in the spec, so no network and no signer are reached there. */
  service: MailService = new MailService()
  /** The save-to-hive act; loaded on the press so the window's own load stays small. */
  saveToHive: (input: SaveMessageInput) => Promise<SaveMessageResult> =
    async input => (await import('./mail-to-hive.js')).saveMessageToHive(input)
  /** How long the typing must pause before a draft is kept. */
  draftSaveMs = DRAFT_SAVE_MS
  /** How often the unread cue asks the host. */
  pollEveryMs = POLL_EVERY_MS
  /** Is anyone looking at the page? A poll asks nothing while this is false. */
  visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

  connectedCallback(): void {
    ensureStyles()
    this.#cleanup.push(EffectBus.on<{ at?: number }>(MAIL_OPEN, payload => {
      if (Math.abs(Date.now() - (payload?.at ?? 0)) > OPEN_STAMP_MS) return
      this.open()
    }))
    // The pill's press comes on the replaying channel, so the last press would reach a window that
    // mounts later and open it by itself. Only a press made while this window listens counts.
    let live = false
    this.#cleanup.push(EffectBus.on<{ key?: string }>('indicator:activate', payload => {
      if (live && payload?.key === UNREAD_INDICATOR) this.open()
    }))
    this.#cleanup.push(EffectBus.on('indicator:query', () => { if (live) this.#paintPill() }))
    live = true
  }

  disconnectedCallback(): void {
    for (const off of this.#cleanup) off()
    this.#cleanup = []
    this.#poller?.stop()
    this.#poller = null
    this.close()
  }

  open(): void {
    if (!this.#panel) {
      const panel = el('aside', 'hc-mail')
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-label', t('mail.title', 'Mail'))
      panel.tabIndex = -1
      panel.setAttribute('data-consumes-wheel', '')
      panel.addEventListener('keydown', this.#onKey)
      this.appendChild(panel)
      this.#panel = panel
    }
    this.#paintPill()
    void this.#start()
  }

  close(): void {
    this.#epoch++ // an answer still on its way finds nobody waiting
    if (!this.#panel) return
    if (this.#pane.kind === 'compose') this.#leaveCompose(this.#pane, false)
    this.#autosaver().cancel()
    this.#previewer.cancel()
    this.#frame?.cancel()
    this.#frame = null
    // The count the window already knows is the cue's starting point; the poll keeps it current.
    const box = this.#lists.get('box')
    if (box?.loaded && this.#address) this.#unreadBy.set(this.#address, unreadCount(box.items))
    this.#panel.removeEventListener('keydown', this.#onKey)
    this.#panel.remove()
    this.#panel = null
    // Everything decrypted goes with the window.
    this.#lists.clear()
    this.#readables.clear()
    this.#threadKeys.clear()
    this.#expanded.clear()
    this.#query = ''
    this.#pane = { kind: 'list' }
    this.#said = null
    this.#cues.clear()
    this.#busy.clear()
    this.#forgetPainted()
    this.#setUnread()
  }

  get isOpen(): boolean { return !!this.#panel }

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      const pane = this.#pane
      if (pane.kind === 'compose') { this.#leaveCompose(pane); return }
      if (pane.kind === 'read') { this.#backToList(); return }
      if (this.#query) { this.#setQuery(''); return }
      this.close()
      return
    }
    if (this.#pane.kind !== 'list' || isField(event.target) || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'j' || event.key === 'k') {
      event.preventDefault()
      this.#moveFocus(event.key === 'j' ? 1 : -1)
    }
  }

  /** Made on first use, so the pause is the one set on the element (a spec shortens it). */
  #autosaver(): Debounced {
    return this.#saver ??= new Debounced(() => this.#saveDraftNow(), this.draftSaveMs)
  }

  // ── opening, and the lists ──────────────────────────────────────────────

  async #start(): Promise<void> {
    const epoch = ++this.#epoch
    this.#phase = 'loading'
    this.#pane = { kind: 'list' }
    this.#said = null
    this.#lists.clear()
    this.#cueOn('start', t('mail.loading', 'Opening your mailbox…'))
    this.#render()
    try {
      const boxes = await this.service.mailboxes()
      if (epoch !== this.#epoch) return
      this.#cueOff('start')
      if (!boxes.length) {
        this.#key = await this.service.publicKey()
        if (epoch !== this.#epoch) return
        this.#phase = 'no-mailbox'
        this.#render()
        return
      }
      this.#boxes = boxes
      if (!boxes.some(box => box.address === this.#address)) this.#address = boxes[0]!.address
      this.#fitTab()
      this.#phase = 'ready'
      this.#render()
      this.#startPoll()
      for (const folder of FOLDERS_OF[this.#tab]) void this.#loadFolder(folder)
    } catch (error) {
      if (epoch !== this.#epoch) return
      this.#cueOff('start')
      this.#phase = 'problem'
      this.#problem = explain(error)
      this.#render()
    }
  }

  #list(folder: Folder): FolderList {
    let list = this.#lists.get(folder)
    if (!list) {
      list = { items: [], cursor: null, loaded: false, failed: false, loading: null, token: 0 }
      this.#lists.set(folder, list)
    }
    return list
  }

  /**
   * One page of a folder, drawn as it opens. A first load draws placeholders; a refresh keeps the rows
   * on screen and replaces each where it stands; a quiet load (the poll) only adds what is new and
   * says nothing unless asked. Resolves when the page is in; a quiet load passes its failure on so the
   * poll can count it.
   */
  async #loadFolder(folder: Folder, options: { more?: boolean; quiet?: boolean } = {}): Promise<void> {
    const epoch = this.#epoch
    const address = this.#address
    const list = this.#list(folder)
    const token = ++list.token
    const quiet = !!options.quiet
    const more = !!options.more
    // Placeholders only for a page the participant asked for and has nothing of yet: a poll of an empty
    // inbox must not flash three ghost rows every 90 seconds.
    const first = !more && !quiet && !list.items.length
    const id = `load:${folder}`
    const what = quiet ? t('mail.checking', 'Checking for mail…')
      : more ? t('mail.loading-more', 'Opening older mail…')
        : first ? t('mail.loading', 'Opening your mailbox…')
          : t('mail.refreshing', 'Refreshing…')
    const loading: Loading = { first, quiet, total: null, opened: 0, arriving: new Map(), what, cue: id }
    list.loading = loading
    list.failed = false
    const current = (): boolean => epoch === this.#epoch && token === list.token
    this.#cueOn(id, what, null, quiet)
    this.#syncList()
    try {
      // A row is held as it opens and drawn on the next frame with every other row that opened since:
      // a page of a hundred rows opening one by one is drawn a few times, not a hundred (R2 #3).
      const page = await this.service.list(address, folder, more ? list.cursor : null, (item, progress) => {
        if (!current()) return
        loading.total = progress.total
        loading.opened = progress.opened
        loading.arriving.set(item.sig, item)
        this.#drawSoon()
      })
      if (!current()) return
      // The page itself holds every row that opened, so what is still waiting for a frame is dropped.
      loading.arriving.clear()
      if (more || quiet) {
        list.items = mergeNewestFirst(list.items, page.items)
        if (more) list.cursor = page.cursor
      } else {
        // A refresh starts again from the newest page: what the host no longer lists goes.
        list.items = page.items
        list.cursor = page.cursor
      }
      list.loaded = true
    } catch (error) {
      if (!current()) return
      if (quiet) throw error // the poll counts it; the list on screen is as it was
      list.failed = !list.items.length && !loading.arriving.size
      this.#say(explain(error, false, [], { act: 'read', address }), 'bad')
    } finally {
      if (current()) {
        // What opened before a failure still stands; then the page is drawn at once, not a frame later.
        if (loading.arriving.size) list.items = mergeNewestFirst(list.items, loading.arriving.values())
        loading.arriving.clear()
        list.loading = null
        this.#cueOff(id)
        this.#drawNow()
      }
    }
  }

  /** One redraw on the next frame, however many rows open before it. */
  #drawSoon(): void {
    if (this.#frame) return
    const draw = (): void => { this.#frame = null; this.#landArrivals(); this.#syncList() }
    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(draw)
      this.#frame = { cancel: () => cancelAnimationFrame(id) }
    } else {
      const id = setTimeout(draw, 16)
      this.#frame = { cancel: () => clearTimeout(id) }
    }
  }

  /**
   * The frame's work, now. A hidden tab draws no frames, so a page that lands always draws here
   * rather than waiting on one that may never come.
   */
  #drawNow(): void {
    this.#frame?.cancel()
    this.#frame = null
    this.#landArrivals()
    this.#syncList()
  }

  /** The rows that opened since the last frame, each into its final place; the line says how far it has got. */
  #landArrivals(): void {
    for (const list of this.#lists.values()) {
      const loading = list.loading
      if (!loading) continue
      if (loading.arriving.size) {
        list.items = mergeNewestFirst(list.items, loading.arriving.values())
        loading.arriving.clear()
      }
      if (loading.total === null) continue
      const progress = { opened: loading.opened, total: loading.total }
      this.#cueOn(loading.cue, `${loading.what} ${t('mail.cue.count', '{opened} of {total}', progress)}`, progressShare(progress), loading.quiet)
    }
  }

  #invalidate(folder: Folder): void {
    const list = this.#lists.get(folder)
    if (list) list.loaded = false
  }

  #chooseTab(tab: Tab): void {
    this.#tab = tab
    this.#said = null
    this.#render()
    for (const folder of FOLDERS_OF[tab]) {
      const list = this.#list(folder)
      if (!list.loaded && !list.loading) void this.#loadFolder(folder)
    }
  }

  #refresh(): void {
    for (const folder of FOLDERS_OF[this.#tab]) {
      if (!this.#list(folder).loading?.quiet && this.#list(folder).loading) continue
      void this.#loadFolder(folder)
    }
  }

  #chooseAddress(address: string): void {
    if (address === this.#address) return
    if (this.#pane.kind === 'compose') this.#leaveCompose(this.#pane, false)
    this.#epoch++
    this.#address = address
    this.#fitTab()
    this.#lists.clear()
    this.#threadKeys.clear()
    this.#expanded.clear()
    this.#pane = { kind: 'list' }
    this.#said = null
    this.#render()
    for (const folder of FOLDERS_OF[this.#tab]) void this.#loadFolder(folder)
  }

  /**
   * What this key may do at an address (`Mailbox.can`, from the host). The window leaves out what it
   * may not, so a read-only key sees a plain reader; a refusal is still worded (`forbidden`), because
   * the operator can change a key's acts after the window asked. A host older than roles says nothing,
   * and then a key may do all five.
   */
  #may(act: MailAct, address = this.#address): boolean {
    const box = this.#boxes.find(b => b.address === address)
    return (box?.can ?? MAIL_ACTS).includes(act)
  }

  /** The addresses this key may send from — the composer's From. */
  #senders(): Mailbox[] {
    return this.#boxes.filter(box => this.#may('send', box.address))
  }

  /** A tab this key has no use for (Drafts without `draft`) is not offered; the window falls back to Inbox. */
  #fitTab(): void {
    if (this.#tab === 'drafts' && !this.#may('draft')) this.#tab = 'inbox'
  }

  #readable(item: MailListItem): Readable {
    let readable = this.#readables.get(item.sig)
    if (!readable) {
      readable = readableMeta(item.meta)
      this.#readables.set(item.sig, readable)
    }
    return readable
  }

  #replaceItem(folder: Folder, item: MailListItem): void {
    const list = this.#lists.get(folder)
    if (list) list.items = list.items.map(held => (held.sig === item.sig ? item : held))
    const pane = this.#pane
    if (pane.kind === 'read' && pane.item.sig === item.sig) pane.item = item
  }

  #dropItem(folder: Folder, sig: string): void {
    const list = this.#lists.get(folder)
    if (list) list.items = list.items.filter(held => held.sig !== sig)
  }

  // ── the list, drawn in place ────────────────────────────────────────────

  #entries(): Entry[] {
    const words = searchWords(this.#query)
    const matches = (item: MailListItem): boolean => {
      const r = this.#readable(item)
      return matchesWords([r.from, r.to, r.subject, r.preview], words)
    }
    const entries: Entry[] = []
    const tab = this.#tab
    if (tab === 'inbox' || tab === 'sent') {
      const folder: Folder = tab === 'inbox' ? 'box' : 'sent'
      const items = this.#list(folder).items.filter(item => !item.marks?.hidden && matches(item))
      // Subjects compare decoded: an RFC 2047 "Re:" must meet the plain subject it answers.
      for (const thread of threadsOf(items, this.#threadKeys, item => this.#readable(item).subject)) {
        if (thread.count === 1) {
          entries.push({ key: `r:${folder}:${thread.newest.sig}`, kind: 'row', folder, item: thread.newest, member: false, hidden: false })
          continue
        }
        for (const member of thread.items) this.#threadKeys.set(member.sig, thread.key)
        const open = this.#expanded.has(thread.key)
        entries.push({ key: `t:${thread.key}`, kind: 'thread', folder, thread, open })
        if (open) for (const member of thread.items) entries.push({ key: `m:${folder}:${member.sig}`, kind: 'row', folder, item: member, member: true, hidden: false })
      }
    } else if (tab === 'drafts') {
      for (const item of this.#list('drafts').items) {
        if (matches(item)) entries.push({ key: `r:drafts:${item.sig}`, kind: 'row', folder: 'drafts', item, member: false, hidden: false })
      }
    } else {
      const hidden = (['box', 'sent'] as const).flatMap(folder =>
        this.#list(folder).items.filter(item => item.marks?.hidden && matches(item)).map(item => ({ folder, item })))
      hidden.sort((a, b) => newestFirst(a.item, b.item))
      for (const { folder, item } of hidden) entries.push({ key: `h:${folder}:${item.sig}`, kind: 'row', folder, item, member: false, hidden: true })
    }
    let placeholders = 0
    for (const folder of FOLDERS_OF[tab]) {
      const loading = this.#lists.get(folder)?.loading
      if (!loading?.first) continue
      placeholders += loading.total === null ? PLACEHOLDER_GUESS : Math.max(0, loading.total - loading.opened)
    }
    for (let i = 0; i < placeholders; i++) entries.push({ key: `s:${i}`, kind: 'skeleton' })
    return entries
  }

  #syncList(): void {
    this.#paintTabs()
    const listEl = this.#listEl
    if (!listEl) return
    const entries = this.#entries()
    const wanted = new Set(entries.map(entry => entry.key))
    for (const [key, row] of this.#rowEls) if (!wanted.has(key)) { row.remove(); this.#rowEls.delete(key) }
    // Walked by sibling, not by index: a live `children[i]` is counted again after every insert in some
    // engines (jsdom among them), which made a long page cost the square of its rows.
    let here: ChildNode | null = listEl.firstChild
    for (const entry of entries) {
      let row = this.#rowEls.get(entry.key)
      if (!row) { row = el('li'); this.#rowEls.set(entry.key, row) }
      this.#fillRow(entry, row)
      if (row === here) here = here.nextSibling
      else listEl.insertBefore(row, here)
    }

    const folders = FOLDERS_OF[this.#tab]
    const lists = folders.map(folder => this.#list(folder))
    const loading = lists.some(list => list.loading && !list.loading.quiet)
    const shown = entries.some(entry => entry.kind !== 'skeleton')
    if (this.#noticeEl) {
      const settled = !loading && lists.every(list => list.loaded || list.failed)
      this.#noticeEl.textContent = shown || !settled || lists.some(list => list.failed) ? '' : this.#emptyText()
      this.#noticeEl.hidden = !this.#noticeEl.textContent
    }
    if (this.#refreshEl) {
      this.#refreshEl.disabled = loading
      this.#refreshEl.textContent = loading ? t('mail.refreshing', 'Refreshing…') : t('mail.refresh', 'Refresh')
    }
    if (this.#moreEl) {
      this.#moreEl.replaceChildren()
      if (this.#tab !== 'hidden') {
        const list = lists[0]!
        if (list.cursor) {
          const older = this.#button(list.loading ? t('mail.loading-more', 'Opening older mail…') : t('mail.more', 'Older'), () => { void this.#loadFolder(folders[0]!, { more: true }) })
          older.disabled = !!list.loading
          this.#moreEl.appendChild(older)
        }
      } else if (lists.some(list => list.cursor)) {
        this.#moreEl.appendChild(el('p', 'hc-mail-quiet', t('mail.hidden-pages', 'Only the pages opened so far are looked through for hidden messages.')))
      }
    }
  }

  #emptyText(): string {
    if (this.#query) return t('mail.no-match', 'Nothing here matches “{query}”.', { query: this.#query })
    switch (this.#tab) {
      case 'inbox': return t('mail.empty-inbox', 'No mail yet.')
      case 'sent': return t('mail.empty-sent', 'Nothing sent yet.')
      case 'drafts': return t('mail.empty-drafts', 'No drafts.')
      default: return t('mail.empty-hidden', 'Nothing is hidden.')
    }
  }

  /** Everything a row's drawing depends on. A row that says the same is left alone, so a page of a
   *  hundred rows arriving one by one redraws one row each time, not all of them. */
  #stamp(entry: Entry): string {
    if (entry.kind === 'skeleton') return 'skeleton'
    const item = entry.kind === 'thread' ? entry.thread.newest : entry.item
    const busy = [...this.#busy].filter(k => k.endsWith(item.sig))
    const shape = entry.kind === 'thread'
      ? [entry.thread.count, entry.thread.unread, entry.thread.flagged, entry.open]
      : [entry.member, entry.hidden]
    return JSON.stringify([entry.kind, entry.folder, item.sig, timeOf(item), item.marks, this.#readable(item), shape, busy])
  }

  #fillRow(entry: Entry, row: HTMLLIElement): void {
    const stamp = this.#stamp(entry)
    if (row.dataset['stamp'] === stamp) return
    row.dataset['stamp'] = stamp
    row.replaceChildren()
    row.onclick = null
    row.onkeydown = null
    row.removeAttribute('aria-hidden')
    row.removeAttribute('aria-expanded')
    if (entry.kind === 'skeleton') {
      row.className = 'hc-mail-skeleton'
      row.tabIndex = -1
      row.setAttribute('aria-hidden', 'true')
      row.append(el('span'), el('span'), el('span'))
      return
    }
    row.tabIndex = 0
    row.dataset['key'] = entry.key
    const item = entry.kind === 'thread' ? entry.thread.newest : entry.item
    const folder = entry.folder
    const readable = this.#readable(item)
    const unread = folder === 'box' && (entry.kind === 'thread' ? entry.thread.unread > 0 : !item.marks?.read)
    const flagged = entry.kind === 'thread' ? entry.thread.flagged : !!item.marks?.flagged
    row.className = ['hc-mail-row',
      unread ? 'is-unread' : '', flagged ? 'is-flagged' : '',
      entry.kind === 'row' && entry.member ? 'is-member' : '',
      entry.kind === 'row' && entry.hidden ? 'is-hidden' : '',
      entry.kind === 'thread' && entry.open ? 'is-open' : '',
    ].filter(Boolean).join(' ')

    const whoField = folder === 'box' ? readable.from : readable.to
    const who = el('span', 'hc-mail-row-who', whoField ? withNames(whoField) : t('mail.unknown', '(unreadable)'))
    if (flagged) {
      const star = el('span', 'hc-mail-row-flag', '★')
      star.setAttribute('aria-label', t('mail.flagged', 'Flagged'))
      who.prepend(star)
    }
    row.appendChild(who)

    const main = el('span', 'hc-mail-row-main')
    main.appendChild(el('span', 'hc-mail-row-subject', readable.subject || t('mail.no-subject', '(no subject)')))
    if (entry.kind === 'thread') {
      const count = el('span', 'hc-mail-row-count', String(entry.thread.count))
      count.setAttribute('aria-label', t('mail.thread-count', '{count} messages', { count: entry.thread.count }))
      main.appendChild(count)
      row.setAttribute('aria-expanded', String(entry.open))
    }
    if (entry.kind === 'row' && entry.hidden) main.appendChild(el('span', 'hc-mail-row-folder', folder === 'box' ? t('mail.inbox', 'Inbox') : t('mail.sent-folder', 'Sent')))
    if (readable.preview) main.appendChild(el('span', 'hc-mail-row-preview', readable.preview))
    row.appendChild(main)
    row.appendChild(el('span', 'hc-mail-row-at', when(timeOf(item))))

    const acts = el('span', 'hc-mail-row-acts')
    acts.addEventListener('click', event => event.stopPropagation())
    if (entry.kind === 'row' && entry.hidden) this.#hiddenActs(acts, folder, item)
    else if (entry.kind === 'row' && folder !== 'drafts' && this.#may('mark')) {
      acts.appendChild(this.#busyButton(`hide:${item.sig}`, t('mail.hide', 'Hide'), t('mail.hiding', 'Hiding…'), () => { void this.#hide(folder, item) }, 'is-small'))
    }
    if (acts.childElementCount) row.appendChild(acts)

    const press = (): void => {
      this.#focusKey = entry.key
      if (entry.kind === 'thread') {
        if (entry.open) this.#expanded.delete(entry.thread.key); else this.#expanded.add(entry.thread.key)
        this.#syncList()
        return
      }
      if (folder === 'drafts') void this.#openDraft(item)
      else void this.#openMessage(folder, item)
    }
    row.onclick = press
    row.onkeydown = event => { if (event.key === 'Enter' && event.target === row) { event.stopPropagation(); press() } }
  }

  #hiddenActs(acts: HTMLElement, folder: Folder, item: MailListItem): void {
    const mark = this.#may('mark')
    const remove = this.#may('delete')
    if (!mark) return // a reader sees hidden mail, and does nothing to it
    acts.appendChild(this.#busyButton(`unhide:${item.sig}`, t('mail.unhide', 'Un-hide'), t('mail.unhiding', 'Bringing it back…'), () => { void this.#unhide(folder, item) }, 'is-small'))
    if (!remove) return
    const toggle = el('label', 'hc-mail-check')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = !!item.marks?.deletable
    box.disabled = this.#busy.has(`deletable:${item.sig}`)
    box.setAttribute('data-escape-local', '')
    box.addEventListener('change', () => { void this.#setDeletable(folder, item, box.checked) })
    toggle.append(box, el('span', '', t('mail.deletable', 'May be deleted')))
    acts.appendChild(toggle)
    const del = this.#busyButton(`delete:${item.sig}`, t('mail.delete', 'Delete'), t('mail.deleting', 'Deleting…'), () => { void this.#delete(folder, item) }, 'is-small is-danger')
    // Delete is the host's trash, not the end: said on the button itself, where the press is made.
    del.title = t('mail.delete-means', 'Removes it from your mailbox. The host keeps it 30 days, then it is gone.')
    // Two acts, never one: Delete waits for the participant's own "may be deleted" on this message.
    if (!(item.marks?.hidden && item.marks?.deletable)) { del.disabled = true; del.dataset['off'] = '1' }
    acts.appendChild(del)
  }

  #paintTabs(): void {
    const box = this.#lists.get('box')
    const inbox = this.#tabEls.get('inbox')
    if (inbox) inbox.dataset['count'] = String(box ? unreadCount(box.items) : 0)
  }

  #setQuery(query: string): void {
    this.#query = query
    const input = this.#panel?.querySelector<HTMLInputElement>('.hc-mail-search')
    if (input && input.value !== query) input.value = query
    this.#syncList()
  }

  #moveFocus(step: number): void {
    const rows = Array.from(this.#listEl?.querySelectorAll<HTMLElement>('.hc-mail-row') ?? [])
    if (!rows.length) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const next = at < 0 ? rows[step > 0 ? 0 : rows.length - 1]! : rows[Math.min(rows.length - 1, Math.max(0, at + step))]!
    next.focus()
    next.scrollIntoView?.({ block: 'nearest' })
  }

  #backToList(): void {
    this.#pane = { kind: 'list' }
    this.#returning = true
    this.#render()
  }

  // ── the cue ─────────────────────────────────────────────────────────────

  #cueOn(id: string, text: string, share: number | null = null, quiet = false): void {
    this.#cues.delete(id)
    this.#cues.set(id, { text, share, quiet })
    this.#paintCue()
  }

  #cueOff(id: string): void {
    if (this.#cues.delete(id)) this.#paintCue()
  }

  /** The newest act the participant pressed wins the line; a poll shows only when nothing else is going on. */
  #paintCue(): void {
    const line = this.#cueEl
    if (!line) return
    const cues = [...this.#cues.values()]
    const cue = cues.filter(c => !c.quiet).pop() ?? cues.pop()
    line.hidden = !cue
    line.classList.toggle('is-quiet', !!cue?.quiet)
    const text = line.querySelector('.hc-mail-cue-text')
    const bar = line.querySelector<HTMLElement>('.hc-mail-bar')
    const fill = line.querySelector<HTMLElement>('.hc-mail-bar-fill')
    if (text) text.textContent = cue?.text ?? ''
    if (bar && fill) {
      bar.classList.toggle('is-indeterminate', !!cue && cue.share === null)
      fill.style.width = cue && cue.share !== null ? `${Math.round(cue.share * 100)}%` : ''
    }
  }

  #say(text: string, tone: Said['tone']): void {
    this.#said = { text, tone }
    this.#paintSaid()
  }

  #paintSaid(): void {
    const said = this.#saidEl
    if (!said) return
    said.className = this.#said ? `hc-mail-said is-${this.#said.tone}` : 'hc-mail-said'
    said.textContent = this.#said?.text ?? ''
    said.hidden = !this.#said
  }

  /** Runs an act under its busy key: its button says so and cannot be pressed again until it is done. */
  async #act<T>(key: string, cue: string, run: () => Promise<T>): Promise<T | undefined> {
    if (this.#busy.has(key)) return undefined
    this.#busy.add(key)
    this.#cueOn(key, cue)
    this.#paintBusy()
    try { return await run() } finally {
      this.#busy.delete(key)
      this.#cueOff(key)
      this.#paintBusy()
    }
  }

  #paintBusy(): void {
    for (const [key, held] of this.#busyButtons) {
      if (!held.button.isConnected) { this.#busyButtons.delete(key); continue }
      const busy = this.#busy.has(key)
      held.button.textContent = busy ? held.busy : held.idle
      held.button.disabled = busy || held.button.dataset['off'] === '1'
    }
    this.#syncList()
  }

  #button(label: string, onPress: () => void, extra = ''): HTMLButtonElement {
    const button = el('button', `hc-mail-do ${extra}`.trim(), label)
    button.type = 'button'
    button.addEventListener('click', onPress)
    return button
  }

  #busyButton(key: string, idle: string, busy: string, onPress: () => void, extra = ''): HTMLButtonElement {
    const pressing = this.#busy.has(key)
    const button = this.#button(pressing ? busy : idle, onPress, extra)
    button.disabled = pressing
    this.#busyButtons.set(key, { button, idle, busy })
    return button
  }

  // ── marks ───────────────────────────────────────────────────────────────

  async #mark(folder: Folder, item: MailListItem, marks: Partial<Record<MarkName, boolean>>): Promise<MailListItem> {
    const merged = await this.service.setMarks(this.#address, folder, item.sig, marks)
    const next: MailListItem = { ...item, marks: merged }
    this.#replaceItem(folder, next)
    return next
  }

  /**
   * A mark or delete that did not happen, said in words — unless the host had already made it (it saw
   * this very signed request before, ALREADY_DONE): then there is nothing to say, and the folder is
   * read again quietly so the rows show what the host holds.
   */
  #refused(error: unknown, act: MailAct, folder: Folder, sig: string): void {
    if (error instanceof MailError && error.code === 'conflict' && error.detail === ALREADY_DONE) {
      if (act === 'delete') this.#dropItem(folder, sig)
      this.#refreshQuietly(folder)
      this.#syncList()
      return
    }
    this.#say(explain(error, false, [], { act, address: this.#address }), 'bad')
  }

  #refreshQuietly(folder: Folder): void {
    if (this.#list(folder).loading) return
    this.#loadFolder(folder, { quiet: true }).catch(() => { /* the rows on screen stay as they were */ })
  }

  async #hide(folder: Folder, item: MailListItem): Promise<void> {
    const epoch = this.#epoch
    await this.#act(`hide:${item.sig}`, t('mail.hiding', 'Hiding…'), async () => {
      try {
        await this.#mark(folder, item, { hidden: true })
        if (epoch !== this.#epoch) return
        if (this.#pane.kind === 'read' && this.#pane.item.sig === item.sig) this.#backToList()
        this.#say(t('mail.hidden-said', 'Hidden. It waits under Hidden.'), 'ok')
      } catch (error) {
        if (epoch === this.#epoch) this.#refused(error, 'mark', folder, item.sig)
      }
    })
  }

  async #unhide(folder: Folder, item: MailListItem): Promise<void> {
    const epoch = this.#epoch
    await this.#act(`unhide:${item.sig}`, t('mail.unhiding', 'Bringing it back…'), async () => {
      try {
        await this.#mark(folder, item, { hidden: false, deletable: false })
        if (epoch !== this.#epoch) return
        if (this.#pane.kind === 'read' && this.#pane.item.sig === item.sig) this.#render()
        this.#say(t('mail.unhidden', 'Back in {folder}.', { folder: folder === 'box' ? t('mail.inbox', 'Inbox') : t('mail.sent-folder', 'Sent') }), 'ok')
      } catch (error) {
        if (epoch === this.#epoch) this.#refused(error, 'mark', folder, item.sig)
      }
    })
  }

  async #setDeletable(folder: Folder, item: MailListItem, deletable: boolean): Promise<void> {
    const epoch = this.#epoch
    await this.#act(`deletable:${item.sig}`, t('mail.marking', 'Marking…'), async () => {
      try {
        await this.#mark(folder, item, { deletable })
      } catch (error) {
        if (epoch === this.#epoch) this.#refused(error, 'mark', folder, item.sig)
      }
    })
  }

  async #delete(folder: Folder, item: MailListItem): Promise<void> {
    const epoch = this.#epoch
    await this.#act(`delete:${item.sig}`, t('mail.deleting', 'Deleting…'), async () => {
      try {
        await this.service.remove(this.#address, folder, item.sig)
        if (epoch !== this.#epoch) return
        this.#dropItem(folder, item.sig)
        this.#say(t('mail.deleted', 'Deleted. The host keeps it 30 days, then it is gone.'), 'ok')
      } catch (error) {
        if (epoch === this.#epoch) this.#refused(error, 'delete', folder, item.sig)
      }
    })
  }

  async #toggleFlag(folder: Folder, item: MailListItem): Promise<void> {
    const flagged = !!item.marks?.flagged
    const epoch = this.#epoch
    await this.#act(`flag:${item.sig}`, flagged ? t('mail.unflagging', 'Unflagging…') : t('mail.flagging', 'Flagging…'), async () => {
      try {
        await this.#mark(folder, item, { flagged: !flagged })
        if (epoch === this.#epoch && this.#pane.kind === 'read' && this.#pane.item.sig === item.sig) this.#render()
      } catch (error) {
        if (epoch === this.#epoch) this.#refused(error, 'mark', folder, item.sig)
      }
    })
  }

  // ── a message ───────────────────────────────────────────────────────────

  async #openMessage(folder: Folder, item: MailListItem): Promise<void> {
    const token = ++this.#paneToken
    const epoch = this.#epoch
    const current = (): boolean => token === this.#paneToken && epoch === this.#epoch
    this.#listScroll = this.#panel?.querySelector('.hc-mail-body')?.scrollTop ?? 0
    const pane: ReadPane = { kind: 'read', folder, tab: this.#tab, item, asText: false }
    this.#pane = pane
    this.#said = null
    this.#cueOn('open', t('mail.cue.opening', 'Opening the message…'))
    this.#render()
    try {
      if (folder === 'sent') {
        pane.sent = await this.service.readSent(this.#address, item.sig)
        if (!current()) return
        pane.asText = true
        pane.previews = sentPreviews(sentFiles(pane.sent))
      } else {
        // One fetch: the raw bytes, read here. Downloads, a forward's files and Save to hive all work
        // from these same bytes, so the message is never fetched twice.
        const raw = await this.service.readRaw(this.#address, item.sig)
        if (!current()) return
        const mail = parseMail(raw)
        pane.raw = raw
        pane.mail = mail
        pane.asText = !mail.html
        // The pictures cost one more walk of the message. A small one pays it now; a large one waits
        // for the press, so opening it costs one walk however a stranger filled it.
        if (raw.length > PREVIEW_ON_PRESS) pane.picturesWait = pictureCandidates(mail.attachments).length > 0
        else pane.previews = receivedPreviews(mail, raw)
      }
    } catch (error) {
      // A MailError is the host's; anything else is a copy this window could not read the shape of.
      if (current()) pane.failed = error instanceof MailError ? explain(error, false, [], { act: 'read', address: this.#address }) : t('mail.read.broken', 'This message could not be shown.')
    } finally {
      this.#cueOff('open')
    }
    if (!current()) return
    this.#render()
    // Opened is read. Said to the host quietly; the list shows it at once.
    if (folder === 'box' && !pane.failed && !item.marks?.read && this.#may('mark')) {
      try { await this.#mark(folder, item, { read: true }); if (epoch === this.#epoch) this.#syncList() } catch { /* still unread on the host; nothing else changes */ }
    }
  }

  async #openDraft(item: MailListItem): Promise<void> {
    const token = ++this.#paneToken
    const epoch = this.#epoch
    this.#listScroll = this.#panel?.querySelector('.hc-mail-body')?.scrollTop ?? 0
    const pane: ReadPane = { kind: 'read', folder: 'drafts', tab: this.#tab, item, asText: true }
    this.#pane = pane
    this.#said = null
    this.#cueOn('open', t('mail.cue.opening-draft', 'Opening the draft…'))
    this.#render()
    try {
      const kept: MailDraft = await this.service.readDraft(this.#address, item.sig)
      if (token !== this.#paneToken || epoch !== this.#epoch) return
      const to = Array.isArray(kept.to) ? kept.to.join(', ') : String(kept.to ?? '')
      const draft: Draft = {
        to, cc: (kept.cc ?? []).join(', '), subject: kept.subject ?? '', text: kept.text ?? '',
        inReplyTo: kept.inReplyTo ?? '', references: kept.references ?? '',
      }
      const attached: Attached[] = (kept.attachments ?? []).map(file => ({
        filename: file.filename, type: file.type, size: base64Size(file.content), content: () => file.content,
      }))
      this.#compose(draft, { draftSig: item.sig, formatted: !!kept.html, attached, back: { kind: 'list' } })
      // What was opened is what is kept: it is not saved again until it changes.
      const opened = this.#pane as Pane
      if (opened.kind === 'compose') opened.savedAs = this.#draftKey(opened)
    } catch (error) {
      if (token === this.#paneToken && epoch === this.#epoch) { pane.failed = explain(error, false, [], { act: 'read', address: this.#address }); this.#render() }
    } finally {
      this.#cueOff('open')
    }
  }

  #download(filename: string, bytes: Uint8Array | null): void {
    if (!bytes) { this.#say(t('mail.download-failed', 'That attachment could not be opened.'), 'bad'); return }
    // Opaque bytes, whatever the sender called them: a stranger's "text/html" must download, never
    // render inside the hive's own origin.
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' }))
    const link = el('a')
    link.href = url
    link.download = fileName(filename)
    link.rel = 'noopener'
    link.hidden = true
    ;(this.#panel ?? document.body).appendChild(link)
    link.click()
    link.remove()
    // The browser has the bytes once the click is handled; the URL is let go on the next turn.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async #saveToHive(pane: ReadPane): Promise<void> {
    const mail = pane.mail
    const raw = pane.raw
    if (!mail || !raw) return
    const epoch = this.#epoch
    await this.#act(`hive:${pane.item.sig}`, t('mail.hive.saving', 'Saving to hive…'), async () => {
      let result: SaveMessageResult
      try {
        result = await this.saveToHive({ mail, raw, sig: pane.item.sig, attachmentBytes: oneWalk(raw, mail.attachments.map((_, index) => index)) })
      } catch (error) {
        result = { status: 'failed', placed: [], shared: [], skipped: [], message: t('mail.hive.failed', 'The message could not be saved ({reason}).', { reason: error instanceof Error ? error.message : String(error) }) }
      }
      if (epoch !== this.#epoch) return
      this.#say(result.message, result.status === 'saved' || result.status === 'already-saved' ? 'ok' : 'bad')
    })
  }

  // ── writing ─────────────────────────────────────────────────────────────

  #compose(draft?: Draft, options: { draftSig?: string | null; formatted?: boolean; attached?: Attached[]; note?: string; back?: Pane } = {}): void {
    // Write pressed while writing: the words on screen are kept before a fresh page replaces them.
    if (this.#pane.kind === 'compose') this.#leaveCompose(this.#pane, false)
    this.#autosaver().cancel()
    const pane: ComposePane = {
      kind: 'compose',
      draft: draft ?? { to: '', cc: '', subject: '', text: '', inReplyTo: '', references: '' },
      from: this.#may('send') ? this.#address : this.#senders()[0]?.address ?? this.#address,
      formatted: !!options.formatted,
      attached: options.attached ?? [],
      draftSig: options.draftSig ?? null,
      savedFrom: options.draftSig ? this.#address : null,
      savedAs: null,
      saving: false,
      again: false,
      discarded: false,
      status: null,
      sending: false,
      ...(options.note ? { note: options.note } : {}),
      back: options.back ?? (this.#pane.kind === 'compose' ? this.#pane.back : this.#pane),
    }
    this.#pane = pane
    this.#said = null
    this.#render()
    void this.#suggest()
  }

  #forward(pane: ReadPane): void {
    const mail = pane.mail
    const raw = pane.raw
    if (!mail || !raw) return
    const draft = forwardDraft(mail)
    // Carried by index: the files are read out of the raw bytes only when a send or a draft save needs
    // them, all of them in one walk.
    const bytesOf = oneWalk(raw, draft.attachments)
    const attached: Attached[] = draft.attachments.map(index => {
      const file = mail.attachments[index]!
      return { filename: file.filename, type: file.type, size: file.size, content: () => bytesOf(index) }
    })
    this.#compose(draft, { attached, back: pane })
  }

  /** Reads the form into the pane: the pane is what is saved and sent, the form is only where it is typed. */
  #capture(pane: ComposePane): void {
    const form = this.#formEl
    if (!form || this.#pane !== pane) return
    const value = (name: string): string => (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value ?? ''
    pane.draft = { to: value('to'), cc: value('cc'), subject: value('subject'), text: value('text'), inReplyTo: pane.draft.inReplyTo, references: pane.draft.references }
    const from = value('from')
    if (from) pane.from = from
    pane.formatted = !!(form.elements.namedItem('formatted') as HTMLInputElement | null)?.checked
  }

  #composeChanged(): void {
    const pane = this.#pane
    if (pane.kind !== 'compose' || pane.sending) return
    this.#capture(pane)
    this.#autosaver().call()
    this.#previewer.call()
  }

  /** What a kept draft says, minus the bytes — two drafts that say the same are one. */
  #draftKey(pane: ComposePane): string {
    const d = pane.draft
    return JSON.stringify([pane.from, d.to, d.cc, d.subject, d.text, d.inReplyTo, d.references, pane.formatted, pane.attached.map(a => [a.filename, a.size])])
  }

  #draftInput(pane: ComposePane, withFiles: boolean): MailDraftInput | null {
    const d = pane.draft
    if (!d.to.trim() && !d.cc.trim() && !d.subject.trim() && !d.text.trim() && !pane.attached.length) return null
    const attachments: MailAttachmentInput[] = []
    if (withFiles) {
      for (const file of pane.attached) {
        const content = file.content()
        if (content !== null) attachments.push({ filename: file.filename, type: wireType(file.type), content })
      }
    }
    return {
      to: d.to, cc: recipientsIn(d.cc), subject: d.subject, text: d.text,
      ...(pane.formatted ? { html: formatMessage(d.text).html } : {}),
      ...(d.inReplyTo ? { inReplyTo: d.inReplyTo } : {}),
      ...(d.references ? { references: d.references } : {}),
      ...(attachments.length ? { attachments } : {}),
    }
  }

  async #saveDraftNow(): Promise<void> {
    const pane = this.#pane
    if (pane.kind !== 'compose') return
    this.#capture(pane)
    await this.#persistDraft(pane)
  }

  /** Keeps the draft on the host. Works from the pane alone, so it can finish after the form is gone. */
  async #persistDraft(pane: ComposePane): Promise<void> {
    if (pane.sending || pane.discarded || !this.#may('draft', pane.from)) return
    if (pane.saving) { pane.again = true; return }
    const key = this.#draftKey(pane)
    if (key === pane.savedAs) return
    let input = this.#draftInput(pane, true)
    if (!input) return
    const from = pane.from
    pane.saving = true
    // Quietly, the way a poll is said: the participant is typing, and a save they did not press must
    // not take the line from an act they did.
    this.#busy.add('draft')
    this.#cueOn('draft', t('mail.draft.saving', 'Saving draft…'), null, true)
    this.#paintBusy()
    this.#paintStatus(pane, { text: t('mail.draft.saving', 'Saving draft…'), tone: 'quiet' })
    try {
      let kept: { sig: string } | null = null
      let note: string | null = null
      // A draft moved to another address leaves the old one behind on purpose: it is forgotten there.
      const replaces = pane.savedFrom === from ? pane.draftSig : null
      try {
        kept = await this.service.saveDraft(from, input, replaces)
      } catch (error) {
        if (!(error instanceof MailError && error.code === 'refused' && input.attachments?.length)) throw error
        // A draft is small on the host (1 MiB); the words are kept, the files wait for the send.
        input = this.#draftInput(pane, false)!
        kept = await this.service.saveDraft(from, input, replaces)
        note = t('mail.draft.no-files', 'Draft saved without its attachments: a draft holds at most {size}.', { size: sizeLabel(MAIL_LIMITS.draftBytes) })
      }
      if (pane.savedFrom && pane.savedFrom !== from && pane.draftSig) void this.#forgetDraft(pane.savedFrom, pane.draftSig)
      pane.draftSig = kept.sig
      pane.savedFrom = from
      pane.savedAs = key
      this.#invalidate('drafts')
      if (pane.discarded) { void this.#forgetDraft(from, kept.sig); return }
      this.#paintStatus(pane, { text: note ?? t('mail.draft.saved', 'Draft saved'), tone: note ? 'bad' : 'ok' })
    } catch (error) {
      this.#paintStatus(pane, { text: t('mail.draft.failed', 'The draft was not saved: {reason}', { reason: explain(error, false, [], { act: 'draft', address: from }) }), tone: 'bad' })
    } finally {
      pane.saving = false
      this.#busy.delete('draft')
      this.#cueOff('draft')
      this.#paintBusy()
      if (pane.again) { pane.again = false; void this.#persistDraft(pane) }
    }
  }

  async #forgetDraft(address: string, sig: string): Promise<void> {
    try { await this.service.removeDraft(address, sig) } catch { /* it stays among the drafts; the participant can discard it there */ }
    this.#invalidate('drafts')
  }

  /** Steps out of the composer; the words are kept first (the save finishes on its own). */
  #leaveCompose(pane: ComposePane, render = true): void {
    this.#autosaver().cancel()
    this.#previewer.cancel()
    this.#capture(pane)
    void this.#persistDraft(pane)
    if (!render) return
    this.#pane = pane.back.kind === 'compose' ? { kind: 'list' } : pane.back
    this.#returning = this.#pane.kind === 'list'
    this.#render()
  }

  async #discard(pane: ComposePane): Promise<void> {
    this.#autosaver().cancel()
    this.#previewer.cancel()
    pane.discarded = true
    const sig = pane.draftSig
    const address = pane.savedFrom ?? pane.from
    if (!sig) { this.#pane = pane.back.kind === 'compose' ? { kind: 'list' } : pane.back; this.#render(); return }
    const epoch = this.#epoch
    await this.#act('discard', t('mail.discarding', 'Discarding…'), async () => {
      await this.#forgetDraft(address, sig)
      if (epoch !== this.#epoch || this.#pane !== pane) return
      this.#pane = { kind: 'list' }
      this.#render()
      this.#say(t('mail.discarded', 'Draft discarded.'), 'ok')
      if (this.#tab === 'drafts') void this.#loadFolder('drafts')
    })
  }

  async #attach(pane: ComposePane, files: readonly File[]): Promise<void> {
    if (!files.length) return
    const refused: string[] = []
    this.#cueOn('files', t('mail.cue.reading-files', 'Reading the files…'))
    try {
      for (const file of files) {
        const name = file.name || 'attachment'
        if (pane.attached.length >= MAIL_LIMITS.attachments) {
          refused.push(t('mail.compose.too-many', '{name} was not added: a message carries at most {count} files.', { name, count: MAIL_LIMITS.attachments }))
          continue
        }
        const total = pane.attached.reduce((sum, a) => sum + a.size, 0)
        if (total + file.size > MAIL_LIMITS.attachmentBytes) {
          refused.push(t('mail.compose.too-large', '{name} was not added: the files may come to {size} in all.', { name, size: sizeLabel(MAIL_LIMITS.attachmentBytes) }))
          continue
        }
        let bytes: Uint8Array
        try { bytes = await fileBytes(file) } catch {
          refused.push(t('mail.compose.unreadable', '{name} could not be read.', { name }))
          continue
        }
        pane.attached.push({ filename: name, type: file.type, size: bytes.length, content: () => bytes })
      }
    } finally {
      this.#cueOff('files')
    }
    if (this.#pane !== pane) return
    pane.note = refused.length ? refused.join(' ') : undefined
    this.#paintAttached(pane)
    this.#autosaver().call()
  }

  /** THE ACT. The press is the yes; nothing above this line sends. */
  async #send(): Promise<void> {
    const pane = this.#pane
    if (pane.kind !== 'compose' || pane.sending) return
    this.#capture(pane)
    const draft = pane.draft
    const fail = (failed: string): void => {
      pane.failed = failed
      pane.sending = false
      if (this.#pane === pane) this.#render()
    }

    if (!this.#may('send', pane.from)) return fail(explain(new MailError('forbidden', 'send'), true, [], { act: 'send', address: pane.from }))
    const to = recipientsIn(draft.to)
    const cc = recipientsIn(draft.cc)
    if (!to.length) return fail(t('mail.compose.need-to', 'Add at least one address in To.'))
    if (!draft.subject.trim()) return fail(t('mail.compose.need-subject', 'Add a subject.'))
    if (!draft.text.trim()) return fail(t('mail.compose.need-body', 'Write something first.'))
    if (to.length + cc.length > MAIL_LIMITS.recipients) return fail(t('mail.compose.need-fewer', 'A message goes to at most {count} people.', { count: MAIL_LIMITS.recipients }))
    if (pane.attached.length > MAIL_LIMITS.attachments) return fail(t('mail.compose.too-many-send', 'A message carries at most {count} files.', { count: MAIL_LIMITS.attachments }))
    const attachments: MailAttachmentInput[] = []
    let total = 0
    for (const file of pane.attached) {
      const content = file.content()
      if (content === null) return fail(t('mail.compose.lost-file', '{name} could not be read, so nothing was sent.', { name: file.filename }))
      total += typeof content === 'string' ? base64Size(content) : content.length
      attachments.push({ filename: file.filename, type: wireType(file.type), content })
    }
    if (total > MAIL_LIMITS.attachmentBytes) return fail(t('mail.compose.too-large-send', 'The files come to {total}; a message carries at most {size}.', { total: sizeLabel(total), size: sizeLabel(MAIL_LIMITS.attachmentBytes) }))
    const body = pane.formatted ? formatMessage(draft.text) : { text: draft.text, html: '' }

    this.#autosaver().cancel()
    pane.sending = true
    pane.failed = undefined
    this.#cueOn('send', t('mail.sending', 'Sending…'))
    this.#render()
    const epoch = this.#epoch
    // Gone out: the draft is done with, the composer closes, and Sent is read again for the copy.
    const sent = (said: string): void => {
      pane.discarded = true
      if (pane.draftSig) void this.#forgetDraft(pane.savedFrom ?? pane.from, pane.draftSig)
      this.#invalidate('sent')
      if (epoch !== this.#epoch) return
      this.#pane = { kind: 'list' }
      this.#said = { text: said, tone: 'ok' }
      this.#render()
      if (this.#tab === 'sent') void this.#loadFolder('sent')
    }
    try {
      await this.service.send({
        from: pane.from, to, cc, subject: draft.subject.trim(), text: body.text,
        ...(body.html ? { html: body.html } : {}),
        ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}), ...(draft.references ? { references: draft.references } : {}),
        ...(attachments.length ? { attachments } : {}),
      })
      sent(t('mail.sent', 'Sent to {to}.', { to: to.join(', ') }))
    } catch (error) {
      // The host already took this very request: it went. Saying "failed" here would invite a second
      // press that sends it twice, so it is said as sent, and nothing offers to try again.
      if (error instanceof MailError && error.code === 'conflict' && error.detail === ALREADY_SENT) {
        sent(explain(error, true))
        return
      }
      if (epoch === this.#epoch) fail(explain(error, true, [...to, ...cc], { act: 'send', address: pane.from }))
    } finally {
      this.#cueOff('send')
    }
  }

  /** To/Cc suggestions: everyone this window has seen write, or been written to. Nothing is fetched for them. */
  async #suggest(): Promise<void> {
    const epoch = this.#epoch
    const seeds: ContactSeed[] = []
    for (const item of this.#lists.get('box')?.items ?? []) seeds.push(...contactsIn(this.#readable(item).from, 'inbox'))
    for (const item of this.#lists.get('sent')?.items ?? []) seeds.push(...contactsIn(this.#readable(item).to, 'sent'))
    const pane = this.#pane
    const back = pane.kind === 'compose' ? pane.back : pane
    if (back.kind === 'read' && back.mail) seeds.push(...contactsIn(back.mail.from, 'inbox'), ...contactsIn(back.mail.to, 'inbox'), ...contactsIn(back.mail.cc, 'inbox'))
    let known: Awaited<ReturnType<typeof knownAddresses>>
    try { known = await knownAddresses(seeds) } catch { return }
    if (epoch !== this.#epoch || !this.#knownEl) return
    const own = new Set(this.#boxes.map(box => box.address.toLowerCase()))
    this.#knownEl.replaceChildren(...known.filter(c => !own.has(c.address)).map(contact => {
      const option = el('option')
      option.value = contact.address
      if (contact.name && !namesAnAddress(contact.name)) option.label = contact.name
      return option
    }))
  }

  // ── the unread cue ──────────────────────────────────────────────────────

  /**
   * Polls only after the window found a mailbox (a hive that never opened mail asks nothing), and
   * never behind a NIP-07 extension: it may ask the participant to approve every signature, and a
   * prompt every 90 seconds would be the window opening itself by another name.
   */
  #startPoll(): void {
    if (this.#poller || !this.#boxes.length || (window as { nostr?: unknown }).nostr) return
    this.#poller = new Poller({
      everyMs: this.pollEveryMs,
      maxErrors: POLL_MAX_ERRORS,
      visible: () => this.visible(),
      check: () => this.#poll(),
      onGiveUp: () => { this.#poller = null },
    })
    this.#poller.start()
  }

  async #poll(): Promise<void> {
    if (this.isOpen) {
      // Open: the inbox on screen takes in what is new, quietly, and only when that disturbs nothing.
      const box = this.#lists.get('box')
      if (this.#phase !== 'ready' || this.#pane.kind !== 'list' || this.#tab !== 'inbox' || !box || box.loading) return
      await this.#loadFolder('box', { quiet: true })
      return
    }
    for (const box of this.#boxes) {
      const page = await this.service.list(box.address, 'box')
      this.#unreadBy.set(box.address, unreadCount(page.items))
    }
    this.#setUnread()
  }

  #setUnread(): void {
    this.#unread = [...this.#unreadBy.values()].reduce((sum, n) => sum + n, 0)
    EffectBus.emit(MAIL_UNREAD, { count: this.#unread })
    this.#paintPill()
  }

  /** The pill shows while the window is shut and something waits; the open window says it itself. */
  #paintPill(): void {
    if (this.#unread > 0 && !this.isOpen) {
      EffectBus.emit('indicator:set', {
        key: UNREAD_INDICATOR,
        icon: 'mail',
        label: t('mail.unread.pill', '{count} unread', { count: this.#unread }),
        dismissable: false,
        actionable: true,
      })
    } else {
      EffectBus.emit('indicator:clear', { key: UNREAD_INDICATOR })
    }
  }

  // ── the drawing ─────────────────────────────────────────────────────────

  #forgetPainted(): void {
    this.#cueEl = null
    this.#saidEl = null
    this.#listEl = null
    this.#noticeEl = null
    this.#moreEl = null
    this.#refreshEl = null
    this.#tabEls.clear()
    this.#rowEls.clear()
    this.#formEl = null
    this.#previewEl = null
    this.#attachedEl = null
    this.#composeSaidEl = null
    this.#statusEl = null
    this.#knownEl = null
    this.#busyButtons.clear()
  }

  #render(): void {
    const panel = this.#panel
    if (!panel) return
    this.#forgetPainted()
    panel.replaceChildren(this.#head(), this.#cueLine())
    this.#paintCue()
    const body = el('div', 'hc-mail-body')
    panel.appendChild(body)

    if (this.#phase === 'loading') {
      // Placeholders from the first frame: a blank pane reads as a broken one.
      const list = el('ul', 'hc-mail-list')
      list.setAttribute('aria-hidden', 'true')
      for (let i = 0; i < PLACEHOLDER_GUESS; i++) { const row = el('li', 'hc-mail-skeleton'); row.append(el('span'), el('span'), el('span')); list.appendChild(row) }
      body.appendChild(list)
      return
    }
    if (this.#phase === 'problem') {
      body.appendChild(el('p', 'hc-mail-said is-bad', this.#problem))
      body.appendChild(this.#button(t('mail.retry', 'Try again'), () => { void this.#start() }))
      return
    }
    if (this.#phase === 'no-mailbox') { this.#noMailbox(body); return }

    this.#saidEl = el('p', 'hc-mail-said')
    body.appendChild(this.#saidEl)
    this.#paintSaid()
    const pane = this.#pane
    if (pane.kind === 'compose') this.#composePane(body, pane)
    else if (pane.kind === 'read') this.#readPane(body, pane)
    else this.#listPane(body)
  }

  #head(): HTMLElement {
    const head = el('header', 'hc-mail-head')
    head.appendChild(el('span', 'hc-mail-title', t('mail.title', 'Mail')))

    if (this.#phase === 'ready') {
      if (this.#boxes.length > 1) {
        const select = el('select', 'hc-mail-address')
        select.setAttribute('aria-label', t('mail.address', 'Address'))
        select.setAttribute('data-escape-local', '')
        for (const box of this.#boxes) {
          const option = el('option', '', mailboxLabel(box))
          option.value = box.address
          option.selected = box.address === this.#address
          select.appendChild(option)
        }
        select.addEventListener('change', () => this.#chooseAddress(select.value))
        head.appendChild(select)
      } else {
        const box = this.#boxes.find(b => b.address === this.#address)
        head.appendChild(el('span', 'hc-mail-who', box ? mailboxLabel(box) : this.#address))
      }
      if (this.#may('send')) head.appendChild(this.#button(t('mail.compose', 'Write'), () => this.#compose(undefined, { back: { kind: 'list' } }), 'is-place'))
    }
    const close = el('button', 'hc-mail-close', '×')
    close.type = 'button'
    close.setAttribute('aria-label', t('panel.close', 'Close'))
    close.addEventListener('click', () => this.close())
    head.appendChild(close)
    return head
  }

  #cueLine(): HTMLElement {
    const line = el('div', 'hc-mail-cue')
    line.setAttribute('role', 'status')
    line.setAttribute('aria-live', 'polite')
    line.appendChild(el('span', 'hc-mail-cue-text'))
    const bar = el('div', 'hc-mail-bar')
    bar.appendChild(el('div', 'hc-mail-bar-fill'))
    line.appendChild(bar)
    this.#cueEl = line
    return line
  }

  #noMailbox(body: HTMLElement): void {
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none', 'This device’s key does not own a mailbox on the mail host yet.')))
    if (!this.#key) { body.appendChild(el('p', 'hc-mail-said is-bad', explain(new MailError('no-key')))); return }
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none-key', 'To give it one, tell whoever runs the mail host to add this key to the address:')))
    body.appendChild(el('code', 'hc-mail-keybox', this.#key))
    const copy = this.#button(t('mail.copy-key', 'Copy key'), () => {
      void (async () => {
        try { await navigator.clipboard.writeText(this.#key ?? ''); copy.textContent = t('mail.copied', 'Copied') } catch { /* the key is selectable above */ }
      })()
    })
    body.appendChild(copy)
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.none-note', 'It is a public key: safe to share. The secret half never leaves this device.')))
  }

  #listPane(body: HTMLElement): void {
    const tabs = el('div', 'hc-mail-tabs')
    const labels: readonly [Tab, string][] = [
      ['inbox', t('mail.inbox', 'Inbox')], ['sent', t('mail.sent-folder', 'Sent')],
      ['drafts', t('mail.drafts', 'Drafts')], ['hidden', t('mail.hidden', 'Hidden')],
    ]
    for (const [tab, label] of labels) {
      if (tab === 'drafts' && !this.#may('draft')) continue
      const button = this.#button(label, () => this.#chooseTab(tab), tab === this.#tab ? 'is-on' : '')
      button.setAttribute('aria-pressed', String(tab === this.#tab))
      this.#tabEls.set(tab, button)
      tabs.appendChild(button)
    }
    const search = el('input', 'hc-mail-search')
    search.type = 'search'
    search.value = this.#query
    search.placeholder = t('mail.search', 'Search what has opened')
    search.setAttribute('aria-label', t('mail.search-label', 'Search'))
    search.setAttribute('data-escape-local', '')
    search.addEventListener('input', () => { this.#query = search.value; this.#syncList() })
    tabs.appendChild(search)
    this.#refreshEl = this.#button(t('mail.refresh', 'Refresh'), () => this.#refresh())
    tabs.appendChild(this.#refreshEl)
    body.appendChild(tabs)

    if (this.#tab === 'hidden' && this.#may('mark') && this.#may('delete')) body.appendChild(el('p', 'hc-mail-quiet', t('mail.hidden-note', 'Hidden messages wait here. Mark one “may be deleted”, then Delete removes it from your mailbox: the host keeps it 30 days, then it is gone.')))
    this.#listEl = el('ul', 'hc-mail-list')
    body.appendChild(this.#listEl)
    this.#noticeEl = el('p', 'hc-mail-quiet')
    body.appendChild(this.#noticeEl)
    this.#moreEl = el('div', 'hc-mail-more')
    body.appendChild(this.#moreEl)
    this.#syncList()

    // Back from a message: the list is where it was, with the row that was opened in focus.
    if (!this.#returning) return
    this.#returning = false
    const scroll = this.#listScroll
    const focusKey = this.#focusKey
    queueMicrotask(() => {
      if (!body.isConnected) return
      body.scrollTop = scroll
      if (focusKey) this.#rowEls.get(focusKey)?.focus({ preventScroll: true })
    })
  }

  /**
   * A message, drawn inside a try: a copy in a shape nobody expected (a host can hand back anything)
   * must leave the way back and a line saying so, never a pane with no Back (R2 #9).
   */
  #readPane(body: HTMLElement, pane: ReadPane): void {
    const before = body.childNodes.length
    try { this.#readParts(body, pane) } catch {
      while (body.childNodes.length > before) body.lastChild!.remove()
      const bar = el('div', 'hc-mail-tabs')
      bar.appendChild(this.#button(t('mail.back', 'Back'), () => this.#backToList()))
      body.append(bar, el('p', 'hc-mail-said is-bad', t('mail.read.broken', 'This message could not be shown.')))
    }
  }

  #readParts(body: HTMLElement, pane: ReadPane): void {
    const bar = el('div', 'hc-mail-tabs')
    bar.appendChild(this.#button(t('mail.back', 'Back'), () => this.#backToList()))
    const readable = this.#readable(pane.item)

    if (pane.failed) { body.appendChild(bar); body.appendChild(el('p', 'hc-mail-said is-bad', pane.failed)); return }
    if (!pane.mail && !pane.sent) {
      // What the row already knew, at once; the body follows when it has opened.
      body.appendChild(bar)
      body.appendChild(el('h3', 'hc-mail-subject', readable.subject || t('mail.no-subject', '(no subject)')))
      const meta = el('dl', 'hc-mail-meta')
      const lines: [string, string][] = [
        [t('mail.from', 'From'), withNames(readable.from)], [t('mail.to', 'To'), withNames(readable.to)], [t('mail.date', 'Date'), when(timeOf(pane.item))],
      ]
      for (const [label, value] of lines) if (value) { meta.appendChild(el('dt', '', label)); meta.appendChild(el('dd', '', value)) }
      body.appendChild(meta)
      body.appendChild(el('p', 'hc-mail-quiet', t('mail.opening', 'Opening…')))
      const lines2 = el('div', 'hc-mail-skeleton-text')
      lines2.setAttribute('aria-hidden', 'true')
      for (let i = 0; i < 4; i++) lines2.appendChild(el('span'))
      body.appendChild(lines2)
      return
    }

    const lines: [string, string][] = pane.mail
      ? [[t('mail.from', 'From'), pane.mail.from], [t('mail.to', 'To'), pane.mail.to], [t('mail.cc', 'Cc'), pane.mail.cc], [t('mail.date', 'Date'), pane.mail.date]]
      : [[t('mail.from', 'From'), pane.sent!.name ? `${pane.sent!.name} <${pane.sent!.from}>` : String(pane.sent!.from ?? '')], [t('mail.to', 'To'), joined(pane.sent!.to)], [t('mail.cc', 'Cc'), joined(pane.sent!.cc)], [t('mail.date', 'Date'), when(pane.sent!.at)]]
    const subject = String(pane.mail?.subject ?? pane.sent!.subject ?? '')
    const html = String(pane.mail?.html ?? pane.sent?.html ?? '')

    if (pane.mail && this.#may('send')) {
      const mail = pane.mail
      bar.appendChild(this.#button(t('mail.reply', 'Reply'), () => this.#compose(replyDraft(mail, this.#address), { back: pane })))
      bar.appendChild(this.#button(t('mail.reply-all', 'Reply all'), () => this.#compose(replyDraft(mail, this.#address, true), { back: pane })))
      bar.appendChild(this.#button(t('mail.forward', 'Forward'), () => this.#forward(pane)))
    }
    if (html) bar.appendChild(this.#button(pane.asText ? t('mail.show-html', 'Show formatted') : t('mail.show-text', 'Show plain text'), () => { pane.asText = !pane.asText; this.#render() }))
    const item = pane.item
    if (this.#may('mark')) {
      const flagged = !!item.marks?.flagged
      bar.appendChild(this.#busyButton(`flag:${item.sig}`, flagged ? t('mail.unflag', 'Unflag') : t('mail.flag', 'Flag'),
        flagged ? t('mail.unflagging', 'Unflagging…') : t('mail.flagging', 'Flagging…'), () => { void this.#toggleFlag(pane.folder, item) }))
      if (item.marks?.hidden) bar.appendChild(this.#busyButton(`unhide:${item.sig}`, t('mail.unhide', 'Un-hide'), t('mail.unhiding', 'Bringing it back…'), () => { void this.#unhide(pane.folder, item) }))
      else bar.appendChild(this.#busyButton(`hide:${item.sig}`, t('mail.hide', 'Hide'), t('mail.hiding', 'Hiding…'), () => { void this.#hide(pane.folder, item) }))
    }
    body.appendChild(bar)

    body.appendChild(el('h3', 'hc-mail-subject', subject || t('mail.no-subject', '(no subject)')))
    const meta = el('dl', 'hc-mail-meta')
    for (const [label, value] of lines) {
      if (!value) continue
      meta.appendChild(el('dt', '', label))
      meta.appendChild(el('dd', '', value))
    }
    body.appendChild(meta)

    if (html && !pane.asText) {
      const safe = makeMailHtmlSafe(html, pane.mail?.inlineImages ?? {})
      if (safe.blocked) body.appendChild(el('p', 'hc-mail-quiet', t('mail.blocked', '{n} remote items were not loaded, so nothing outside could see you open this.', { n: safe.blocked })))
      body.appendChild(frame(mailFrameDocument(safe.html), t('mail.message', 'Message')))
    } else {
      body.appendChild(el('pre', 'hc-mail-text', pane.mail?.text ?? pane.sent!.text))
    }

    this.#attachmentsOf(body, pane)

    if (pane.mail && pane.raw) {
      const keep = el('div', 'hc-mail-acts hc-mail-keep')
      keep.appendChild(this.#busyButton(`hive:${item.sig}`, t('mail.hive.save', 'Save to hive'), t('mail.hive.saving', 'Saving to hive…'), () => { void this.#saveToHive(pane) }))
      keep.appendChild(el('span', 'hc-mail-privacy', t('mail.hive.privacy', 'Saving puts this message’s text, its raw bytes and its attachments into the hive unsealed, so whatever you share from that page carries the message with it.')))
      body.appendChild(keep)
    }
  }

  #attachmentsOf(body: HTMLElement, pane: ReadPane): void {
    const raw = pane.raw
    const files = pane.mail && raw
      ? pane.mail.attachments.map((file, index) => ({ filename: file.filename, type: file.type, size: file.size, bytes: () => attachmentBytes(raw, index) }))
      : sentFiles(pane.sent).map(file => ({ filename: String(file.filename ?? ''), type: file.type, size: base64Size(file.content), bytes: () => sentAttachmentBytes(file) }))
    if (!files.length) return
    body.appendChild(el('p', 'hc-mail-quiet', t('mail.files', 'Attachments — nothing opens until you press Download:')))
    const list = el('ul', 'hc-mail-attachments')
    for (const file of files) {
      const row = el('li')
      row.appendChild(el('span', 'hc-mail-attachment-name', `${file.filename} · ${file.type} · ${sizeLabel(file.size)}`))
      row.appendChild(this.#button(t('mail.download', 'Download'), () => this.#download(file.filename, file.bytes()), 'is-small'))
      list.appendChild(row)
    }
    body.appendChild(list)
    if (pane.picturesWait) {
      const wait = el('div', 'hc-mail-acts')
      wait.appendChild(this.#busyButton(`pictures:${pane.item.sig}`, t('mail.previews.show', 'Show pictures'), t('mail.previews.showing', 'Opening the pictures…'), () => { void this.#showPictures(pane) }))
      wait.appendChild(el('span', 'hc-mail-quiet', t('mail.previews.large', 'This message is large, so its pictures wait for a press.')))
      body.appendChild(wait)
    }
    if (pane.previews) body.appendChild(frame(pane.previews, t('mail.previews', 'Pictures in this message'), 'is-previews'))
  }

  /** A large message's pictures, on the press: the button says so for the frame it takes to read them. */
  async #showPictures(pane: ReadPane): Promise<void> {
    const mail = pane.mail
    const raw = pane.raw
    if (!mail || !raw || !pane.picturesWait) return
    await this.#act(`pictures:${pane.item.sig}`, t('mail.previews.showing', 'Opening the pictures…'), async () => {
      // One turn first, so the pressed button and the line are painted before the walk holds the thread.
      await new Promise(resolve => setTimeout(resolve, 0))
      if (this.#pane !== pane) return
      pane.previews = receivedPreviews(mail, raw)
      pane.picturesWait = false
    })
    if (this.#pane !== pane) return
    this.#render()
    if (!pane.previews) this.#say(t('mail.previews.none', 'None of its pictures could be shown.'), 'quiet')
  }

  #composePane(body: HTMLElement, pane: ComposePane): void {
    const form = el('form', 'hc-mail-form')
    form.noValidate = true
    form.addEventListener('submit', event => { event.preventDefault(); void this.#send() })
    form.addEventListener('input', () => this.#composeChanged())
    this.#formEl = form

    const field = <T extends HTMLInputElement | HTMLTextAreaElement>(node: T, name: string, label: string, value: string): HTMLLabelElement => {
      const wrap = el('label', 'hc-mail-field')
      wrap.appendChild(el('span', '', label))
      node.name = name
      node.value = value
      node.disabled = pane.sending
      node.setAttribute('data-escape-local', '')
      wrap.appendChild(node)
      return wrap
    }

    const senders = this.#senders()
    if (senders.length > 1) {
      const wrap = el('label', 'hc-mail-field')
      wrap.appendChild(el('span', '', t('mail.from', 'From')))
      const select = el('select')
      select.name = 'from'
      select.setAttribute('data-escape-local', '')
      for (const box of senders) { const o = el('option', '', mailboxLabel(box)); o.value = box.address; o.selected = box.address === pane.from; select.appendChild(o) }
      select.disabled = pane.sending
      select.addEventListener('change', () => this.#composeChanged())
      wrap.appendChild(select)
      form.appendChild(wrap)
    }
    const to = el('input')
    to.setAttribute('list', KNOWN_LIST_ID)
    to.autocomplete = 'off'
    form.appendChild(field(to, 'to', t('mail.to', 'To'), pane.draft.to))
    const cc = el('input')
    cc.setAttribute('list', KNOWN_LIST_ID)
    cc.autocomplete = 'off'
    form.appendChild(field(cc, 'cc', t('mail.cc', 'Cc'), pane.draft.cc))
    form.appendChild(field(el('input'), 'subject', t('mail.subject', 'Subject'), pane.draft.subject))

    const formatting = el('label', 'hc-mail-check')
    const toggle = el('input')
    toggle.type = 'checkbox'
    toggle.name = 'formatted'
    toggle.checked = pane.formatted
    toggle.disabled = pane.sending
    toggle.setAttribute('data-escape-local', '')
    toggle.addEventListener('change', () => { this.#composeChanged(); this.#paintPreview() })
    formatting.append(toggle, el('span', '', t('mail.compose.formatting', 'Formatting')))
    form.appendChild(formatting)

    const text = el('textarea', 'hc-mail-compose-text')
    text.rows = 12
    form.appendChild(field(text, 'text', t('mail.message', 'Message'), pane.draft.text))

    const preview = el('div', 'hc-mail-preview')
    preview.appendChild(el('p', 'hc-mail-hint', t('mail.compose.marks', '**bold**  _italic_  `code`  - list  1. list  > quote  # heading  [text](https://…)')))
    preview.appendChild(frame(mailFrameDocument(''), t('mail.compose.preview', 'Preview'), 'is-preview'))
    this.#previewEl = preview
    form.appendChild(preview)

    const files = el('div', 'hc-mail-files')
    this.#attachedEl = files
    form.appendChild(files)

    this.#composeSaidEl = el('p', 'hc-mail-said is-bad')
    form.appendChild(this.#composeSaidEl)
    if (pane.failed) form.appendChild(el('p', 'hc-mail-said is-bad', pane.failed))
    const acts = el('div', 'hc-mail-acts')
    if (this.#may('send', pane.from)) {
      const send = el('button', 'hc-mail-do is-place', pane.sending ? t('mail.sending', 'Sending…') : t('mail.send', 'Send'))
      send.type = 'submit'
      send.disabled = pane.sending
      acts.appendChild(send)
    }
    if (this.#may('draft', pane.from)) {
      const save = this.#busyButton('draft', t('mail.draft.save', 'Save draft'), t('mail.draft.saving', 'Saving draft…'), () => { this.#autosaver().cancel(); void this.#saveDraftNow() })
      if (pane.sending) { save.disabled = true; save.dataset['off'] = '1' }
      acts.appendChild(save)
    }
    const cancel = this.#busyButton('discard', t('mail.discard', 'Discard'), t('mail.discarding', 'Discarding…'), () => { void this.#discard(pane) })
    if (pane.sending) { cancel.disabled = true; cancel.dataset['off'] = '1' }
    acts.appendChild(cancel)
    form.appendChild(acts)
    this.#statusEl = el('p', 'hc-mail-status')
    form.appendChild(this.#statusEl)

    this.#knownEl = el('datalist')
    this.#knownEl.id = KNOWN_LIST_ID
    form.appendChild(this.#knownEl)
    body.appendChild(form)

    this.#paintAttached(pane)
    this.#paintStatus(pane, pane.status)
    this.#paintPreview()
    if (pane.draft.subject || pane.draft.to) queueMicrotask(() => (form.elements.namedItem(pane.draft.to ? 'text' : 'to') as HTMLElement | null)?.focus())
  }

  #paintPreview(): void {
    const pane = this.#pane
    const preview = this.#previewEl
    if (pane.kind !== 'compose' || !preview) return
    preview.hidden = !pane.formatted
    if (!pane.formatted) return
    const shown = preview.querySelector('iframe')
    if (shown) shown.srcdoc = mailFrameDocument(formatMessage(pane.draft.text).html)
  }

  #paintAttached(pane: ComposePane): void {
    const files = this.#attachedEl
    if (!files || this.#pane !== pane) return
    files.replaceChildren()
    const total = pane.attached.reduce((sum, file) => sum + file.size, 0)
    const caps = t('mail.compose.caps', 'Up to {count} files, {size} in all.', { count: MAIL_LIMITS.attachments, size: sizeLabel(MAIL_LIMITS.attachmentBytes) })
    if (pane.attached.length) {
      const list = el('ul', 'hc-mail-attachments')
      pane.attached.forEach((file, index) => {
        const row = el('li')
        row.appendChild(el('span', 'hc-mail-attachment-name', `${file.filename} · ${sizeLabel(file.size)}`))
        const remove = this.#button(t('mail.compose.remove', 'Remove'), () => {
          pane.attached.splice(index, 1)
          this.#paintAttached(pane)
          this.#autosaver().call()
        }, 'is-small')
        remove.disabled = pane.sending
        row.appendChild(remove)
        list.appendChild(row)
      })
      files.appendChild(list)
    }
    const pick = el('label', 'hc-mail-pick')
    const input = el('input')
    input.type = 'file'
    input.multiple = true
    input.disabled = pane.sending || pane.attached.length >= MAIL_LIMITS.attachments
    input.setAttribute('data-escape-local', '')
    input.addEventListener('change', () => {
      const picked = Array.from(input.files ?? [])
      input.value = ''
      void this.#attach(pane, picked)
    })
    pick.append(el('span', '', t('mail.compose.attach', 'Attach files')), input)
    files.appendChild(pick)
    files.appendChild(el('p', 'hc-mail-quiet', pane.attached.length ? `${caps} ${sizeLabel(total)}` : caps))
    if (this.#composeSaidEl) {
      this.#composeSaidEl.textContent = pane.note ?? ''
      this.#composeSaidEl.hidden = !pane.note
    }
  }

  #paintStatus(pane: ComposePane, status: Said | null): void {
    pane.status = status
    const line = this.#statusEl
    if (!line || this.#pane !== pane) return
    line.textContent = status?.text ?? ''
    line.className = status ? `hc-mail-status is-${status.tone}` : 'hc-mail-status'
  }
}

const frame = (srcdoc: string, title: string, extra = ''): HTMLIFrameElement => {
  const node = el('iframe', `hc-mail-frame ${extra}`.trim())
  node.setAttribute('sandbox', FRAME_SANDBOX)
  node.setAttribute('referrerpolicy', 'no-referrer')
  node.title = title
  node.srcdoc = srcdoc
  return node
}

// `Re:` alone is kept for callers that draft a reply from a bare subject.
export { replySubject }

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* The same material as every other tool window — the recipe restated
       with the SHARED values, since a module cannot @use the stylesheet. */
    ${SURFACE} { display: contents; }
    .hc-mail {
      position: fixed;
      top: max(calc(2.3rem * var(--hc-header-zoom, 1.0)), var(--hc-header-anchor, 0px));
      right: var(--hc-controls-right, 0px); bottom: 0;
      width: min(44rem, calc(100vw - 1.5rem)); min-width: 16rem;
      box-sizing: border-box; display: flex; flex-direction: column;
      z-index: 100002;
      background: rgba(13, 15, 21, 0.975);
      backdrop-filter: blur(14px) saturate(1.04);
      -webkit-backdrop-filter: blur(14px) saturate(1.04);
      border: 0; border-left: 1px solid rgba(${STEEL}, 0.38); border-radius: 0;
      box-shadow: -14px 0 44px rgba(0, 0, 0, 0.46);
      color: #dfe6ee; font: 0.8125rem/1.45 system-ui, sans-serif;
    }
    .hc-mail [hidden] { display: none !important; }
    .hc-mail-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.8rem; border-bottom: 1px solid rgba(${STEEL}, 0.22); }
    .hc-mail-title { font-weight: 600; letter-spacing: 0.02em; }
    .hc-mail-who, .hc-mail-address { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: 0.8; }
    .hc-mail-address { background: transparent; color: inherit; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; padding: 0.15rem 0.3rem; }
    .hc-mail-close { margin-left: auto; background: none; border: 0; color: inherit; font-size: 1.2rem; line-height: 1; cursor: pointer; opacity: 0.7; }
    .hc-mail-close:hover { opacity: 1; }

    /* THE CUE: what the window is doing, under the header, with a bar that fills as rows open. */
    .hc-mail-cue { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.3rem 0.8rem 0.35rem; font-size: 0.75rem; border-bottom: 1px solid rgba(${STEEL}, 0.14); }
    .hc-mail-cue-text { opacity: 0.85; }
    .hc-mail-cue.is-quiet .hc-mail-cue-text { opacity: 0.55; }
    .hc-mail-bar { position: relative; height: 2px; overflow: hidden; background: rgba(${STEEL}, 0.16); }
    .hc-mail-bar-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: rgb(${ACCENT}); transition: width 0.18s ease-out; }
    .hc-mail-cue.is-quiet .hc-mail-bar-fill { background: rgba(${STEEL}, 0.7); }
    .hc-mail-bar.is-indeterminate .hc-mail-bar-fill { width: 30%; animation: hc-mail-slide 1.1s ease-in-out infinite; }
    @keyframes hc-mail-slide { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
    .hc-mail-skeleton { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) 4rem; gap: 0.6rem; padding: 0.6rem 0.3rem; border-bottom: 1px solid rgba(${STEEL}, 0.1); }
    .hc-mail-skeleton > span, .hc-mail-skeleton-text > span { display: block; height: 0.6rem; border-radius: 2px; background: rgba(${STEEL}, 0.13); animation: hc-mail-glow 1.4s ease-in-out infinite; }
    .hc-mail-skeleton-text { display: flex; flex-direction: column; gap: 0.5rem; }
    .hc-mail-skeleton-text > span:nth-child(2n) { width: 82%; }
    .hc-mail-skeleton-text > span:last-child { width: 46%; }
    @keyframes hc-mail-glow { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .hc-mail-bar.is-indeterminate .hc-mail-bar-fill { animation: none; width: 100%; opacity: 0.5; }
      .hc-mail-skeleton > span, .hc-mail-skeleton-text > span { animation: none; }
    }

    .hc-mail-body { flex: 1; min-height: 0; overflow: auto; padding: 0.7rem 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; }
    .hc-mail-quiet { margin: 0; opacity: 0.65; }
    .hc-mail-said { margin: 0; padding: 0.4rem 0.6rem; border-radius: 2px; border: 1px solid rgba(${STEEL}, 0.3); }
    .hc-mail-said.is-ok { border-color: rgba(120, 200, 140, 0.55); }
    .hc-mail-said.is-bad { border-color: rgba(220, 110, 110, 0.65); }
    .hc-mail-do { background: rgba(${STEEL}, 0.12); color: inherit; border: 1px solid rgba(${STEEL}, 0.4); border-radius: 2px; padding: 0.25rem 0.65rem; cursor: pointer; font: inherit; }
    .hc-mail-do:hover:not(:disabled) { background: rgba(${STEEL}, 0.22); }
    .hc-mail-do:disabled { opacity: 0.5; cursor: default; }
    .hc-mail-do.is-place, .hc-mail-do.is-on { border-color: rgba(${ACCENT}, 0.75); color: rgb(${ACCENT}); }
    .hc-mail-do.is-small { padding: 0.05rem 0.4rem; font-size: 0.75rem; }
    .hc-mail-do.is-danger:not(:disabled) { border-color: rgba(220, 110, 110, 0.65); }
    .hc-mail-do[data-count]:not([data-count="0"])::after { content: attr(data-count); margin-left: 0.35rem; color: rgb(${ACCENT}); font-weight: 600; }
    .hc-mail-tabs, .hc-mail-acts { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
    .hc-mail-search { flex: 1; min-width: 8rem; background: rgba(255, 255, 255, 0.05); color: inherit; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; padding: 0.25rem 0.5rem; font: inherit; }
    .hc-mail-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .hc-mail-row { display: grid; grid-template-columns: minmax(0, 11rem) minmax(0, 1fr) auto auto; align-items: center; gap: 0.6rem; padding: 0.45rem 0.3rem; border-bottom: 1px solid rgba(${STEEL}, 0.14); cursor: pointer; }
    .hc-mail-row:hover, .hc-mail-row:focus { background: rgba(${STEEL}, 0.1); outline: none; }
    .hc-mail-row:focus-visible { box-shadow: inset 2px 0 0 rgb(${ACCENT}); }
    .hc-mail-row > span, .hc-mail-row-main > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hc-mail-row-main { display: flex; align-items: baseline; gap: 0.4rem; min-width: 0; }
    .hc-mail-row-subject { flex: 0 1 auto; min-width: 0; }
    .hc-mail-row-preview { flex: 1 1 0; min-width: 0; opacity: 0.5; }
    .hc-mail-row-count, .hc-mail-row-folder { flex: none; padding: 0 0.3rem; border: 1px solid rgba(${STEEL}, 0.35); border-radius: 2px; font-size: 0.6875rem; opacity: 0.85; }
    .hc-mail-row-flag { margin-right: 0.3rem; color: rgb(${ACCENT}); }
    .hc-mail-row-at { opacity: 0.6; font-size: 0.75rem; }
    .hc-mail-row.is-unread .hc-mail-row-who, .hc-mail-row.is-unread .hc-mail-row-subject { font-weight: 600; }
    .hc-mail-row.is-member { padding-left: 1.3rem; background: rgba(${STEEL}, 0.04); }
    .hc-mail-row.is-open { border-bottom-color: transparent; }
    .hc-mail-row.is-hidden > .hc-mail-row-who, .hc-mail-row.is-hidden > .hc-mail-row-main, .hc-mail-row.is-hidden > .hc-mail-row-at { opacity: 0.5; }
    .hc-mail-row-acts { display: flex; align-items: center; gap: 0.35rem; visibility: hidden; }
    .hc-mail-row:hover .hc-mail-row-acts, .hc-mail-row:focus-within .hc-mail-row-acts, .hc-mail-row.is-hidden .hc-mail-row-acts { visibility: visible; }
    .hc-mail-check { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.75rem; cursor: pointer; }
    .hc-mail-subject { margin: 0; font-size: 1rem; }
    .hc-mail-meta { display: grid; grid-template-columns: auto 1fr; gap: 0.1rem 0.6rem; margin: 0; opacity: 0.85; }
    .hc-mail-meta dt { opacity: 0.6; } .hc-mail-meta dd { margin: 0; overflow-wrap: anywhere; }
    .hc-mail-frame { width: 100%; height: 60vh; border: 1px solid rgba(${STEEL}, 0.25); border-radius: 2px; background: #fff; }
    .hc-mail-frame.is-previews, .hc-mail-frame.is-preview { height: 14rem; }
    .hc-mail-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    .hc-mail-attachments { margin: 0; padding-left: 1.1rem; opacity: 0.9; display: flex; flex-direction: column; gap: 0.25rem; }
    .hc-mail-attachments li { display: flex; align-items: center; gap: 0.5rem; }
    .hc-mail-attachment-name { overflow-wrap: anywhere; }
    .hc-mail-keep { align-items: flex-start; }
    .hc-mail-privacy { flex: 1; min-width: 12rem; font-size: 0.75rem; opacity: 0.6; }
    .hc-mail-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .hc-mail-field { display: flex; flex-direction: column; gap: 0.15rem; }
    .hc-mail-field > span, .hc-mail-pick > span { opacity: 0.6; font-size: 0.75rem; }
    .hc-mail-field input, .hc-mail-field textarea, .hc-mail-field select { background: rgba(255, 255, 255, 0.05); color: inherit; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; padding: 0.35rem 0.5rem; font: inherit; }
    .hc-mail-compose-text { resize: vertical; min-height: 10rem; }
    .hc-mail-preview { display: flex; flex-direction: column; gap: 0.3rem; }
    .hc-mail-hint { margin: 0; font-size: 0.75rem; opacity: 0.55; font-family: ui-monospace, monospace; }
    .hc-mail-files { display: flex; flex-direction: column; gap: 0.3rem; }
    .hc-mail-pick { display: flex; flex-direction: column; gap: 0.15rem; }
    .hc-mail-pick input { font: inherit; color: inherit; }
    .hc-mail-status { margin: 0; min-height: 1rem; font-size: 0.75rem; opacity: 0.6; }
    .hc-mail-status.is-bad { opacity: 0.9; color: rgb(230, 140, 140); }
    .hc-mail-keybox { display: block; padding: 0.5rem 0.6rem; border: 1px solid rgba(${STEEL}, 0.3); border-radius: 2px; overflow-wrap: anywhere; user-select: all; font-size: 0.75rem; }
  `
  document.head.appendChild(style)
}
