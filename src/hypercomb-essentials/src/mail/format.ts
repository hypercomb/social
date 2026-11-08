// mail/format.ts
//
// WHAT A PERSON TYPES, MADE INTO A MESSAGE. The composer takes plain text with a
// few light marks — paragraphs, **bold**, _italic_, `code`, lists, quotes,
// headings and links — and this turns it into the two bodies a message carries:
// an html one for readers that show it, and a plain one that always goes along.
// Pure: no DOM, no network, no storage.
//
// ── THE SOURCE IS NEVER MARKUP ──────────────────────────────────────────────
//
// What was typed is read into a small tree first (blocks of lines, then runs of
// text and marks), and the html is written from that tree with every character
// of the source escaped on the way out. No raw text is ever replaced into a tag,
// so "<script>" typed in the composer arrives as the words "<script>". The only
// tags that can appear are the ones written below; there is no image, no style
// and no script among them.
//
// ── A LINK GOES WHERE IT SAYS, OR NOWHERE ───────────────────────────────────
//
// An href is written only for a URL that parses with protocol http:, https: or
// mailto:, and it is the parser's own normalized form that is written. Anything
// else (javascript:, data:, a relative path) stays as the visible text it was.
//
// ── IT FINISHES ─────────────────────────────────────────────────────────────
//
// A composer can be pasted a megabyte of anything. Every mark is found by a
// forward scan; a mark with no closer anywhere ahead turns that mark off for the
// rest of the run, so unbalanced marks cost one scan, not one per opener. Marks
// cannot nest inside themselves and quotes stop nesting at MAX_QUOTE_DEPTH, so
// the work stays a small multiple of the length.

export interface FormattedMessage {
  /** An html fragment (no <html>/<body>): for the sandboxed preview and for the send's `html`. */
  readonly html: string
  /** The plain version: marks removed, links as `text <url>`. Always sent alongside the html. */
  readonly text: string
}

const MAX_QUOTE_DEPTH = 8
const MAX_URL = 2048

// ── escaping and links ──────────────────────────────────────────────────────

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch)

const LINK_PREFIX = /^(https?:\/\/|mailto:)/i

/** The normalized URL to write as an href, or null when it must not be a link. */
function safeHref(candidate: string): string | null {
  const value = candidate.trim()
  if (!value || value.length > MAX_URL || !LINK_PREFIX.test(value) || /[\s<>"`]/.test(value)) return null
  // Asked first because a thrown error per candidate is what a pasted wall of
  // broken URLs would otherwise cost.
  if (typeof URL.canParse === 'function' && !URL.canParse(value)) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol === 'mailto:') return url.pathname ? url.href : null
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname ? url.href : null
  return null
}

// ── inline: runs of text and marks ──────────────────────────────────────────

type Inline =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'code'; readonly value: string }
  | { readonly kind: 'strong' | 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly url: string; readonly bare: boolean; readonly children: readonly Inline[] }

interface Allowed { readonly strong: boolean; readonly em: boolean; readonly link: boolean }

