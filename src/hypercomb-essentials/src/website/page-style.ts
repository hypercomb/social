// website/page-style.ts
//
// A PAGE'S LOOK, LIFTED INTO THREE ATOMS IT CAN SHARE.
//
//   type    the faces (`@font-face`)
//   theme   the variables every rule reads (custom properties on the root)
//   sheet   the rules
//
// Each is put once and linked by signature, so fifty parts of one page hold
// one sheet between them, and a second page restyles by linking another theme.
// Swap the theme atom and the same rules draw differently; that is the whole
// reason the variables are kept apart from the rules.
//
// WHY EVERY ATOM IS CONFINED TO A CLASS. A sheet a page LINKS is lifted into
// the hive's own document as it stands (presentation/tiles/cell-page-stylesheets.ts);
// only inline CSS is confined by the site view. A lifted sheet that still said
// `body { … }` or `* { … }` would restyle the hive. So each rule is rewritten
// to sit under one class, with the page's root selectors becoming that class,
// and the page (and each part) wraps itself in it. The same sheet then works
// lifted into the hive, and inside a seated part's shadow root.
//
// Pure: text in, text out.

import { scopeCellPageCss } from '../presentation/tiles/cell-page-css-scope.js'

export interface StyleAtoms {
  readonly type: string
  readonly theme: string
  readonly sheet: string
}

/** The file name each atom is linked under, so a host serves it as CSS. */
export const ATOM_FILE: Record<keyof StyleAtoms, string> = {
  type: 'type.css', theme: 'theme.css', sheet: 'sheet.css',
}
/** Link order: faces, then variables, then the rules that read both. */
export const ATOM_ORDER: readonly (keyof StyleAtoms)[] = ['type', 'theme', 'sheet']

const ROOTS = new Set([':root', 'html', ':host'])

/** Index just past the string, comment or bracket that starts at `i`, or `i`
 *  when none starts there. Keeps structure characters inside them inert. */
function skipInert(css: string, i: number): number {
  const c = css[i]
  if (c === '"' || c === "'") {
    let j = i + 1
    while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1
    return Math.min(j + 1, css.length)
  }
  if (c === '/' && css[i + 1] === '*') {
    const end = css.indexOf('*/', i + 2)
    return end < 0 ? css.length : end + 2
  }
  return i
}

/** Split at a separator that is not inside a string, comment or brackets. */
function splitTop(text: string, separator: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const past = skipInert(text, i)
    if (past !== i) { i = past - 1; continue }
    const c = text[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === separator && depth === 0) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start))
  return out
}

type TopRule =
  | { readonly kind: 'statement'; readonly text: string }
  | { readonly kind: 'block'; readonly head: string; readonly body: string }

/** The top-level rules of a stylesheet, in order. */
function topRules(css: string): TopRule[] {
  const rules: TopRule[] = []
  let i = 0
  while (i < css.length) {
    let j = i
    let open = -1
    for (; j < css.length; j++) {
      const past = skipInert(css, j)
      if (past !== j) { j = past - 1; continue }
      if (css[j] === ';') break
      if (css[j] === '{') { open = j; break }
    }
    if (open < 0) {
      const text = css.slice(i, Math.min(j + 1, css.length))
      if (text.trim()) rules.push({ kind: 'statement', text })
      i = j + 1
      continue
    }
    let depth = 1
    let k = open + 1
    for (; k < css.length && depth > 0; k++) {
      const past = skipInert(css, k)
      if (past !== k) { k = past - 1; continue }
      if (css[k] === '{') depth++
      else if (css[k] === '}') depth--
    }
    // An unclosed block runs to the end of the text; there is no brace to drop.
    const bodyEnd = depth === 0 ? k - 1 : css.length
    rules.push({ kind: 'block', head: css.slice(i, open), body: css.slice(open + 1, bodyEnd) })
    i = k
  }
  return rules
}

const bare = (selector: string): string => selector.replace(/\/\*[\s\S]*?\*\//g, '').trim()

/**
 * Split a stylesheet into its three atoms. Nothing is rewritten: every rule
 * lands in exactly one atom with its text intact, except a root rule that
 * mixes variables with other declarations, which is divided between the theme
 * (its variables) and the sheet (the rest).
 */
export function splitStyle(css: string): StyleAtoms {
  const type: string[] = []
  const theme: string[] = []
  const sheet: string[] = []
  for (const rule of topRules(String(css ?? ''))) {
    if (rule.kind === 'statement') { sheet.push(rule.text.trim()); continue }
    const head = bare(rule.head)
    if (/^@font-face\b/i.test(head)) { type.push(`${head}{${rule.body.trim()}}`); continue }
    const selectors = head.startsWith('@') ? [] : splitTop(head, ',').map(s => s.trim())
    if (selectors.length > 0 && selectors.every(s => ROOTS.has(s))) {
      const declarations = splitTop(rule.body, ';').map(d => d.trim()).filter(Boolean)
      const variables = declarations.filter(d => bare(d).startsWith('--'))
      const rest = declarations.filter(d => !bare(d).startsWith('--'))
      if (variables.length) theme.push(`:root{${variables.join(';')}}`)
      if (rest.length) sheet.push(`${head}{${rest.join(';')}}`)
      continue
    }
    sheet.push(`${rule.head.trim()}{${rule.body}}`)
  }
  return { type: type.join('\n'), theme: theme.join('\n'), sheet: sheet.join('\n') }
}

/** Confine every atom to `.scope`. An empty atom stays empty. */
export function scopeAtoms(atoms: StyleAtoms, scope: string): StyleAtoms {
  const host = `.${scope}`
  const confine = (css: string): string => (css.trim() ? `${scopeCellPageCss(css, host).trim()}\n` : '')
  return { type: confine(atoms.type), theme: confine(atoms.theme), sheet: confine(atoms.sheet) }
}

/** The `<link>` a document reaches one atom by. */
export const atomLink = (atom: keyof StyleAtoms, sig: string): string =>
  `<link rel="stylesheet" href="resource:${sig}/${ATOM_FILE[atom]}">`
