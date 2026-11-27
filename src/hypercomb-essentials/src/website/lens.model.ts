// website/lens.model.ts
//
// THE LENS'S READING OF ONE PAGE: its markup said in a binding syntax a person
// reads at a glance (jwize, 2026-11-18: "a human readable interface syntax so
// we can easily see the html that will be provided … a transpiled view that
// shows the binding in an angular like syntax but not necessarily compiled to
// that"; "the code runs but the alternate view is a one way view for
// developers to understand the logic").
//
// ONE WAY. Nothing here is ever compiled or run. The page stays what it is; this
// only says it differently:
//
//   data-hc-trait="header"           *trait="header"        the placeholder a tile fills
//   style="color: red"               [style.color]="red"    a style the element binds
//   onclick="go()"                   (click)="go()"         what it does when pressed
//   src="resource:<sig>"             [src]="resource 1a2b…" bytes it reaches by signature
//   <community-doors>                a behaviour            code, not markup
//
// A class the page's own styles never name is said as a WARNING: the piece
// leans on a look it does not carry (src/documentation/website-artifact-paradigm.md:
// a part stands alone and carries its own appearance).
//
// Pure: text in, plain data out. It parses with the platform's DOMParser and
// touches no store, no registry and no live document.

import { TRAIT_ATTR } from './page-cut.js'

export type LensTone =
  | 'punct' | 'tag' | 'attr' | 'value' | 'binding' | 'trait' | 'text' | 'behaviour' | 'warn' | 'muted' | 'flow'

export interface LensSpan {
  readonly text: string
  readonly tone: LensTone
  /** Said when the span is pointed at: a full signature, why a class is warned. */
  readonly note?: string
  /** The trait word this span is about, so the view can lead to its filler's card. */
  readonly trait?: string
}

export interface LensLine {
  readonly depth: number
  readonly spans: readonly LensSpan[]
}

/** A sheet the page reaches by signature. */
export interface LensSheet {
  readonly sig: string
  readonly file: string
}

export interface LensRead {
  readonly lines: readonly LensLine[]
  /** Every trait word the page states, in document order, once each. */
  readonly traits: readonly string[]
  /** The sheets it links by signature, in link order. */
  readonly sheets: readonly LensSheet[]
  /** Every stylesheet written inside it, joined in document order. */
  readonly inlineCss: string
  /** Every class it uses, once each. */
  readonly classes: readonly string[]
  /** Its behaviours: custom elements and scripts, as the lens names them. */
  readonly behaviours: readonly string[]
  /** How many distinct pictures it reaches by signature. */
  readonly pictures: number
}

export interface ReadOptions {
  /** True when a tile fills the trait: its own version is then said as one line
   *  that leads to the filler's card, never written out. */
  readonly filled?: (word: string) => boolean
  /** True when the piece's own styles name the class; a class that answers
   *  false is warned. Unasked, no class is warned. */
  readonly owned?: (className: string) => boolean
  /** Lines said before the rest is summed up as one. */
  readonly maxLines?: number
}

const RESOURCE_SIG = /(?:resource:|\/@resource\/)([0-9a-f]{64})/i
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const REACHING = new Set(['src', 'href', 'poster', 'srcset', 'data', 'action'])
const MAX_LINES = 1500
const TEXT_MAX = 80
const VALUE_MAX = 60
const INLINE_MAX = 60

const short = (sig: string): string => `${sig.slice(0, 8)}…`
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()
const isBehaviourTag = (tag: string): boolean => tag.includes('-')

/** The file a resource link names after its signature (`resource:<sig>/sheet.css`), or ''. */
const fileOf = (href: string): string => {
  const at = href.search(RESOURCE_SIG)
  if (at < 0) return ''
  const rest = href.slice(at).replace(RESOURCE_SIG, '')
  return rest.replace(/^\/+/, '')
}

