// pools/open-entries.ts
//
// AN OPEN ENTRY POOL, AS THE HIVE AND THE PAGE READ IT (documentation/
// open-entry-pools.md). A leader opens a pool by one key in their own signed
// index, and anyone handed the code posts a small signed member of kind 30573
// to the leader's host. This file is the names, the shapes and the reader, for
// any meaning: what an entry IS (a recipe today) is the caller's to read from
// `content`. The flows that write (open, close, recycle, hide, post) are in
// open-entries-flows.ts and are built over what is here.
//
//   P      the key the leader's index is kept under on the host
//   O      the signature of the opening record (an atom, at most 1 KB)
//   nonce  16 random bytes as 32 lowercase hex: the capability, kept with the
//          hive's other secrets (core EntryNonceStore), never in a pool
//   A      sha256("entries" NUL O NUL nonce): the pool's address
//   until  the pool's end, whole seconds, decimal
//   H      sha256("entries:pool" NUL A NUL P NUL until): what the index names
//
// A is a capability, so it is computed with the signature service directly and
// never registered as a pool meaning: the registry is a public census.
//
// One signed event is one member: the body is exactly the UTF-8 bytes of
// JSON.stringify over the seven fields in a fixed order, and a body spelled
// any other way is refused, as the host refuses it. A listing is never proof
// (M1): every member is trusted by its own bytes, and the hidden list only when
// it hashes to the name the host handed out. Every read is bounded in time,
// size and count, and nothing here throws. A dependency: it registers nothing.

import { I18N_IOC_KEY, OPEN_ENTRY_KIND, SignatureService, get, parsePostCode, postCodeFragment, type I18nProvider, type PostCode } from '@hypercomb/core'
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { HOST_CONCURRENCY, fetchWithDeadline, mapBounded } from '../sharing/bounded-fetch.js'
import { bareHost, originOf } from '../sharing/zone-door.js'
import { readBodyCapped } from './bounded-body.js'
import type { PoolNode } from './pool-node.js'

/** The design's numbers, in one place. They are the owner's to change, and the host holds the same ones. */
export const ENTRY_LIMITS = Object.freeze({
  /** A whole member, words and all. */
  memberBytes: 4096,
  /** Members a listing gives, and a reader takes. */
  listed: 256,
  /** Members a reader keeps of one key: the newest. */
  perKey: 8,
  /** A member's stamp against the host's clock, either way. */
  stampSeconds: 600,
  /** How long a pool lasts unless the leader picks another end. */
  defaultSeconds: 86_400,
  /** How far ahead a pool's end may be, by the host's clock. */
  untilMaxSeconds: 31 * 86_400,
  /** What a leader's clock may run ahead of the host's and still open a pool of the longest end: the stamp window. */
  clockMarginSeconds: 600,
  /** How long a pool stays readable after its end. */
  keptSeconds: 30 * 86_400,
  /** The opening record. */
  recordBytes: 1024,
  /** The leader's hidden list. */
  hiddenBytes: 64 * 1024,
  /** A poster's name, and an entry's title, in UTF-16 units (recipe-template.ts line()). */
  name: 48,
  title: 120,
})

/** The three headers of the host's own on a pool's listing (blossom-worker worker.js serveEntryListing),
 *  and the two query parameters every read and post carries. The names live here and nowhere else. */
export const ENTRY_LISTING_HEADERS = Object.freeze({
  state: 'X-Entries-State',
  hidden: 'X-Entries-Hidden',
  hostTime: 'X-Host-Time',
  reason: 'X-Reason',
  by: 'by',
  until: 'until',
})

/** What a host says of a pool. Null: this host does not know it (not opened, recycled, a wrong code, an older host). */
export type EntryPoolState = 'open' | 'closed' | 'expired' | null

const SIG = /^[0-9a-f]{64}$/
const NONCE = /^[0-9a-f]{32}$/
const SCHNORR_SIG = /^[0-9a-f]{128}$/
const UNTIL = /^[1-9][0-9]{0,11}$/
const HOST_TIMEOUT_MS = 8_000
/** One listing line is a name and a newline: room for one name past the limit, so an overfull listing is seen. */
const LISTING_READ_BYTES = (ENTRY_LIMITS.listed + 1) * 65
/** Pools whose members this page remembers, and members remembered for one pool. Memory only. */
const POOLS_HELD_MAX = 8
const MEMBERS_HELD_MAX = 1024

const utf8 = new TextEncoder()
const strictText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  let said: string | undefined
  try { said = get<I18nProvider>(I18N_IOC_KEY)?.t(key, params) } catch { said = undefined }
  const text = said && said !== key ? said : fallback
  return params ? text.replace(/\{(\w+)\}/g, (hole, name: string) => name in params ? String(params[name]) : hole) : text
}

const exact = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
const signatureOf = (bytes: Uint8Array): Promise<string> => SignatureService.sign(exact(bytes))
const hashOfText = (text: string): Promise<string> => signatureOf(utf8.encode(text))
const hex = (bytes: Uint8Array): string => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, at) => byte === b[at])

/** Bytes, from this realm or another (a test page's TextEncoder answers in its own). */
const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'
const isSig = (value: unknown): value is string => typeof value === 'string' && SIG.test(value)
/** A pool's end as the path spells it: whole seconds, decimal, no other form. */
const isUntil = (value: unknown): value is number => Number.isSafeInteger(value) && UNTIL.test(String(value))

