// cell-page-css-scope.ts — make a cell page's CSS belong to the page.
//
// A cell page is an ARTIFACT: it carries its own CSS and dependencies, so it
// displays alone or beside another artifact. The site view used to lift the
// page's <style> blocks straight into `document.head`, which meant the page's
// rules applied to the WHOLE application — the hive chrome inherited them, and
// two pages could never be on screen at once without fighting each other.
//
// This rewrites a page's stylesheet so every rule is confined to the host the
// page is mounted in. The page's own root selectors become the host, because
// inside the artifact the host IS the page's root:
//
//     body { background: #fff }        →  #hc-site-view-host { background: #fff }
//     html.dark .card { color: #eee }  →  #hc-site-view-host.dark .card { … }
//     .card { padding: 1rem }          →  #hc-site-view-host .card { padding: 1rem }
//
// Root CLASS writes still work because the site view mirrors `class` and
// `data-theme` from <html>/<body> onto the host (a page's theme toggle writes
// `document.documentElement.classList`, which no longer matches on its own once
// the CSS is scoped).
//
// At-rules that describe things rather than select them — @keyframes,
// @font-face, @property, @import, @charset, @namespace, @page — pass through
// untouched. Conditional groups (@media, @supports, @container, @layer with a
// block) are recursed into, so their inner rules are scoped the same way.
//
// Written as a small hand-rolled walker rather than via CSSOM so it is pure,
// synchronous, and testable without a document. Text inside strings, comments,
// url(), and parenthesised selector arguments is never treated as structure.

/** At-rules whose body is a nested rule list — recurse into these. */
const GROUPING = /^@(media|supports|container|layer|scope)\b/i
/** At-rules whose body is not a selector list — pass through verbatim. */
const VERBATIM = /^@(keyframes|-webkit-keyframes|font-face|property|page|counter-style|font-feature-values|viewport)\b/i

/**
 * Scope every rule in `css` to `host` (a selector such as
 * `'#hc-site-view-host'`). Returns the rewritten stylesheet text.
 */
export function scopeCellPageCss(css: string, host: string): string {
  return scopeBlock(String(css ?? ''), host)
}

/** Rewrite one rule-list body (top level, or the inside of a group at-rule). */
function scopeBlock(css: string, host: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const prelude = readUntilBlock(css, i)
    if (prelude === null) { out += css.slice(i); break }
    const head = css.slice(i, prelude.end)
    if (prelude.terminator === ';') {
      // A statement at-rule (@import, @charset, @namespace…) — pass through.
      out += head
      i = prelude.end
      continue
    }
    const body = readBalanced(css, prelude.end)
    const inner = css.slice(prelude.end + 1, body.end)
    const selector = head.trim()
    if (VERBATIM.test(selector)) {
      out += head + '{' + inner + '}'
    } else if (GROUPING.test(selector)) {
      out += head + '{' + scopeBlock(inner, host) + '}'
    } else if (selector.startsWith('@')) {
      // Unknown at-rule with a block — leave its body alone rather than
      // guessing at its grammar.
      out += head + '{' + inner + '}'
    } else {
      out += head.replace(selector, scopeSelectorList(selector, host)) + '{' + inner + '}'
    }
    i = body.end + 1
    if (i > css.length) break
  }
  return out
}

/** Rewrite a comma-separated selector list. */
export function scopeSelectorList(list: string, host: string): string {
  return splitTopLevel(list, ',')
    .map(sel => scopeSelector(sel.trim(), host))
    .filter(Boolean)
    .join(', ')
}