/** Split declarations at semicolons that are not inside parentheses or quotes. */
function declarations(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let depth = 0, quote = '', start = 0
  const take = (end: number): void => {
    const piece = style.slice(start, end)
    const colon = piece.indexOf(':')
    if (colon > 0) {
      const name = piece.slice(0, colon).trim()
      const value = piece.slice(colon + 1).trim()
      if (name && value) out.push([name, value])
    }
  }
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth === 0) { take(i); start = i + 1 }
  }
  take(style.length)
  return out
}

/** The spans one attribute is said as. */
function attributeSpans(name: string, value: string, options: ReadOptions): LensSpan[] {
  if (name === TRAIT_ATTR) {
    return [{ text: ' *trait', tone: 'trait', trait: value }, { text: '=', tone: 'punct' }, { text: `"${value}"`, tone: 'trait', trait: value }]
  }
  if (name === 'style') {
    return declarations(value).flatMap(([prop, val]) => [
      { text: ` [style.${prop}]`, tone: 'binding' as const },
      { text: '=', tone: 'punct' as const },
      { text: `"${clip(val, VALUE_MAX)}"`, tone: 'value' as const, ...(val.length > VALUE_MAX ? { note: val } : {}) },
    ])
  }
  if (/^on[a-z]+$/.test(name)) {
    const code = squash(value)
    return [
      { text: ` (${name.slice(2)})`, tone: 'binding' },
      { text: '=', tone: 'punct' },
      { text: `"${clip(code, VALUE_MAX)}"`, tone: 'value', ...(code.length > VALUE_MAX ? { note: code } : {}) },
    ]
  }
  if (REACHING.has(name)) {
    const sig = RESOURCE_SIG.exec(value)?.[1]?.toLowerCase()
    if (sig) {
      const file = fileOf(value)
      return [
        { text: ` [${name}]`, tone: 'binding' },
        { text: '=', tone: 'punct' },
        { text: `"resource ${short(sig)}${file ? ` ${file}` : ''}"`, tone: 'value', note: sig },
      ]
    }
  }
  if (name === 'class') {
    const names = value.split(/\s+/).filter(Boolean)
    const spans: LensSpan[] = [{ text: ' class', tone: 'attr' }, { text: '="', tone: 'punct' }]
    names.forEach((cls, index) => {
      if (index > 0) spans.push({ text: ' ', tone: 'value' })
      const owned = options.owned ? options.owned(cls) : true
      spans.push(owned
        ? { text: cls, tone: 'value' }
        : { text: cls, tone: 'warn', note: 'No rule this piece carries names this class: it leans on a look from elsewhere.' })
    })
    spans.push({ text: '"', tone: 'punct' })
    return spans
  }
  if (value === '') return [{ text: ` ${name}`, tone: 'attr' }]
  const said = squash(value)
  return [
    { text: ` ${name}`, tone: 'attr' },
    { text: '=', tone: 'punct' },
    { text: `"${clip(said, VALUE_MAX)}"`, tone: 'value', ...(said.length > VALUE_MAX ? { note: said } : {}) },
  ]
}

/** `<tag attr…` as spans, without the closing bracket. */
function openSpans(el: Element, options: ReadOptions): LensSpan[] {
  const tag = el.localName
  const spans: LensSpan[] = [{ text: '<', tone: 'punct' }, { text: tag, tone: isBehaviourTag(tag) ? 'behaviour' : 'tag' }]
  for (const attr of Array.from(el.attributes)) spans.push(...attributeSpans(attr.name, attr.value, options))
  return spans
}

const closeSpans = (tag: string): LensSpan[] =>
  [{ text: '</', tone: 'punct' }, { text: tag, tone: isBehaviourTag(tag) ? 'behaviour' : 'tag' }, { text: '>', tone: 'punct' }]

const lineCount = (text: string): number => (text.trim() ? text.trim().split('\n').length : 0)

/** The meaningful children of an element: elements and text that says something. */
const meaningful = (el: Element): ChildNode[] =>
  Array.from(el.childNodes).filter(node =>
    node.nodeType === 1 || (node.nodeType === 3 && squash(node.textContent ?? '') !== ''))

