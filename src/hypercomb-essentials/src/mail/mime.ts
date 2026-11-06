// mail/mime.ts
//
// ONE MESSAGE, READ. Bytes in (the raw RFC 5322 / MIME message the mail Worker
// sealed), a plain object out: who, what, when, the text, the html, and the
// attachments by name. Pure: no DOM, no network, no storage.
//
// ── NOTHING IS FETCHED ─────────────────────────────────────────────────────
//
// An inline image is read out of the message itself or not at all. A message
// that points at an image on someone else's server is never followed here, so
// reading mail cannot make this browser contact a host we do not control
// (no-third-party-requests.md). The html is made safe in mail-html.ts.
//
// ── LIMITS ──────────────────────────────────────────────────────────────────
//
// A message is untrusted input from anywhere. Depth, part count and inline
// image sizes are capped so a hostile one cannot spend the tab's memory.
//
// ── AN ATTACHMENT IS OPENED WHEN IT IS ASKED FOR ───────────────────────────
//
// parseMail lists attachments by name, type and size and lets their bytes go.
// A message can carry 25 MB of them, and a list of messages is read far more
// often than an attachment is opened. When one is wanted, attachmentBytes walks
// the same raw message again, under the same caps, to the n-th attachment as
// parseMail numbered it — the raw bytes are the truth, held once, by the window.

export interface MailAttachment {
  readonly filename: string
  readonly type: string
  readonly size: number
}

export interface ParsedMail {
  readonly from: string
  readonly to: string
  readonly cc: string
  readonly replyTo: string
  readonly subject: string
  readonly date: string
  readonly messageId: string
  readonly inReplyTo: string
  readonly references: string
  readonly text: string
  readonly html: string
  readonly attachments: readonly MailAttachment[]
  /** Content-ID (no angle brackets) → data: URL, for images the message carries itself. */
  readonly inlineImages: Readonly<Record<string, string>>
}

export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024
const MAX_DEPTH = 8
const MAX_PARTS = 200
const MAX_INLINE_IMAGE = 2 * 1024 * 1024
const MAX_INLINE_TOTAL = 8 * 1024 * 1024
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// ── bytes and strings ───────────────────────────────────────────────────────

const latin1 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return out
}

const toBytes = (binary: string): Uint8Array => {
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff
  return out
}

// ── decoding in one pass ────────────────────────────────────────────────────
//
// A part is decoded straight into one preallocated buffer, never through a
// cleaned copy of its text or an array of numbers: a 15 MB message must cost
// about its own size, not many times it. The same walk without a buffer is how
// an attachment's size is learned while listing, so listing decodes nothing.

const B64 = ((): Int8Array => {
  const table = new Int8Array(128).fill(-1)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i
  return table
})()

/** Base64 → bytes (into `out` when given); returns the byte count. Noise is skipped; `=` ends a group. */
function base64Walk(text: string, out: Uint8Array | null): number {
  let n = 0
  let acc = 0
  let bits = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 61) { acc = 0; bits = 0; continue }
    const value = code < 128 ? B64[code]! : -1
    if (value < 0) continue
    acc = ((acc << 6) | value) & 0xffffff
    bits += 6
    if (bits >= 8) { bits -= 8; if (out) out[n] = (acc >> bits) & 0xff; n++ }
  }
  return n
}

const fromBase64 = (text: string): Uint8Array => {
  const out = new Uint8Array(Math.ceil((text.length * 3) / 4) + 1)
  return out.subarray(0, base64Walk(text, out))
}

const hexValue = (code: number): number =>
  code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1

/** Quoted-printable → bytes (into `out` when given); returns the byte count. `header` is RFC 2047 "Q", where `_` is a space. */
function qpWalk(text: string, header: boolean, out: Uint8Array | null): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 61) {
      if (!header && text.charCodeAt(i + 1) === 10) { i += 1; continue }
      if (!header && text.charCodeAt(i + 1) === 13 && text.charCodeAt(i + 2) === 10) { i += 2; continue }
      const hi = hexValue(text.charCodeAt(i + 1))
      const lo = hexValue(text.charCodeAt(i + 2))
      if (hi >= 0 && lo >= 0) { if (out) out[n] = hi * 16 + lo; n++; i += 2; continue }
    }
    if (out) out[n] = header && code === 95 ? 32 : code & 0xff
    n++
  }
  return n
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

const qpBytes = (text: string, header = false): Uint8Array => {
  const out = new Uint8Array(text.length)
  return out.subarray(0, qpWalk(text, header, out))
}

/** RFC 2231 `%XX` → bytes (the charset is applied afterwards, so a multi-byte character survives). */
const percentBytes = (text: string): Uint8Array => {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { out.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2 } else out.push(text.charCodeAt(i) & 0xff)
  }
  return Uint8Array.from(out)
}

