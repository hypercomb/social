// mail/template.ts
//
// A MESSAGE YOU FILL IN. A template is one artifact: its bytes have one
// signature (I1), it declares its holes — names arranged, a schema of holes, the
// "layout" relation of N4 — and a message that uses it carries only the
// template's signature and a typed fill. The reader renders the message from its
// own copy of the template, so whoever audited those bytes audited every message
// that names them (M1): no message is read twice for what a template already is.
// Pure: no DOM, no network, no storage, no key. It exports and never registers.
// The design, and the steps after this one: documentation/mail-templates.md.
//
// ── REFUSED AT PARSE, NEVER STRIPPED ────────────────────────────────────────
//
// mail-html.ts cleans a stranger's html by dropping what can act. A template is
// different: it is meant to be audited, and an audit of bytes that are quietly
// changed on the way to the screen is an audit of something else. So the html a
// template may carry is a closed set — the tags format.ts writes (p, br, h1, h2,
// strong, em, code, ul, ol, li, blockquote, a) plus h3 and hr, which carry no
// attributes and can neither load nor act — and anything outside it refuses the
// whole template with a reason. No script, no style, no image tag, no comment,
// no attribute but a link's href and rel and a list's start. Pictures come only
// from holes and the template's own resources, written by this module.
//
// ── A HOLE IS TYPED, AND ITS VALUE IS ESCAPED BY ITS TYPE ──────────────────
//
// Every string of a fill is untrusted. The template is compiled once into a
// small tree and rendered in ONE pass over that tree, so a value is never
// scanned again: "{{other}}" in a text hole arrives as those nine characters,
// "<script>" as the word. A url is written only when it parses as http, https
// or mailto with no credentials in it; a number must be finite; a date must be
// ISO 8601 and real; a resource is a 64-hex signature and nothing else (I2).
//
// ── NOTHING IS FETCHED ──────────────────────────────────────────────────────
//
// A resource is resolved by the READER from its own heap, through the
// `resolveResource` it passes in. A picture shows only when the reader already
// holds its bytes, the bytes are png, jpeg, gif or webp, and the label agrees
// with the bytes; otherwise the reader sees words naming the signature. There
// is no URL for anything, so rendering a message cannot make this browser
// contact a host (T7).
//
// ── TRUST CHANGES ONE BIT, AND RUNS NOTHING ─────────────────────────────────
//
// What the reader sees does not depend on trust: a template that parses is safe
// to render by construction, whoever made it. Trust is the activation gate's
// answer for the template's signature (T3, T5) and it sets `live` — the flag
// the window will use to prefer this rendering and, later, to run the declared
// script. This step runs no script, ever: `blocked` says so for every template
// that declares one, whatever the trust.

/** The self-declaring key of a template document; its value is the format version. */
export const MAIL_TEMPLATE_KEY = 'mail:template'
/** The self-declaring key of the fill a message carries. */
export const MAIL_FILL_KEY = 'mail:fill'
/** The MIME type of the part a message carries beside its baked text and html. */
export const MAIL_TEMPLATE_PART_TYPE = 'application/vnd.hypercomb.mail+json'
/** The header that names the template, for filters and other clients. A hint: the part is the truth. */
export const MAIL_TEMPLATE_HEADER = 'X-Hypercomb-Template'
export const MAIL_TEMPLATE_PART_FILENAME = 'hypercomb-template.json'

export const MAIL_TEMPLATE_LIMITS = Object.freeze({
  /** A template document, in bytes. */
  templateBytes: 256 * 1024,
  holes: 64,
  resources: 32,
  /** Holes named in the subject, text and html together. */
  placeholders: 256,
  /** Elements open inside each other. */
  depth: 16,
  name: 120,
  label: 120,
  description: 500,
  subject: 200,
  /** The most a text hole may declare as its `max`; `textDefault` when it declares none. */
  text: 20_000,
  textDefault: 2_000,
  /** The most items a list hole may declare as its `max`; `listDefault` when it declares none. */
  list: 200,
  listDefault: 50,
  url: 2048,
  /** Every string of a fill, counted together. */
  fillChars: 64 * 1024,
  /** The part a message carries. */
  partBytes: 96 * 1024,
  /** The rendered html or text, pictures not counted. */
  renderedChars: 1024 * 1024,
  /** One picture, and all the pictures of one rendering. */
  image: 2 * 1024 * 1024,
  images: 8 * 1024 * 1024,
})

const L = MAIL_TEMPLATE_LIMITS

// ── types ───────────────────────────────────────────────────────────────────

export type ScalarHoleType = 'text' | 'url' | 'number' | 'date' | 'resource'
export type HoleType = ScalarHoleType | 'list'

export interface MailHole {
  readonly type: HoleType
  /** A list's item type: a scalar, never a list. */
  readonly of?: ScalarHoleType
  readonly required?: boolean
  /** What the composer asks for, and a picture's alt text. */
  readonly label?: string
  /** Characters for a text hole, items for a list. */
  readonly max?: number
}

/** The document as its author wrote it. `templateBytes` writes it; `parseTemplate` reads it back. */
export interface MailTemplateDocument {
  readonly name: string
  readonly description?: string
  readonly subject?: string
  readonly holes: Readonly<Record<string, MailHole>>
  /** The plain body. Always sent, always rendered. */
  readonly text: string
  readonly html?: string
  /** The template's own pictures, by signature: `{{@name}}` shows one. */
  readonly resources?: Readonly<Record<string, string>>
  /** DECLARED only. Runs in no release yet (documentation/mail-templates.md, step 4). */
  readonly script?: string
}

export interface MailTemplate extends MailTemplateDocument {
  /** sha256 of the exact bytes it was read from. */
  readonly sig: string
}

export type ParsedTemplate =
  | { readonly ok: true; readonly template: MailTemplate; readonly sig: string }
  | { readonly ok: false; readonly reason: string }

export type FillValue = string | number | readonly (string | number)[]
export type MailFill = Readonly<Record<string, FillValue>>

/** Problems read `<hole>: <why>` (or `fill: <why>`), `why` from a fixed vocabulary a window can put in words. */
export type FillCheck =
  | { readonly ok: true; readonly fill: MailFill }
  | { readonly ok: false; readonly problems: readonly string[] }

/** The activation gate's answer for a template's signature (T5): may it execute here? */
export type TemplateTrust = 'admitted' | 'held' | 'unknown'