/**
 * The latest end a pool opened at `nowSeconds` (this device's clock) may have.
 * The host refuses an end more than 31 days ahead of ITS clock, and a leader's
 * clock may run ahead of the host's, so the end is kept ten minutes (the stamp
 * window a member is allowed either way) inside the 31 days. This is the one
 * place the cap is computed: what the leader picks and what the open flow
 * writes both come through it.
 */
export const latestEntryUntil = (nowSeconds: number): number =>
  Math.floor(nowSeconds) + ENTRY_LIMITS.untilMaxSeconds - ENTRY_LIMITS.clockMarginSeconds

/** An entry's meaning: `family:name`, no spaces, nothing unprintable (P4). */
export const isEntryMeaning = (meaning: unknown): meaning is string =>
  typeof meaning === 'string' && meaning.includes(':') && meaning.length <= 160 && !/[\s\u0000-\u001f\u007f]/.test(meaning)

// recipe-template.ts line(): a tab passes; a line break, any other control
// character or a direction embedding, override or isolate does not.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const BIDI = /[‪-‮⁦-⁩]/

/** One line, the reader's own rule (recipe-template.ts line(), required): text, not blank after trimming, at most
 *  `max` UTF-16 units, no line break, control character or direction override. The host keeps the same rule, so
 *  nothing it stores is later refused for its name or title. */
export const isEntryLine = (value: unknown, max: number): value is string =>
  typeof value === 'string' && !!value.trim() && value.length <= max && !CONTROL.test(value) && !/[\r\n]/.test(value) && !BIDI.test(value)

// ── the names ───────────────────────────────────────────────────────────────

/** 16 random bytes as 32 lowercase hex: a fresh pool's nonce. */
export const newEntryNonce = (): string => hex(crypto.getRandomValues(new Uint8Array(16)))

/** A fresh 64-hex page: a new entry. The same page again replaces an entry. */
export const newEntryPage = (): string => hex(crypto.getRandomValues(new Uint8Array(32)))

/** A = sha256("entries" NUL O NUL nonce), or '' when either part is not the hex it must be. */
export async function entryPoolAddress(record: string, nonce: string): Promise<string> {
  if (!isSig(record) || !NONCE.test(String(nonce ?? ''))) return ''
  return hashOfText(`entries\u0000${record}\u0000${nonce}`)
}

/** H = sha256("entries:pool" NUL A NUL P NUL until), or '' when a part is not what it must be. */
export async function entryPoolName(address: string, by: string, until: number): Promise<string> {
  if (!isSig(address) || !isSig(by) || !isUntil(until)) return ''
  return hashOfText(`entries:pool\u0000${address}\u0000${by}\u0000${until}`)
}

/** The three keys a pool may be named under in the leader's index. */
export const entryIndexKeys = (pool: string): { open: string; closed: string; hidden: string } =>
  ({ open: `entries:${pool}`, closed: `entries-closed:${pool}`, hidden: `entries-hidden:${pool}` })

/** The pool an index key names, and how: '' for a key that is none of the three. */
export const entryKeyOf = (key: string): { pool: string; as: 'open' | 'closed' | 'hidden' } | null => {
  const m = /^entries(|-closed|-hidden):([0-9a-f]{64})$/.exec(String(key ?? ''))
  if (!m) return null
  return { pool: m[2], as: m[1] === '' ? 'open' : m[1] === '-closed' ? 'closed' : 'hidden' }
}

