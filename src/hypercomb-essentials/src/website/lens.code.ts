// website/lens.code.ts
//
// READING THE CODE THAT DREW A PANEL, ONE STATEMENT AT A TIME.
//
// The lens traces a panel while it draws (lens.trace.ts): every element made,
// every property set, every listener added, each with the line and column of
// the code that did it. This file reads the code at that place and says what it
// meant, so the panel can be shown as a template (lens.panel.ts):
//
//   head.className = "hc-brood-head"              class="hc-brood-head"
//   row.className = `hc-brood-row${a ? ' x' : ''}` class="hc-brood-row" [class.x]="a"
//   name.textContent = broodLabel(record)          {{ broodLabel(record) }}
//   close.addEventListener('click', () => this.close())   (click)="this.close()"
//   for (const record of this.#roster) body.appendChild(…)  @for (const record of this.#roster)
//
// It is not a parser. It masks strings, template text and comments so their
// brackets cannot count, then reads statements by their brackets and the shape
// of their lines. Code it cannot read is shown by what it produced instead.
//
// Pure: text in, plain data out.

/**
 * The text with every string's, template's and comment's CONTENT turned to
 * spaces (newlines kept), so brackets and semicolons in it are not structure.
 * A template's `${ … }` stays code. Same length as the text.
 */
export function maskCode(src: string): string {
  const out = src.split('')
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '
  }
  // Template nesting: each entry is the brace depth at which a `${` opened.
  const templates: number[] = []
  let depth = 0
  let i = 0
  const scanTemplate = (from: number): number => {
    // From just past a backtick (or a closing `}` of `${`), to the closing backtick or the next `${`.
    let j = from
    while (j < src.length) {
      if (src[j] === '\\') { j += 2; continue }
      if (src[j] === '`') { blank(from, j); return j + 1 }
      if (src[j] === '$' && src[j + 1] === '{') {
        blank(from, j)
        templates.push(depth)
        depth++
        return j + 2
      }
      j++
    }
    blank(from, src.length)
    return src.length
  }
  while (i < src.length) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      const stop = end < 0 ? src.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? src.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
      blank(i + 1, Math.min(j, src.length))
      i = j + 1
      continue
    }
    if (c === '`') { i = scanTemplate(i + 1); continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (c === '}' && templates.length && templates[templates.length - 1] === depth) {
        templates.pop()
        i = scanTemplate(i + 1)
        continue
      }
    }
    i++
  }
  return out.join('')
}

/** The offset of a 1-based line and column, or -1 past the text. */
export function offsetOf(src: string, line: number, column: number): number {
  let at = 0
  for (let n = 1; n < line; n++) {
    const next = src.indexOf('\n', at)
    if (next < 0) return -1
    at = next + 1
  }
  const offset = at + Math.max(0, column - 1)
  return offset <= src.length ? offset : -1
}

const OPEN = '([{'
const CLOSE = ')]}'
/** A line that ends with one of these goes on to the next. */
const CARRIES_ON = /[=([{,?:+\-*/&|!<>]$/
/** A line that starts with one of these carries on the line before. */
const CARRIED = /^[?:.)\]}+\-*/&|]/
/** A line that is only a flow header (`for (…)`, `if (…)`, `else`) carries on to the statement under it. */
const HEADER_LINE = /^\s*(?:\}\s*)?(?:(?:else\s+)?(?:if|for|while)\s*\(.*\)|else)\s*$/

/** The masked line that ends at `newline` (exclusive). */
const lineBefore = (masked: string, newline: number): string => masked.slice(masked.lastIndexOf('\n', newline - 1) + 1, newline)

const lastSolid = (text: string): string => text.replace(/\s+$/, '')
const firstSolid = (text: string): string => text.replace(/^\s+/, '')