/**
 * Read a page as the lens says it. The body is the template; the head is only
 * where its look is reached from, so it is read into `sheets` and `inlineCss`
 * and never said as lines.
 */
export function readPage(html: string, options: ReadOptions = {}): LensRead {
  const source = String(html ?? '')
  const max = options.maxLines ?? MAX_LINES
  const empty: LensRead = { lines: [], traits: [], sheets: [], inlineCss: '', classes: [], behaviours: [], pictures: 0 }
  if (!source.trim() || typeof DOMParser === 'undefined') return empty
  const doc = new DOMParser().parseFromString(source, 'text/html')

  const sheets: LensSheet[] = []
  for (const link of Array.from(doc.querySelectorAll('link'))) {
    if (!/\bstylesheet\b/i.test(link.getAttribute('rel') ?? '')) continue
    const href = link.getAttribute('href') ?? ''
    const sig = RESOURCE_SIG.exec(href)?.[1]?.toLowerCase()
    if (sig && !sheets.some(sheet => sheet.sig === sig)) sheets.push({ sig, file: fileOf(href) })
  }
  const inlineCss = Array.from(doc.querySelectorAll('style'), style => style.textContent ?? '').join('\n')

  const traits: string[] = []
  const classes = new Set<string>()
  const behaviours: string[] = []
  const pictures = new Set<string>()
  const lines: LensLine[] = []
  let dropped = 0

  const say = (depth: number, spans: LensSpan[]): void => {
    if (lines.length >= max) { dropped++; return }
    lines.push({ depth, spans })
  }

  const visit = (el: Element, depth: number): void => {
    const tag = el.localName
    const word = el.getAttribute(TRAIT_ATTR)
    if (word && !traits.includes(word)) traits.push(word)
    for (const cls of (el.getAttribute('class') ?? '').split(/\s+/)) if (cls) classes.add(cls)
    for (const name of REACHING) {
      const sig = RESOURCE_SIG.exec(el.getAttribute(name) ?? '')?.[1]
      if (sig && tag !== 'script' && tag !== 'link') pictures.add(sig.toLowerCase())
    }

    if (tag === 'script') {
      const src = el.getAttribute('src') ?? ''
      const sig = RESOURCE_SIG.exec(src)?.[1]?.toLowerCase()
      const named = sig ? `script ${short(sig)}` : `script, ${lineCount(el.textContent ?? '')} lines`
      behaviours.push(named)
      const spans = openSpans(el, options)
      spans.push({ text: '>', tone: 'punct' })
      spans.push({ text: sig ? ' … ' : ` … ${lineCount(el.textContent ?? '')} lines … `, tone: 'behaviour' })
      spans.push(...closeSpans(tag))
      say(depth, spans)
      return
    }
    if (tag === 'style') {
      say(depth, [{ text: '<', tone: 'punct' }, { text: 'style', tone: 'tag' }, { text: '>', tone: 'punct' },
        { text: ` … ${ruleCount(el.textContent ?? '')} rules … `, tone: 'muted' }, ...closeSpans('style')])
      return
    }
    if (isBehaviourTag(tag) && !behaviours.includes(`<${tag}>`)) behaviours.push(`<${tag}>`)

    const open = openSpans(el, options)
    if (VOID.has(tag)) { say(depth, [...open, { text: ' />', tone: 'punct' }]); return }
    if (tag === 'svg') {
      const shapes = el.querySelectorAll('*').length
      say(depth, [...open, { text: ' />', tone: 'punct' }, { text: `  ${shapes} shapes`, tone: 'muted' }])
      return
    }
    if (word && options.filled?.(word)) {
      say(depth, [...open, { text: '>', tone: 'punct' }])
      say(depth + 1, [{ text: `filled by the tile "${word}": its own piece, below`, tone: 'trait', trait: word }])
      say(depth, closeSpans(tag))
      return
    }

    const children = meaningful(el)
    if (children.length === 0) { say(depth, [...open, { text: '>', tone: 'punct' }, ...closeSpans(tag)]); return }
    if (children.length === 1 && children[0].nodeType === 3) {
      const text = squash(children[0].textContent ?? '')
      if (text.length <= INLINE_MAX) {
        say(depth, [...open, { text: '>', tone: 'punct' }, { text, tone: 'text' }, ...closeSpans(tag)])
        return
      }
    }
    say(depth, [...open, { text: '>', tone: 'punct' }])
    for (const child of children) {
      if (child.nodeType === 1) visit(child as Element, depth + 1)
      else {
        const text = squash(child.textContent ?? '')
        say(depth + 1, [{ text: clip(text, TEXT_MAX), tone: 'text', ...(text.length > TEXT_MAX ? { note: text } : {}) }])
      }
    }
    say(depth, closeSpans(tag))
  }

  if (doc.body) visit(doc.body, 0)
  if (dropped > 0) lines.push({ depth: 0, spans: [{ text: `… ${dropped} more lines`, tone: 'muted' }] })
  return { lines, traits, sheets, inlineCss, classes: [...classes], behaviours, pictures: pictures.size }
}

