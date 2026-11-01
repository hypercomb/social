// comfy-desk/callouts/callouts.ts
//
// THE LABELS AND LEADERS. The same drawing as the tile editor, and the editor's
// own pieces under it: its tab and card material (`te-dg-*`), its placement pass
// and its lighting machine. Those are read here, never restated, so the two
// desks cannot drift. Only the parts differ.

import { GAP, MARGIN } from '../../editor/diagram/layout.js'
import { placeTabs, type TabIn } from '../../editor/diagram/placement.js'
import { HOVER_GRACE_MS, escapeRung, idle, litMap, reduce, type LightEvent, type LightState, type PointerKind } from '../../editor/diagram/lit-state.js'
import { make, type CalloutPlace, type CalloutsHandle, type CalloutsPart, type Lit, type RecipeRow } from '../parts.js'

const SVG = 'http://www.w3.org/2000/svg'

/** Wider than the editor's card: a prompt is sentences, not a colour. */
export const CARD_WIDTH = 304
export const TAB_WIDTH = 208

type Record_ = {
  row: RecipeRow
  wrap: HTMLElement
  label: HTMLButtonElement
  value: HTMLElement
  body: HTMLElement
  lead: SVGGElement
  halo: SVGPathElement
  line: SVGPathElement
  dot: SVGCircleElement
}

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, className = ''): SVGElementTagNameMap[K] => {
  const node = document.createElementNS(SVG, tag)
  if (className) node.setAttribute('class', className)
  return node
}

class Callouts implements CalloutsHandle {
  readonly el = make('div', 'te-dg')
  readonly #leaders = svg('svg', 'te-dg-leaders')
  readonly #holder = make('div', 'te-dg-callouts')
  readonly #events: Parameters<CalloutsPart['create']>[0]
  readonly #records = new Map<string, Record_>()
  #state: LightState = idle()
  #place: CalloutPlace | null = null
  #grace = 0
  #graceFor: string | null = null

