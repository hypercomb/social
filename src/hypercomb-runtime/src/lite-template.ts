// hypercomb-runtime/src/lite-template.ts
//
// ANGULAR'S TEMPLATE, LITE — the companion of lite-signals.ts (jwize,
// 2026-11-12: "the user interface hasn't changed only the code running it").
// It builds the SAME DOM an Angular template builds — the same elements,
// attributes, classes, styles, text and listeners, in the same order — and
// keeps it up to date the way Angular's zoneless OnPush change detection does:
// one refresh pass over every live binding whenever a signal it read changes
// or a bound event fired. It covers exactly the constructs the chat window's
// template uses: elements, static and interpolated text, property / attribute
// / class / style / innerHTML bindings, events (with Angular's key filters),
// template references, @if/@else if/@else (with `as`), @switch, keyed @for
// (with @empty), and ng-template + ngTemplateOutlet (a plain function).
//
// Styles stay Angular's: every element a template builds wears the scope
// attribute (`_ngcontent-<scope>`) and the host wears `_nghost-<scope>`, so the
// chat's compiled sheets match exactly what they match under Angular.
//
// Angular rules reproduced on purpose:
//   - a property binding uses Angular's attribute→property names (tabindex →
//     tabIndex, class → className, for → htmlFor, readonly → readOnly);
//   - `src`/`href` pass Angular's URL sanitiser (anything else becomes
//     `unsafe:<url>`);
//   - `(keydown.enter)` fires only for Enter with NO modifier held (Angular's
//     key-event plugin compares the full key, modifiers included);
//   - a handler that returns `false` prevents the default;
//   - an attribute or style bound to null/undefined is removed; interpolation
//     prints null/undefined as '';
//   - every binding compares with Object.is and touches the DOM only on change.

import { createOwner, PRIORITY, scheduled, signal, untracked, type Owner, type WritableSignal } from './lite-signals'

// ── shapes ──────────────────────────────────────────────────────────

/** A piece of template: inserts its nodes under `parent` before `before`. */
export type Kid = (parent: Node, before: Node | null, ctx: Ctx) => void
/** Something applied to the element it sits in (a binding, a listener, a ref). */
export type Directive = { readonly directive: (el: Element, ctx: Ctx) => void }
/** What `el()` and the block helpers take as children. */
export type Child = Kid | Directive | string | null | undefined | false | readonly Child[]

/** A live region of the template: its bindings run in template order each pass. */
export type Ctx = {
  readonly view: ViewState
  readonly ns: string | null
  readonly bindings: (() => void)[]
  readonly disposers: (() => void)[]
}

type ViewState = {
  readonly scope: string
  readonly pending: (() => void)[]
  markDirty(): void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

// Angular's DomElementSchemaRegistry attribute → property names.
const PROP_NAMES: Record<string, string> = {
  class: 'className', for: 'htmlFor', formaction: 'formAction', innerHtml: 'innerHTML', readonly: 'readOnly', tabindex: 'tabIndex',
}

// Angular's URL sanitiser (packages/core/src/sanitization/url_sanitizer.ts).
const SAFE_URL = /^(?!javascript:)(?:[a-z0-9+.-]+:|[^&:/?#]*(?:[/?#]|$))/i
export const sanitizeUrl = (url: string): string => (SAFE_URL.test(String(url)) ? String(url) : `unsafe:${url}`)

/** Interpolation's stringify: null and undefined print as nothing. */
export const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value))

/** HTML the code vouches for (Angular's bypassSecurityTrustHtml). Compared by
 *  identity, as Angular compares its SafeHtml wrapper: a new box re-sets the DOM. */
export type TrustedHtml = { readonly trustedHtml: string }
export const trustHtml = (html: string): TrustedHtml => ({ trustedHtml: String(html) })

// ── building ────────────────────────────────────────────────────────

function newCtx(view: ViewState, ns: string | null): Ctx {
  return { view, ns, bindings: [], disposers: [] }
}

function isDirective(child: Child): child is Directive {
  return !!child && typeof child === 'object' && 'directive' in child
}

/** Insert every child in order. */
function place(children: readonly Child[], parent: Node, before: Node | null, ctx: Ctx, el?: Element): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    if (Array.isArray(child)) { place(child, parent, before, ctx, el); continue }
    if (typeof child === 'string') { parent.insertBefore(document.createTextNode(child), before); continue }
    if (isDirective(child)) {
      if (!el) throw new Error('[lite-template] a binding must sit inside an element')
      child.directive(el, ctx)
      continue
    }
    ;(child as Kid)(parent, before, ctx)
  }
}