const ALL: Allowed = { strong: true, em: true, link: true }
const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch)
/** The edge of the text counts as space: a mark cannot open onto nothing. */
const isSpace = (ch: string | undefined): boolean => ch === undefined || SPACE.test(ch)
const URL_STOP = /[\s<>"`]/
const URL_TAIL = new Set(['.', ',', ';', ':', '!', '?', "'", '"', ')', ']', '*', '_'])

/** The next `**` at or after `from` that can close bold (not after a space), or -1. */
function strongClose(src: string, from: number): number {
  for (let at = src.indexOf('**', from); at >= 0; at = src.indexOf('**', at + 1)) if (!isSpace(src[at - 1])) return at
  return -1
}

/** The next `_` at or after `from` that can close italic (not after a space, not inside a word), or -1. */
function emClose(src: string, from: number): number {
  for (let at = src.indexOf('_', from); at >= 0; at = src.indexOf('_', at + 1)) if (!isSpace(src[at - 1]) && !isWord(src[at + 1])) return at
  return -1
}

/** A bare URL's end, with trailing punctuation the sentence put there left outside it. */
function bareUrlEnd(src: string, start: number): number {
  let end = start
  let open = 0
  let close = 0
  while (end < src.length && !URL_STOP.test(src[end]!)) {
    if (src[end] === '(') open++
    else if (src[end] === ')') close++
    end++
  }
  while (end > start && URL_TAIL.has(src[end - 1]!)) {
    if (src[end - 1] === ')') { if (close <= open) break; close-- }
    end--
  }
  return end
}

function parseInline(src: string, allowed: Allowed): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = (): void => { if (text) { out.push({ kind: 'text', value: text }); text = '' } }
  // A closer's validity never depends on its opener, so once a search for one
  // fails, no later opener of that mark in this run can succeed either.
  let code = true
  let strong = allowed.strong
  let em = allowed.em
  let link = allowed.link
  let bracket = -1
  let paren = -1

  let i = 0
  while (i < src.length) {
    const ch = src[i]!

    if (ch === '`' && code) {
      const end = src.indexOf('`', i + 1)
      if (end < 0) code = false
      else if (end === i + 1) { text += '``'; i += 2; continue }
      else { flush(); out.push({ kind: 'code', value: src.slice(i + 1, end) }); i = end + 1; continue }
    }

    if (ch === '*' && strong && src[i + 1] === '*' && !isSpace(src[i + 2])) {
      const end = strongClose(src, i + 3)
      if (end < 0) strong = false
      else {
        flush()
        out.push({ kind: 'strong', children: parseInline(src.slice(i + 2, end), { ...allowed, strong: false }) })
        i = end + 2
        continue
      }
    }

    if (ch === '_' && em && !isWord(src[i - 1]) && !isSpace(src[i + 1])) {
      const end = emClose(src, i + 2)
      if (end < 0) em = false
      else {
        flush()
        out.push({ kind: 'em', children: parseInline(src.slice(i + 1, end), { ...allowed, em: false }) })
        i = end + 1
        continue
      }
    }

    if (ch === '[' && link) {
      // The next `]` (and the next `)` after it) are remembered, so a run of `[`
      // waiting on one far `]` is one scan, not one per bracket.
      if (bracket < i) bracket = src.indexOf(']', i + 1)
      if (bracket < 0) link = false
      else if (src[bracket + 1] === '(') {
        if (paren < bracket + 2) paren = src.indexOf(')', bracket + 2)
        if (paren < 0) link = false
        else {
          const url = src.slice(bracket + 2, paren).trim()
          const href = safeHref(url)
          if (href) {
            flush()
            const label = src.slice(i + 1, bracket)
            out.push({
              kind: 'link', href, url, bare: false,
              children: label.trim() ? parseInline(label, { ...allowed, link: false }) : [{ kind: 'text', value: url }],
            })
            i = paren + 1
            continue
          }
        }
      }
    }

    if (link && (ch === 'h' || ch === 'H' || ch === 'm' || ch === 'M') && !isWord(src[i - 1]) && LINK_PREFIX.test(src.slice(i, i + 8))) {
      const end = bareUrlEnd(src, i)
      const url = src.slice(i, end)
      const href = safeHref(url)
      if (href) { flush(); out.push({ kind: 'link', href, url, bare: true, children: [{ kind: 'text', value: url }] }); i = end; continue }
      // Not a link: the whole run is text, so it is not scanned again from inside.
      text += src.slice(i, Math.max(end, i + 1))
      i = Math.max(end, i + 1)
      continue
    }

    text += ch
    i++
  }
  flush()
  return out
}

function inlineHtml(nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.kind) {
      case 'text': out += escapeHtml(node.value); break
      case 'code': out += `<code>${escapeHtml(node.value)}</code>`; break
      case 'strong': out += `<strong>${inlineHtml(node.children)}</strong>`; break
      case 'em': out += `<em>${inlineHtml(node.children)}</em>`; break
      case 'link': out += `<a href="${escapeHtml(node.href)}" rel="noopener noreferrer">${inlineHtml(node.children)}</a>`; break
    }
  }
  return out
}

function inlineText(nodes: readonly Inline[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.kind) {
      case 'text': case 'code': out += node.value; break
      case 'strong': case 'em': out += inlineText(node.children); break
      case 'link': {
        const label = inlineText(node.children)
        out += node.bare || label === node.url ? node.url : `${label} <${node.url}>`
        break
      }
    }
  }
  return out
}

// ── blocks: groups of lines ─────────────────────────────────────────────────