export interface HeldResource {
  readonly type: string
  readonly bytes: Uint8Array
}

export interface RenderDeps {
  readonly trust: (templateSig: string) => TemplateTrust
  /** The reader's own heap. Nothing is fetched: a signature it does not hold shows as words. */
  readonly resolveResource?: (sig: string) => HeldResource | null
  /**
   * `data` (default): pictures inline, for the hive's own sandboxed frame.
   * `cid`: `cid:` references for the baked copy outside readers get, which the
   * send must carry as inline parts — `images` lists them.
   */
  readonly images?: 'data' | 'cid'
  readonly locale?: string
  /** How a date with a time is shown; a date alone is always shown as written. */
  readonly timeZone?: string
  /** The words for what could not be shown: an i18n `t`, or the fallbacks. */
  readonly say?: (key: string, fallback: string, params?: Readonly<Record<string, string>>) => string
}

export interface RenderedImage {
  readonly sig: string
  readonly type: string
  /** The Content-ID the baked html points at (without angle brackets). */
  readonly cid: string
}

export interface BlockedItem {
  readonly kind: 'resource' | 'script'
  readonly sig: string
  readonly why: 'not-held' | 'not-a-picture' | 'too-large' | 'not-run'
}

export type RenderedMail =
  | {
      readonly ok: true
      readonly subject: string
      readonly text: string
      readonly html: string
      /** The activation gate admitted this template (T3). Changes nothing else here. */
      readonly live: boolean
      readonly blocked: readonly BlockedItem[]
      /** Every picture shown, once each. */
      readonly images: readonly RenderedImage[]
    }
  | { readonly ok: false; readonly problems: readonly string[] }

/** The part a send carries beside its baked text and html, and the header that names it. */
export interface MailTemplatePart {
  readonly type: typeof MAIL_TEMPLATE_PART_TYPE
  readonly filename: string
  readonly body: string
  readonly header: { readonly name: typeof MAIL_TEMPLATE_HEADER; readonly value: string }
}

/** What a received message says about its template: a reference and a fill, checked for shape only. */
export interface ReadMailPart {
  readonly templateSig: string
  readonly fill: MailFill
}

// ── characters ──────────────────────────────────────────────────────────────

const SIG = /^[a-f0-9]{64}$/
const HOLE_NAME = /^[a-z][a-z0-9_-]{0,39}$/
// Every name an object already answers to (its constructor, the prototype
// accessor, toString, …) and `prototype`. Refused as a key anywhere in a
// document or a fill, so nothing copied by assignment later can reach a
// prototype, and no lookup by name can find an inherited member where a hole
// was meant.
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype'])
// Control characters, and the bidirectional embeddings, overrides and isolates
// that make text read in one order and render in another — an audit has to see
// what the reader will see.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const BIDI = /[‪-‮⁦-⁩]/
const SCALAR_TYPES: ReadonlySet<string> = new Set(['text', 'url', 'number', 'date', 'resource'])
const HOLE_TYPES: ReadonlySet<string> = new Set([...SCALAR_TYPES, 'list'])
const TOP_KEYS: ReadonlySet<string> = new Set([MAIL_TEMPLATE_KEY, 'name', 'description', 'subject', 'holes', 'text', 'html', 'resources', 'script'])
const HOLE_KEYS: ReadonlySet<string> = new Set(['type', 'of', 'required', 'label', 'max'])

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch)

const utf8 = new TextEncoder()
const clip = (value: string, max = 40): string => (value.length > max ? `${value.slice(0, max)}…` : value)
const short = (sig: string): string => `${sig.slice(0, 12)}…`

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** An own data property's value, or undefined; a getter is not a value and is never called. */
const ownValue = (source: Record<string, unknown>, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

class Refusal extends Error {}
// A declaration, not an arrow, so the compiler knows the code after a refusal is unreachable.
function refuse(reason: string): never { throw new Refusal(reason) }

/** Bytes from any realm: a test runner's TextEncoder and its Uint8Array need not be the same class. */
const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'

/** JSON with every key checked as it is read: a forbidden key refuses the whole document. */
function parseJson(text: string): unknown {
  return JSON.parse(text, function reviver(key: string, value: unknown) {
    if (FORBIDDEN_KEYS.has(key)) refuse(`the key "${key}" is not allowed anywhere in it`)
    return value
  })
}

/**
 * The first key an object repeats, or null. JSON.parse keeps the last of two,
 * and a reader of the bytes may see the first: an audit cannot rest on that.
 * Only called on text JSON.parse accepted, so strings are well formed.
 */
function repeatedKey(text: string): string | null {
  const open: (Set<string> | null)[] = []
  let expectKey = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const top = open[open.length - 1]
      if (expectKey && top) {
        const key = JSON.parse(text.slice(i, j + 1)) as string
        if (top.has(key)) return key
        top.add(key)
        expectKey = false
      }
      i = j
    } else if (ch === '{') { open.push(new Set()); expectKey = true }
    else if (ch === '[') { open.push(null); expectKey = false }
    else if (ch === '}' || ch === ']') { open.pop(); expectKey = false }
    else if (ch === ',') expectKey = open[open.length - 1] instanceof Set
  }
  return null
}

/** The normalized URL for a link, or null. Same rule as format.ts, and no `user:pass@` to dress a host up as another. */
function safeUrl(candidate: string): string | null {
  const value = candidate.trim()
  if (!value || value.length > L.url || !/^(https?:\/\/|mailto:)/i.test(value) || /[\s<>"`]/.test(value) || CONTROL.test(value) || BIDI.test(value)) return null
  if (typeof URL.canParse === 'function' && !URL.canParse(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol === 'mailto:') return url.pathname ? url.href : null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password) return null
  return url.href
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2})))?$/

/** True for a real ISO 8601 date, or a date and time with its zone (an instant, not a guess). */
function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false
  const day = new Date(Date.UTC(y, mo - 1, d))
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return false
  if (m[4] !== undefined) {
    if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59) return false
    if (m[8] !== undefined && (Number(m[8]) > 14 || Number(m[9]) > 59)) return false
  }
  return Number.isFinite(Date.parse(value))
}

// ── compiling: text with holes ──────────────────────────────────────────────

type Hole = { readonly name: string; readonly resource: boolean }
type Segment =
  | { readonly k: 'text'; readonly v: string }
  | { readonly k: 'hole'; readonly hole: Hole; readonly line: string | null }