/** An element, built once; its directives bind it, its children fill it. */
export function el(tag: string, attrs: Record<string, string> | null, ...children: Child[]): Kid {
  return (parent, before, ctx) => {
    const ns = tag === 'svg' ? SVG_NS : ctx.ns
    const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag)
    node.setAttribute(`_ngcontent-${ctx.view.scope}`, '')
    if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
    const inner = ns === ctx.ns ? ctx : { ...ctx, ns } as Ctx
    place(children, node, null, inner, node)
    parent.insertBefore(node, before)
  }
}

/** Static text (already whitespace-normalised as Angular would). */
export const text = (value: string): Kid => (parent, before) => { parent.insertBefore(document.createTextNode(value), before) }

/** `{{ }}`: a text node whose data follows `fn`. */
export function txt(fn: () => unknown): Kid {
  return (parent, before, ctx) => {
    const node = document.createTextNode('')
    let last: string | undefined
    ctx.bindings.push(() => {
      const next = str(fn())
      if (next !== last) { last = next; node.data = next }
    })
    parent.insertBefore(node, before)
  }
}

// ── bindings ────────────────────────────────────────────────────────

const UNSET = Symbol('unset')

function bind(fn: () => unknown, apply: (el: Element, value: unknown, last: unknown) => void): Directive {
  return {
    directive(el, ctx) {
      let last: unknown = UNSET
      ctx.bindings.push(() => {
        const next = fn()
        if (Object.is(next, last)) return
        const was = last
        last = next
        apply(el, next, was === UNSET ? undefined : was)
      })
    },
  }
}

/** `[name]="…"` — a DOM property (Angular's property names; src/href sanitised). */
export function prop(name: string, fn: () => unknown): Directive {
  const key = PROP_NAMES[name] ?? name
  const url = key === 'src' || key === 'href'
  return bind(fn, (el, value) => {
    ;(el as unknown as Record<string, unknown>)[key] = url && value !== null && value !== undefined ? sanitizeUrl(String(value)) : value
  })
}

/** `[attr.name]="…"` — null/undefined removes the attribute. */
export function attr(name: string, fn: () => unknown): Directive {
  return bind(fn, (el, value) => {
    if (value === null || value === undefined) el.removeAttribute(name)
    else el.setAttribute(name, String(value))
  })
}

/** `[class.name]="…"` */
export function cls(name: string, fn: () => unknown): Directive {
  return bind(fn, (el, value) => { el.classList.toggle(name, !!value) })
}

/** `[class]="…"` — a string (space-separated) or a map; it adds and removes only
 *  its own classes, leaving static ones and `[class.x]` bindings alone. */
export function classMap(fn: () => string | Record<string, unknown> | null | undefined): Directive {
  return {
    directive(el, ctx) {
      let mine = new Set<string>()
      let last: unknown = UNSET
      ctx.bindings.push(() => {
        const value = fn()
        if (Object.is(value, last) && typeof value !== 'object') return
        last = value
        const next = new Set<string>()
        if (typeof value === 'string') value.split(/\s+/).filter(Boolean).forEach(c => next.add(c))
        else if (value) for (const [c, on] of Object.entries(value)) if (on) next.add(c)
        for (const c of mine) if (!next.has(c)) el.classList.remove(c)
        for (const c of next) if (!mine.has(c)) el.classList.add(c)
        mine = next
      })
    },
  }
}

