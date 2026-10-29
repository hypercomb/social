// editor/diagram/tile-diagram.ts
//
// THE DOM DIAGRAM. A technical drawing of ONE tile: the model in the middle,
// a quiet labelled tab for every editable part, a straight leader from each
// tab to the exact part, and a lit layer that paints the part, its leader and
// its tab together. This module knows PARTS and FIELD KINDS only — never a
// shape — and reaches the editor only through the TileSessionPort it is given.
//
// Built ONCE per (model, group): the lit layer, the leaders, the callouts. An
// update() afterwards only repaints in place, so a node that exists, has focus
// or has an open native colour popup is never rebuilt, and a layout flip keeps
// every node (and a half-typed answer) it had.
//
// Lighting is ONE attribute, `data-lit = soft | strong` (+ `data-tone=alert`),
// on every element that carries the part id; diagram.styles.ts reads nothing
// else. The pure reducer in lit-state.ts decides; the 120ms hover grace timer
// lives here, because the reducer has no clock.

import type { ModelGeometry, ModelPart, PartContext, Pt, Rect, TileModel } from '../models/tile-model.js'
import {
  buildControl, buildLayerChip, buildQuestions, buildTabSwatch, closeLayerMenus, glanceOf, h, questionsGlance, setAttr, setText,
  type Control, type ControlEnv, type LayerChip, type TabSwatch, type TileSessionPort, type Translate,
} from './controls.js'
import { installDiagramStyles } from './diagram.styles.js'
import { activationOf, FIELDS, groupParts, kindOfPart, type Activation } from './fields.js'
import { CARD, CARD_COMPACT, GAP_TOOL, TAB, TAB_COMPACT, TOOL, unionExtent } from './layout.js'
import { HOVER_GRACE_MS, idle, lifted, litMap, litOf, reduce, tapActs, type LightEvent, type LightState } from './lit-state.js'
import { placeTabs, type Placement, type TabIn } from './placement.js'

export type { LightState }
export type { TileSessionPort, Translate }
export type {
  EditorField, FieldValue, LayerChoice, LayerFacts, TitleStatus,
} from './controls.js'

// ── the interface (spec 12.4, exact) ────────────────────────────────────────

export interface DiagramInput {
  /** Stage side px, from diagram/layout.ts (the shell measures, the diagram never measures the stage). */
  readonly size: number
  readonly variant: string
  /** em / 16: every px constant is multiplied by it. */
  readonly unit: number
  readonly viewport: { readonly width: number; readonly height: number }
  readonly layout: 'wide' | 'narrow'
  /** Wide: where the stage square sits in the viewport. */
  readonly figure: { readonly left: number; readonly top: number }
  /** The framed rect in stage px; null: none or a group. */
  readonly picture: Rect | null
  readonly hasPicture: boolean
  /** Name drawn on the band (hideText false, or no picture). */
  readonly showName: boolean
  /** hideText true over a picture: ghost text, dashed hairlines. */
  readonly ghostName: boolean
  /** A pan or pinch is in progress. */
  readonly gesturing: boolean
  readonly camera: boolean
  /** Restore an open card (kept for the Escape ladder). */
  readonly open: string | null
}

export interface DiagramEvents {
  /** Mirrors the machine for the header and aria needs. */
  onLight(state: Readonly<LightState>, lit: ReadonlyMap<string, 'soft' | 'strong'>): void
  /** 'focus-text' and 'pin-stage' the shell performs (the input and the stage are its); the others the diagram performs itself. */
  onIntent(i: { part: string; activation: Activation }): void
}

export interface DiagramDeps {
  readonly model: TileModel
  readonly port: TileSessionPort
  /** .te-vp: receives leaders, callouts, dim, chip, tag. */
  readonly viewport: HTMLElement
  /** .te-figure (S x S, overflow visible): holds stage.el; the diagram appends its lit layer. */
  readonly figure: HTMLElement
  /** CropStage.el: the pointer surface (the diagram listens, never captures). */
  readonly gesture: HTMLElement
  /** Where the picture toolbar lives in wide (under the figure). */
  readonly toolbarHome: HTMLElement
  readonly t: Translate
  readonly events: DiagramEvents
}

export interface TileDiagram {
  readonly el: HTMLElement
  /** Current; CropStage's provider and the overlay read it, so the shape is computed once. */
  readonly geometry: ModelGeometry
  readonly context: PartContext
  /** Idempotent, synchronous, builds callouts once per (model, group) and never rebuilds a node that exists or has focus. */
  update(input: DiagramInput): void
  /** OUTSIDE CONTROL: the shell sets { focus: nameId } while the name input has focus; { open: null } on Escape. */
  setLight(patch: Partial<LightState>): void
  readonly light: Readonly<LightState>
  /** Highest z whose hit() is true. */
  partAt(clientX: number, clientY: number): string | null
  check(): { crossings: number; overlaps: string[]; offscreen: string[] }
  dispose(): void
}

// ── internals ───────────────────────────────────────────────────────────────

const SVG = 'http://www.w3.org/2000/svg'
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | null> = {}, ...kids: Node[]): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== null) el.setAttribute(k, String(v))
  for (const kid of kids) el.append(kid)
  return el
}

/** The Questions callout has no part; this id can never be a model's own. */
const QUESTIONS = '~questions'
const TAP_SLOP = { mouse: 6, touch: 10 }
const NEIGHBOUR_FACE = 50
/** What on the stage handles its own presses. */
const NOT_A_TAP = 'button, video, input, select, textarea, .te-camera, .te-empty-tools'
/** The dark band the tile's own text sits on: the contrast driver reads it. */
const GROUND = 'rgb(38,38,38)'