const decodeCharset = (bytes: Uint8Array, charset: string | undefined): string => {
  const label = String(charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '')
  try { return new TextDecoder(label === 'us-ascii' ? 'windows-1252' : label).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

// ── headers ─────────────────────────────────────────────────────────────────

/** RFC 2047 encoded words: =?utf-8?B?...?= and =?iso-8859-1?Q?...?= */
const decodeWords = (value: string): string =>
  value.replace(/=\?([\w.-]+)(?:\*[\w-]+)?\?([bq])\?([^?\s]*)\?=(?:[ \t]+(?==\?))?/gi, (whole, charset: string, enc: string, text: string) => {
    try { return decodeCharset(enc.toLowerCase() === 'b' ? fromBase64(text) : qpBytes(text, true), charset) } catch { return whole }
  })

/** A header the sender wrote as raw 8-bit UTF-8 reads as mojibake once the message is held as bytes-as-characters. */
const decodeLoose = (value: string): string => {
  if (!/[\x80-\xff]/.test(value)) return value
  try { return new TextDecoder('utf-8', { fatal: true }).decode(toBytes(value)) } catch { return value }
}

// A decoded header or filename is shown, quoted into replies and carried on
// forwards. A line break inside one would break the reply's own headers, and a
// bidirectional control can make "invoice\u202efdp.exe" read as "invoiceexe.pdf".
// So C0/C1 controls (tab and line breaks become a space) and the bidi controls
// are taken out of everything decoded from a header.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const withoutControls = (value: string): string => value.replace(CONTROLS, ch => (ch === '\t' || ch === '\r' || ch === '\n' ? ' ' : ''))

const readHeader = (value: string | undefined): string => withoutControls(decodeLoose(decodeWords(value ?? ''))).trim()

function splitMessage(raw: string): { head: string; body: string } {
  const gap = /\r?\n\r?\n/.exec(raw)
  if (!gap) return { head: raw, body: '' }
  return { head: raw.slice(0, gap.index), body: raw.slice(gap.index + gap[0].length) }
}

/** A part with no blank line is all "head": only this much of it is read as headers. */
const MAX_HEAD = 256 * 1024

/** Unfolded headers by lowercase name; the first of a repeated header wins. */
function parseHeaders(head: string): Map<string, string> {
  const headers = new Map<string, string>()
  const read = head.length > MAX_HEAD ? head.slice(0, MAX_HEAD) : head
  for (const line of read.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim())
  }
  return headers
}

interface ValueWithParams { readonly main: string; readonly params: Record<string, string> }

/** `text/html; charset="utf-8"; name*=utf-8''a%20b` → { main, params }, with RFC 2231 folded and decoded. */
function parseValue(value: string): ValueWithParams {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quoted && ch === '\\' && i + 1 < value.length) { current += value[++i]; continue }
    if (ch === '"') { quoted = !quoted; current += ch; continue }
    if (ch === ';' && !quoted) { tokens.push(current); current = ''; continue }
    current += ch
  }
  tokens.push(current)

  const params: Record<string, string> = {}
  const pieces = new Map<string, Map<number, string>>()
  for (const token of tokens.slice(1)) {
    const eq = token.indexOf('=')
    if (eq < 1) continue
    let key = token.slice(0, eq).trim().toLowerCase()
    let val = token.slice(eq + 1).trim().replace(/^"(.*)"$/s, '$1')
    const star = /^(.+?)\*(\d+)?(\*)?$/.exec(key)
    if (star) {
      const base = star[1]
      if (star[3] || star[2] === undefined) {
        const m = /^([^']*)'[^']*'(.*)$/s.exec(val)
        if (m) val = decodeCharset(percentBytes(m[2]), m[1])
      }
      if (star[2] !== undefined) {
        if (!pieces.has(base)) pieces.set(base, new Map())
        pieces.get(base)!.set(Number(star[2]), val)
        continue
      }
      key = base
    }
    params[key] = val
  }
  for (const [base, parts] of pieces) params[base] = [...parts.entries()].sort(([a], [b]) => a - b).map(([, v]) => v).join('')
  return { main: tokens[0].trim().toLowerCase(), params }
}

// ── bodies ──────────────────────────────────────────────────────────────────

/** Where the line break just before `at` starts (never before `floor`): it belongs to the delimiter, not the part. */
const breakBefore = (body: string, at: number, floor: number): number =>
  Math.max(floor, body[at - 1] === '\n' ? (body[at - 2] === '\r' ? at - 2 : at - 1) : at)

/**
 * The parts between `--boundary` lines, found by searching for the marker and
 * slicing — the body is never split into lines and joined again, so each level
 * of nesting costs one scan, and a part's bytes come out exactly as they went in.
 */
function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  const pieces: string[] = []
  let start = -1
  for (let at = body.indexOf(marker); at >= 0; at = body.indexOf(marker, at + 1)) {
    if (at > 0 && body[at - 1] !== '\n') continue
    let end = at + marker.length
    const closing = body.startsWith('--', end)
    if (closing) end += 2
    while (body[end] === ' ' || body[end] === '\t' || body[end] === '\r') end++
    if (end < body.length && body[end] !== '\n') continue
    // The delimiter's own line break, and one more when the part ended on a blank
    // line — as the line-by-line reader did, so a part reads as it always has.
    if (start >= 0) pieces.push(body.slice(start, breakBefore(body, breakBefore(body, at, start), start)))
    if (closing) return pieces
    start = Math.min(end + 1, body.length)
    at = start - 1
  }
  if (start >= 0) pieces.push(body.slice(start, breakBefore(body, body.length, start)))
  return pieces
}

const decodeBody = (body: string, encoding: string): Uint8Array =>
  encoding === 'base64' ? fromBase64(body) : encoding === 'quoted-printable' ? qpBytes(body) : toBytes(body)

/** What decodeBody would return the length of, without decoding. */
const decodedSize = (body: string, encoding: string): number =>
  encoding === 'base64' ? base64Walk(body, null) : encoding === 'quoted-printable' ? qpWalk(body, false, null) : body.length

/** One kind of line end in what is shown, whatever the sender's mail system used. */
const toLf = (text: string): string => text.replace(/\r\n?/g, '\n')

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Only the head of an html body is turned into text: enough for reading, replying and a preview. */
const MAX_HTML_TEXT = 512 * 1024
const RAW_OPEN = /<(script|style)(?![\w-])/iy
const LINE_TAG = /^(br(?![\w-])|\/(p|div|tr|li|h[1-6])(?![\w-]))/i
const CLOSERS: Readonly<Record<string, RegExp>> = { script: /<\/script\s*>/gi, style: /<\/style\s*>/gi }

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]{1,32});/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]!.toLowerCase() === 'x' ? Number(`0x${entity.slice(2)}`) : Number(entity.slice(1))
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[entity.toLowerCase()] ?? whole
  })