/** The path of a page address (`https://zone/a/b` opens at `/a/b`), never its query or fragment: '/' for a site door. */
const pathOfPage = (page: string): string => {
  const text = String(page ?? '').trim()
  const rest = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slash = rest.indexOf('/')
  const path = slash >= 0 ? rest.slice(slash).split(/[?#]/)[0] ?? '/' : '/'
  return /^\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*$/.test(path) ? path : '/'
}

/** The page's own address, as a visitor's browser asks for it: its origin and its own path, never a query or fragment.
 *  '' for a page that names no origin. */
export const entryPageUrl = (page: string): string => {
  const origin = originOf(page)
  return origin ? `${origin}${pathOfPage(page)}` : ''
}

/** The link a leader shows: the page's own address with `#post=<O>~<nonce>`, or '' when the page or a part is not
 *  valid. A page that opens at a path keeps it; every read and post still goes to the page's origin. */
export const entryCodeLink = (page: string, record: string, nonce: string): string => {
  const origin = originOf(page)
  const fragment = postCodeFragment(record, nonce)
  return origin && fragment ? `${origin}${pathOfPage(page)}${fragment}` : ''
}

/** May a code be shown for this address? A `host.` or `try-` address refuses every write, so never: a label that is
 *  `host`, or one that starts with `try-`, ANYWHERE in the host (`kitchen.try-example.com` is a try address too). */
export const isOfferablePage = (page: string): boolean => {
  const bare = bareHost(page)
  const name = bare.replace(/:\d{1,5}$/, '')
  return !!originOf(bare) && !name.split('.').some(label => label === 'host' || label.startsWith('try-'))
}

/** The code a link or a bare fragment carries, or null. */
export const entryCodeOf = (text: unknown): PostCode | null => {
  const raw = String(text ?? '').trim()
  const at = raw.indexOf('#')
  return parsePostCode(at >= 0 ? raw.slice(at) : raw)
}

// ── the opening record ──────────────────────────────────────────────────────

/** What a pool is opened for: public, named by its signature O. */
export interface EntryOpeningRecord {
  /** What an entry is, as a meaning: `recipe:entry`. */
  readonly meaning: string
  /** What the pool is called: one line, at most 120. */
  readonly title: string
  /** The signature of what a poster fills in (a recipe's template). */
  readonly template: string
  /** P: the key the leader's index is kept under on the host. */
  readonly by: string
  /** The pool's end, whole seconds. */
  readonly until: number
  /** The page the code opens. Optional: records made before it was carried have none. It reveals nothing the code
   *  does not (the code IS a link to the page), and it is what lets another of the leader's devices place the pool
   *  on its page: this record is the one thing about a pool such a device can read. */
  readonly page?: string
}

/** The longest page a record carries: an address, never a document. */
const RECORD_PAGE_MAX = 256

/** Is this a page a record may carry: an address with an origin, one line, no longer than an address is. */
const isRecordPage = (page: unknown): page is string =>
  typeof page === 'string' && page.length > 0 && page.length <= RECORD_PAGE_MAX && page === page.trim()
  && !/[\s\u0000-\u001f\u007f]/.test(page) && !!originOf(page)

/** The record's canonical bytes: the six fields in one order, then the page when there is one, as JSON.stringify
 *  writes them. A record without a page is spelled exactly as before it was carried. It checks nothing. */
export const entryRecordBytes = (record: EntryOpeningRecord): Uint8Array =>
  utf8.encode(JSON.stringify({
    'entries:open': 1, meaning: record.meaning, title: record.title, template: record.template, by: record.by, until: record.until,
    ...(record.page !== undefined ? { page: record.page } : {}),
  }))

export type ParsedEntryRecord =
  | { ok: true; record: EntryOpeningRecord; sig: string }
  | { ok: false; reason: string }

/** Read an opening record from its bytes, strictly: at most 1 KB, the six fields (and the page when given) and no other, each as it must be,
 *  and spelled exactly as entryRecordBytes spells them. With `expectedSig` a mismatch is refused (S3). Never throws. */
export async function parseEntryRecord(bytes: Uint8Array, expectedSig?: string): Promise<ParsedEntryRecord> {
  const refuse = (reason: string): ParsedEntryRecord => ({ ok: false, reason })
  try {
    if (!isBytes(bytes) || bytes.byteLength > ENTRY_LIMITS.recordBytes) return refuse('an opening record is at most 1 KB')
    const sig = await signatureOf(bytes)
    if (expectedSig !== undefined && sig !== expectedSig) return refuse('the record does not hash to its name')
    const doc = JSON.parse(strictText.decode(bytes)) as Record<string, unknown> | null
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return refuse('an opening record is a JSON object')
    if (doc['entries:open'] !== 1) return refuse('not an opening record')
    const record: EntryOpeningRecord = {
      meaning: doc['meaning'] as string, title: doc['title'] as string, template: doc['template'] as string,
      by: doc['by'] as string, until: doc['until'] as number,
      ...(Object.hasOwn(doc, 'page') ? { page: doc['page'] as string } : {}),
    }
    if (!isEntryMeaning(record.meaning)) return refuse('the record names no meaning')
    if (!isEntryLine(record.title, ENTRY_LIMITS.title)) return refuse('the record\'s title is not one line of 1 to 120 characters')
    if (!isSig(record.template) || !isSig(record.by)) return refuse('the record names its template and its key by 64 lowercase hex')
    if (!isUntil(record.until)) return refuse('the record\'s end is not whole seconds')
    if (record.page !== undefined && !isRecordPage(record.page)) return refuse('the record\'s page is not an address')
    if (!sameBytes(entryRecordBytes(record), bytes)) return refuse('an opening record is spelled one way')
    return { ok: true, record, sig }
  } catch { return refuse('an opening record is a JSON object') }
}

// ── the member ──────────────────────────────────────────────────────────────

/** The signed event, as the fixed spelling holds it. */
export interface EntryEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: string[][]
  readonly content: string
  readonly sig: string
}

/** One entry to post, or take back (`gone`). */
export interface EntryMemberInput {
  /** H: the pool it is for. */
  readonly pool: string
  /** Which entry this is: a new one per entry (newEntryPage), the same again to replace it. */
  readonly page: string
  /** Who is posting: one line, at most 48. */
  readonly name: string
  /** What the entry is called: one line, at most 120. */
  readonly title: string
  /** The entry itself, as text: for a recipe, its canonical JSON (recipe-template.ts recipeBytes). */
  readonly content: string
  /** Seconds: the host's time at the press. */
  readonly createdAt: number
  /** Takes that page back. */
  readonly gone?: boolean
}

/** The fixed spelling: the UTF-8 bytes of JSON.stringify over the seven fields in this order. The signing library
 *  returns them in another order, so they are always written out here. */
export const entryMemberBody = (event: EntryEvent): Uint8Array =>
  utf8.encode(JSON.stringify({
    id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content, sig: event.sig,
  }))

export type SignedEntryMember =
  | { ok: true; event: EntryEvent; body: Uint8Array; name: string }
  | { ok: false; reason: string }

/** The tags of a member, in the order every builder writes them. */
const memberTags = (input: EntryMemberInput): string[][] => [
  ['pool', input.pool], ['page', input.page], ['name', input.name], ['title', input.title], ...(input.gone ? [['gone', '1']] : []),
]

/**
 * Sign one member with `secretKey` (a key made in memory for this page load,
 * never the shell's signer) and spell it the one way. Refused, in words, when
 * a field breaks a rule a reader or the host would refuse it for, or when the
 * whole member is over 4 KB. Never throws.
 */
export async function signEntryMember(input: EntryMemberInput, secretKey: Uint8Array): Promise<SignedEntryMember> {
  const refuse = (reason: string): SignedEntryMember => ({ ok: false, reason })
  try {
    if (!isSig(input?.pool) || !isSig(input.page)) return refuse(t('pools.posts.refuse.page', 'An entry names its pool and its page by signature.'))
    if (!isEntryLine(input.name, ENTRY_LIMITS.name)) {
      return refuse(t('pools.posts.refuse.name', 'Your name is one line of 1 to {max} characters.', { max: ENTRY_LIMITS.name }))
    }
    if (!isEntryLine(input.title, ENTRY_LIMITS.title)) {
      return refuse(t('pools.posts.refuse.title', 'The title is one line of 1 to {max} characters.', { max: ENTRY_LIMITS.title }))
    }
    if (typeof input.content !== 'string' || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
      return refuse(t('pools.posts.refuse.sign', 'The entry could not be signed.'))
    }
    const signed = finalizeEvent({ kind: OPEN_ENTRY_KIND, created_at: input.createdAt, tags: memberTags(input), content: input.content }, secretKey)
    const event: EntryEvent = {
      id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at, kind: signed.kind, tags: signed.tags, content: signed.content, sig: signed.sig,
    }
    const body = entryMemberBody(event)
    if (body.byteLength > ENTRY_LIMITS.memberBytes) {
      return refuse(t('pools.posts.refuse.size', 'This entry is {over} bytes over what one entry may hold.', { over: body.byteLength - ENTRY_LIMITS.memberBytes }))
    }
    return { ok: true, event, body, name: await signatureOf(body) }
  } catch { return refuse(t('pools.posts.refuse.sign', 'The entry could not be signed.')) }
}

/** How many bytes are left for `content` in a member with these fields: the plain measure a form shows. */
export function entryRoomLeft(input: Omit<EntryMemberInput, 'createdAt'> & { createdAt?: number }): number {
  // A signed member's id, key and signature are fixed-width hex, so a placeholder of the same width measures it.
  const event: EntryEvent = {
    id: '0'.repeat(64), pubkey: '0'.repeat(64), created_at: input.createdAt ?? 1_800_000_000, kind: OPEN_ENTRY_KIND,
    tags: memberTags(input as EntryMemberInput), content: String(input.content ?? ''), sig: '0'.repeat(128),
  }
  return ENTRY_LIMITS.memberBytes - entryMemberBody(event).byteLength
}

/** A member as a reader takes it: its name, who signed it, and what it says. */
export interface EntryMember {
  /** The member's name: the hash of its bytes. */
  readonly name: string
  /** The key that signed it. */
  readonly signer: string
  /** Seconds, as signed. */
  readonly at: number
  readonly page: string
  /** What the poster called themselves. */
  readonly label: string
  readonly title: string
  readonly gone: boolean
  readonly content: string
  readonly bytes: Uint8Array
}

/** The tags of a member: exactly one each of pool, page, name, title, at most one gone (`'1'`), and nothing else. */
const entryTags = (tags: unknown): Record<string, string> | null => {
  if (!Array.isArray(tags)) return null
  const found: Record<string, string> = {}
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length !== 2 || typeof tag[0] !== 'string' || typeof tag[1] !== 'string') return null
    if (!['pool', 'page', 'name', 'title', 'gone'].includes(tag[0]) || Object.hasOwn(found, tag[0])) return null
    found[tag[0]] = tag[1]
  }
  if (!['pool', 'page', 'name', 'title'].every(name => Object.hasOwn(found, name))) return null
  if (Object.hasOwn(found, 'gone') && found['gone'] !== '1') return null
  return found
}