type Block =
  | { readonly kind: 'p'; readonly lines: readonly string[] }
  | { readonly kind: 'h'; readonly level: 1 | 2; readonly line: string }
  | { readonly kind: 'ul'; readonly items: readonly string[][] }
  | { readonly kind: 'ol'; readonly start: number; readonly items: readonly string[][] }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }

const BLANK = /^\s*$/
const HEADING = /^ {0,3}(#{1,2})[ \t]+(.+)$/s
const BULLET = /^ {0,3}- +(.*)$/s
const NUMBERED = /^ {0,3}(\d{1,9})\. +(.*)$/s
const QUOTE = /^ {0,3}> ?(.*)$/s
const CONTINUES = /^ {2,}\S/

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = []
  const quoting = depth < MAX_QUOTE_DEPTH
  const starts = (line: string): boolean => HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || (quoting && QUOTE.test(line))

  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (BLANK.test(line)) { i++; continue }

    const heading = HEADING.exec(line)
    if (heading) { blocks.push({ kind: 'h', level: heading[1]!.length === 1 ? 1 : 2, line: heading[2]!.trim() }); i++; continue }

    if (quoting && QUOTE.test(line)) {
      const inner: string[] = []
      for (let m = QUOTE.exec(lines[i] ?? ''); i < lines.length && m; m = QUOTE.exec(lines[++i] ?? '')) inner.push(m[1]!)
      blocks.push({ kind: 'quote', blocks: parseBlocks(inner, depth + 1) })
      continue
    }

    const list = (pattern: RegExp, body: (m: RegExpExecArray) => string): string[][] => {
      const items: string[][] = []
      while (i < lines.length) {
        const m = pattern.exec(lines[i]!)
        if (m) { items.push([body(m)]); i++; continue }
        if (items.length && CONTINUES.test(lines[i]!) && !starts(lines[i]!)) { items[items.length - 1]!.push(lines[i]!.trim()); i++; continue }
        break
      }
      return items
    }
    if (BULLET.test(line)) { blocks.push({ kind: 'ul', items: list(BULLET, m => m[1]!) }); continue }
    const numbered = NUMBERED.exec(line)
    if (numbered) { blocks.push({ kind: 'ol', start: Number(numbered[1]), items: list(NUMBERED, m => m[2]!) }); continue }

    const para: string[] = [line]
    for (i++; i < lines.length && !BLANK.test(lines[i]!) && !starts(lines[i]!); i++) para.push(lines[i]!)
    blocks.push({ kind: 'p', lines: para })
  }
  return blocks
}

interface Rendered { html: string; text: string }

function renderLines(lines: readonly string[], joinText: string): Rendered {
  const nodes = lines.map(line => parseInline(line, ALL))
  return { html: nodes.map(inlineHtml).join('<br>'), text: nodes.map(inlineText).join(joinText) }
}

function renderBlocks(blocks: readonly Block[]): Rendered {
  const html: string[] = []
  const text: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'p': {
        const r = renderLines(block.lines, '\n')
        html.push(`<p>${r.html}</p>`)
        text.push(r.text)
        break
      }
      case 'h': {
        const r = renderLines([block.line], '\n')
        html.push(`<h${block.level}>${r.html}</h${block.level}>`)
        text.push(r.text)
        break
      }
      case 'ul': case 'ol': {
        const items = block.items.map(item => renderLines(item, '\n  '))
        const tag = block.kind
        const start = block.kind === 'ol' && block.start !== 1 ? ` start="${block.start}"` : ''
        html.push(`<${tag}${start}>${items.map(r => `<li>${r.html}</li>`).join('')}</${tag}>`)
        const first = block.kind === 'ol' ? block.start : 0
        text.push(items.map((r, n) => (block.kind === 'ol' ? `${first + n}. ` : '- ') + r.text).join('\n'))
        break
      }
      case 'quote': {
        const r = renderBlocks(block.blocks)
        html.push(`<blockquote>${r.html}</blockquote>`)
        text.push(r.text.split('\n').map(line => (line ? `> ${line}` : '>')).join('\n'))
        break
      }
    }
  }
  return { html: html.join('\n'), text: text.join('\n\n') }
}

/** Light marks in, the html and plain bodies of a message out. Never throws. */
export function formatMessage(source: string): FormattedMessage {
  const lines = String(source ?? '').split(/\r?\n|\r/)
  const { html, text } = renderBlocks(parseBlocks(lines, 0))
  return { html, text }
}