/** The span of the statement that holds `offset`, read off the masked text. */
export function statementAt(src: string, masked: string, offset: number): { start: number; end: number; text: string } {
  let depth = 0
  let start = 0
  for (let i = offset - 1; i >= 0; i--) {
    const c = masked[i]
    if (CLOSE.includes(c)) depth++
    else if (OPEN.includes(c)) {
      if (depth === 0) { start = i + 1; break }
      depth--
    } else if (depth === 0 && c === ';') { start = i + 1; break }
    else if (depth === 0 && c === '\n') {
      const before = lastSolid(masked.slice(Math.max(0, i - 200), i))
      const after = firstSolid(masked.slice(i + 1, i + 200))
      if (!CARRIES_ON.test(before) && !CARRIED.test(after) && !HEADER_LINE.test(lineBefore(masked, i))) { start = i + 1; break }
    }
  }
  // A header line's own `}` (`} else`) belongs to the block before, not to this statement.
  while (start < masked.length && /[\s}]/.test(masked[start])) start++
  depth = 0
  let end = masked.length
  for (let i = offset; i < masked.length; i++) {
    const c = masked[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) {
      if (depth === 0) { end = i; break }
      depth--
    } else if (depth === 0 && c === ';') { end = i; break }
    else if (depth === 0 && c === '\n') {
      const before = lastSolid(masked.slice(Math.max(0, i - 200), i))
      const after = firstSolid(masked.slice(i + 1, i + 200))
      if (!CARRIES_ON.test(before) && !CARRIED.test(after)) { end = i; break }
    }
  }
  return { start, end, text: src.slice(start, end).trim() }
}