const PLACEHOLDER = /\{\{\s*(@?)([a-z][a-z0-9_-]{0,39})\s*\}\}/y

interface Census {
  readonly holes: Readonly<Record<string, MailHole>>
  readonly resources: Readonly<Record<string, string>>
  count: number
}

/** The placeholder at `at` (which holds `{{`), checked against what the template declares. */
function placeholderAt(src: string, at: number, census: Census, where: string): { hole: Hole; end: number } {
  PLACEHOLDER.lastIndex = at
  const m = PLACEHOLDER.exec(src)
  if (!m) refuse(`the ${where} has a "{{" that is not a hole: write a hole as {{name}}`)
  const whole = m[0]
  const name = m[2] as string
  const resource = m[1] === '@'
  if (resource ? !Object.hasOwn(census.resources, name) : !Object.hasOwn(census.holes, name)) {
    refuse(`the ${where} names ${resource ? 'a resource' : 'a hole'} it does not declare: ${resource ? '@' : ''}${name}`)
  }
  if (++census.count > L.placeholders) refuse(`it names holes more than ${L.placeholders} times`)
  return { hole: { name, resource }, end: at + whole.length }
}

/** Plain text with holes: the text body and the subject. */
function compileText(src: string, where: 'text' | 'subject', census: Census): Segment[] {
  if (CONTROL.test(src.replace(/[\r\n\t]/g, ''))) refuse(`the ${where} has control characters in it`)
  if (BIDI.test(src)) refuse(`the ${where} has direction overrides in it, which make it read differently than it shows`)
  const text = src.replace(/\r\n?/g, '\n')
  const out: Segment[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{{', i)
    if (open < 0) { out.push({ k: 'text', v: text.slice(i) }); break }
    if (open > i) out.push({ k: 'text', v: text.slice(i, open) })
    const { hole, end } = placeholderAt(text, open, census, where)
    if (where === 'subject') {
      const declared = hole.resource ? undefined : census.holes[hole.name]
      if (hole.resource || declared?.type === 'resource' || declared?.of === 'resource') refuse('the subject names a picture, which a subject cannot show')
    }
    // A hole alone on its line can hold a list as lines; anywhere else a list is one line.
    const lineStart = text.lastIndexOf('\n', open - 1) + 1
    const lineEnd = text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end)
    const before = text.slice(lineStart, open)
    const alone = where === 'text' && /^[ \t]*$/.test(before) && /^[ \t]*$/.test(text.slice(end, lineEnd))
    out.push({ k: 'hole', hole, line: alone ? before : null })
    i = end
  }
  return out
}

// ── compiling: the html ─────────────────────────────────────────────────────

type Tag = 'p' | 'br' | 'hr' | 'h1' | 'h2' | 'h3' | 'strong' | 'em' | 'code' | 'ul' | 'ol' | 'li' | 'blockquote' | 'a'
type Href = { readonly url: string } | { readonly hole: string }
type HtmlNode =
  | { readonly k: 'text'; readonly v: string }
  | { readonly k: 'hole'; readonly hole: Hole }
  | { readonly k: 'el'; readonly tag: Tag; readonly href?: Href; readonly start?: number; readonly kids: HtmlNode[] }

const BLOCK: ReadonlySet<string> = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr'])
const INLINE: ReadonlySet<string> = new Set(['strong', 'em', 'code', 'a', 'br'])
const VOID: ReadonlySet<string> = new Set(['br', 'hr'])
const FLOW: ReadonlySet<string> = new Set([...BLOCK, ...INLINE])
const NOTHING: ReadonlySet<string> = new Set()
/** What each element may hold. Text and holes ride along everywhere except a list's own level. */
const HOLDS: Readonly<Record<Tag | 'root', ReadonlySet<string>>> = {
  root: FLOW, blockquote: FLOW, li: FLOW,
  p: INLINE, h1: INLINE, h2: INLINE, h3: INLINE, strong: INLINE, em: INLINE,
  a: new Set(['strong', 'em', 'code', 'br']),
  code: NOTHING,
  ul: new Set(['li']), ol: new Set(['li']),
  br: NOTHING, hr: NOTHING,
}
const REL_TOKENS: ReadonlySet<string> = new Set(['noopener', 'noreferrer', 'nofollow', 'ugc'])
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/y

/** One character reference at `at` (which holds `&`), decoded, or a refusal. */
function entityAt(src: string, at: number, where: string): { ch: string; end: number } {
  ENTITY.lastIndex = at
  const m = ENTITY.exec(src)
  const body = m?.[1]
  let ch: string | undefined
  if (body?.[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
    if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) ch = String.fromCodePoint(code)
  } else if (body) ch = NAMED_ENTITIES[body.toLowerCase()]
  if (!m || ch === undefined || CONTROL.test(ch.replace(/[\n\t]/g, '')) || BIDI.test(ch)) {
    refuse(`the ${where} has an "&" that is not a character it allows: write &amp;`)
  }
  return { ch: ch as string, end: at + (m as RegExpExecArray)[0].length }
}

/** Literal text with entities decoded and holes found. */
function readText(src: string, census: Census, where: string): (HtmlNode & { k: 'text' | 'hole' })[] {
  const out: (HtmlNode & { k: 'text' | 'hole' })[] = []
  let text = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === '&') { const e = entityAt(src, i, where); text += e.ch; i = e.end; continue }
    if (ch === '{' && src[i + 1] === '{') {
      if (text) { out.push({ k: 'text', v: text }); text = '' }
      const p = placeholderAt(src, i, census, where)
      out.push({ k: 'hole', hole: p.hole })
      i = p.end
      continue
    }
    text += ch
    i++
  }
  if (text) out.push({ k: 'text', v: text })
  return out
}

interface RawTag {
  readonly name: string
  readonly closing: boolean
  readonly attrs: readonly (readonly [string, string | null])[]
  readonly end: number
}

const isSpace = (ch: string | undefined): boolean => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'

