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

const fromBase64 = (text: string): Uint8Array => {
  try {
    const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
    return toBytes(atob(clean + '='.repeat((4 - (clean.length % 4)) % 4)))
  } catch { return new Uint8Array(0) }
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Quoted-printable → bytes. `header` is the RFC 2047 "Q" form, where `_` is a space. */
const qpBytes = (text: string, header = false): Uint8Array => {
  const source = header ? text.replace(/_/g, ' ') : text.replace(/=\r?\n/g, '')
  const out: number[] = []
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(source.slice(i + 1, i + 3))) { out.push(parseInt(source.slice(i + 1, i + 3), 16)); i += 2 } else out.push(source.charCodeAt(i) & 0xff)
  }
  return Uint8Array.from(out)
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

const readHeader = (value: string | undefined): string => decodeLoose(decodeWords(value ?? '')).trim()

function splitMessage(raw: string): { head: string; body: string } {
  const gap = /\r?\n\r?\n/.exec(raw)
  if (!gap) return { head: raw, body: '' }
  return { head: raw.slice(0, gap.index), body: raw.slice(gap.index + gap[0].length) }
}

/** Unfolded headers by lowercase name; the first of a repeated header wins. */
function parseHeaders(head: string): Map<string, string> {
  const headers = new Map<string, string>()
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
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

function splitMultipart(body: string, boundary: string): string[] {
  const marker = `--${boundary}`
  const pieces: string[] = []
  let current: string[] | null = null
  // The line break before a delimiter belongs to the delimiter, not to the part above it.
  const finish = (): void => {
    if (!current) return
    if (current[current.length - 1] === '') current.pop()
    pieces.push(current.join('\n'))
  }
  for (const line of body.split(/\r?\n/)) {
    const bare = line.trimEnd()
    if (bare === marker) { finish(); current = []; continue }
    if (bare === `${marker}--`) { finish(); current = null; break }
    if (current) current.push(line)
  }
  finish()
  return pieces
}

const decodeBody = (body: string, encoding: string): Uint8Array =>
  encoding === 'base64' ? fromBase64(body) : encoding === 'quoted-printable' ? qpBytes(body) : toBytes(body)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** A readable text for a message that came as html only. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === '#') {
        const code = entity[1]!.toLowerCase() === 'x' ? Number(`0x${entity.slice(2)}`) : Number(entity.slice(1))
        return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
      }
      return ENTITIES[entity.toLowerCase()] ?? whole
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

interface Collected {
  texts: string[]
  htmls: string[]
  attachments: MailAttachment[]
  inline: Record<string, string>
  inlineBytes: number
  parts: number
}

function collect(raw: string, depth: number, into: Collected): void {
  if (++into.parts > MAX_PARTS) return
  const { head, body } = splitMessage(raw)
  const headers = parseHeaders(head)
  const type = parseValue(headers.get('content-type') ?? 'text/plain; charset=us-ascii')
  const disposition = parseValue(headers.get('content-disposition') ?? '')

  if (type.main.startsWith('multipart/') && type.params['boundary'] && depth < MAX_DEPTH) {
    for (const piece of splitMultipart(body, type.params['boundary'])) collect(piece, depth + 1, into)
    return
  }

  const bytes = decodeBody(body, (headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase())
  const filename = decodeLoose(decodeWords(disposition.params['filename'] ?? type.params['name'] ?? ''))
  const attached = disposition.main === 'attachment' || (!!filename && !type.main.startsWith('text/'))

  if (!attached && type.main === 'text/plain') { into.texts.push(decodeCharset(bytes, type.params['charset'])); return }
  if (!attached && type.main === 'text/html') { into.htmls.push(decodeCharset(bytes, type.params['charset'])); return }

  const cid = (headers.get('content-id') ?? '').trim().replace(/^<|>$/g, '')
  if (cid && INLINE_TYPES.has(type.main) && bytes.length <= MAX_INLINE_IMAGE && into.inlineBytes + bytes.length <= MAX_INLINE_TOTAL) {
    into.inline[cid] = `data:${type.main};base64,${toBase64(bytes)}`
    into.inlineBytes += bytes.length
    return
  }
  into.attachments.push({
    filename: filename || (type.main === 'message/rfc822' ? 'message.eml' : 'attachment'),
    type: type.main,
    size: bytes.length,
  })
}

/** Read a raw message. Never throws: a message that cannot be read comes back with what could be. */
export function parseMail(bytes: Uint8Array): ParsedMail {
  const raw = latin1(bytes.length > MAX_MESSAGE_BYTES ? bytes.subarray(0, MAX_MESSAGE_BYTES) : bytes)
  const headers = parseHeaders(splitMessage(raw).head)
  const into: Collected = { texts: [], htmls: [], attachments: [], inline: {}, inlineBytes: 0, parts: 0 }
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