/** `[style.name]="…"` or `[style.name.px]="…"`; custom properties too. Null removes. */
export function style(name: string, fn: () => unknown, unit = ''): Directive {
  return bind(fn, (el, value) => {
    const css = (el as HTMLElement).style
    if (value === null || value === undefined || value === '') css.removeProperty(name)
    else css.setProperty(name, `${value}${unit}`)
  })
}

/** `[innerHTML]="…"` — a TrustedHtml box (by identity) or a plain string. */
export function html(fn: () => TrustedHtml | string | null | undefined): Directive {
  return bind(fn, (el, value) => {
    const box = value as TrustedHtml | string | null | undefined
    el.innerHTML = box === null || box === undefined ? '' : typeof box === 'string' ? box : box.trustedHtml
  })
}

// ── events ──────────────────────────────────────────────────────────

/** Angular's full key for an event: the key, lower-cased, with the modifiers held. */
export function eventFullKey(event: KeyboardEvent): string {
  let key = String(event.key ?? '').toLowerCase()
  if (key === ' ') key = 'space'
  else if (key === '.') key = 'dot'
  let full = ''
  for (const [mod, held] of [['alt', event.altKey], ['control', event.ctrlKey], ['meta', event.metaKey], ['shift', event.shiftKey]] as const) {
    if (held && key !== mod) full += `${mod}.`
  }
  return full + key
}

/** `(type)="…"` or `(keydown.enter)="…"` (pass `key: 'enter'`). Returning false
 *  prevents the default; the view is refreshed after the handler. */
export function on(type: string, handler: (event: Event) => unknown, options: { key?: string } = {}): Directive {
  return {
    directive(el, ctx) {
      const listener = (event: Event): void => {
        if (options.key && eventFullKey(event as KeyboardEvent) !== options.key) return
        const result = untracked(() => handler(event))
        if (result === false) event.preventDefault()
        ctx.view.markDirty()
      }
      el.addEventListener(type, listener)
      ctx.disposers.push(() => el.removeEventListener(type, listener))
    },
  }
}

// ── references and mounts ───────────────────────────────────────────

/** What a view query hands the code: the element, as Angular's ElementRef does. */
export type ElementRefLike<T extends Element = Element> = { readonly nativeElement: T }

/** `#name` read by a view query: the signal holds `{ nativeElement }` while the element lives. */
export function ref<T extends Element>(target: WritableSignal<ElementRefLike<T> | undefined>): Directive {
  return {
    directive(el, ctx) {
      const handle = { nativeElement: el as T }
      ctx.view.pending.push(() => target.set(handle))
      ctx.disposers.push(() => { if (untracked(() => target()) === handle) target.set(undefined) })
    },
  }
}

/** Run `attach` once the element is in the document (after the pass that built
 *  it); its returned function runs when the element's region is removed. */
export function mount(attach: (el: Element) => (() => void) | void): Directive {
  return {
    directive(el, ctx) {
      let detach: (() => void) | void
      let alive = true
      ctx.view.pending.push(() => { if (alive) detach = untracked(() => attach(el)) })
      ctx.disposers.push(() => { alive = false; detach?.() })
    },
  }
}

// ── blocks ──────────────────────────────────────────────────────────

/** A removable run of nodes between two marks, with its own bindings. */
type Block = { readonly ctx: Ctx; readonly start: Comment; readonly end: Comment }

function openBlock(children: readonly Child[], parent: Node, before: Node | null, outer: Ctx): Block {
  const ctx = newCtx(outer.view, outer.ns)
  const start = document.createComment('')
  const end = document.createComment('')
  parent.insertBefore(start, before)
  parent.insertBefore(end, before)
  place(children, parent, end, ctx)
  return { ctx, start, end }
}