interface Rec {
  readonly id: string
  readonly part: ModelPart | null
  readonly side: 'left' | 'right'
  readonly kind: string
  readonly wrap: HTMLElement
  readonly tab: HTMLElement
  readonly label: HTMLButtonElement
  readonly val: HTMLElement
  readonly body: HTMLElement
  readonly swc: TabSwatch | null
  readonly controls: Control[]
  readonly chips: LayerChip[]
  readonly leader: SVGGElement | null
  dock: HTMLElement | null
  wasOpen: boolean
  glance: string
}

interface LitPart { readonly g: SVGGElement; sig: string; paths: SVGPathElement[] }

const samePlaced = (a: LightState, b: LightState): boolean =>
  a.hover === b.hover && a.focus === b.focus && a.open === b.open && a.pin === b.pin

let sequence = 0

class Diagram implements TileDiagram {
  readonly #d: DiagramDeps
  readonly #uid = String(++sequence)
  readonly #doc: Document
  readonly el: HTMLElement
  readonly #leaders: SVGSVGElement
  readonly #callouts: HTMLElement
  readonly #dim: HTMLElement
  readonly #chip: HTMLElement
  readonly #tag: HTMLElement
  readonly #probe: HTMLElement
  readonly #lit: SVGSVGElement
  readonly #litLayer: SVGGElement
  readonly #capture: SVGGElement
  readonly #capturePath: SVGPathElement
  readonly #cross: SVGGElement
  readonly #crossPath: SVGPathElement
  readonly #bandLabel: HTMLElement
  readonly #clipIn: SVGPathElement
  readonly #clipOut: SVGPathElement
  readonly #clipMask: SVGPathElement
  readonly #clipPic: SVGRectElement
  readonly #litParts = new Map<string, LitPart>()
  readonly #recs = new Map<string, Rec>()
  readonly #unsub: () => void
  readonly #off: (() => void)[] = []
  /** Listeners on nodes a build made: dropped when the build is replaced. */
  #buildOff: (() => void)[] = []

  #geometry: ModelGeometry
  #variantKey: string
  #context: PartContext = { picture: null, fillLive: false, showName: true, group: false }
  #input: DiagramInput | null = null
  #state: LightState = idle()
  #group = false
  #sig = ''
  #parts: readonly ModelPart[] = []
  #placement: Placement | null = null
  #hoverTimer: ReturnType<typeof setTimeout> | undefined
  #down: { id: number; x: number; y: number; touch: boolean; moved: boolean } | null = null
  #chipSig = ''
  #dock: HTMLElement | null = null
  #disposed = false