/** The index just past the bracket matching the one at `at` (masked text), or -1. */
function closeOf(masked: string, at: number): number {
  let depth = 0
  for (let i = at; i < masked.length; i++) {
    if (OPEN.includes(masked[i])) depth++
    else if (CLOSE.includes(masked[i])) {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** The index of the bracket opening the one that closes at `at` (masked text), or -1. */
function openOf(masked: string, at: number): number {
  let depth = 0
  for (let i = at; i >= 0; i--) {
    if (CLOSE.includes(masked[i])) depth++
    else if (OPEN.includes(masked[i])) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

export type FlowKind = 'if' | 'for' | 'while' | 'else'

/** A condition or loop a statement runs under. */
export interface Flow {
  readonly kind: FlowKind
  /** What is inside its parentheses: `report !== undefined`, `const record of this.#roster`. */
  readonly head: string
}

/** A statement with the flow written in front of it taken off: `for (…) body.appendChild(…)`. */
export function stripFlow(statement: string): { flows: Flow[]; rest: string } {
  const flows: Flow[] = []
  let rest = statement.trim()
  for (;;) {
    const word = /^(if|for|while)\s*\(/.exec(rest)
    if (!word) break
    const masked = maskCode(rest)
    const open = rest.indexOf('(', word[1].length)
    const close = closeOf(masked, open)
    if (close < 0) break
    flows.push({ kind: word[1] as FlowKind, head: rest.slice(open + 1, close - 1).trim() })
    rest = rest.slice(close).trim()
    if (rest.startsWith('{')) rest = rest.slice(1).trim()
  }
  return { flows, rest }
}

/**
 * The blocks a statement sits in, innermost first, up to the function it is
 * in: `if (…) {`, `for (…) {`, `else {`. A block that is not flow (the
 * function's own body, an object, a class) ends the walk.
 */
export function enclosingFlow(src: string, masked: string, offset: number): Flow[] {
  const flows: Flow[] = []
  let depth = 0
  for (let i = offset - 1; i >= 0; i--) {
    const c = masked[i]
    if (c === '}' || c === ')' || c === ']') { depth++; continue }
    if (c === '(' || c === '[') { if (depth > 0) depth--; continue }
    if (c !== '{') continue
    if (depth > 0) { depth--; continue }
    // An unmatched `{`: what opened it?
    const before = lastSolid(masked.slice(0, i))
    if (/\belse$/.test(before)) { flows.push({ kind: 'else', head: '' }); i = before.length - 4; continue }
    if (!before.endsWith(')')) break
    const open = openOf(masked, before.length - 1)
    if (open < 0) break
    const word = /\b(if|for|while)\s*$/.exec(masked.slice(0, open))
    if (!word) break
    flows.push({ kind: word[1] as FlowKind, head: src.slice(open + 1, before.length - 1).trim() })
    i = open - word[0].length + 1
  }
  return flows
}

/** Split at commas outside brackets, strings and templates. */
export function splitArgs(text: string): string[] {
  const masked = maskCode(text)
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) depth--
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1 }
  }
  const last = text.slice(start).trim()
  if (last) out.push(last)
  return out
}

export type Statement =
  | { readonly kind: 'assign'; readonly target: string; readonly value: string }
  | { readonly kind: 'call'; readonly target: string; readonly method: string; readonly args: readonly string[] }
  | { readonly kind: 'other'; readonly text: string }

/** What one statement does: assigns a value, calls a method, or something else. */
export function readStatement(statement: string): Statement {
  const text = statement.trim().replace(/;$/, '')
  const masked = maskCode(text)
  // An assignment: the first `=` outside brackets that is not part of ==, !=, <=, >=, =>.
  let depth = 0
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) depth--
    else if (c === '=' && depth === 0) {
      const prev = masked[i - 1] ?? ''
      const next = masked[i + 1] ?? ''
      if (next === '=' || next === '>' || '=!<>+-*/'.includes(prev)) continue
      const target = text.slice(0, i).trim().replace(/^(const|let|var)\s+/, '')
      return { kind: 'assign', target, value: text.slice(i + 1).trim() }
    }
  }
  // A call: `target.method(args)` with nothing after its closing parenthesis.
  if (masked.endsWith(')')) {
    const open = openOf(masked, masked.length - 1)
    const head = text.slice(0, open)
    const call = /^([\s\S]*)\.([\w$#]+)\s*$/.exec(head)
    if (open > 0 && call) return { kind: 'call', target: call[1].trim(), method: call[2], args: splitArgs(text.slice(open + 1, -1)) }
  }
  return { kind: 'other', text }
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }

/** JavaScript escapes said as the characters they stand for: compiled code writes `×` as `\xD7`. */
export function decodeEscapes(text: string): string {
  return text.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/g,
    (_, braced?: string, four?: string, two?: string, other?: string) => {
      const hex = braced ?? four ?? two
      if (hex) return String.fromCodePoint(parseInt(hex, 16))
      return SIMPLE_ESCAPES[other ?? ''] ?? other ?? ''
    })
}

/** A string literal's value, or null when the text is not one plain literal. */
export function literalOf(text: string): string | null {
  const t = text.trim()
  const quote = t[0]
  if ((quote === '"' || quote === "'") && t.endsWith(quote) && t.length >= 2) {
    const body = t.slice(1, -1)
    if (!new RegExp(`(^|[^\\\\])${quote}`).test(body)) return decodeEscapes(body)
  }
  if (quote === '`' && t.endsWith('`') && !t.includes('${')) return decodeEscapes(t.slice(1, -1))
  return null
}

export type TemplatePart = { readonly text: string } | { readonly expr: string }

/** A template literal's parts, or null when the text is not one. */
export function templateParts(text: string): TemplatePart[] | null {
  const t = text.trim()
  if (!t.startsWith('`') || !t.endsWith('`') || t.length < 2) return null
  const masked = maskCode(t)
  const parts: TemplatePart[] = []
  let i = 1
  let from = 1
  while (i < t.length - 1) {
    if (t[i] === '\\') { i += 2; continue }
    if (t[i] === '$' && t[i + 1] === '{') {
      if (i > from) parts.push({ text: t.slice(from, i) })
      const close = closeOf(masked, i + 1)
      if (close < 0) return null
      parts.push({ expr: t.slice(i + 2, close - 1).trim() })
      i = close
      from = close
      continue
    }
    i++
  }
  if (from < t.length - 1) parts.push({ text: t.slice(from, t.length - 1) })
  return parts
}

/** `cond ? ' word' : ''` (either way round), as the word and the condition that adds it. */
export function toggledWord(expr: string): { word: string; when: string } | null {
  const yes = /^([\s\S]+?)\s*\?\s*(['"])\s*([\w-]+)\s*\2\s*:\s*(['"])\s*\4$/.exec(expr.trim())
  if (yes) return { word: yes[3], when: yes[1].trim() }
  const no = /^([\s\S]+?)\s*\?\s*(['"])\s*\2\s*:\s*(['"])\s*([\w-]+)\s*\3$/.exec(expr.trim())
  if (no) return { word: no[4], when: `!(${no[1].trim()})` }
  return null
}

/** A listener said by what it does: `() => this.close()` is `this.close()`. */
export function handlerOf(text: string): string {
  const t = text.trim()
  const arrow = /^(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*=>\s*([\s\S]+)$/.exec(t)
  if (!arrow) return t
  const body = arrow[1].trim()
  if (!body.startsWith('{')) return body
  const inner = oneLine(body.slice(1, -1)).replace(/;$/, '')
  return inner.includes(';') ? `{ ${inner} }` : inner
}

/** A call said short: every function body in it becomes `{…}`. */
export function shortCall(text: string): string {
  const masked = maskCode(text)
  let out = ''
  let from = 0
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '{') continue
    const close = closeOf(masked, i)
    if (close < 0) break
    out += text.slice(from, i) + '{…}'
    from = close
    i = close - 1
  }
  return oneLine(out + text.slice(from))
}

/** Collapse whitespace so a statement reads on one line. */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()