/** The tag at `at` (which holds `<`), scanned by hand so no input can make a pattern backtrack. Null when it is not one. */
function readTag(src: string, at: number): RawTag | null {
  let i = at + 1
  const closing = src[i] === '/'
  if (closing) i++
  const nameStart = i
  if (!/[A-Za-z]/.test(src[i] ?? '')) return null
  while (/[A-Za-z0-9]/.test(src[i] ?? '')) i++
  const name = src.slice(nameStart, i).toLowerCase()
  const attrs: [string, string | null][] = []
  for (;;) {
    const before = i
    while (isSpace(src[i])) i++
    if (i >= src.length) return null
    if (src[i] === '>') return { name, closing, attrs, end: i + 1 }
    if (src[i] === '/' && src[i + 1] === '>' && !closing) return { name, closing, attrs, end: i + 2 }
    if (closing || i === before) return null
    const attrStart = i
    while (i < src.length && !isSpace(src[i]) && !'"\'<>/='.includes(src[i] as string)) i++
    if (i === attrStart) return null
    const attr = src.slice(attrStart, i).toLowerCase()
    while (isSpace(src[i])) i++
    let value: string | null = null
    if (src[i] === '=') {
      i++
      while (isSpace(src[i])) i++
      const quote = src[i]
      if (quote !== '"' && quote !== "'") return null
      const close = src.indexOf(quote, i + 1)
      if (close < 0) return null
      value = src.slice(i + 1, close)
      i = close + 1
    }
    attrs.push([attr, value])
  }
}

/** An attribute value with its character references decoded; a hole is allowed only as the whole of an href. */
function attrValue(raw: string, census: Census): { text: string } | { hole: Hole } {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{{')) {
    const p = placeholderAt(trimmed, 0, census, 'html')
    if (p.end !== trimmed.length) refuse('a link\'s href may be one hole and nothing else')
    return { hole: p.hole }
  }
  if (raw.includes('{{')) refuse('a link\'s href may be one hole and nothing else')
  let text = ''
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '&') { const e = entityAt(raw, i, 'html'); text += e.ch; i = e.end } else { text += raw[i]; i++ }
  }
  return { text }
}

function elementOf(tag: RawTag, census: Census): HtmlNode & { k: 'el' } {
  const name = tag.name as Tag
  const seen = new Set<string>()
  let href: Href | undefined
  let start: number | undefined
  for (const [attr, raw] of tag.attrs) {
    if (seen.has(attr)) refuse(`a <${name}> repeats the attribute ${attr}`)
    seen.add(attr)
    if (raw === null) refuse(`the attribute ${clip(attr)} on <${name}> has no value`)
    const value = raw as string
    if (name === 'a' && attr === 'href') {
      const read = attrValue(value, census)
      if ('hole' in read) {
        if (read.hole.resource || census.holes[read.hole.name]?.type !== 'url') refuse(`a link's href may only be a url hole: ${read.hole.name}`)
        href = { hole: read.hole.name }
      } else {
        const url = safeUrl(read.text)
        if (!url) refuse(`a link goes somewhere that is not http, https or mailto: ${clip(read.text)}`)
        href = { url: url as string }
      }
    } else if (name === 'a' && attr === 'rel') {
      const tokens = attrValue(value, census)
      if (!('text' in tokens) || !tokens.text.trim().split(/\s+/).every(token => REL_TOKENS.has(token.toLowerCase()))) refuse(`a link's rel may only say noopener, noreferrer, nofollow or ugc`)
    } else if (name === 'ol' && attr === 'start') {
      if (!/^[1-9][0-9]{0,8}$/.test(value.trim())) refuse('a list\'s start must be a whole number')
      start = Number(value.trim())
    } else {
      refuse(`the attribute ${clip(attr)} is not allowed on <${name}>`)
    }
  }
  return { k: 'el', tag: name, ...(href ? { href } : {}), ...(start !== undefined ? { start } : {}), kids: [] }
}

function compileHtml(src: string, census: Census): HtmlNode[] {
  if (CONTROL.test(src.replace(/[\r\n\t]/g, ''))) refuse('the html has control characters in it')
  if (BIDI.test(src)) refuse('the html has direction overrides in it, which make it read differently than it shows')
  const root: HtmlNode[] = []
  const stack: { tag: Tag | 'root'; kids: HtmlNode[] }[] = [{ tag: 'root', kids: root }]
  const top = (): { tag: Tag | 'root'; kids: HtmlNode[] } => stack[stack.length - 1] as { tag: Tag | 'root'; kids: HtmlNode[] }
  const inside = (tag: Tag): boolean => stack.some(frame => frame.tag === tag)

  const addText = (chunk: string): void => {
    const here = top()
    for (const node of readText(chunk, census, 'html')) {
      if (here.tag === 'ul' || here.tag === 'ol') {
        if (node.k === 'text') { if (node.v.trim()) refuse(`text sits directly in a <${here.tag}>; put it in an <li>`); continue }
        const hole = node.hole.resource ? undefined : census.holes[node.hole.name]
        if (hole?.type !== 'list') refuse(`only a list hole may sit directly in a <${here.tag}>: ${node.hole.name}`)
      }
      here.kids.push(node)
    }
  }

  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { addText(src.slice(i)); break }
    if (lt > i) addText(src.slice(i, lt))
    const tag = readTag(src, lt)
    if (!tag) refuse(`the html has a "<" that does not open a tag it allows (a comment, a doctype, or a bare <: write &lt;)`)
    const raw = tag
    if (!Object.hasOwn(HOLDS, raw.name) || raw.name === 'root') refuse(`the html uses <${clip(raw.name, 20)}>, which a template may not carry`)
    const name = raw.name as Tag
    if (raw.closing) {
      if (top().tag !== name) refuse(`</${name}> closes something that is not open`)
      stack.pop()
    } else {
      const here = top()
      if (!HOLDS[here.tag].has(name)) refuse(`<${name}> cannot sit inside ${here.tag === 'root' ? 'the top of the html' : `<${here.tag}>`}`)
      if (name === 'a' && inside('a')) refuse('a link cannot sit inside a link')
      const el = elementOf(raw, census)
      here.kids.push(el)
      if (!VOID.has(name)) {
        stack.push({ tag: name, kids: el.kids })
        if (stack.length - 1 > L.depth) refuse(`the html nests deeper than ${L.depth}`)
      }
    }
    i = raw.end
  }
  if (stack.length > 1) refuse(`<${top().tag}> is never closed`)
  return root
}

// ── parsing a template ──────────────────────────────────────────────────────

interface Compiled {
  readonly subject: readonly Segment[]
  readonly text: readonly Segment[]
  readonly html: readonly HtmlNode[] | null
}

// The compiled form is kept beside the template, never on it, so a caller cannot
// hand the renderer a tree the parser did not make. A template object built by
// hand is compiled (and so checked) the first time it is rendered.
const compiledOf = new WeakMap<MailTemplate, Compiled>()

