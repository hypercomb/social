// website/lens.panel.ts
//
// A PANEL DRAWN BY CODE, SAID AS A TEMPLATE (jwize, 2026-11-18: "the code runs
// but the alternate view is a one way view for developers to understand the
// logic").
//
// The panel's live DOM is the shape: what is on the screen is what the
// template says, never a guess. The trace (lens.trace.ts) says which code made
// each node and set each property; the code at that place (lens.code.ts) says
// what it bound:
//
//   <article class="hc-brood-row" [class.is-accepted]="accepted">
//     <div class="hc-brood-name">{{ broodLabel(record) }}</div>
//     @if (report !== void 0) {
//       <pre class="hc-brood-report">{{ report }}</pre>
//     }
//     <button (click)="this.close()">×</button>
//   </article>
//
// Siblings made by the same line and placed by the same line are one loop: the
// first is said, the rest are counted. Conditions and loops come from the code
// around the line that PLACED a node, up to the function it is in.
//
// A node the trace did not see made (it was there before, or came from
// innerHTML) is said as it stands. A line whose code cannot be read is said by
// the value it produced.
//
// Pure, given the panel, the trace and the code: nothing is read or written.

import {
  decodeEscapes, enclosingFlow, handlerOf, literalOf, maskCode, offsetOf, oneLine, readStatement, shortCall, statementAt,
  stripFlow, templateParts, toggledWord, type Flow, type Statement,
} from './lens.code.js'
import type { LensLine, LensSpan } from './lens.model.js'
import type { Site, Trace, TraceOp } from './lens.trace.js'

export interface SourceText {
  readonly text: string
  readonly masked: string
}

/** The code a site's address names, or nothing when it could not be read. */
export type SourceOf = (url: string) => SourceText | undefined

export interface PanelFacts {
  readonly elements: number
  readonly bindings: number
  readonly listeners: number
  readonly loops: number
  readonly conditions: number
  /** Things the trace saw done whose code could not be read. */
  readonly unread: number
}

export interface PanelRead {
  readonly lines: readonly LensLine[]
  /** The node each line is about (null for a flow line), parallel to `lines`. */
  readonly nodes: readonly (Node | null)[]
  readonly facts: PanelFacts
}

/** Put text where the masker can read it. */
export const sourceText = (text: string): SourceText => ({ text, masked: maskCode(text) })