/**
 * The strict verifier a reader uses: bytes as a member of pool `H`, or null.
 * The bytes hash to `name` (when given), are at most 4 KB, are the fixed
 * spelling of a kind-30573 event with exactly the member's tags, its `pool`
 * tag is `H`, its name, title and page keep their rules, its id is the
 * lowercase hash the reader computes and its signature is valid. Never throws.
 */
export async function readEntryMember(bytes: Uint8Array, pool: string, name?: string): Promise<EntryMember | null> {
  try {
    if (!isBytes(bytes) || bytes.byteLength === 0 || bytes.byteLength > ENTRY_LIMITS.memberBytes || !isSig(pool)) return null
    const hash = await signatureOf(bytes)
    if (name !== undefined && hash !== name) return null
    const evt = JSON.parse(strictText.decode(bytes)) as Record<string, unknown> | null
    if (!evt || typeof evt !== 'object' || Array.isArray(evt)) return null
    if (evt['kind'] !== OPEN_ENTRY_KIND) return null
    if (!isSig(evt['id']) || !isSig(evt['pubkey']) || !Number.isSafeInteger(evt['created_at']) || (evt['created_at'] as number) < 0) return null
    if (typeof evt['content'] !== 'string' || typeof evt['sig'] !== 'string' || !SCHNORR_SIG.test(evt['sig'])) return null
    const tags = entryTags(evt['tags'])
    if (!tags) return null
    const event = evt as unknown as EntryEvent
    if (!sameBytes(entryMemberBody(event), bytes)) return null
    if (tags['pool'] !== pool || !isSig(tags['page'])) return null
    if (!isEntryLine(tags['name'], ENTRY_LIMITS.name) || !isEntryLine(tags['title'], ENTRY_LIMITS.title)) return null
    // The signature check hashes the event itself and refuses an id that is not that hash (lowercase by the rule
    // above). nostr-tools keeps a verdict on the object it is handed; a copy keeps it off this one.
    if (!verifyEvent(structuredClone(event) as never)) return null
    return {
      name: hash, signer: event.pubkey, at: event.created_at, page: tags['page'] as string,
      label: tags['name'] as string, title: tags['title'] as string, gone: tags['gone'] === '1', content: event.content, bytes,
    }
  } catch { return null }
}