const plainString = (value: unknown, field: string, max: number, required: boolean): string | undefined => {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string') return refuse(`"${field}" must be text`)
  if (required && !value.trim()) refuse(`"${field}" is empty`)
  if (value.length > max) refuse(`"${field}" is longer than ${max} characters`)
  if (CONTROL.test(value) || /[\r\n]/.test(value) || BIDI.test(value)) refuse(`"${field}" has control characters or direction overrides in it`)
  return value
}

function readHole(name: string, value: unknown): MailHole {
  if (!HOLE_NAME.test(name) || FORBIDDEN_KEYS.has(name)) refuse(`a hole's name must be lowercase letters, digits, - or _ (up to 40), starting with a letter: ${clip(name)}`)
  if (!isPlainObject(value)) return refuse(`the hole ${name} is not an object`)
  for (const key of Object.keys(value)) if (!HOLE_KEYS.has(key)) refuse(`the hole ${name} has an unknown field "${clip(key)}"`)
  const type = value['type']
  if (typeof type !== 'string' || !HOLE_TYPES.has(type)) refuse(`the hole ${name} has no type this format knows (text, url, number, date, resource, list)`)
  const of = value['of']
  if (type === 'list') {
    if (typeof of !== 'string' || !SCALAR_TYPES.has(of)) refuse(`the list ${name} must say what it holds: "of" text, url, number, date or resource`)
  } else if (of !== undefined) refuse(`only a list says "of": ${name}`)
  const required = value['required']
  if (required !== undefined && typeof required !== 'boolean') refuse(`the hole ${name}'s "required" must be true or false`)
  const label = plainString(value['label'], `${name}.label`, L.label, false)
  const max = value['max']
  if (max !== undefined) {
    const ceiling = type === 'text' ? L.text : type === 'list' ? L.list : 0
    if (!ceiling) refuse(`only a text or list hole says "max": ${name}`)
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > ceiling) refuse(`the hole ${name}'s "max" must be a whole number from 1 to ${ceiling}`)
  }
  return Object.freeze({
    type: type as HoleType,
    ...(type === 'list' ? { of: of as ScalarHoleType } : {}),
    ...(required !== undefined ? { required: required as boolean } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(max !== undefined ? { max: max as number } : {}),
  })
}

/** The document checked, field by field, into a template; the compiled form alongside. */
function readDocument(doc: unknown, sig: string): { template: MailTemplate; compiled: Compiled } {
  if (!isPlainObject(doc)) refuse('it is not a JSON object')
  const source = doc as Record<string, unknown>
  for (const key of Object.keys(source)) if (!TOP_KEYS.has(key)) refuse(`it has an unknown field "${clip(key)}"`)
  if (source[MAIL_TEMPLATE_KEY] !== 1) refuse(`it does not say "${MAIL_TEMPLATE_KEY}": 1, the one version this reader knows`)

  const name = plainString(source['name'], 'name', L.name, true) as string
  const description = plainString(source['description'], 'description', L.description, false)

  const holesValue = source['holes']
  if (!isPlainObject(holesValue)) refuse('"holes" must be an object (it may be empty)')
  const holeNames = Object.keys(holesValue as object)
  if (holeNames.length > L.holes) refuse(`it declares more than ${L.holes} holes`)
  const holes: Record<string, MailHole> = {}
  for (const hole of holeNames) holes[hole] = readHole(hole, (holesValue as Record<string, unknown>)[hole])

  const resourcesValue = source['resources']
  const resources: Record<string, string> = {}
  if (resourcesValue !== undefined) {
    if (!isPlainObject(resourcesValue)) refuse('"resources" must be an object of signatures')
    const names = Object.keys(resourcesValue as object)
    if (names.length > L.resources) refuse(`it names more than ${L.resources} resources`)
    for (const resource of names) {
      if (!HOLE_NAME.test(resource) || FORBIDDEN_KEYS.has(resource)) refuse(`a resource's name must be lowercase letters, digits, - or _: ${clip(resource)}`)
      const value = (resourcesValue as Record<string, unknown>)[resource]
      if (typeof value !== 'string' || !SIG.test(value)) refuse(`the resource ${resource} is not a signature (64 lowercase hex)`)
      resources[resource] = value as string
    }
  }

  const script = source['script']
  if (script !== undefined && (typeof script !== 'string' || !SIG.test(script))) refuse('"script" must be a signature (64 lowercase hex)')

  const text = source['text']
  if (typeof text !== 'string' || !text.trim()) refuse('"text" is missing: a template always carries its plain body')
  const subject = source['subject']
  if (subject !== undefined && (typeof subject !== 'string' || subject.length > L.subject || /[\r\n]/.test(subject))) refuse(`"subject" must be one line of at most ${L.subject} characters`)
  const html = source['html']
  if (html !== undefined && typeof html !== 'string') refuse('"html" must be text')

  const census: Census = { holes, resources, count: 0 }
  const compiled: Compiled = {
    subject: typeof subject === 'string' ? compileText(subject, 'subject', census) : [],
    text: compileText(text as string, 'text', census),
    html: typeof html === 'string' ? compileHtml(html, census) : null,
  }

  const template: MailTemplate = Object.freeze({
    sig,
    name,
    ...(description !== undefined ? { description } : {}),
    ...(typeof subject === 'string' ? { subject } : {}),
    holes: Object.freeze(holes),
    text: text as string,
    ...(typeof html === 'string' ? { html } : {}),
    ...(resourcesValue !== undefined ? { resources: Object.freeze(resources) } : {}),
    ...(typeof script === 'string' ? { script } : {}),
  })
  return { template, compiled }
}

/**
 * Read a template from its bytes. Strict: anything this format does not say is
 * refused with a reason, never dropped. Pass the signature the bytes were held
 * under and a mismatch is refused too (S3). Never throws.
 */
export async function parseTemplate(bytes: Uint8Array, expectedSig?: string): Promise<ParsedTemplate> {
  try {
    if (!isBytes(bytes)) refuse('it is not bytes')
    if (bytes.length > L.templateBytes) refuse(`it is larger than ${L.templateBytes / 1024} KB`)
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { return refuse('it is not UTF-8') }
    let doc: unknown
    try { doc = parseJson(text) } catch (error) { if (error instanceof Refusal) throw error; return refuse('it is not JSON') }
    const repeated = repeatedKey(text)
    if (repeated !== null) refuse(`it repeats the key "${clip(repeated)}", so two readers could see two templates`)
    const sig = await sha256Hex(bytes)
    if (expectedSig !== undefined && sig !== expectedSig) refuse('its bytes do not match the signature they were held under')
    const { template, compiled } = readDocument(doc, sig)
    compiledOf.set(template, compiled)
    return { ok: true, template, sig }
  } catch (error) {
    return { ok: false, reason: error instanceof Refusal ? error.message : 'it could not be read' }
  }
}