function runBindings(ctx: Ctx): void {
  for (const binding of ctx.bindings) binding()
}

function closeBlock(block: Block): void {
  const parent = block.start.parentNode
  if (parent) {
    let node: Node | null = block.start
    while (node) {
      const next: Node | null = node === block.end ? null : node.nextSibling
      parent.removeChild(node)
      node = next
    }
  }
  disposeCtx(block.ctx)
}

function disposeCtx(ctx: Ctx): void {
  for (const dispose of ctx.disposers.splice(0).reverse()) { try { dispose() } catch (error) { console.error(error) } }
}

/** Move a block's nodes so they sit right before `before`. */
function moveBlock(block: Block, parent: Node, before: Node | null): void {
  const nodes: Node[] = []
  let node: Node | null = block.start
  while (node) { nodes.push(node); if (node === block.end) break; node = node.nextSibling }
  for (const n of nodes) parent.insertBefore(n, before)
}

/** `@if (a) {…} @else if (b; as x) {…} @else {…}` — the view is kept while the
 *  same branch holds; `alias()` reads the condition's current value. */
export function when(
  branches: readonly (readonly [() => unknown, (alias: () => any) => Child[]])[],
  orElse?: () => Child[],
): Kid {
  return (parent, before, outer) => {
    const anchor = document.createComment('')
    parent.insertBefore(anchor, before)
    let index = -2
    let value: unknown
    let block: Block | null = null
    const alias = (): unknown => value
    outer.disposers.push(() => { if (block) closeBlock(block) })
    outer.bindings.push(() => {
      let next = -1
      let nextValue: unknown
      for (let i = 0; i < branches.length; i++) {
        const v = branches[i]![0]()
        if (v) { next = i; nextValue = v; break }
      }
      value = nextValue
      if (next !== index) {
        if (block) closeBlock(block)
        block = null
        index = next
        const children = next >= 0 ? branches[next]![1](alias) : orElse?.()
        if (children) block = openBlock(children, anchor.parentNode!, anchor, outer)
      }
      if (block) runBindings(block.ctx)
    })
  }
}

/** `@switch (v) { @case ('a') {…} }` — compared with ===; no @default (the chat has none). */
export function match(fn: () => unknown, cases: Record<string, () => Child[]>): Kid {
  const keys = Object.keys(cases)
  return when(keys.map(key => [() => fn() === key, () => cases[key]!()] as const))
}

/** `@for (item of list; track key) {…} @empty {…}` — keyed, with ANGULAR'S OWN
 *  reconciliation (list_reconciliation.ts `reconcile`, ported as is): match from
 *  both ends, swap, move a single row, and detach a row only when its place is
 *  taken — so the same rows move (and lose focus) as under Angular, no more.
 *  `item()` and `index()` read the row's current values. */