// ── the hidden list ─────────────────────────────────────────────────────────

/** The leader's list of what honest readers do not show: a poster's key, or one page of a key. */
export interface EntryHiddenList {
  /** Lines `k:<key>`. */
  readonly keys: readonly string[]
  /** Lines `<key>:<page>`. */
  readonly pages: readonly string[]
}

/** One line of the hidden list: a key, or one page of a key. */
export type EntryHiddenLine = { readonly key: string; readonly page?: string }

const KEY_LINE = /^k:[0-9a-f]{64}$/
const PAGE_LINE = /^[0-9a-f]{64}:[0-9a-f]{64}$/

/** The line as the list spells it. No line is a bare 64-hex string: a HEAD_ONLY host would follow it as a signature
 *  and keep served whatever it names. '' for a key or page that is not 64 lowercase hex. */
export const hiddenLineText = (line: EntryHiddenLine): string => {
  const key = String(line?.key ?? '')
  if (!isSig(key)) return ''
  if (line.page === undefined) return `k:${key}`
  return isSig(line.page) ? `${key}:${line.page}` : ''
}

export const emptyHiddenList = (): EntryHiddenList => ({ keys: [], pages: [] })

/** The list's canonical bytes: its lines once each, sorted, so one list is one signature. It checks nothing. */
export const hiddenListBytes = (list: EntryHiddenList): Uint8Array =>
  utf8.encode(JSON.stringify({ 'entries:hidden': 1, keys: [...new Set(list.keys)].sort(), pages: [...new Set(list.pages)].sort() }))

/** Read a hidden list strictly: at most 64 KB, the three fields and no other, every line of its shape and once.
 *  With `expectedSig` a mismatch is refused. Null for anything else. Never throws. */
export async function parseHiddenList(bytes: Uint8Array, expectedSig?: string): Promise<EntryHiddenList | null> {
  try {
    if (!isBytes(bytes) || bytes.byteLength > ENTRY_LIMITS.hiddenBytes) return null
    if (expectedSig !== undefined && await signatureOf(bytes) !== expectedSig) return null
    const doc = JSON.parse(strictText.decode(bytes)) as Record<string, unknown> | null
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    if (Object.keys(doc).sort().join(',') !== 'entries:hidden,keys,pages' || doc['entries:hidden'] !== 1) return null
    const keys = doc['keys']
    const pages = doc['pages']
    if (!Array.isArray(keys) || !Array.isArray(pages)) return null
    if (!keys.every(line => typeof line === 'string' && KEY_LINE.test(line))) return null
    if (!pages.every(line => typeof line === 'string' && PAGE_LINE.test(line))) return null
    if (new Set(keys).size !== keys.length || new Set(pages).size !== pages.length) return null
    return { keys: keys as string[], pages: pages as string[] }
  } catch { return null }
}

/** The list with one line hidden (`hide`) or shown again. A line already as asked leaves the list as it was. */
export function withHiddenLine(list: EntryHiddenList, line: EntryHiddenLine, hide: boolean): EntryHiddenList {
  const text = hiddenLineText(line)
  if (!text) return list
  const field = line.page === undefined ? 'keys' : 'pages'
  const lines = new Set(list[field])
  if (hide) lines.add(text)
  else lines.delete(text)
  return { ...list, [field]: [...lines] }
}

/** Is this key, or this page of it, on the list? */
export const isHidden = (list: EntryHiddenList | null, key: string, page: string): boolean =>
  !!list && (list.keys.includes(`k:${key}`) || list.pages.includes(`${key}:${page}`))

// ── the reader's fold ───────────────────────────────────────────────────────

/** One entry a reader draws: the member that stands for its key and page. */
export interface EntryRow {
  /** The key that signed it: the node the row sits under. */
  readonly signer: string
  /** What the poster typed as their name: what someone typed, never proof of who they are. */
  readonly label: string
  readonly title: string
  readonly page: string
  /** Seconds, never later than the reader's clock. */
  readonly at: number
  readonly content: string
  /** The member's name and bytes: what a row is opened and brought home from. */
  readonly member: string
  readonly bytes: Uint8Array
}

/** Why a reader draws nothing from a pool it reached. */
export type EntryFoldRefusal = 'hidden-unread'

export interface EntryFold {
  readonly rows: EntryRow[]
  /** The host listed more than 256: a host that is not keeping the rule. The first 256 were read. */
  readonly over: boolean
  readonly why?: EntryFoldRefusal
}

/**
 * What a reader draws from a pool's verified members, given in the order the
 * host listed them: at most 8 a key (the newest), then one per key and page
 * (the newest stands), `gone` removes the page, then the hidden list. A stamp
 * ahead of `nowSeconds` counts as now, and two dated the same are ordered by
 * the raw stamp, then the name, so every reader picks the same one. When the
 * host named a hidden list (`hidden.named`) and it could not be read and
 * verified (`hidden.list` null), nothing is drawn: a reader never draws around
 * a missing list. Rows keep the listing's order (a key's first member, then
 * its page's), because a stamp never decides who is shown first. Pure.
 */