/**
 * The canonical bytes of a template: fields in one order, holes in the order the
 * author gave them, no whitespace. The writer "save as template" uses, so one
 * template is one signature (I1). It checks nothing — `parseTemplate` does.
 */
export function templateBytes(doc: MailTemplateDocument): Uint8Array {
  const holes: Record<string, unknown> = {}
  for (const [name, hole] of Object.entries(doc.holes)) {
    holes[name] = {
      type: hole.type,
      ...(hole.of !== undefined ? { of: hole.of } : {}),
      ...(hole.required !== undefined ? { required: hole.required } : {}),
      ...(hole.label !== undefined ? { label: hole.label } : {}),
      ...(hole.max !== undefined ? { max: hole.max } : {}),
    }
  }
  return utf8.encode(JSON.stringify({
    [MAIL_TEMPLATE_KEY]: 1,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(doc.subject !== undefined ? { subject: doc.subject } : {}),
    holes,
    text: doc.text,
    ...(doc.html !== undefined ? { html: doc.html } : {}),
    ...(doc.resources !== undefined ? { resources: doc.resources } : {}),
    ...(doc.script !== undefined ? { script: doc.script } : {}),
  }))
}

// ── checking a fill ─────────────────────────────────────────────────────────

type Checked = { readonly value: string | number } | { readonly why: string }

function checkScalar(type: ScalarHoleType, value: unknown, max: number): Checked {
  switch (type) {
    case 'text': {
      // Length first: a ten-megabyte string is refused before any pattern reads it.
      if (typeof value !== 'string') return { why: 'not-text' }
      if (value.length > max) return { why: 'too-long' }
      const text = value.replace(/\r\n?/g, '\n')
      if (CONTROL.test(text.replace(/[\n\t]/g, '')) || BIDI.test(text)) return { why: 'control-characters' }
      return { value: text }
    }
    case 'url': {
      if (typeof value !== 'string') return { why: 'not-a-link' }
      if (value.length > L.url) return { why: 'too-long' }
      const url = safeUrl(value)
      return url ? { value: url } : { why: 'not-a-link' }
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? { value } : { why: 'not-a-number' }
    case 'date':
      return typeof value === 'string' && value.length <= 40 && isIsoDate(value) ? { value } : { why: 'not-a-date' }
    case 'resource':
      return typeof value === 'string' && SIG.test(value) ? { value } : { why: 'not-a-signature' }
    default:
      // Only a template built by hand, never one parseTemplate read, gets here.
      return { why: 'unknown-type' }
  }
}

/**
 * Is this fill one the template can render? Every hole typed, every value capped,
 * required holes present, nothing the template does not declare. The fill that
 * comes back is the one to render and to send: urls normalized, line ends folded.
 */
export function validateFill(template: Pick<MailTemplate, 'holes'>, fill: unknown): FillCheck {
  // A fill handed over in code could be a proxy whose traps throw; JSON never is.
  try { return checkFill(template, fill) } catch { return { ok: false, problems: ['fill: unreadable'] } }
}

function checkFill(template: Pick<MailTemplate, 'holes'>, fill: unknown): FillCheck {
  if (!isPlainObject(fill)) return { ok: false, problems: ['fill: not-an-object'] }
  const keys = Object.keys(fill)
  if (keys.length > L.holes) return { ok: false, problems: ['fill: too-many-values'] }
  const problems: string[] = []
  const add = (problem: string): void => { if (problems.length < 32) problems.push(problem) }
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) add(`${key}: forbidden`)
    else if (!Object.hasOwn(template.holes, key)) add(`${clip(key)}: unknown`)
  }

  const out: [string, FillValue][] = []
  let chars = 0
  for (const [name, hole] of Object.entries(template.holes)) {
    const descriptor = Object.getOwnPropertyDescriptor(fill, name)
    if (descriptor && !('value' in descriptor)) { add(`${name}: not-a-value`); continue }
    const value = ownValue(fill, name)
    if (value === undefined) { if (hole.required) add(`${name}: required`); continue }

    if (hole.type === 'list') {
      if (!Array.isArray(value)) { add(`${name}: not-a-list`); continue }
      if (value.length > (hole.max ?? L.listDefault)) { add(`${name}: too-many`); continue }
      if (hole.required && value.length === 0) { add(`${name}: required`); continue }
      const items: (string | number)[] = []
      let bad = ''
      for (let i = 0; i < value.length && !bad; i++) {
        const checked = checkScalar(hole.of as ScalarHoleType, value[i] as unknown, L.textDefault)
        if ('why' in checked) bad = `${name}[${i}]: ${checked.why}`
        else { items.push(checked.value); if (typeof checked.value === 'string') chars += checked.value.length }
      }
      if (bad) { add(bad); continue }
      out.push([name, Object.freeze(items)])
      continue
    }

    const checked = checkScalar(hole.type, value, hole.type === 'text' ? (hole.max ?? L.textDefault) : L.textDefault)
    if ('why' in checked) { add(`${name}: ${checked.why}`); continue }
    if (hole.required && typeof checked.value === 'string' && !checked.value.trim()) { add(`${name}: required`); continue }
    if (typeof checked.value === 'string') chars += checked.value.length
    out.push([name, checked.value])
  }
  if (chars > L.fillChars) add('fill: too-large')
  if (problems.length) return { ok: false, problems }
  return { ok: true, fill: Object.freeze(Object.fromEntries(out)) as MailFill }
}

// ── rendering ───────────────────────────────────────────────────────────────

const PICTURE_TYPES: Readonly<Record<string, (b: Uint8Array) => boolean>> = {
  'image/png': b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  'image/webp': b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
}

const interpolate = (text: string, params?: Readonly<Record<string, string>>): string =>
  params ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (Object.hasOwn(params, key) ? params[key] as string : whole)) : text