  readonly #onPress = (event: PointerEvent): void => {
    const target = event.target
    if (!(target instanceof Element) || target.closest('.te-dg-callout, .cd-picture')) return
    if (this.el.parentElement?.contains(target)) this.#send({ type: 'outside-click' })
  }

  constructor(events: Parameters<CalloutsPart['create']>[0]) {
    this.#events = events
    this.#leaders.setAttribute('aria-hidden', 'true')
    this.el.append(this.#leaders, this.#holder)
    document.addEventListener('pointerdown', this.#onPress, true)
  }

  rows(rows: readonly RecipeRow[], cardOf: (id: string) => HTMLElement | null): void {
    const wanted = new Set(rows.map(row => row.id))
    for (const [id, record] of this.#records) {
      if (wanted.has(id)) continue
      record.wrap.remove()
      record.lead.remove()
      this.#records.delete(id)
      if (this.#state.open === id) this.#send({ type: 'open', part: null })
    }
    for (const row of rows) if (!this.#records.has(row.id)) this.#add(row, cardOf(row.id))
    this.#layout()
  }

  values(of: (id: string) => { readonly text: string; readonly alert: boolean }): void {
    for (const [id, record] of this.#records) {
      const { text, alert } = of(id)
      if (record.value.textContent !== text) {
        const span = make('span', '', text)
        record.value.replaceChildren(span)
      }
      if (alert) { record.wrap.dataset['tone'] = 'alert'; record.lead.dataset['tone'] = 'alert' }
      else { delete record.wrap.dataset['tone']; delete record.lead.dataset['tone'] }
    }
  }

  place(place: CalloutPlace): void {
    this.#place = place
    this.#layout()
  }

  open(id: string | null): void { this.#send({ type: 'open', part: id }) }
  enter(part: string): void { this.#enter(part, 'mouse') }
  leave(part: string): void { this.#leave(part) }

  dismiss(): boolean {
    if (!escapeRung(this.#state)) return false
    this.#send({ type: 'escape' })
    return true
  }

  dispose(): void {
    window.clearTimeout(this.#grace)
    document.removeEventListener('pointerdown', this.#onPress, true)
    this.el.remove()
  }

  #add(row: RecipeRow, card: HTMLElement | null): void {
    const label = make('button', 'te-dg-lab', row.label)
    label.type = 'button'
    label.setAttribute('aria-expanded', 'false')
    const value = make('span', 'te-dg-val')
    const tab = make('div', 'te-dg-tab')
    tab.append(label, value)
    const head = make('div', 'te-dg-head')
    head.append(tab)
    const body = make('div', 'te-dg-body')
    body.hidden = true
    if (card) body.append(card)
    const wrap = make('div', 'te-dg-callout')
    wrap.dataset['part'] = row.id
    wrap.dataset['side'] = row.side
    wrap.setAttribute('role', 'group')
    wrap.setAttribute('aria-label', row.label)
    wrap.append(head, body)

    const lead = svg('g', 'te-dg-lead')
    lead.dataset['part'] = row.id
    const halo = svg('path', 'te-dg-halo')
    const line = svg('path', 'te-dg-ln')
    const dot = svg('circle', 'te-dg-dot')
    dot.setAttribute('r', '4')
    lead.append(halo, line, dot)
    lead.toggleAttribute('hidden', !row.anchor)

    label.addEventListener('click', () => this.#send({ type: 'toggle-open', part: row.id }))
    wrap.addEventListener('pointerenter', event => this.#enter(row.id, event.pointerType as PointerKind))
    wrap.addEventListener('pointerleave', () => this.#leave(row.id))
    wrap.addEventListener('focusin', () => this.#send({ type: 'focus-in', part: row.id }))
    wrap.addEventListener('focusout', event => {
      if (!wrap.contains(event.relatedTarget as Node | null)) this.#send({ type: 'focus-out', part: row.id })
    })

    this.#records.set(row.id, { row, wrap, label, value, body, lead, halo, line, dot })
    this.#holder.append(wrap)
    this.#leaders.append(lead)
  }

  #enter(part: string, pointer: PointerKind): void {
    if (this.#graceFor === part) { window.clearTimeout(this.#grace); this.#graceFor = null }
    this.#send({ type: 'pointer-enter', part, pointer })
  }

  #leave(part: string): void {
    this.#send({ type: 'pointer-leave', part })
    window.clearTimeout(this.#grace)
    this.#graceFor = part
    this.#grace = window.setTimeout(() => {
      this.#graceFor = null
      this.#send({ type: 'grace-elapsed', part })
    }, HOVER_GRACE_MS)
  }

  #send(event: LightEvent): void {
    const wasOpen = this.#state.open
    const next = reduce(this.#state, event)
    if (next === this.#state) return
    this.#state = next
    const lit = litMap(next, [...this.#records.keys()]) as Map<string, Lit>
    for (const [id, record] of this.#records) {
      const level = lit.get(id)
      if (level) { record.wrap.dataset['lit'] = level; record.lead.dataset['lit'] = level }
      else { delete record.wrap.dataset['lit']; delete record.lead.dataset['lit'] }
      const open = next.open === id
      record.wrap.toggleAttribute('data-open', open)
      record.body.hidden = !open
      record.label.setAttribute('aria-expanded', String(open))
    }
    if (next.open !== wasOpen) {
      this.#layout()
      this.#events.onOpen(next.open)
    }
    this.#events.onLit(lit)
  }

  #layout(): void {
    const place = this.#place
    if (!place) return
    this.el.dataset['layout'] = place.narrow ? 'narrow' : 'wide'
    if (place.narrow) {
      for (const record of this.#records.values()) {
        record.wrap.style.cssText = ''
        record.wrap.removeAttribute('data-grow')
        record.wrap.removeAttribute('data-covered')
      }
      return
    }
    const U = place.unit
    const picture = place.picture
    // Anchors are the picture's own: the placement pass adds the figure.
    const anchorOf = (row: RecipeRow) => row.anchor
      ? { x: row.anchor.x * picture.w, y: row.anchor.y * picture.h }
      : null
    const tabs: TabIn[] = [...this.#records.values()].map(record => ({
      id: record.row.id,
      side: record.row.side,
      anchor: anchorOf(record.row),
      free: !record.row.anchor,
      ...(this.#state.open === record.row.id ? { open: { bodyHeight: record.body.offsetHeight } } : {}),
    }))
    // An open card keeps to the gutter it has, so it never leaves the desk.
    const gutter = picture.x - (GAP + MARGIN) * U
    const placed = placeTabs({
      tabs,
      extent: { min: 0, max: picture.w },
      figure: { left: picture.x, top: picture.y },
      size: picture.h,
      viewport: place.viewport,
      unit: U,
      tab: TAB_WIDTH * U,
      card: Math.max(TAB_WIDTH * U, Math.min(CARD_WIDTH * U, gutter)),
      toolbar: null,
    })
    for (const [id, record] of this.#records) {
      const tab = placed.tabs.get(id)
      if (!tab) continue
      record.wrap.style.left = `${tab.left}px`
      record.wrap.style.top = `${tab.top}px`
      record.wrap.style.width = `${tab.width}px`
      record.wrap.dataset['grow'] = tab.grow
      record.wrap.toggleAttribute('data-covered', tab.covered)
      const points = placed.leaders.get(id)
      if (!points?.length) continue
      const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')
      record.halo.setAttribute('d', path)
      record.line.setAttribute('d', path)
      record.dot.setAttribute('cx', String(points[0]!.x))
      record.dot.setAttribute('cy', String(points[0]!.y))
      record.lead.toggleAttribute('data-covered', placed.hiddenLeaders.has(id))
    }
  }
}

export const calloutsPart: CalloutsPart = {
  create: events => new Callouts(events),
}