/** Spaces and tabs at the end of each line removed, by hand: `/[ \t]+\n/` costs n² on a long run of spaces. */
const trimLineEnds = (text: string): string =>
  text.split('\n').map(line => {
    let end = line.length
    while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--
    return end === line.length ? line : line.slice(0, end)
  }).join('\n')

/**
 * A readable text for a message that came as html only. One forward scan: a tag
 * is skipped to its `>`, a `<` with no `>` ends the text, and a script or style
 * with no closer runs to the end. No pattern here can look back over what it
 * already passed, so a body made of `<` costs its length, not its square.
 */
export const htmlToText = (html: string): string => {
  const src = html.length > MAX_HTML_TEXT ? html.slice(0, MAX_HTML_TEXT) : html
  let out = ''
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { out += src.slice(i); break }
    out += src.slice(i, lt)
    RAW_OPEN.lastIndex = lt
    const raw = RAW_OPEN.exec(src)
    if (raw) {
      const closer = CLOSERS[raw[1]!.toLowerCase()]!
      closer.lastIndex = lt + raw[0].length
      const shut = closer.exec(src)
      if (!shut) break
      i = shut.index + shut[0].length
      continue
    }
    const gt = src.indexOf('>', lt + 1)
    if (gt < 0) break
    if (LINE_TAG.test(src.slice(lt + 1, Math.min(gt, lt + 8)))) out += '\n'
    i = gt + 1
  }
  return trimLineEnds(decodeEntities(out)).replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The Content-ID map has no prototype: a message is free to name a part
 * "constructor" or "__proto__", and a lookup must never answer with Object's own.
 */
const noPrototype = (): Record<string, string> => Object.create(null) as Record<string, string>

interface Collected {
  texts: string[]
  htmls: string[]
  attachments: MailAttachment[]
  inline: Record<string, string>
  inlineBytes: number
  parts: number
  /** Set when the walk is for one attachment's bytes: text is not decoded, images are not encoded. */
  want?: number
  found?: Uint8Array
}