export function each<T>(
  list: () => Iterable<T> | null | undefined,
  key: (item: T, index: number) => unknown,
  render: (item: () => T, index: () => number) => Child[],
  empty?: () => Child[],
): Kid {
  type Row = { item: T; index: number; block: Block }
  return (parent, before, outer) => {
    const anchor = document.createComment('')
    parent.insertBefore(anchor, before)
    const rows: Row[] = []
    let emptyBlock: Block | null = null
    outer.disposers.push(() => { for (const row of rows) closeBlock(row.block); if (emptyBlock) closeBlock(emptyBlock) })
    const trackBy = (index: number, item: T): unknown => key(item, index)
    // The live collection Angular's reconcile drives: the rows, in DOM order.
    const live: LiveRows<T, Row> = {
      get length() { return rows.length },
      at: i => rows[i]!.item,
      attach(i, row) {
        moveBlock(row.block, anchor.parentNode!, rows[i]?.block.start ?? anchor)
        rows.splice(i, 0, row)
      },
      detach(i) {
        const row = rows.splice(i, 1)[0]!
        moveBlock(row.block, document.createDocumentFragment(), null)
        return row
      },
      create(i, item) {
        const row = { item, index: i } as Row
        row.block = openBlock(render(() => row.item, () => row.index), document.createDocumentFragment(), null, outer)
        return row
      },
      destroy: row => closeBlock(row.block),
      updateValue(i, item) { rows[i]!.item = item },
      swap(a, b) {
        const start = Math.min(a, b), end = Math.max(a, b)
        const endRow = live.detach(end)
        if (end - start > 1) { const startRow = live.detach(start); live.attach(start, endRow); live.attach(end, startRow) }
        else live.attach(start, endRow)
      },
      move(from, to) { live.attach(to, live.detach(from)) },
    }
    outer.bindings.push(() => {
      reconcileRows(live, [...(list() ?? [])], trackBy)
      rows.forEach((row, i) => { row.index = i })
      const host = anchor.parentNode!
      if (!rows.length && empty) { if (!emptyBlock) emptyBlock = openBlock(empty(), host, anchor, outer) }
      else if (emptyBlock) { closeBlock(emptyBlock); emptyBlock = null }
      for (const row of rows) runBindings(row.block.ctx)
      if (emptyBlock) runBindings(emptyBlock.ctx)
    })
  }
}

type LiveRows<T, R> = {
  readonly length: number
  at(i: number): T
  attach(i: number, row: R): void
  detach(i: number): R
  create(i: number, item: T): R
  destroy(row: R): void
  updateValue(i: number, item: T): void
  swap(a: number, b: number): void
  move(from: number, to: number): void
}

/** 1: the same value at the same place; -1: the same key; 0: neither (Angular's valuesMatching). */
function matching<T>(liveIdx: number, liveValue: T, newIdx: number, newValue: T, trackBy: (i: number, v: T) => unknown): number {
  if (liveIdx === newIdx && Object.is(liveValue, newValue)) return 1
  if (Object.is(trackBy(liveIdx, liveValue), trackBy(newIdx, newValue))) return -1
  return 0
}