class Renderer {
  readonly #template: MailTemplate
  readonly #fill: MailFill
  readonly #deps: RenderDeps
  readonly #number: Intl.NumberFormat
  readonly #day: Intl.DateTimeFormat
  readonly #moment: Intl.DateTimeFormat
  readonly #blocked: BlockedItem[] = []
  readonly #images = new Map<string, RenderedImage>()
  // What each signature came to, so a picture named twice is resolved, checked and counted once.
  readonly #pictures = new Map<string, { src: string } | { why: BlockedItem['why'] }>()
  #imageBytes = 0
  #imageChars = 0

  constructor(template: MailTemplate, fill: MailFill, deps: RenderDeps) {
    this.#template = template
    this.#fill = fill
    this.#deps = deps
    const locale = deps.locale ?? 'en'
    const safe = <T>(make: (loc: string, zone: string) => T): T => {
      try { return make(locale, deps.timeZone ?? 'UTC') } catch { return make('en', 'UTC') }
    }
    this.#number = safe(loc => new Intl.NumberFormat(loc, { maximumFractionDigits: 6 }))
    this.#day = safe(loc => new Intl.DateTimeFormat(loc, { dateStyle: 'long', timeZone: 'UTC' }))
    this.#moment = safe((loc, zone) => new Intl.DateTimeFormat(loc, { dateStyle: 'long', timeStyle: 'short', timeZone: zone }))
  }