function collect(raw: string, depth: number, into: Collected): void {
  if (into.found || ++into.parts > MAX_PARTS) return
  const { head, body } = splitMessage(raw)
  const headers = parseHeaders(head)
  const type = parseValue(headers.get('content-type') ?? 'text/plain; charset=us-ascii')
  const disposition = parseValue(headers.get('content-disposition') ?? '')

  if (type.main.startsWith('multipart/') && type.params['boundary'] && depth < MAX_DEPTH) {
    for (const piece of splitMultipart(body, type.params['boundary'])) collect(piece, depth + 1, into)
    return
  }

  const encoding = (headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase()
  const filename = withoutControls(decodeLoose(decodeWords(disposition.params['filename'] ?? type.params['name'] ?? ''))).trim()
  const attached = disposition.main === 'attachment' || (!!filename && !type.main.startsWith('text/'))

  // Only what is shown is decoded: text and html when reading, inline images
  // within their caps, and the one attachment asked for. Every other part is
  // measured, not decoded.
  const seeking = into.want !== undefined
  if (!attached && type.main === 'text/plain') { if (!seeking) into.texts.push(toLf(decodeCharset(decodeBody(body, encoding), type.params['charset']))); return }
  if (!attached && type.main === 'text/html') { if (!seeking) into.htmls.push(toLf(decodeCharset(decodeBody(body, encoding), type.params['charset']))); return }

  // The inline budget is spent in the same order on both walks, so an image that
  // was inlined on the first is inlined (and so not numbered) on the second.
  const size = decodedSize(body, encoding)
  const cid = (headers.get('content-id') ?? '').trim().replace(/^<|>$/g, '')
  if (cid && INLINE_TYPES.has(type.main) && size <= MAX_INLINE_IMAGE && into.inlineBytes + size <= MAX_INLINE_TOTAL) {
    if (!seeking) into.inline[cid] = `data:${type.main};base64,${toBase64(decodeBody(body, encoding))}`
    into.inlineBytes += size
    return
  }
  if (seeking && into.attachments.length === into.want) into.found = decodeBody(body, encoding)
  into.attachments.push({
    filename: filename || (type.main === 'message/rfc822' ? 'message.eml' : 'attachment'),
    type: type.main,
    size,
  })
}

const capped = (bytes: Uint8Array): string => latin1(bytes.length > MAX_MESSAGE_BYTES ? bytes.subarray(0, MAX_MESSAGE_BYTES) : bytes)

/** Read a raw message. Never throws: a message that cannot be read comes back with what could be. */
export function parseMail(bytes: Uint8Array): ParsedMail {
  const raw = capped(bytes)
  const headers = parseHeaders(splitMessage(raw).head)
  const into: Collected = { texts: [], htmls: [], attachments: [], inline: noPrototype(), inlineBytes: 0, parts: 0 }
  try { collect(raw, 0, into) } catch { /* what was collected stands */ }

  const html = into.htmls.join('\n')
  const text = into.texts.join('\n\n').trim() || (html ? htmlToText(html) : '')
  return {
    from: readHeader(headers.get('from')),
    to: readHeader(headers.get('to')),
    cc: readHeader(headers.get('cc')),
    replyTo: readHeader(headers.get('reply-to')),
    subject: readHeader(headers.get('subject')),
    date: readHeader(headers.get('date')),
    messageId: readHeader(headers.get('message-id')),
    inReplyTo: readHeader(headers.get('in-reply-to')),
    references: readHeader(headers.get('references')),
    text,
    html,
    attachments: into.attachments,
    inlineImages: into.inline,
  }
}

/**
 * The decoded bytes of the `index`-th attachment, numbered as `parseMail(raw).attachments`
 * numbers them, or null when there is no such attachment. Never throws.
 */
export function attachmentBytes(raw: Uint8Array, index: number): Uint8Array | null {
  if (!Number.isInteger(index) || index < 0) return null
  const into: Collected = { texts: [], htmls: [], attachments: [], inline: noPrototype(), inlineBytes: 0, parts: 0, want: index }
  try { collect(capped(raw), 0, into) } catch { return null }
  return into.found ?? null
}

const SIGNATURE = /^--\s*$/
const ATTRIBUTION = /^(on\s.{0,300}\bwrote:|-{2,}\s*(original|forwarded) message\s*-{2,})\s*$/i
const PREVIEW_SCAN = 4096

/**
 * A line or two of what a message says, for a list row: the quoted reply below it,
 * the "On … wrote:" above that and the signature are left out, whitespace is
 * folded, and it is cut to `max` characters (an ellipsis included).
 */
export function previewText(mail: Pick<ParsedMail, 'text'>, max = 120): string {
  if (max <= 0) return ''
  // Only the head of a long message is looked at: a preview is the opening, not a summary.
  const lines = mail.text.slice(0, PREVIEW_SCAN).split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    if (SIGNATURE.test(line)) break
    if (ATTRIBUTION.test(line.trim())) break
    if (/^\s*>/.test(line)) continue
    kept.push(line)
  }
  let folded = kept.join(' ').replace(/\s+/g, ' ').trim()
  if (!folded) folded = mail.text.slice(0, PREVIEW_SCAN).replace(/\s+/g, ' ').trim()
  const chars = Array.from(folded)
  return chars.length <= max ? folded : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}