export function foldEntryMembers(
  members: readonly EntryMember[],
  options: { nowSeconds: number; hidden?: { named: string | null; list: EntryHiddenList | null }; over?: boolean },
): EntryFold {
  const over = options.over === true
  if (options.hidden?.named && !options.hidden.list) return { rows: [], over, why: 'hidden-unread' }
  const now = Math.floor(options.nowSeconds)
  const dated = (member: EntryMember): number => Math.min(member.at, now)
  const newestFirst = (a: EntryMember, b: EntryMember): number =>
    dated(b) - dated(a) || b.at - a.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

  // Where each key and each key's page first appears in the listing: the order rows are drawn in.
  const keyAt = new Map<string, number>()
  const pageAt = new Map<string, number>()
  const once = new Map<string, EntryMember>()
  members.forEach((member, at) => {
    if (once.has(member.name)) return
    once.set(member.name, member)
    if (!keyAt.has(member.signer)) keyAt.set(member.signer, at)
    const page = `${member.signer}:${member.page}`
    if (!pageAt.has(page)) pageAt.set(page, at)
  })

  const byKey = new Map<string, EntryMember[]>()
  for (const member of once.values()) byKey.set(member.signer, [...(byKey.get(member.signer) ?? []), member])
  const standing: EntryMember[] = []
  for (const held of byKey.values()) {
    const kept = [...held].sort(newestFirst).slice(0, ENTRY_LIMITS.perKey)
    const pages = new Set<string>()
    for (const member of kept) {
      if (pages.has(member.page)) continue
      pages.add(member.page)
      standing.push(member)
    }
  }
  const list = options.hidden?.list ?? null
  const rows = standing
    .filter(member => !member.gone && !isHidden(list, member.signer, member.page))
    .sort((a, b) => (keyAt.get(a.signer) as number) - (keyAt.get(b.signer) as number)
      || (pageAt.get(`${a.signer}:${a.page}`) as number) - (pageAt.get(`${b.signer}:${b.page}`) as number))
    .map((member): EntryRow => ({
      signer: member.signer, label: member.label, title: member.title, page: member.page,
      at: dated(member), content: member.content, member: member.name, bytes: member.bytes,
    }))
  return { rows, over }
}

/** Where a row came from, as a node: the participant who signed it, by the name they typed (pools/pool-node.ts). */
export const entryRowNode = (row: EntryRow, own = ''): PoolNode => ({
  kind: 'participant',
  id: row.signer,
  ...(row.label ? { name: row.label } : {}),
  ...(own && row.signer === own ? { you: true } : {}),
})

// ── the listing ─────────────────────────────────────────────────────────────

/** One pool's listing, as the host answered it. */
export interface EntryListing {
  /** False: the host did not answer (network, deadline). Nothing was learned. */
  readonly reached: boolean
  /** The HTTP status, when it answered. */
  readonly status?: number
  readonly state: EntryPoolState
  /** The members the host wrote first, at most 256, in its order. */
  readonly names: string[]
  /** The host listed more than 256. */
  readonly over: boolean
  /** The signature of the leader's hidden list, when the host names one. */
  readonly hidden: string | null
  /** The host's clock, whole seconds, when it said. */
  readonly hostTime: number | null
  /** The host's own words (X-Reason), one line. */
  readonly said: string
  /** Milliseconds on this device's clock when the host's answer arrived: what the host's time is measured
   *  against. Absent on a listing that never arrived, or one a caller made without a clock. */
  readonly readAt?: number
}

/** Where one pool is read and posted: the page's origin, and the three parts the host proves the pool from. */
export interface EntryPoolPath {
  /** The page the code opens (a host, or an origin). */
  readonly page: string
  /** A, P and until. */
  readonly address: string
  readonly by: string
  readonly until: number
}

/** The pool's query, as every read and post carries it. */
export const entryPoolQuery = (by: string, until: number): string =>
  `?${ENTRY_LISTING_HEADERS.by}=${by}&${ENTRY_LISTING_HEADERS.until}=${until}`

/** `/<A>/?by=&until=` at the page's own origin, or '' when a part is not valid. */
export const entryListingUrl = (path: EntryPoolPath): string => {
  const origin = originOf(path.page)
  return origin && isSig(path.address) && isSig(path.by) && isUntil(path.until)
    ? `${origin}/${path.address}/${entryPoolQuery(path.by, path.until)}`
    : ''
}

/** `/<A>/<member>?by=&until=`: where a member is posted, or ''. */
export const entryMemberUrl = (path: EntryPoolPath, member: string): string => {
  const listing = entryListingUrl(path)
  return listing && isSig(member) ? listing.replace(/\/\?/, `/${member}?`) : ''
}

const NOT_REACHED: EntryListing = Object.freeze({ reached: false, state: null, names: [], over: false, hidden: null, hostTime: null, said: '' }) as EntryListing

/** The first `limit` bytes of a body and whether it ran past them; the rest is never asked for. */
const readPrefix = async (response: Response, limit: number): Promise<{ bytes: Uint8Array; more: boolean }> => {
  const reader = response.body?.getReader()
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer())
    return { bytes: all.subarray(0, limit), more: all.byteLength > limit }
  }
  const parts: Uint8Array[] = []
  let size = 0
  let more = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = limit - size
    if (value.byteLength > room) {
      parts.push(value.subarray(0, room))
      size = limit
      more = true
      await reader.cancel().catch(() => undefined)
      break
    }
    parts.push(value)
    size += value.byteLength
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) { out.set(part, at); at += part.byteLength }
  return { bytes: out, more }
}