const MAX_LINES = 2000
const VALUE_MAX = 70
const TEXT_MAX = 80
const PROPERTY_ATTR: Record<string, string> = { className: 'class', tabIndex: 'tabindex', htmlFor: 'for' }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()
const siteKey = (site: Site | null | undefined): string => (site ? `${site.url}:${site.line}:${site.column}` : '')
const shortUrl = (url: string): string => url.replace(/^.*\//, '')

interface Read {
  readonly statement: Statement
  readonly text: string
  readonly start: number
  readonly source: SourceText
}

export function readPanel(root: Element, trace: Trace, sourceOf: SourceOf, maxLines = MAX_LINES): PanelRead {
  const lines: LensLine[] = []
  const nodes: (Node | null)[] = []
  const facts = { elements: 0, bindings: 0, listeners: 0, loops: 0, conditions: 0, unread: 0 }
  const reads = new Map<string, Read | null>()
  let dropped = 0

  const say = (depth: number, spans: LensSpan[], node: Node | null): void => {
    if (lines.length >= maxLines) { dropped++; return }
    lines.push({ depth, spans })
    nodes.push(node)
  }

  /** The statement at a site, read once. */
  const readAt = (site: Site | null | undefined): Read | null => {
    if (!site) return null
    const key = siteKey(site)
    if (reads.has(key)) return reads.get(key)!
    let read: Read | null = null
    const source = sourceOf(site.url)
    if (source) {
      const offset = offsetOf(source.text, site.line, site.column)
      if (offset >= 0) {
        const at = statementAt(source.text, source.masked, offset)
        if (at.text) read = { statement: readStatement(stripFlow(at.text).rest), text: at.text, start: at.start, source }
      }
    }
    reads.set(key, read)
    return read
  }

  /** What a hover says of a binding: the code, where it is, and in which function. */
  const noteOf = (read: Read | null, site: Site | null): string | undefined => {
    if (!site) return undefined
    const where = `${site.fn ? `${site.fn} · ` : ''}${shortUrl(site.url)}:${site.line}`
    return read ? `${clip(oneLine(read.text), 300)}\n${where}` : where
  }

  /** The value an assignment or a call's argument gave, or null when its code is not read. */
  const valueOf = (read: Read | null, arg = -1): string | null => {
    if (!read) return null
    if (read.statement.kind === 'assign' && arg < 0) return read.statement.value
    if (read.statement.kind === 'call' && arg >= 0) return read.statement.args[arg] ?? null
    return null
  }

  const binding = (name: string, value: string, note?: string): LensSpan[] => {
    facts.bindings++
    const said = decodeEscapes(oneLine(value))
    return [
      { text: ` [${name}]`, tone: 'binding' },
      { text: '=', tone: 'punct' },
      { text: `"${clip(said, VALUE_MAX)}"`, tone: 'value', ...(note ? { note } : {}) },
    ]
  }
  const plain = (name: string, value: string | null): LensSpan[] =>
    value === null || value === ''
      ? [{ text: ` ${name}`, tone: 'attr' }]
      : [{ text: ` ${name}`, tone: 'attr' }, { text: '=', tone: 'punct' }, { text: `"${clip(squash(value), VALUE_MAX)}"`, tone: 'value' }]

  /**
   * A class value said as its static words, a binding per toggled word, and
   * one binding for whatever is left that changes:
   * `hc-brood-risk is-${risk.level}` is class="hc-brood-risk" [class]="`is-${risk.level}`".
   */
  const classSpans = (value: string, note?: string): LensSpan[] => {
    const literal = literalOf(value)
    if (literal !== null) return plain('class', literal)
    const parts = templateParts(value)
    if (!parts) return binding('class', value, note)
    const fixed: string[] = []
    const changing: string[] = []
    const toggles: Array<{ word: string; when: string }> = []
    let token = ''
    let moves = false
    const flush = (): void => {
      if (token) (moves ? changing : fixed).push(token)
      token = ''
      moves = false
    }
    for (const part of parts) {
      if ('text' in part) {
        for (const piece of part.text.split(/(\s+)/)) {
          if (/^\s+$/.test(piece)) flush()
          else token += piece
        }
        continue
      }
      // A toggled word carries its own space: it is never part of a token.
      const toggled = toggledWord(part.expr)
      if (toggled) { toggles.push(toggled); continue }
      token += '${' + part.expr + '}'
      moves = true
    }
    flush()
    const spans = fixed.length ? plain('class', decodeEscapes(fixed.join(' '))) : []
    for (const toggle of toggles) spans.push(...binding(`class.${toggle.word}`, toggle.when, note))
    if (changing.length) spans.push(...binding('class', `\`${changing.join(' ')}\``, note))
    return spans
  }

  /** What made a placed node, when the line that placed it called something to make it: `this.#act("Read", …)`. */
  const madeBy = (node: Node, siblings: readonly Node[]): string | null => {
    const site = trace.placed.get(node)
    const read = readAt(site)
    if (!read || read.statement.kind !== 'call') return null
    const key = siteKey(site)
    const index = siblings.filter(sibling => siteKey(trace.placed.get(sibling)) === key).indexOf(node)
    const arg = read.statement.args[Math.max(0, index)] ?? read.statement.args[0]
    if (!arg || !arg.includes('(') || /^document\./.test(arg)) return null
    return shortCall(arg)
  }

  const flowsOf = (node: Node): Flow[] => {
    const site = trace.placed.get(node)
    const read = readAt(site)
    if (!read) return []
    const around = enclosingFlow(read.source.text, read.source.masked, read.start).reverse()
    return [...around, ...stripFlow(read.text).flows]
  }

  const meaningful = (el: Element): Node[] =>
    Array.from(el.childNodes).filter(child =>
      child.nodeType === 1 || (child.nodeType === 3 && squash(child.textContent ?? '') !== ''))

  const visit = (el: Element, depth: number): void => {
    facts.elements++
    const tag = el.localName
    const ops: readonly TraceOp[] = trace.ops.get(el) ?? []
    const spans: LensSpan[] = [{ text: '<', tone: 'punct' }, { text: tag, tone: tag.includes('-') ? 'behaviour' : 'tag' }]
    const done = new Set<string>()
    let content: LensSpan[] | null = null
    let skipChildren = false

    for (const op of ops) {
      if (op.kind === 'create') continue
      const read = readAt(op.site)
      const note = noteOf(read, op.site)
      if (op.kind === 'set') {
        const value = valueOf(read)
        if (value === null) { facts.unread++; continue }
        if (op.name === 'textContent' || op.name === 'innerText') {
          const literal = literalOf(value)
          content = literal !== null
            ? [{ text: clip(squash(literal), TEXT_MAX), tone: 'text' }]
            : (facts.bindings++, [{ text: '{{ ', tone: 'binding' }, { text: clip(decodeEscapes(oneLine(value)), VALUE_MAX), tone: 'value', note }, { text: ' }}', tone: 'binding' }])
          skipChildren = true
          continue
        }
        if (op.name === 'innerHTML') { spans.push(...binding('innerHTML', value, note)); skipChildren = true; continue }
        const attr = PROPERTY_ATTR[op.name] ?? op.name.toLowerCase()
        done.add(attr)
        if (op.name === 'className') { spans.push(...classSpans(value, note)); continue }
        const literal = literalOf(value)
        if (literal !== null) spans.push(...plain(attr, literal))
        else if (value === 'true') spans.push(...plain(attr, null))
        else if (/^-?\d+(\.\d+)?$/.test(value)) spans.push(...plain(attr, value))
        else spans.push(...binding(op.name, value, note))
        continue
      }
      if (op.kind === 'attr') {
        done.add(op.name)
        const value = valueOf(read, 1)
        if (value === null) { facts.unread++; continue }
        const literal = literalOf(value)
        spans.push(...(literal !== null ? plain(op.name, literal) : binding(`attr.${op.name}`, value, note)))
        continue
      }
      if (op.kind === 'class') {
        if (op.name === 'toggle' && read?.statement.kind === 'call') {
          const [word, when] = read.statement.args
          const literal = word ? literalOf(word) : null
          if (literal && when) { spans.push(...binding(`class.${literal}`, when, note)); continue }
        }
        if (op.name === 'add' && read?.statement.kind === 'call') {
          const words = read.statement.args.map(literalOf)
          if (words.every(w => w !== null)) { spans.push(...plain('class', words.join(' '))); continue }
        }
        if (!read) facts.unread++
        continue
      }
      if (op.kind === 'style') {
        done.add('style')
        const prop = op.name.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)
        const value = read?.statement.kind === 'call' && read.statement.method === 'setProperty' ? valueOf(read, 1) : valueOf(read)
        if (value === null) { facts.unread++; continue }
        const literal = literalOf(value)
        spans.push(...binding(`style.${prop}`, literal !== null ? `'${literal}'` : value, note))
        continue
      }
      if (op.kind === 'listen') {
        const handler = valueOf(read, 1)
        if (handler === null) { facts.unread++; continue }
        facts.listeners++
        spans.push(
          { text: ` (${op.name})`, tone: 'binding' },
          { text: '=', tone: 'punct' },
          { text: `"${clip(decodeEscapes(oneLine(handlerOf(handler))), VALUE_MAX)}"`, tone: 'value', ...(note ? { note } : {}) },
        )
      }
    }

    // Whatever the trace did not see set is said as it stands.
    for (const attr of Array.from(el.attributes)) {
      if (done.has(attr.name)) continue
      if (attr.name === 'class' && spans.some(span => span.text === ' class' || span.text.startsWith(' [class'))) continue
      spans.push(...plain(attr.name, attr.value))
    }

    if (VOID.has(tag)) { say(depth, [...spans, { text: ' />', tone: 'punct' }], el); return }
    const close: LensSpan[] = [{ text: '</', tone: 'punct' }, { text: tag, tone: tag.includes('-') ? 'behaviour' : 'tag' }, { text: '>', tone: 'punct' }]
    const children = skipChildren ? meaningful(el).filter(child => child.nodeType === 1) : meaningful(el)

    if (content && children.length === 0) { say(depth, [...spans, { text: '>', tone: 'punct' }, ...content, ...close], el); return }
    if (!content && children.length === 0) { say(depth, [...spans, { text: '>', tone: 'punct' }, ...close], el); return }
    if (!content && children.length === 1 && children[0].nodeType === 3) {
      say(depth, [...spans, { text: '>', tone: 'punct' }, { text: clip(squash(children[0].textContent ?? ''), TEXT_MAX), tone: 'text' }, ...close], el)
      return
    }
    say(depth, [...spans, { text: '>', tone: 'punct' }], el)
    if (content) say(depth + 1, content, el)
    visitChildren(children, depth + 1)
    say(depth, close, el)
  }

  /** Children grouped into loops and conditions, each said once. */
  const visitChildren = (children: readonly Node[], depth: number): void => {
    type Group = { readonly members: Node[]; readonly flows: Flow[] }
    const groups: Group[] = []
    let lastKey = ''
    for (const child of children) {
      const made = (trace.ops.get(child) ?? []).find(op => op.kind === 'create')?.site
      const key = child.nodeType === 1 && made ? `${siteKey(made)}|${siteKey(trace.placed.get(child))}` : ''
      if (key && key === lastKey) groups[groups.length - 1].members.push(child)
      else groups.push({ members: [child], flows: flowsOf(child) })
      lastKey = key
    }

    let open: Flow[] = []
    const same = (a: Flow, b: Flow): boolean => a.kind === b.kind && a.head === b.head
    for (const group of groups) {
      let shared = 0
      while (shared < open.length && shared < group.flows.length && same(open[shared], group.flows[shared])) shared++
      for (let k = open.length - 1; k >= shared; k--) say(depth + k, [{ text: '}', tone: 'flow' }], null)
      for (let k = shared; k < group.flows.length; k++) {
        const flow = group.flows[k]
        if (flow.kind === 'for' || flow.kind === 'while') facts.loops++
        else facts.conditions++
        const words = flow.kind === 'else' ? '@else {' : `@${flow.kind} (${clip(oneLine(flow.head), VALUE_MAX)}) {`
        say(depth + k, [{ text: words, tone: 'flow' }], null)
      }
      open = group.flows
      const inner = depth + open.length
      const first = group.members[0]
      const maker = madeBy(first, children)
      if (maker) say(inner, [{ text: `↳ ${clip(maker, VALUE_MAX + 20)}`, tone: 'muted', ...(maker.length > VALUE_MAX + 20 ? { note: maker } : {}) }], null)
      if (first.nodeType === 1) visit(first as Element, inner)
      else say(inner, [{ text: clip(squash(first.textContent ?? ''), TEXT_MAX), tone: 'text' }], first)
      if (group.members.length > 1) {
        say(inner, [{ text: `… and ${group.members.length - 1} more like it, made by the same lines`, tone: 'muted' }], null)
      }
    }
    for (let k = open.length - 1; k >= 0; k--) say(depth + k, [{ text: '}', tone: 'flow' }], null)
  }

  visit(root, 0)
  if (dropped > 0) {
    lines.push({ depth: 0, spans: [{ text: `… ${dropped} more lines`, tone: 'muted' }] })
    nodes.push(null)
  }
  return { lines, nodes, facts }
}