  get blocked(): readonly BlockedItem[] { return this.#blocked }
  get images(): readonly RenderedImage[] { return [...this.#images.values()] }
  /** Characters of picture data in the html, which the size cap does not count. */
  get imageChars(): number { return this.#imageChars }
  block(item: BlockedItem): void { this.#blocked.push(item) }

  #say(key: string, fallback: string, params?: Readonly<Record<string, string>>): string {
    try { return this.#deps.say?.(key, fallback, params) ?? interpolate(fallback, params) } catch { return interpolate(fallback, params) }
  }

  #value(hole: Hole): FillValue | undefined {
    if (hole.resource) return this.#template.resources?.[hole.name]
    return Object.hasOwn(this.#fill, hole.name) ? this.#fill[hole.name] : undefined
  }

  #typeOf(hole: Hole): { type: HoleType; of?: ScalarHoleType; label: string } {
    if (hole.resource) return { type: 'resource', label: hole.name }
    const declared = this.#template.holes[hole.name] as MailHole
    return { type: declared.type, ...(declared.of ? { of: declared.of } : {}), label: declared.label ?? hole.name }
  }

  #plain(type: ScalarHoleType, value: string | number, label: string): string {
    switch (type) {
      case 'number': return this.#number.format(value as number)
      case 'date': {
        const text = value as string
        return text.length === 10 ? this.#day.format(new Date(`${text}T00:00:00Z`)) : this.#moment.format(new Date(text))
      }
      case 'resource': return this.#say('mail.template.picture', '[picture: {label}]', { label })
      default: return String(value)
    }
  }

  /** The bytes a signature names, if the reader holds them and they are a picture it shows. */
  #picture(sig: string): { src: string } | { why: BlockedItem['why'] } {
    const known = this.#pictures.get(sig)
    if (known) return known
    let held: HeldResource | null = null
    try { held = this.#deps.resolveResource?.(sig) ?? null } catch { held = null }
    let found: { src: string } | { why: BlockedItem['why'] }
    const type = String(held?.type ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
    const looks = PICTURE_TYPES[type]
    if (!held || !isBytes(held.bytes)) found = { why: 'not-held' }
    else if (!looks || !looks(held.bytes)) found = { why: 'not-a-picture' }
    else if (held.bytes.length > L.image || this.#imageBytes + held.bytes.length > L.images) found = { why: 'too-large' }
    else {
      this.#imageBytes += held.bytes.length
      const cid = `${sig}@hypercomb`
      this.#images.set(sig, { sig, type, cid })
      found = { src: this.#deps.images === 'cid' ? `cid:${cid}` : `data:${type};base64,${toBase64(held.bytes)}` }
    }
    if ('why' in found) this.#blocked.push({ kind: 'resource', sig, why: found.why })
    this.#pictures.set(sig, found)
    return found
  }

  #scalarHtml(type: ScalarHoleType, value: string | number, label: string, where: { anchor: boolean; code: boolean }): string {
    switch (type) {
      case 'text': return escapeHtml(value as string).replace(/\n/g, '<br>')
      case 'url': {
        const url = escapeHtml(value as string)
        return where.anchor || where.code ? url : `<a href="${url}" rel="noopener noreferrer">${url}</a>`
      }
      case 'resource': {
        const sig = value as string
        const picture = where.code ? null : this.#picture(sig)
        if (picture && 'src' in picture) {
          this.#imageChars += picture.src.length
          return `<img src="${escapeHtml(picture.src)}" alt="${escapeHtml(label)}">`
        }
        return `<em>${escapeHtml(this.#say('mail.template.picture-missing', '[picture {sig} is not shown here]', { sig: short(sig) }))}</em>`
      }
      default: return escapeHtml(this.#plain(type, value, label))
    }
  }

  #holeHtml(hole: Hole, parent: Tag | 'root', where: { anchor: boolean; code: boolean }): string {
    const value = this.#value(hole)
    if (value === undefined) return ''
    const { type, of, label } = this.#typeOf(hole)
    if (type !== 'list') return this.#scalarHtml(type, value as string | number, label, where)
    const items = value as readonly (string | number)[]
    const each = items.map(item => this.#scalarHtml(of as ScalarHoleType, item, label, where))
    return parent === 'ul' || parent === 'ol' ? each.map(item => `<li>${item}</li>`).join('') : each.join(', ')
  }

  html(nodes: readonly HtmlNode[], parent: Tag | 'root', where: { anchor: boolean; code: boolean }): string {
    let out = ''
    for (const node of nodes) {
      if (node.k === 'text') { out += escapeHtml(node.v); continue }
      if (node.k === 'hole') { out += this.#holeHtml(node.hole, parent, where); continue }
      if (node.tag === 'br' || node.tag === 'hr') { out += `<${node.tag}>`; continue }
      const inner = this.html(node.kids, node.tag, { anchor: where.anchor || node.tag === 'a', code: where.code || node.tag === 'code' })
      if (node.tag === 'a') {
        const target = node.href && 'url' in node.href ? node.href.url : node.href ? this.#value({ name: node.href.hole, resource: false }) : undefined
        out += typeof target === 'string' ? `<a href="${escapeHtml(target)}" rel="noopener noreferrer">${inner}</a>` : `<a>${inner}</a>`
        continue
      }
      out += `<${node.tag}${node.start !== undefined && node.start !== 1 ? ` start="${node.start}"` : ''}>${inner}</${node.tag}>`
    }
    return out
  }

  text(segments: readonly Segment[], oneLine: boolean): string {
    let out = ''
    for (const segment of segments) {
      if (segment.k === 'text') { out += segment.v; continue }
      const value = this.#value(segment.hole)
      if (value === undefined) continue
      const { type, of, label } = this.#typeOf(segment.hole)
      if (type !== 'list') { out += this.#plain(type, value as string | number, label); continue }
      const items = (value as readonly (string | number)[]).map(item => this.#plain(of as ScalarHoleType, item, label))
      // A list alone on its line becomes lines; its own indent is already written before it.
      out += segment.line !== null && !oneLine ? items.map((item, n) => `${n ? segment.line : ''}- ${item}`).join('\n') : items.join(', ')
    }
    return out
  }
}

const compileAgain = (template: MailTemplate): Compiled | null => {
  try {
    const census: Census = { holes: template.holes, resources: template.resources ?? {}, count: 0 }
    return {
      subject: typeof template.subject === 'string' ? compileText(template.subject, 'subject', census) : [],
      text: compileText(template.text, 'text', census),
      html: typeof template.html === 'string' ? compileHtml(template.html, census) : null,
    }
  } catch { return null }
}

/**
 * The message a template and a fill make: subject, text and html, each written
 * with its own escaping. The fill is checked again here, so nothing unchecked is
 * ever rendered. `live` is the activation gate's yes for the template; this step
 * renders no script whatever it says. Never throws.
 */
export function renderTemplate(template: MailTemplate, fill: unknown, deps: RenderDeps): RenderedMail {
  try { return render(template, fill, deps) } catch { return { ok: false, problems: ['render: failed'] } }
}

function render(template: MailTemplate, fill: unknown, deps: RenderDeps): RenderedMail {
  const checked = validateFill(template, fill)
  if (!checked.ok) return { ok: false, problems: checked.problems }
  let compiled = compiledOf.get(template)
  if (!compiled) {
    const again = compileAgain(template)
    if (!again) return { ok: false, problems: ['template: unreadable'] }
    compiled = again
    compiledOf.set(template, again)
  }

  let trust: TemplateTrust = 'unknown'
  try { trust = deps.trust(template.sig) } catch { trust = 'unknown' }

  const renderer = new Renderer(template, checked.fill, deps)
  const subject = Array.from(renderer.text(compiled.subject, true).replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()).slice(0, L.subject).join('')
  const text = renderer.text(compiled.text, false)
  const html = compiled.html ? renderer.html(compiled.html, 'root', { anchor: false, code: false }) : ''
  if (text.length > L.renderedChars || html.length - renderer.imageChars > L.renderedChars) return { ok: false, problems: ['render: too-large'] }

  // Declared, never run in this step — for every reader alike, so what a reader
  // sees never depends on trust (only `live` does).
  if (template.script) renderer.block({ kind: 'script', sig: template.script, why: 'not-run' })
  return {
    ok: true,
    subject,
    text,
    html,
    live: trust === 'admitted',
    blocked: Object.freeze([...renderer.blocked]),
    images: Object.freeze(renderer.images),
  }
}

// ── the part a message carries ──────────────────────────────────────────────

/**
 * The part a send carries beside the baked text and html: the template's
 * signature and the fill, nothing inline that a signature could name (I2).
 * Null for a signature that is not one, a fill that is not an object, or a part
 * over its cap. Check the fill with `validateFill` first; this checks shape only.
 */
export function mailPart(templateSig: string, fill: MailFill): MailTemplatePart | null {
  if (typeof templateSig !== 'string' || !SIG.test(templateSig) || !isPlainObject(fill)) return null
  const body = JSON.stringify({ [MAIL_FILL_KEY]: 1, template: templateSig, fill })
  if (utf8.encode(body).length > L.partBytes) return null
  return {
    type: MAIL_TEMPLATE_PART_TYPE,
    filename: MAIL_TEMPLATE_PART_FILENAME,
    body,
    header: { name: MAIL_TEMPLATE_HEADER, value: templateSig },
  }
}

const shapeValue = (value: unknown): boolean =>
  (typeof value === 'string' && value.length <= L.text) || (typeof value === 'number' && Number.isFinite(value))

/**
 * The template reference a received message carries, or null. Found among the
 * attachments by type — exactly one, or none counts — read, and checked for
 * shape. It says what the SENDER claims; the reader still holds the template
 * itself, checks the fill against it with `validateFill`, and asks the gate.
 * Works on a parsed message (mime.ts) and on a kept Sent copy alike. Never throws.
 */
export function readMailPart(
  mail: { readonly attachments: readonly { readonly type: string; readonly size?: number }[] },
  attachmentBytes: (index: number) => Uint8Array | null,
): ReadMailPart | null {
  try {
    const found: number[] = []
    mail.attachments.forEach((attachment, index) => { if (String(attachment.type).toLowerCase() === MAIL_TEMPLATE_PART_TYPE) found.push(index) })
    if (found.length !== 1) return null
    const index = found[0] as number
    const declared = mail.attachments[index]?.size
    if (typeof declared === 'number' && declared > L.partBytes) return null
    const bytes = attachmentBytes(index)
    if (!isBytes(bytes) || bytes.length > L.partBytes) return null
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const doc = parseJson(text)
    if (repeatedKey(text) !== null || !isPlainObject(doc)) return null
    const keys = Object.keys(doc)
    const templateSig = doc['template']
    if (keys.length !== 3 || doc[MAIL_FILL_KEY] !== 1 || typeof templateSig !== 'string' || !SIG.test(templateSig)) return null
    const fill = doc['fill']
    if (!isPlainObject(fill)) return null
    const names = Object.keys(fill)
    if (names.length > L.holes) return null
    for (const name of names) {
      if (!HOLE_NAME.test(name) || FORBIDDEN_KEYS.has(name)) return null
      const value = fill[name]
      if (Array.isArray(value) ? value.length > L.list || !value.every(shapeValue) : !shapeValue(value)) return null
    }
    return { templateSig, fill: Object.freeze({ ...fill }) as MailFill }
  } catch { return null }
}