/** Rewrite one complex selector. */
function scopeSelector(selector: string, host: string): string {
  if (!selector) return ''
  // A comment before the selector belongs to the author's text, not to the
  // selector — keep it in front of the rewrite.
  const lead = /^(?:\s|\/\*[\s\S]*?\*\/)*/.exec(selector)?.[0] ?? ''
  if (lead) {
    const core = selector.slice(lead.length)
    return core ? lead + scopeSelector(core, host) : selector
  }
  // Nesting / relative selectors are already relative to their parent rule.
  if (selector.startsWith('&')) return selector

  // `html`, `body` and `:root` all name the page's root, and inside the
  // artifact that root IS the host — so every root compound in the chain
  // becomes the host, and consecutive ones collapse into one element with
  // their qualifiers merged (`html.dark body` → `#host.dark`, not
  // `#host.dark body`, which would match nothing).
  const parts = splitCompounds(selector)
  if (!parts.some(p => p.kind === 'compound' && ROOT_HEAD.test(p.text))) {
    return `${host} ${selector}`
  }

  type Piece = { root: boolean; text: string }
  const pieces: Piece[] = []
  for (const part of parts) {
    if (part.kind === 'combinator') {
      pieces.push({ root: false, text: part.text })
      continue
    }
    const rootMatch = ROOT_HEAD.exec(part.text)
    if (!rootMatch) { pieces.push({ root: false, text: part.text }); continue }
    const qualifiers = part.text.slice(rootMatch[0].length)
    const previous = pieces.at(-2)
    const between = pieces.at(-1)
    const collapsible = previous?.root === true && between !== undefined &&
      !between.root && /^(\s*|\s*>\s*)$/.test(between.text)
    if (collapsible) {
      // Same element named twice — fold the qualifiers onto the first.
      pieces.pop()
      pieces[pieces.length - 1] = { root: true, text: previous.text + qualifiers }
      continue
    }
    pieces.push({ root: true, text: host + qualifiers })
  }
  const out = pieces.map(p => p.text).join('')
  return pieces[0]?.root ? out : `${host} ${out}`
}

const ROOT_HEAD = /^(html|body|:root)(?![\w-])/i

/** Split a complex selector into compounds and the combinators between them. */
function splitCompounds(selector: string): Array<{ kind: 'compound' | 'combinator'; text: string }> {
  const parts: Array<{ kind: 'compound' | 'combinator'; text: string }> = []
  let depth = 0
  let start = 0
  let i = 0
  const push = (kind: 'compound' | 'combinator', text: string): void => {
    if (text) parts.push({ kind, text })
  }
  while (i < selector.length) {
    const skip = skipNoise(selector, i)
    if (skip !== i) { i = skip; continue }
    const c = selector[i]
    if (c === '(' || c === '[') { depth++; i++; continue }
    if (c === ')' || c === ']') { depth = Math.max(0, depth - 1); i++; continue }
    if (depth === 0 && (/\s/.test(c) || c === '>' || c === '+' || c === '~')) {
      push('compound', selector.slice(start, i))
      let j = i
      while (j < selector.length && (/\s/.test(selector[j]) || '>+~'.includes(selector[j]))) j++
      push('combinator', selector.slice(i, j))
      start = j
      i = j
      continue
    }
    i++
  }
  push('compound', selector.slice(start))
  return parts
}

/**
 * Scan forward for the `{` that opens a rule's block, or the `;` that ends a
 * statement at-rule. Returns null when neither appears (malformed tail).
 */
function readUntilBlock(css: string, from: number): { end: number; terminator: '{' | ';' } | null {
  let depth = 0
  for (let i = from; i < css.length; i++) {
    const skip = skipNoise(css, i)
    if (skip !== i) { i = skip - 1; continue }
    const c = css[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && c === '{') return { end: i, terminator: '{' }
    else if (depth === 0 && c === ';') return { end: i + 1, terminator: ';' }
  }
  return null
}

/** Find the `}` matching the `{` at `open`. */
function readBalanced(css: string, open: number): { end: number } {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    const skip = skipNoise(css, i)
    if (skip !== i) { i = skip - 1; continue }
    const c = css[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { end: i }
    }
  }
  return { end: css.length }
}

/** Split on `sep`, ignoring separators inside strings, comments, or brackets. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const skip = skipNoise(text, i)
    if (skip !== i) { i = skip - 1; continue }
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    else if (c === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts
}

/**
 * If `i` starts a string or a comment, return the index just past it —
 * otherwise return `i` unchanged. One place that knows what is not structure.
 */
function skipNoise(text: string, i: number): number {
  const c = text[i]
  if (c === '"' || c === "'") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue }
      if (text[j] === c) return j + 1
    }
    return text.length
  }
  if (c === '/' && text[i + 1] === '*') {
    const close = text.indexOf('*/', i + 2)
    return close < 0 ? text.length : close + 2
  }
  return i
}