// ── what a piece's own styles name ───────────────────────────────────

/** Every rule's selector text, comments taken out; at-rule heads are not rules. */
function preludes(css: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 1
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1
      i = j
      continue
    }
    if (c === '{') { out.push(css.slice(start, i)); start = i + 1 }
    else if (c === '}' || c === ';') start = i + 1
  }
  return out
    .map(text => text.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter(text => text !== '' && !text.startsWith('@') && !/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/i.test(text))
}

/** How many rules a stylesheet holds (at-rule heads are not counted). */
export function ruleCount(css: string): number {
  return preludes(String(css ?? '')).length
}

const CLASS_TOKEN = /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[^0-9a-fA-F\n]|[\w-])+)/g

/** A class name as a selector escapes it (`md\:flex`, `w-1\/2`), unescaped. */
const unescape = (token: string): string =>
  token
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')

/** Every class a stylesheet's selectors name. */
export function selectorClasses(css: string): Set<string> {
  const names = new Set<string>()
  for (const prelude of preludes(String(css ?? ''))) {
    // A dot inside an attribute's quoted value is not a class.
    const bare = prelude.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
    for (const match of bare.matchAll(CLASS_TOKEN)) names.add(unescape(match[1]))
  }
  return names
}

/** The classes a piece uses that no rule it carries names, in the order given. */
export function unownedClasses(used: readonly string[], css: string): string[] {
  const named = selectorClasses(css)
  return used.filter(cls => !named.has(cls))
}

// ── where a page's link leads in the hive ────────────────────────────

/**
 * The tiles a link pressed in a piece may mean, most likely first, read the
 * way the website view reads its pages' links (site-view.drone.ts
 * #resolveAndNavigate): `/a/b` from the hive root, then under the site's
 * entry; `b` as a child, a sibling, then under the entry; `..` one level up,
 * never above the entry. Answers [] for a link that leaves the hive (the web,
 * mail, a resource, an anchor on the same page).
 */
export function linkTargets(href: string, at: readonly string[], entry: readonly string[]): string[][] {
  const link = String(href ?? '').trim()
  if (!link || link.startsWith('#') || /^(https?:|mailto:|tel:|\/\/|resource:|data:|blob:|javascript:)/i.test(link)) return []
  if (link.startsWith('/@resource/')) return []
  const path = link.split(/[?#]/)[0]
  if (path === '..' || path === '../') {
    return at.length > entry.length ? [at.slice(0, -1)] : []
  }
  const parts = path.replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map(part => decodeURIComponent(part))
  const candidates = path.startsWith('/')
    ? [parts, [...entry, ...parts]]
    : [[...at, ...parts], [...at.slice(0, -1), ...parts], [...entry, ...parts]]
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    const key = candidate.join('\u0000')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