/** A listing response as an EntryListing: its headers checked to their shapes, its names to 64 hex, the first 256.
 *  `readAt` is this device's clock when the response arrived (readEntryListing takes it). */
export async function entryListingOf(response: Response, readAt?: number): Promise<EntryListing> {
  const header = (name: string): string => String(response.headers.get(name) ?? '').trim()
  const stated = header(ENTRY_LISTING_HEADERS.state)
  const state: EntryPoolState = stated === 'open' || stated === 'closed' || stated === 'expired' ? stated : null
  const hidden = header(ENTRY_LISTING_HEADERS.hidden).toLowerCase()
  const time = header(ENTRY_LISTING_HEADERS.hostTime)
  const said = header(ENTRY_LISTING_HEADERS.reason).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 160)
  const base = {
    reached: true, status: response.status, state, said,
    hidden: state && SIG.test(hidden) ? hidden : null,
    hostTime: /^[0-9]{1,12}$/.test(time) ? Number(time) : null,
    ...(Number.isFinite(readAt) ? { readAt: readAt as number } : {}),
  }
  // Only a pool the host knows has a listing of this kind: anything else is the ordinary answer, never read as one.
  if (!state || response.status !== 200 || state === 'expired') {
    await response.body?.cancel().catch(() => undefined)
    return { ...base, names: [], over: false }
  }
  const { bytes, more } = await readPrefix(response, LISTING_READ_BYTES)
  const lines = new TextDecoder().decode(bytes).split('\n')
  // A cut body may end inside a name: only whole lines are names.
  if (more) lines.pop()
  const names = [...new Set(lines.map(line => line.trim()).filter(line => SIG.test(line)))]
  return { ...base, names: names.slice(0, ENTRY_LIMITS.listed), over: more || names.length > ENTRY_LIMITS.listed }
}

/** Every external a read touches. Each optional: the live one stands in for any left out. */
export interface EntryReadDeps {
  /** A fetch with a deadline: `fetchWithDeadline` unless a spec hands one in. */
  fetch?(url: string, init: RequestInit): Promise<Response>
  /** Milliseconds on this device's clock. */
  now?(): number
}

const liveFetch = (url: string, init: RequestInit): Promise<Response> => fetchWithDeadline(url, init, { timeoutMs: HOST_TIMEOUT_MS })

/**
 * The pool's listing, asked fresh at the page's own origin (never through
 * the shared pool-listing reader, which may answer from a copy): the state,
 * the names, the hidden list's signature and the host's clock from the host's
 * own headers, and this device's clock at the moment the answer arrived
 * (`readAt`), so the host's time is measured against when it was said, not
 * against whatever was read after it. Unreachable: `reached: false`. Never
 * throws.
 */
export async function readEntryListing(path: EntryPoolPath, deps: EntryReadDeps = {}): Promise<EntryListing> {
  try {
    const url = entryListingUrl(path)
    if (!url) return NOT_REACHED
    const response = await (deps.fetch ?? liveFetch)(url, { cache: 'no-store', credentials: 'omit' })
    return await entryListingOf(response, (deps.now ?? Date.now)())
  } catch { return NOT_REACHED }
}

/** host - this device, in whole seconds, from a listing: what a page stamps with. 0 when unknown. The device's time
 *  is the listing's own `readAt` when it carries one, else `localMs`. */
export const hostOffsetOf = (listing: Pick<EntryListing, 'hostTime' | 'readAt'>, localMs: number): number =>
  listing.hostTime === null ? 0 : listing.hostTime - Math.floor((listing.readAt ?? localMs) / 1000)

// ── reading a pool ──────────────────────────────────────────────────────────

/** A pool as a reader draws it. */
export interface EntryPoolRead {
  readonly reached: boolean
  readonly state: EntryPoolState
  readonly rows: EntryRow[]
  readonly over: boolean
  /** host - this device, whole seconds: the stamp a post should carry is now plus this. */
  readonly offset: number
  /** The hidden list as read, for the leader's Hide and Show again. */
  readonly hidden: { readonly named: string | null; readonly list: EntryHiddenList | null }
  /** Why nothing was drawn from a pool the host knows. */
  readonly why?: EntryFoldRefusal
  /** The host's own words, one line. */
  readonly said: string
  /** Every member the listing named that verified, in the listing's order, before the fold: what a poster's page
   *  counts its own changes from. Absent when nothing was listed. */
  readonly members?: readonly EntryMember[]
}

/** pool address → member name → the member as read, or null for bytes that are not one. A member's bytes hash to
 *  its name, so its reading never changes and it is fetched once. Memory only, the oldest pool let go first. */
const held = new Map<string, Map<string, EntryMember | null>>()

const heldFor = (address: string): Map<string, EntryMember | null> => {
  let pool = held.get(address)
  if (!pool) {
    pool = new Map()
    held.set(address, pool)
    if (held.size > POOLS_HELD_MAX) held.delete(held.keys().next().value as string)
  }
  return pool
}

/** Forget every member read on this page: a spec's reset between cases. */
export const forgetEntryMembers = (): void => { held.clear() }

/** What one atom read found: its bytes; or none, with whether the host answered (it holds nothing by that name)
 *  or did not (the network, the deadline, a host error: a brief failure, not an answer). */
export type EntryAtomAnswer =
  | { readonly bytes: Uint8Array }
  | { readonly bytes: null; readonly reached: boolean }