/** Angular's UniqueValueMultiKeyMap: rows put aside by key, duplicate keys queued in order. */
class Detached<R> {
  readonly #kv = new Map<unknown, R>()
  #chain: Map<R, R> | undefined
  has(k: unknown): boolean { return this.#kv.has(k) }
  get(k: unknown): R | undefined { return this.#kv.get(k) }
  delete(k: unknown): boolean {
    if (!this.#kv.has(k)) return false
    const v = this.#kv.get(k)!
    if (this.#chain?.has(v)) { this.#kv.set(k, this.#chain.get(v)!); this.#chain.delete(v) }
    else this.#kv.delete(k)
    return true
  }
  set(k: unknown, v: R): void {
    if (!this.#kv.has(k)) { this.#kv.set(k, v); return }
    let prev = this.#kv.get(k)!
    const chain = this.#chain ??= new Map()
    while (chain.has(prev)) prev = chain.get(prev)!
    chain.set(prev, v)
  }
  forEach(fn: (v: R) => void): void {
    for (const [, first] of this.#kv) {
      let v = first
      fn(v)
      while (this.#chain?.has(v)) { v = this.#chain.get(v)!; fn(v) }
    }
  }
}

/** Angular's `reconcile` (packages/core/src/render3/list_reconciliation.ts), array branch. */
function reconcileRows<T, R>(live: LiveRows<T, R>, next: readonly T[], trackBy: (i: number, v: T) => unknown): void {
  let detached: Detached<R> | undefined
  let future: Set<unknown> | undefined
  let liveStart = 0
  let liveEnd = live.length - 1
  let newEnd = next.length - 1
  const attachDetached = (index: number, k: unknown): boolean => {
    if (!detached?.has(k)) return false
    live.attach(index, detached.get(k)!)
    detached.delete(k)
    return true
  }
  while (liveStart <= liveEnd && liveStart <= newEnd) {
    const liveStartValue = live.at(liveStart)
    const newStartValue = next[liveStart]!
    const startMatch = matching(liveStart, liveStartValue, liveStart, newStartValue, trackBy)
    if (startMatch !== 0) {
      if (startMatch < 0) live.updateValue(liveStart, newStartValue)
      liveStart++
      continue
    }
    const liveEndValue = live.at(liveEnd)
    const newEndValue = next[newEnd]!
    const endMatch = matching(liveEnd, liveEndValue, newEnd, newEndValue, trackBy)
    if (endMatch !== 0) {
      if (endMatch < 0) live.updateValue(liveEnd, newEndValue)
      liveEnd--
      newEnd--
      continue
    }
    const liveStartKey = trackBy(liveStart, liveStartValue)
    const liveEndKey = trackBy(liveEnd, liveEndValue)
    const newStartKey = trackBy(liveStart, newStartValue)
    if (Object.is(newStartKey, liveEndKey)) {
      const newEndKey = trackBy(newEnd, newEndValue)
      if (Object.is(newEndKey, liveStartKey)) {
        live.swap(liveStart, liveEnd)
        live.updateValue(liveEnd, newEndValue)
        newEnd--
        liveEnd--
      } else {
        live.move(liveEnd, liveStart)
      }
      live.updateValue(liveStart, newStartValue)
      liveStart++
      continue
    }
    detached ??= new Detached<R>()
    if (!future) { future = new Set(); for (let i = liveStart; i <= liveEnd; i++) future.add(trackBy(i, live.at(i))) }
    if (attachDetached(liveStart, newStartKey)) {
      live.updateValue(liveStart, newStartValue)
      liveStart++
      liveEnd++
    } else if (!future.has(newStartKey)) {
      live.attach(liveStart, live.create(liveStart, next[liveStart]!))
      liveStart++
      liveEnd++
    } else {
      detached.set(liveStartKey, live.detach(liveStart))
      liveEnd--
    }
  }
  while (liveStart <= newEnd) {
    const value = next[liveStart]!
    if (!attachDetached(liveStart, trackBy(liveStart, value))) live.attach(liveStart, live.create(liveStart, value))
    else live.updateValue(liveStart, value)
    liveStart++
  }
  while (liveStart <= liveEnd) live.destroy(live.detach(liveEnd--))
  detached?.forEach(row => live.destroy(row))
}

// ── the view ────────────────────────────────────────────────────────

export type View = {
  /** Refresh on the next pass even if no signal changed (a bound event does this). */
  markDirty(): void
  /** Remove everything the view built and stop refreshing it. */
  dispose(): void
  readonly owner: Owner
}

/** Build `children` into `host` and keep them current: the first pass runs
 *  after construction's effects, every later pass after the effects of the
 *  flush that dirtied it (Angular's order). The host wears `_nghost-<scope>`. */
export function render(host: Element, children: Child[], options: { scope: string; owner?: Owner }): View {
  const owner = options.owner ?? createOwner()
  const tick = signal(0)
  const pending: (() => void)[] = []
  const state: ViewState = { scope: options.scope, pending, markDirty: () => tick.update(n => n + 1) }
  const ctx = newCtx(state, null)
  host.setAttribute(`_nghost-${options.scope}`, '')
  const end = document.createComment('')
  let built = false
  const job = scheduled(() => {
    tick()
    if (!built) { built = true; host.appendChild(end); place(children, host, end, ctx) }
    runBindings(ctx)
    for (const run of pending.splice(0)) run()
  }, PRIORITY.view)
  const view: View = {
    owner,
    markDirty: state.markDirty,
    dispose() {
      job.destroy()
      disposeCtx(ctx)
      let node: Node | null = end.previousSibling
      while (built && node) { const prev: Node | null = node.previousSibling; host.removeChild(node); node = prev }
      if (end.parentNode) end.parentNode.removeChild(end)
    },
  }
  owner.add(() => view.dispose())
  return view
}