  constructor(deps: DiagramDeps) {
    installDiagramStyles()
    this.#d = deps
    this.#doc = deps.viewport.ownerDocument
    this.#variantKey = deps.model.defaultVariant
    this.#geometry = deps.model.geometry(320, deps.model.defaultVariant)
    const id = (n: string): string => `te-dg-${this.#uid}-${n}`

    // ── the lit layer: a SIBLING above the stage, never inside CropStage.el ──
    this.#clipIn = svg('path')
    this.#clipOut = svg('path', { 'clip-rule': 'evenodd' })
    this.#clipMask = svg('path')
    this.#clipPic = svg('rect')
    const hatch = svg('pattern', { id: id('hatch'), width: 9, height: 9, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      svg('path', { d: 'M0 0V9', class: 'te-dg-hatch-line', 'stroke-width': 1.6 }))
    this.#litLayer = svg('g')
    this.#capturePath = svg('path', { fill: 'none', 'stroke-dasharray': '3 5', 'stroke-width': 1, class: 'te-dg-capture-line' })
    this.#capture = svg('g', { class: 'te-dg-capture' }, this.#capturePath)
    this.#crossPath = svg('path', { fill: 'none', 'stroke-dasharray': '1.5 3', 'stroke-width': 1.5, class: 'te-dg-cross-line' })
    this.#cross = svg('g', { class: 'te-dg-cross' }, this.#crossPath)
    this.#lit = svg('svg', { class: 'te-dg-lit', 'aria-hidden': 'true', focusable: 'false' },
      svg('defs', {},
        svg('clipPath', { id: id('clip-in') }, this.#clipIn),
        svg('clipPath', { id: id('clip-out') }, this.#clipOut),
        svg('clipPath', { id: id('clip-mask') }, this.#clipMask),
        svg('clipPath', { id: id('clip-pic') }, this.#clipPic),
        hatch),
      this.#litLayer, this.#capture, this.#cross)
    this.#lit.style.setProperty('--hatch', `url(#${id('hatch')})`)
    this.#bandLabel = h('div', { class: 'te-dg-bandlabel te-band-label', hidden: true, 'data-hc-ground': GROUND })

    // ── the viewport layers ────────────────────────────────────────────────
    this.#leaders = svg('svg', { class: 'te-dg-leaders', 'aria-hidden': 'true', focusable: 'false' })
    this.#callouts = h('div', { class: 'te-dg-callouts' })
    this.#dim = h('div', { class: 'te-dg-dim', hidden: true, 'aria-hidden': 'true' })
    this.#chip = h('div', { class: 'te-dg-chip', hidden: true, 'aria-hidden': 'true' })
    this.#tag = h('div', { class: 'te-dg-tag', 'aria-hidden': 'true' })
    this.#probe = h('span', { class: 'te-dg-probe', 'aria-hidden': 'true' })
    this.el = h('div', { class: 'te-dg', 'data-layout': 'wide' },
      this.#leaders, this.#dim, this.#callouts, this.#chip, this.#tag,
      h('div', { class: 'te-dg-notices', 'data-slot': 'notices' }), this.#probe)
    deps.viewport.append(this.el)
    deps.figure.append(this.#lit, this.#bandLabel)

    // ── pointer: the drawn part is a visual twin of its tab ────────────────
    const g = deps.gesture
    this.#on(g, 'pointermove', e => this.#onMove(e as PointerEvent))
    this.#on(g, 'pointerleave', e => { if ((e as PointerEvent).pointerType !== 'touch') this.#hover(null) })
    this.#on(g, 'pointerdown', e => {
      const p = e as PointerEvent
      if (p.button !== 0) return
      this.#down = { id: p.pointerId, x: p.clientX, y: p.clientY, touch: p.pointerType === 'touch', moved: false }
    })
    this.#on(g, 'pointerup', e => this.#onUp(e as PointerEvent))
    this.#on(g, 'pointercancel', () => { this.#down = null })
    this.#on(g, 'focus', () => this.#imagePart() && this.#send({ type: 'focus-in', part: this.#imagePart()! }))
    this.#on(g, 'blur', () => this.#imagePart() && this.#send({ type: 'focus-out', part: this.#imagePart()! }))
    this.#on(this.#doc, 'pointerdown', e => this.#onOutside(e as PointerEvent), true)

    this.#unsub = deps.port.onChange(() => this.#resync())
  }

  // ── public surface ────────────────────────────────────────────────────────

  get geometry(): ModelGeometry { return this.#geometry }
  get context(): PartContext { return this.#context }
  get light(): Readonly<LightState> { return { ...this.#state } }

  setLight(patch: Partial<LightState>): void { this.#send({ type: 'set', patch }) }

  update(input: DiagramInput): void {
    if (this.#disposed) return
    const { model, port } = this.#d
    const prev = this.#input
    this.#input = input
    const group = port.group !== null

    if (this.#geometry.size !== input.size || this.#variantKey !== input.variant) {
      this.#geometry = model.geometry(input.size, input.variant)
      this.#variantKey = input.variant
    }
    const picture = group ? null : input.picture
    this.#context = { picture, fillLive: this.#geometry.groundShows(picture, group), showName: input.showName, group }

    this.#group = group
    this.#parts = group ? groupParts(model.parts) : model.parts
    const sig = `${model.id}|${group}`
    if (sig !== this.#sig) { this.#sig = sig; this.#build() }

    setAttr(this.el, 'data-layout', input.layout)
    setAttr(this.el, 'data-compact', String(input.layout === 'wide' && input.viewport.width < 1000 * input.unit))
    setAttr(this.el, 'data-group', String(group))
    setAttr(this.el, 'data-gesture', input.gesturing ? 'pan' : null)

    if (input.gesturing && !prev?.gesturing) this.#send({ type: 'gesture-start' })
    if (input.open !== (prev?.open ?? null)) this.#send({ type: 'set', patch: { open: input.open } })

    this.#paintLitLayer()
    this.#paintName()
    this.#placeDock()
    this.#syncAll(false)
    this.#paintOpen()
    this.#place()
    this.#paintChip()
    this.#paintTag()
    this.#paintLight()
  }

  partAt(clientX: number, clientY: number): string | null {
    const g = this.#geometry
    const r = this.#d.figure.getBoundingClientRect()
    const k = r.width > 0 ? g.size / r.width : 1
    const p: Pt = { x: (clientX - r.left) * k, y: (clientY - r.top) * k }
    const found = [...this.#parts].sort((a, b) => b.z - a.z).find(part => part.hit(p, g, this.#context))
    return found ? found.id : null
  }

  check(): { crossings: number; overlaps: string[]; offscreen: string[] } {
    const pl = this.#placement
    const input = this.#input
    if (!pl || !input || input.layout !== 'wide') return { crossings: 0, overlaps: [], offscreen: [] }
    const overlaps = [...pl.overlaps]
    const U = input.unit
    const ext = unionExtent(this.#d.model, input.size, input.variant)
    const fig = { l: input.figure.left + ext.min, r: input.figure.left + ext.max, t: input.figure.top, b: input.figure.top + input.size }
    const head = 32 * U
    const hit = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean =>
      a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1
    const toolW = this.#dock && !this.#dock.hidden ? this.#dock.offsetWidth : 0
    const tool = toolW > 0 ? {
      l: input.figure.left + input.size / 2 - toolW / 2, r: input.figure.left + input.size / 2 + toolW / 2,
      t: input.figure.top + input.size + GAP_TOOL * U, b: input.figure.top + input.size + (GAP_TOOL + TOOL) * U,
    } : null
    for (const [id, p] of pl.tabs) {
      const r = { l: p.left, r: p.left + p.width, t: p.headTop, b: p.headTop + head }
      if (hit(r, fig)) overlaps.push(`${id}xfigure`)
      if (tool && hit(r, tool)) overlaps.push(`${id}xtoolbar`)
    }
    return { crossings: pl.crossings, overlaps, offscreen: [...pl.offscreen] }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    clearTimeout(this.#hoverTimer)
    this.#unsub()
    for (const off of this.#off) off()
    this.#off.length = 0
    this.#dropBuilt()
    this.#dock?.remove()
    this.el.remove()
    this.#lit.remove()
    this.#bandLabel.remove()
    this.#d.viewport.removeAttribute('data-lift')
    this.#d.figure.removeAttribute('data-lift')
    this.#d.gesture.removeAttribute('data-cursor')
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  #on(target: EventTarget, type: string, fn: (e: Event) => void, capture = false): void {
    target.addEventListener(type, fn, capture)
    this.#off.push(() => target.removeEventListener(type, fn, capture))
  }

  /** A listener on a node a build made: it goes with the build, not with the diagram. */
  #onBuilt(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn)
    this.#buildOff.push(() => target.removeEventListener(type, fn))
  }

  #dropBuilt(): void {
    for (const off of this.#buildOff) off()
    this.#buildOff = []
  }

  #imagePart(): string | null {
    for (const p of this.#parts) if (kindOfPart(p) === 'image') return p.id
    return null
  }

  #namePart(): string | null {
    for (const p of this.#parts) if (p.fields.includes('title')) return p.id
    return null
  }

  #alertId(): string | null {
    return this.#d.port.name.status.state === 'refused' ? this.#namePart() : null
  }

  #env(): ControlEnv {
    return {
      port: this.#d.port, model: this.#d.model, t: this.#d.t, group: this.#group, uid: this.#uid,
      geometry: () => this.#geometry,
      fillLive: () => this.#context.fillLive,
      variant: () => this.#input?.variant ?? this.#d.model.defaultVariant,
      imagePart: () => this.#imagePart(),
      toggleCard: id => this.#send({ type: 'set', patch: { open: this.#state.open === id ? null : id, pin: null } }),
    }
  }

  #litNow(): Map<string, 'soft' | 'strong'> {
    return litMap(this.#state, [...this.#recs.keys()], this.#alertId())
  }

  #send(e: LightEvent): void {
    const prev = this.#state
    const next = reduce(prev, e)
    if (samePlaced(prev, next)) return
    this.#state = next
    if (prev.open !== next.open) { this.#paintOpen(); this.#place() }
    this.#paintLight()
    this.#d.events.onLight(this.light, this.#litNow())
  }

  /** Re-read the port without a new input: any service or model change. */
  #resync(): void {
    if (this.#disposed || !this.#input) return
    this.#syncAll(false)
    this.#paintName()
    this.#place()
    this.#paintChip()
    this.#paintLight()
  }

  // ── hover, with the 120ms grace the reducer leaves to its caller ─────────

  #hover(part: string | null, pointer?: 'mouse' | 'pen' | 'touch'): void {
    if (part) {
      clearTimeout(this.#hoverTimer)
      this.#send({ type: 'pointer-enter', part, pointer })
      return
    }
    const at = this.#state.hover
    if (at === null) return
    this.#send({ type: 'pointer-leave', part: at })
    clearTimeout(this.#hoverTimer)
    this.#hoverTimer = setTimeout(() => this.#send({ type: 'grace-elapsed', part: at }), HOVER_GRACE_MS)
  }

  #bindPart(el: HTMLElement, part: string): void {
    this.#onBuilt(el, 'pointerenter', e => { const t = (e as PointerEvent).pointerType; if (t !== 'touch') this.#hover(part, t as 'mouse' | 'pen') })
    this.#onBuilt(el, 'pointerleave', e => { if ((e as PointerEvent).pointerType !== 'touch') this.#hover(null) })
    this.#onBuilt(el, 'focusin', () => this.#send({ type: 'focus-in', part }))
    this.#onBuilt(el, 'focusout', e => {
      if (!el.contains((e as FocusEvent).relatedTarget as Node | null)) this.#send({ type: 'focus-out', part })
    })
  }

  #onMove(e: PointerEvent): void {
    // A press that left the slop is a drag for good, even if it came back.
    const press = this.#down
    if (press && press.id === e.pointerId && !press.moved
      && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= (press.touch ? TAP_SLOP.touch : TAP_SLOP.mouse)) press.moved = true
    if (e.pointerType === 'touch' || this.#input?.gesturing) return
    const id = this.#partAt(e)
    const part = id ? this.#parts.find(p => p.id === id) : undefined
    const kind = part ? kindOfPart(part) : ''
    const cursor = kind === 'text' ? 'text' : kind && kind !== 'image' ? 'pointer' : null
    setAttr(this.#d.gesture, 'data-cursor', cursor)
    this.#hover(id, e.pointerType === 'pen' ? 'pen' : 'mouse')
  }

  #partAt(e: PointerEvent): string | null { return this.partAt(e.clientX, e.clientY) }

  #onUp(e: PointerEvent): void {
    const d = this.#down
    this.#down = null
    if (!d || d.id !== e.pointerId || this.#input?.gesturing || d.moved) return
    // A press that ended on the picture's own tools (the camera, the empty
    // state's buttons, a field) is theirs, not a tap on the drawn part under them.
    if ((e.target as Element | null)?.closest?.(NOT_A_TAP)) return
    const slop = d.touch ? TAP_SLOP.touch : TAP_SLOP.mouse
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= slop) return        // a drag opens no card
    const id = this.#partAt(e)
    if (id === null) {
      const open = this.#state.open ? this.#recs.get(this.#state.open) : undefined
      this.#send({ type: 'set', patch: { pin: null, ...(open && open.kind !== 'text' ? { open: null } : {}) } })
      return
    }
    if (d.touch && !(tapActs(this.#state, id) || this.#state.open === id)) {
      this.#send({ type: 'touch-tap', part: id })                              // the first tap pins and lights
      return
    }
    this.#activate(id)
  }

  /** What a click on a drawn part does comes from its field KIND, never from its id. */
  #activate(id: string): void {
    const rec = this.#recs.get(id)
    if (!rec?.part) return
    const activation = activationOf(kindOfPart(rec.part))
    switch (activation) {
      case 'open-colour':
        this.#send({ type: 'set', patch: { pin: null, open: null } })
        rec.swc?.input.click()
        return
      case 'cycle-variant': {
        const vs = this.#d.model.variants
        const at = vs.findIndex(v => v.id === (this.#input?.variant ?? ''))
        if (vs.length > 1) this.#d.port.picture.setVariant(vs[(at + 1) % vs.length].id)
        this.#send({ type: 'set', patch: { pin: null } })
        return
      }
      case 'pin-stage':
        this.#send({ type: 'set', patch: { pin: id, open: null } })
        this.#d.events.onIntent({ part: id, activation })
        return
      case 'focus-text':
        this.#send({ type: 'set', patch: { pin: null, open: id } })
        this.#d.events.onIntent({ part: id, activation })
        return
      case 'open-card':
        this.#send({ type: 'set', patch: { pin: null, open: id } })
        rec.controls.find(c => c.focus)?.focus?.()
        return
    }
  }

  #toggleTab(id: string): void {
    const opening = this.#state.open !== id
    this.#send({ type: 'set', patch: { open: opening ? id : null, pin: null } })
    const rec = this.#recs.get(id)
    if (opening && rec?.part && activationOf(kindOfPart(rec.part)) === 'focus-text') {
      this.#d.events.onIntent({ part: id, activation: 'focus-text' })
    }
  }

  #onOutside(e: PointerEvent): void {
    // The right button is the Escape ladder (BackGesture, on `contextmenu`, which
    // follows this press): it closes ONE rung. Closing the card here would leave
    // the ladder nothing to close, and that same press would then cancel the editor.
    if (e.button === 2) return
    const target = e.target as Node | null
    closeLayerMenus(this.el, target)
    if (this.#input?.layout !== 'wide' || this.#state.open === null || !target) return
    if (this.#callouts.contains(target) || this.#d.figure.contains(target) || this.#dock?.contains(target)) return
    this.#send({ type: 'outside-click' })
  }

  // ── building: once per (model, group) ────────────────────────────────────

  #build(): void {
    this.#dropBuilt()
    const hovered = this.#state.hover
    for (const rec of this.#recs.values()) rec.wrap.remove()
    this.#recs.clear()
    this.#dock?.remove()
    this.#dock = null
    this.#leaders.replaceChildren()
    for (const lp of this.#litParts.values()) lp.g.remove()
    this.#litParts.clear()
    this.#chipSig = ''
    const env = this.#env()
    const t = this.#d.t
    const imageId = this.#imagePart()

    for (const part of this.#parts) {
      const label = t(part.labelKey, part.label)
      const kind = kindOfPart(part)
      const primary = part.fields[0]
      const cardId = `te-dg-${this.#uid}-card-${part.id}`
      const swc = kind === 'colour' ? buildTabSwatch(primary, env, label) : null
      const valId = `te-dg-${this.#uid}-val-${part.id}`
      const labBtn = h('button', { type: 'button', class: 'te-dg-lab', 'aria-expanded': 'false', 'aria-controls': cardId, 'aria-describedby': valId }, label)
      const val = h('span', { class: 'te-dg-val', id: valId })
      const tab = h('div', { class: 'te-dg-tab' }, labBtn, swc?.el, val)
      const head = h('div', { class: 'te-dg-head' }, tab)
      const body = h('div', { class: 'te-dg-body', id: cardId, hidden: true })
      const wrap = h('div', { class: 'te-dg-callout', 'data-part': part.id, 'data-side': part.side, 'data-kind': kind, role: 'group', 'aria-label': label }, head, body)
      const controls: Control[] = []
      const chips: LayerChip[] = []
      const layers = new Set<string>()
      let dock: HTMLElement | null = null
      for (const key of part.fields) {
        const spec = FIELDS[key]
        const c = buildControl(spec.kind, key, env, key === primary ? label : t(spec.labelKey, part.label))
        controls.push(c)
        body.append(c.node)
        if (c.dock) dock = c.dock
        if (spec.layer && !this.#group && !layers.has(spec.layer)) {
          layers.add(spec.layer)
          const chip = buildLayerChip(spec.layer, env)
          chips.push(chip)
          head.append(chip.el)
        }
      }
      const leader = svg('g', { class: 'te-dg-lead', 'data-part': part.id },
        svg('path', { class: 'te-dg-halo', fill: 'none' }), svg('path', { class: 'te-dg-ln', fill: 'none' }), svg('circle', { class: 'te-dg-dot', r: 4 }))
      this.#leaders.append(leader)
      const rec: Rec = { id: part.id, part, side: part.side, kind, wrap, tab, label: labBtn, val, body, swc, controls, chips, leader, dock, wasOpen: false, glance: '' }
      this.#recs.set(part.id, rec)
      this.#callouts.append(wrap)
      this.#wire(rec)
      if (dock && part.id === imageId) {
        this.#dock = dock
        this.#bindPart(dock, part.id)
      }
      const lg = svg('g', { class: 'te-dg-litg', 'data-part': part.id })
      this.#litLayer.append(lg)
      this.#litParts.set(part.id, { g: lg, sig: '\u0000', paths: [] })
    }

    if (!this.#group) {
      const q = buildQuestions(env)
      const label = t('editor.qa.title', 'Questions')
      const cardId = `te-dg-${this.#uid}-card-questions`
      const valId = `te-dg-${this.#uid}-val-questions`
      const labBtn = h('button', { type: 'button', class: 'te-dg-lab', 'aria-expanded': 'false', 'aria-controls': cardId, 'aria-describedby': valId }, label)
      const val = h('span', { class: 'te-dg-val', id: valId })
      const tab = h('div', { class: 'te-dg-tab' }, labBtn, val)
      const body = h('div', { class: 'te-dg-body', id: cardId, hidden: true }, q.node)
      const wrap = h('div', { class: 'te-dg-callout', 'data-part': QUESTIONS, 'data-side': 'right', 'data-kind': 'questions', role: 'group', 'aria-label': label }, h('div', { class: 'te-dg-head' }, tab), body)
      const rec: Rec = { id: QUESTIONS, part: null, side: 'right', kind: 'questions', wrap, tab, label: labBtn, val, body, swc: null, controls: [q], chips: [], leader: null, dock: null, wasOpen: false, glance: '' }
      this.#recs.set(QUESTIONS, rec)
      this.#callouts.append(wrap)
      this.#wire(rec)
    }

    // A callout that was hovered and is gone will never see its pointerleave.
    if (hovered !== null && !this.#recs.has(hovered)) {
      clearTimeout(this.#hoverTimer)
      this.#send({ type: 'set', patch: { hover: null } })
    }
  }

  #wire(rec: Rec): void {
    this.#onBuilt(rec.tab, 'click', e => {
      if ((e.target as Element).closest('.te-dg-swc')) return
      this.#toggleTab(rec.id)
    })
    this.#bindPart(rec.wrap, rec.id)
  }

  // ── painting ──────────────────────────────────────────────────────────────

  #syncRec(rec: Rec, body: boolean): void {
    const env = this.#env()
    rec.swc?.sync()
    let text: string
    let extra = ''
    if (rec.part) {
      const g = glanceOf(rec.kind as Parameters<typeof glanceOf>[0], rec.part.fields[0], env)
      text = g.text
      extra = g.extra ?? ''
    } else text = questionsGlance(env)
    const sig = text + '\u0001' + extra
    if (sig !== rec.glance) {
      rec.glance = sig
      rec.val.replaceChildren(...[h('span', {}, text), extra ? h('span', {}, '· ' + extra) : null].filter((n): n is HTMLSpanElement => n !== null))
    }
    if (body) {
      for (const c of rec.controls) c.sync()
      for (const c of rec.chips) c.sync()
    }
  }

  /** `force` syncs every card; otherwise only an open card and the toolbar (what is on screen). */
  #syncAll(force: boolean): void {
    for (const rec of this.#recs.values()) this.#syncRec(rec, force || this.#state.open === rec.id || !!rec.dock || rec.chips.length > 0)
  }

  #paintOpen(): void {
    for (const rec of this.#recs.values()) {
      const open = this.#state.open === rec.id
      setAttr(rec.wrap, 'data-open', open ? '' : null)
      setAttr(rec.label, 'aria-expanded', String(open))
      rec.body.hidden = !open
      if (open && !rec.wasOpen) {
        this.#syncRec(rec, true)
        for (const c of rec.controls) c.onOpen?.()
      }
      rec.wasOpen = open
    }
    this.#describeName()
  }

  #paintLight(): void {
    const alert = this.#alertId()
    const mark = (el: Element, id: string): void => {
      const lit = litOf(this.#state, id, alert === id ? 'alert' : undefined)
      setAttr(el, 'data-lit', lit)
      setAttr(el, 'data-tone', alert === id ? 'alert' : null)
    }
    for (const [id, rec] of this.#recs) {
      mark(rec.wrap, id)
      if (rec.leader) mark(rec.leader, id)
    }
    for (const [id, lp] of this.#litParts) mark(lp.g, id)

    const imageId = this.#imagePart()
    const input = this.#input
    const lift = lifted(this.#state, imageId, !!input?.gesturing)
    setAttr(this.#d.viewport, 'data-lift', String(lift))
    setAttr(this.#d.figure, 'data-lift', String(lift))

    // the saved box and its size, only while a part that owns the capture is lit
    let strongest: 'soft' | 'strong' | null = null
    for (const p of this.#parts) {
      if (!p.showsCapture) continue
      const l = litOf(this.#state, p.id, alert === p.id ? 'alert' : undefined)
      if (l === 'strong' || (l === 'soft' && strongest === null)) strongest = l
    }
    const g = this.#geometry
    const show = strongest !== null && !!g.capture && !this.#group
    setAttr(this.#capture, 'data-lit', show ? strongest : null)
    setAttr(this.#capture, 'hidden', show ? null : '')
    const wide = input?.layout === 'wide'
    this.#dim.hidden = !(show && wide)
    if (show && wide && input) {
      const b = g.box
      const U = input.unit
      this.#dim.style.left = `${input.figure.left + b.x}px`
      this.#dim.style.top = `${input.figure.top + b.y - 30 * U}px`
      this.#dim.style.width = `${b.w}px`
      setText(this.#dim.firstElementChild ?? this.#dim.appendChild(h('span')), this.#d.t('editor.saved-size', '{size} px, as saved', { size: g.capture }))
    }
    setAttr(this.#cross, 'data-on', input?.gesturing ? 'true' : null)
  }

  /** The lit shapes, from each part's lit() as data. Groups are built once; paths are repainted in place. */
  #paintLitLayer(): void {
    const g = this.#geometry
    const S = g.size
    const id = (n: string): string => `te-dg-${this.#uid}-${n}`
    const lit = this.#lit
    setAttr(lit, 'viewBox', `0 0 ${S} ${S}`)
    setAttr(lit, 'width', String(S))
    setAttr(lit, 'height', String(S))
    setAttr(this.#clipIn, 'd', g.outline)
    setAttr(this.#clipOut, 'd', `M-40 -40H${S + 40}V${S + 40}H-40Z${g.outline}`)
    setAttr(this.#clipMask, 'd', g.mask)
    const pic = this.#context.picture ?? { x: 0, y: 0, w: 0, h: 0 }
    for (const [k, v] of [['x', pic.x], ['y', pic.y], ['width', pic.w], ['height', pic.h]] as const) setAttr(this.#clipPic, k, String(v))

    const url = (n: string): string => `url(#${id(n)})`
    const clipOf: Record<string, string> = { in: url('clip-in'), out: url('clip-out'), mask: url('clip-mask') }

    for (const part of this.#parts) {
      const lp = this.#litParts.get(part.id)
      if (!lp) continue
      const items = part.lit(g, this.#context)
      const sig = items.map(i => `${i.kind}|${i.clip ?? ''}|${i.dash ? 1 : 0}|${i.faint ? 1 : 0}|${i.rule ?? ''}|${i.w ?? 0}`).join(';')
      if (sig !== lp.sig) {
        lp.sig = sig
        lp.g.replaceChildren()
        lp.paths = items.map(it => {
          const p = svg('path', {
            class: `te-dg-l te-dg-${it.kind}`, 'stroke-width': it.w ?? 0, 'fill-rule': it.rule ?? null,
            'stroke-dasharray': it.dash ? '7 6' : null, 'stroke-linejoin': 'round',
          })
          if (it.w) p.style.setProperty('--w', `${it.w}px`)
          if (it.faint) p.setAttribute('data-faint', '')
          if (it.clip === 'mask+pic') lp.g.append(svg('g', { 'clip-path': url('clip-mask') }, svg('g', { 'clip-path': url('clip-pic') }, p)))
          else {
            if (it.clip && clipOf[it.clip]) p.setAttribute('clip-path', clipOf[it.clip])
            lp.g.append(p)
          }
          return p
        })
      }
      items.forEach((it, i) => setAttr(lp.paths[i], 'd', it.d))
    }

    const b = g.box
    setAttr(this.#capturePath, 'd', `M${b.x} ${b.y}H${b.x + b.w}V${b.y + b.h}H${b.x}Z`)
    const r = 14
    setAttr(this.#crossPath, 'd', `M${b.cx - r} ${b.cy}H${b.cx + r}M${b.cx} ${b.cy - r}V${b.cy + r}`)
  }

  /** The one in-place name input, placed from geometry.nameBox; its events are the shell's. */
  #paintName(): void {
    const input = this.#input
    if (!input) return
    const { port } = this.#d
    const nm = port.name.input
    const g = this.#geometry
    const nb = g.nameBox
    const owner = this.#namePart()
    if (!nm.isConnected) this.#d.figure.append(nm)
    nm.classList.add('te-dg-name')
    nm.hidden = this.#group || !owner || input.camera || !nb
    if (nb) {
      const text = nm.value || port.name.value || port.name.address
      this.#probe.style.fontSize = `${g.nameFont}px`
      this.#probe.textContent = text
      const measured = this.#probe.getBoundingClientRect().width
      const w = Math.min(nb.w, Math.max(g.nameFont * 3, measured + g.nameFont * 1.1))
      const hgt = g.nameFont * 1.5
      const set = (k: 'left' | 'top' | 'width' | 'height' | 'fontSize' | 'lineHeight', v: string): void => { if (nm.style[k] !== v) nm.style[k] = v }
      set('left', `${nb.cx - w / 2}px`)
      set('top', `${nb.cy - hgt / 2}px`)
      set('width', `${w}px`)
      set('height', `${hgt}px`)
      set('fontSize', `${g.nameFont}px`)
      set('lineHeight', `${hgt - 4}px`)
    }
    setAttr(nm, 'placeholder', port.name.address)
    setAttr(nm, 'aria-label', this.#d.t('editor.name', 'Name'))
    setAttr(nm, 'data-ghost', String(input.ghostName))
    setAttr(nm, 'data-hc-ground', GROUND)
    setAttr(nm, 'aria-invalid', port.name.status.state === 'refused' ? 'true' : null)
    this.#describeName()

    // a group has no name to type: the band says how many tiles, read only, in its own element
    const bl = this.#bandLabel
    bl.hidden = !this.#group || !nb
    if (this.#group && nb) {
      bl.style.left = `${nb.cx - nb.w / 2}px`
      bl.style.top = `${nb.cy - nb.h / 2}px`
      bl.style.width = `${nb.w}px`
      bl.style.height = `${nb.h}px`
      bl.style.fontSize = `${g.nameFont * 0.8}px`
      setText(bl, this.#d.t('editor.group-title', '{count} tiles', { count: port.group?.count ?? 0 }))
    }
  }

  /** The name input points at the status line while the card that holds it is shown. */
  #describeName(): void {
    const owner = this.#namePart()
    const rec = owner ? this.#recs.get(owner) : undefined
    const nm = this.#d.port.name.input
    const shown = !!rec && !rec.body.hidden && !nm.hidden
    setAttr(nm, 'aria-describedby', shown ? `te-dg-${this.#uid}-name-status` : null)
  }

  /** The toolbar is one node that MOVES between homes when the layout flips; it is never rebuilt. */
  #placeDock(): void {
    const dock = this.#dock
    const input = this.#input
    if (!dock || !input) return
    const rec = this.#recs.get(this.#imagePart() ?? '')
    if (input.layout === 'wide') {
      if (dock.parentNode !== this.#d.toolbarHome) this.#d.toolbarHome.append(dock)
      const U = input.unit
      dock.style.left = `${input.figure.left + input.size / 2}px`
      dock.style.top = `${input.figure.top + input.size + GAP_TOOL * U}px`
      dock.style.maxWidth = `${Math.max(0, input.viewport.width - 16)}px`
      dock.style.width = 'max-content'
      dock.style.transform = 'translateX(-50%)'
    } else {
      if (rec && dock.parentNode !== rec.body) rec.body.prepend(dock)
      for (const k of ['left', 'top', 'width', 'maxWidth', 'transform'] as const) if (dock.style[k]) dock.style[k] = ''
    }
    dock.hidden = this.#group
  }

  /** Tabs and leaders from the pure pass; closed heights only, so an open card moves nothing else. */
  #place(): void {
    const input = this.#input
    if (!input) return
    const leaders = this.#leaders
    setAttr(leaders, 'viewBox', `0 0 ${input.viewport.width} ${input.viewport.height}`)
    if (input.layout !== 'wide') {
      this.#placement = null
      for (const rec of this.#recs.values()) {
        for (const k of ['left', 'top', 'width'] as const) if (rec.wrap.style[k]) rec.wrap.style[k] = ''
        setAttr(rec.wrap, 'data-grow', null)
        setAttr(rec.wrap, 'data-covered', null)
      }
      this.#chip.style.visibility = ''
      return
    }
    const U = input.unit
    const compact = input.viewport.width < 1000 * U
    const g = this.#geometry
    const tabs: TabIn[] = []
    for (const rec of this.#recs.values()) {
      const open = this.#state.open === rec.id ? { bodyHeight: rec.body.offsetHeight } : undefined
      if (rec.part) tabs.push({ id: rec.id, side: rec.side, anchor: rec.part.anchor(g, this.#context), open })
      else tabs.push({ id: rec.id, side: rec.side, anchor: null, free: true, open })
    }
    const dock = this.#dock
    const toolbar = dock && !dock.hidden
      ? { reach: input.figure.left + input.size / 2 + dock.offsetWidth / 2, top: input.figure.top + input.size + GAP_TOOL * U }
      : null
    const pl = placeTabs({
      tabs, extent: unionExtent(this.#d.model, input.size, input.variant), figure: input.figure, size: input.size,
      viewport: input.viewport, unit: U, tab: (compact ? TAB_COMPACT : TAB) * U, card: (compact ? CARD_COMPACT : CARD) * U, toolbar,
    })
    this.#placement = pl
    for (const [id, p] of pl.tabs) {
      const rec = this.#recs.get(id)
      if (!rec) continue
      const w = rec.wrap
      const set = (k: 'left' | 'top' | 'width', v: string): void => { if (w.style[k] !== v) w.style[k] = v }
      set('left', `${p.left}px`)
      set('top', `${p.top}px`)
      set('width', `${p.width}px`)
      setAttr(w, 'data-grow', p.grow === 'up' ? 'up' : null)
      setAttr(w, 'data-covered', p.covered ? '' : null)
    }
    for (const rec of this.#recs.values()) {
      const leader = rec.leader
      if (!leader) continue
      const pts = pl.leaders.get(rec.id)
      leader.style.display = pts ? '' : 'none'
      if (!pts) continue
      const d = 'M' + pts.map(p => `${p.x} ${p.y}`).join('L')
      const [halo, ln, dot] = Array.from(leader.children)
      setAttr(halo, 'd', d)
      setAttr(ln, 'd', d)
      setAttr(dot, 'cx', String(pts[0].x))
      setAttr(dot, 'cy', String(pts[0].y))
      setAttr(leader, 'data-covered', pl.hiddenLeaders.has(rec.id) ? '' : null)
    }
    // the hive chip steps aside while an open card sits on it
    let covered = false
    if (this.#state.open) {
      const open = this.#recs.get(this.#state.open)
      const c = this.#chip.getBoundingClientRect()
      const o = open?.wrap.getBoundingClientRect()
      if (o && c.width > 0 && o.left < c.right && o.right > c.left && o.top < c.bottom && o.bottom > c.top) covered = true
    }
    this.#chip.style.visibility = covered ? 'hidden' : ''
  }

  #paintTag(): void {
    const { model, t } = this.#d
    const v = model.variants.find(x => x.id === this.#input?.variant)
    const sig = model.id + '|' + (v?.id ?? '')
    if (this.#tag.getAttribute('data-sig') === sig) return
    this.#tag.setAttribute('data-sig', sig)
    this.#tag.replaceChildren(t('editor.model', 'model') + ' ', h('b', {}, model.label), v ? ` · ${t(v.labelKey, v.label)}` : '')
  }

  /** The tile at hive size among its neighbours: the honest check of a hairline rim. */
  #paintChip(): void {
    const input = this.#input
    const chip = this.#chip
    if (!input || this.#group || input.layout !== 'wide') { chip.hidden = true; return }
    const { model, port, t } = this.#d
    const twin = port.picture.twinUrl(input.variant)
    const rimRaw = port.value('border.color')
    const rim = (typeof rimRaw === 'string' && rimRaw) || port.fallback('border.color')
    const reading = port.name.stored || port.name.address
    const sig = [input.variant, twin, rim, input.showName, input.hasPicture, reading].join('\u0001')
    chip.hidden = false
    if (sig === this.#chipSig) return
    this.#chipSig = sig

    const size = NEIGHBOUR_FACE
    const g = model.geometry(size, input.variant)
    const nb = model.neighbours ? model.neighbours(g) : []
    const rx = (nb.length ? Math.max(...nb.map(n => Math.abs(n.x))) : 0) + size / 2
    const ry = (nb.length ? Math.max(...nb.map(n => Math.abs(n.y))) : 0) + size / 2
    const W = Math.ceil(rx * 2) + 4
    const H = Math.ceil(ry * 2) + 4
    const id = `te-dg-${this.#uid}-chipclip`
    const root = svg('svg', { width: W, height: H, viewBox: `${-W / 2} ${-H / 2} ${W} ${H}`, 'aria-hidden': 'true', class: 'te-dg-chip-svg' })
    for (const n of nb) root.append(svg('path', { d: g.outline, class: 'te-dg-nb', transform: `translate(${n.x - size / 2} ${n.y - size / 2})` }))
    const me = svg('g', { transform: `translate(${-size / 2} ${-size / 2})` },
      svg('defs', {}, svg('clipPath', { id }, svg('path', { d: g.outline }))),
      svg('path', { d: g.outline, class: 'te-dg-me' }))
    const clipped = svg('g', { 'clip-path': `url(#${id})` })
    if (twin) clipped.append(svg('image', { href: twin, x: g.box.x, y: g.box.y, width: g.box.w, height: g.box.h, preserveAspectRatio: 'xMidYMid slice' }))
    if (g.band && input.showName && input.hasPicture) clipped.append(svg('rect', { x: g.band.x, y: g.band.y, width: g.band.w, height: g.band.h, class: 'te-dg-chip-band' }))
    me.append(clipped)
    // the rim colour is the person's own data: the one raw colour painted
    me.append(svg('path', { d: g.outline, fill: 'none', stroke: rim, 'stroke-width': g.rimWidth, 'stroke-opacity': 0.6, 'clip-path': `url(#${id})` }))
    root.append(me)
    const box = h('div', { class: 'te-dg-chipbox' }, root)
    if (g.nameBox) {
      const label = h('span', {
        class: 'te-dg-chipname', 'data-hc-ground': GROUND,
        style: `left:${W / 2 - g.nameBox.w / 2}px;top:${H / 2 - g.nameFont * 0.75}px;width:${g.nameBox.w}px;font-size:${g.nameFont}px;line-height:${g.nameFont * 1.5}px`,
      }, reading)
      if (input.showName && input.hasPicture) box.append(label)
    }
    chip.replaceChildren(box, h('span', { class: 'te-dg-cap' }, t('editor.hive-scale', 'in the hive')))
  }
}

export function createTileDiagram(deps: DiagramDeps): TileDiagram {
  return new Diagram(deps)
}