/**
 * One atom at the page's origin, `/<sig>` then `/content/<sig>`, kept only
 * when it hashes to its name. `reached: false` when a spelling went
 * unanswered and none served it; `reached: true` with no bytes when the host
 * answered both spellings and holds nothing by that name. Never throws.
 */
export async function readEntryAtomAnswer(page: string, sig: string, limit: number, deps: EntryReadDeps = {}): Promise<EntryAtomAnswer> {
  const origin = originOf(page)
  if (!origin || !isSig(sig)) return { bytes: null, reached: true }
  let unanswered = false
  for (const at of [`/${sig}`, `/content/${sig}`]) {
    try {
      const response = await (deps.fetch ?? liveFetch)(`${origin}${at}`, { credentials: 'omit' })
      if (response.status !== 200) {
        if (response.status >= 500) unanswered = true
        await response.body?.cancel().catch(() => undefined)
        continue
      }
      const bytes = await readBodyCapped(response, limit)
      if (bytes?.byteLength && await signatureOf(bytes) === sig) return { bytes }
    } catch { unanswered = true /* the other spelling, then nothing */ }
  }
  return { bytes: null, reached: !unanswered }
}

/** One atom at the page's origin, `/<sig>` then `/content/<sig>`, kept only when it hashes to its name. */
export async function readEntryAtom(page: string, sig: string, limit: number, deps: EntryReadDeps = {}): Promise<Uint8Array | null> {
  return (await readEntryAtomAnswer(page, sig, limit, deps)).bytes
}

/**
 * A pool as a reader draws it: the listing, each member fetched by its name
 * (at most 256, a few at once, each verified by its own bytes), the hidden
 * list when the host names one (fetched and verified, or nothing is drawn),
 * then the fold on the host's clock when it gave one. `pool` is H, which a
 * caller holding A, P and until computes once (entryPoolName). A closed pool
 * still draws what was posted; an expired or unknown one draws nothing.
 * Never throws.
 */
export async function readEntryPool(path: EntryPoolPath, pool: string, deps: EntryReadDeps = {}): Promise<EntryPoolRead> {
  const nowMs = (): number => (deps.now ?? Date.now)()
  const empty = (listing: EntryListing): EntryPoolRead => ({
    reached: listing.reached, state: listing.state, rows: [], over: listing.over,
    offset: hostOffsetOf(listing, nowMs()), hidden: { named: listing.hidden, list: null }, said: listing.said,
  })
  try {
    const listing = await readEntryListing(path, deps)
    if (!isSig(pool) || (listing.state !== 'open' && listing.state !== 'closed')) return empty(listing)
    const origin = originOf(path.page)
    const fetchOne = deps.fetch ?? liveFetch

    const known = heldFor(path.address)
    const unread = listing.names.filter(name => !known.has(name))
    const fetched = await mapBounded(unread, HOST_CONCURRENCY, async (name) => {
      const response = await fetchOne(`${origin}/${path.address}/${name}`, { credentials: 'omit' })
      if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); return undefined }
      const bytes = await readBodyCapped(response, ENTRY_LIMITS.memberBytes)
      // Bytes that are not the ones named may be a bad transfer: asked again next time, never remembered.
      if (!bytes || await signatureOf(bytes) !== name) return undefined
      return readEntryMember(bytes, pool, name)
    })
    unread.forEach((name, at) => {
      const member = fetched[at]
      if (member !== undefined && (known.has(name) || known.size < MEMBERS_HELD_MAX)) known.set(name, member)
    })
    const members = listing.names.map(name => known.get(name)).filter((member): member is EntryMember => !!member)

    const hiddenBytes = listing.hidden ? await readEntryAtom(path.page, listing.hidden, ENTRY_LIMITS.hiddenBytes, deps) : null
    const list = hiddenBytes && listing.hidden ? await parseHiddenList(hiddenBytes, listing.hidden) : null
    // Measured against the moment the listing arrived: the member reads after it take time of their own.
    const offset = hostOffsetOf(listing, nowMs())
    const fold = foldEntryMembers(members, {
      nowSeconds: listing.hostTime ?? Math.floor(nowMs() / 1000),
      hidden: { named: listing.hidden, list },
      over: listing.over,
    })
    return {
      reached: true, state: listing.state, rows: fold.rows, over: fold.over, offset,
      hidden: { named: listing.hidden, list }, ...(fold.why ? { why: fold.why } : {}), said: listing.said, members,
    }
  } catch {
    return { reached: false, state: null, rows: [], over: false, offset: 0, hidden: { named: null, list: null }, said: '' }
  }
}

/** The reader's refusal or the pool's state as one plain sentence a page or the leader's hive can show. */
export function entryPoolSentence(read: Pick<EntryPoolRead, 'reached' | 'state' | 'why' | 'over'>): string {
  if (!read.reached) return t('pools.posts.read.unreachable', 'The host did not answer. Try again in a moment.')
  if (read.why === 'hidden-unread') {
    return t('pools.posts.read.hidden-unread', 'The leader\'s list of hidden entries did not arrive, so nothing from this pool is shown.')
  }
  if (read.state === null) return t('pools.posts.read.unknown', 'This host is not taking posts for this code.')
  if (read.state === 'expired') return t('pools.posts.read.expired', 'This one has expired.')
  if (read.state === 'closed') return t('pools.posts.read.closed', 'This one is closed.')
  return read.over
    ? t('pools.posts.read.over', 'This host listed more entries than a pool holds. The first {max} are shown.', { max: ENTRY_LIMITS.listed })
    : t('pools.posts.read.open', 'This one is open.')
}
