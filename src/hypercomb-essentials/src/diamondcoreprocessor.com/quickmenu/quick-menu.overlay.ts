// diamondcoreprocessor.com/quickmenu/quick-menu.overlay.ts
//
// The drawn ring. Plain DOM + inline SVG, deliberately NOT Pixi.
//
// ── Why not Pixi ──────────────────────────────────────────────────────
//
// The quick menu has to appear over EVERY surface — hexagons, website,
// tree, slides, the workflow designer — and only one of those is a Pixi
// stage. A DOM overlay is the one renderer that is correct everywhere, owes
// nothing to the stage's lifecycle, and cannot be caught behind a view that
// swapped the canvas out from under it.
//
// ── Prebuilt, never built on the gesture ──────────────────────────────
//
// Every registered menu is rasterised to a detached `<svg>` ONCE, at warm
// time, and kept in memory. Summoning is `appendChild` of an existing
// subtree plus seven style writes — no element creation, no layout of new
// nodes, no measurement. Highlighting rewrites two attributes on two cached
// element references; it never touches innerHTML and never rebuilds.
//
// Cold-start safety: `ensure()` builds on demand if a summon somehow beats
// the warm pass, so a first gesture is correct even when it is slow.

import {
  HEX_RADIUS,
  QUICK_MENU_RING,
  RING_DISTANCE,
  slotOffset,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
} from './quick-menu.types.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// Cold chrome — the same ink-and-steel the other full-viewport surfaces use.
const HEX_FILL = 'rgba(11,15,20,0.88)'
const HEX_STROKE = 'rgba(126,182,214,0.20)'
const HEX_FILL_ON = 'rgba(126,182,214,0.14)'
const HEX_STROKE_ON = 'rgba(126,182,214,0.55)'
const TEXT_OFF = 'rgba(216,230,238,0.62)'
const TEXT_ON = '#d8e6ee'
const TEXT_BACK = 'rgba(216,230,238,0.38)'
const CANCEL_FILL = 'rgba(214,126,126,0.12)'
const CANCEL_STROKE = 'rgba(214,126,126,0.55)'
const CANCEL_TEXT = 'rgb(214,146,146)'
const CURSOR = 'rgb(126,182,214)'
const FOCUS_EASE_MS = 120
const FOCUS_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/**
 * Above everything the participant can be looking at.
 *
 * The census this is derived from, so the next person needn't re-derive it:
 * the Pixi tile canvas (`#pixi-host`) sits at 59989 — far above the 2400 this
 * overlay first used, which is exactly why the ring came up UNDERNEATH the
 * tiles. The shell's viewer/panel family occupies 100002–100004 (tags, files,
 * clipboard, workflow designer, action card, contact form), and the pixi debug
 * panels sit alone at 999999.
 *
 * The quick menu belongs above the panel family: it is transient, summoned
 * deliberately, and dismissed the moment it is used, so it must be readable
 * even when raised over an open panel. It stays below the debug surfaces,
 * which are meant to sit on top of everything including this.
 */
const Z_INDEX = 100050

const PAD = 6
const HALF_WIDTH = RING_DISTANCE + HEX_RADIUS + PAD
const HALF_HEIGHT = RING_DISTANCE * (Math.sqrt(3) / 2) + HEX_RADIUS + PAD
const BOX_WIDTH = HALF_WIDTH * 2
const BOX_HEIGHT = HALF_HEIGHT * 2

/** Point-top hexagon outline: vertices at 30°, 90°, 150°, 210°, 270°, 330°. */
const HEX_POINTS = [30, 90, 150, 210, 270, 330]
  .map(deg => {
    const rad = (deg * Math.PI) / 180
    return `${(Math.cos(rad) * HEX_RADIUS).toFixed(2)},${(Math.sin(rad) * HEX_RADIUS).toFixed(2)}`
  })
  .join(' ')

type SlotElements = {
  readonly hex: SVGPolygonElement
  readonly text: SVGTextElement
  /** Label as declared for this menu — restored whenever `back` moves. */
  readonly label: string
}

type BuiltMenu = {
  readonly svg: SVGSVGElement
  /** The drawn pointer. The real cursor is locked away while the ring is up,
   *  so this is the only thing telling you where your hand is. */
  readonly cursor: SVGGElement
  readonly slots: Map<QuickMenuDirection, SlotElements>
}

export class QuickMenuOverlay {
  #host: HTMLDivElement | null = null
  #built = new Map<string, BuiltMenu>()
  #active: BuiltMenu | null = null
  #activeName: string | null = null
  #highlight: QuickMenuDirection | null = null
  #backDirection: QuickMenuDirection | null = null
  #centreLabel = ''
  #cancelArmed = false

  /** Is a ring on screen right now? */
  get painted(): boolean {
    return this.#active !== null
  }

  // ── warm ────────────────────────────────────────────────────────────

  /** Build the host and every supplied menu ahead of first use. Idempotent. */
  warm(definitions: readonly QuickMenuDefinition[], labelOf: (slot: { label: string; labelKey?: string }) => string): void {
    this.#ensureHost()
    for (const definition of definitions) this.ensure(definition, labelOf)
  }

  /** Return the prebuilt menu, building it if the warm pass hasn't run. */
  ensure(
    definition: QuickMenuDefinition,
    labelOf: (slot: { label: string; labelKey?: string }) => string,
  ): BuiltMenu {
    const cached = this.#built.get(definition.name)
    if (cached) return cached
    const built = this.#build(definition, labelOf)
    this.#built.set(definition.name, built)
    return built
  }

  /** Drop a cached build — call when a definition is replaced or the locale
   *  changes, so the next summon re-renders its labels. */
  invalidate(name?: string): void {
    if (name) this.#built.delete(name)
    else this.#built.clear()
  }

  #ensureHost(): HTMLDivElement {
    if (this.#host?.isConnected) return this.#host
    const host = document.createElement('div')
    host.id = 'hc-quick-menu'
    host.style.cssText =
      `position:fixed;inset:0;z-index:${Z_INDEX};pointer-events:none;` +
      'contain:layout style;display:none;'
    document.body.appendChild(host)
    this.#host = host
    return host
  }

  #build(
    definition: QuickMenuDefinition,
    labelOf: (slot: { label: string; labelKey?: string }) => string,
  ): BuiltMenu {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', String(BOX_WIDTH))
    svg.setAttribute('height', String(BOX_HEIGHT))
    svg.setAttribute('viewBox', `0 0 ${BOX_WIDTH} ${BOX_HEIGHT}`)
    svg.setAttribute('aria-hidden', 'true')
    svg.style.cssText = 'position:absolute;overflow:visible;'

    // No travel line. Selection is by ROLL-OVER — the lit hexagon is the
    // whole readout, and a line from the origin only repeats what the
    // highlight already says.

    const declared = slotsByDirection(definition)
    const slots = new Map<QuickMenuDirection, SlotElements>()

    for (const direction of ['centre', ...QUICK_MENU_RING] as QuickMenuDirection[]) {
      const slot = declared.get(direction)
      if (!slot) continue
      const offset = slotOffset(direction)
      const cx = HALF_WIDTH + offset.x
      const cy = HALF_HEIGHT + offset.y

      const hex = document.createElementNS(SVG_NS, 'polygon')
      hex.setAttribute('points', HEX_POINTS)
      hex.setAttribute('transform', `translate(${cx.toFixed(2)},${cy.toFixed(2)})`)
      hex.setAttribute('fill', HEX_FILL)
      hex.setAttribute('stroke', HEX_STROKE)
      hex.setAttribute('stroke-width', '1')
      svg.appendChild(hex)

      const label = labelOf(slot)
      const text = document.createElementNS(SVG_NS, 'text')
      text.setAttribute('x', cx.toFixed(2))
      text.setAttribute('y', (cy + 4.5).toFixed(2))
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('fill', TEXT_OFF)
      text.setAttribute('font-size', '13')
      text.setAttribute('font-family', 'inherit')
      text.textContent = label
      svg.appendChild(text)

      slots.set(direction, { hex, text, label })
    }

    // The drawn pointer, appended last so it rides over the hexagons. Two
    // shapes: a dark halo so it stays visible on a lit slot, and the mark
    // itself. Small and quiet — it reports position, it does not decorate.
    const cursor = document.createElementNS(SVG_NS, 'g')
    const halo = document.createElementNS(SVG_NS, 'circle')
    halo.setAttribute('r', '5')
    halo.setAttribute('fill', 'rgba(11,15,20,0.85)')
    const dot = document.createElementNS(SVG_NS, 'circle')
    dot.setAttribute('r', '2.5')
    dot.setAttribute('fill', CURSOR)
    cursor.appendChild(halo)
    cursor.appendChild(dot)
    svg.appendChild(cursor)

    return { svg, cursor, slots }
  }

  /** Move the drawn pointer to `dx`,`dy` from the ring centre. */
  setCursor(dx: number, dy: number): void {
    this.#active?.cursor.setAttribute('transform', `translate(${(HALF_WIDTH + dx).toFixed(1)},${(HALF_HEIGHT + dy).toFixed(1)})`)
  }

  // ── paint ───────────────────────────────────────────────────────────

  /**
   * Put `definition`'s ring on screen centred at `origin`. When
   * `backDirection` is given (a nested ring), that slot is relabelled as the
   * way back and drawn dashed — the direction you arrived from is always the
   * direction that returns you.
   */
  paint(
    definition: QuickMenuDefinition,
    origin: { x: number; y: number },
    backDirection: QuickMenuDirection | null,
    labelOf: (slot: { label: string; labelKey?: string }) => string,
    backLabel: string,
    fromOrigin?: { x: number; y: number },
  ): void {
    const host = this.#ensureHost()
    const built = this.ensure(definition, labelOf)

    if (this.#active && this.#active !== built) this.#active.svg.remove()

    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const start = fromOrigin && !reducedMotion ? fromOrigin : origin
    built.svg.style.transition = 'none'
    built.svg.style.left = `${start.x - HALF_WIDTH}px`
    built.svg.style.top = `${start.y - HALF_HEIGHT}px`
    if (!built.svg.isConnected) host.appendChild(built.svg)
    host.style.display = 'block'
    if (start !== origin) {
      // Commit the starting position before applying the fast focus ease.
      void built.svg.getBoundingClientRect()
      built.svg.style.transition =
        `left ${FOCUS_EASE_MS}ms ${FOCUS_EASE}, top ${FOCUS_EASE_MS}ms ${FOCUS_EASE}`
      built.svg.style.left = `${origin.x - HALF_WIDTH}px`
      built.svg.style.top = `${origin.y - HALF_HEIGHT}px`
    }

    this.#active = built
    this.#activeName = definition.name
    this.#backDirection = backDirection
    this.#centreLabel = built.slots.get('centre')?.label ?? ''
    this.#cancelArmed = false
    this.#highlight = null

    for (const [direction, elements] of built.slots) {
      elements.text.textContent = direction === backDirection ? backLabel : elements.label
      this.#style(direction, elements, false)
    }
    this.setCursor(0, 0)
  }

  /** Which menu is on screen, by name. */
  get activeName(): string | null {
    return this.#activeName
  }

  /** Light the slot for `direction`, dimming the rest. Cheap enough to call
   *  on every pointermove: two attribute writes on the slot that changed. */
  highlight(direction: QuickMenuDirection | null): void {
    if (!this.#active || this.#highlight === direction) return
    const previous = this.#highlight
    this.#highlight = direction
    if (previous) {
      const elements = this.#active.slots.get(previous)
      if (elements) this.#style(previous, elements, false)
    }
    if (direction) {
      const elements = this.#active.slots.get(direction)
      if (elements) this.#style(direction, elements, true)
    }
  }

  /**
   * Once the pointer has left the dead zone, the centre stops being an
   * action and becomes the escape hatch — so it says so. This is the only
   * moment the ring rewrites a label, and it is the moment the participant
   * needs to know the gesture is abandonable.
   */
  setCancelArmed(armed: boolean): void {
    if (!this.#active || this.#cancelArmed === armed) return
    this.#cancelArmed = armed
    const elements = this.#active.slots.get('centre')
    if (!elements) return
    elements.text.textContent = armed ? this.#cancelLabel : this.#centreLabel
    this.#style('centre', elements, this.#highlight === 'centre')
  }

  #cancelLabel = 'cancel'

  /** Supply the localised word for the armed centre. */
  set cancelLabel(value: string) {
    this.#cancelLabel = value
  }

  #style(direction: QuickMenuDirection, elements: SlotElements, on: boolean): void {
    const isBack = direction === this.#backDirection
    const isCancel = direction === 'centre' && this.#cancelArmed

    if (isCancel) {
      elements.hex.setAttribute('fill', on ? CANCEL_FILL : HEX_FILL)
      elements.hex.setAttribute('stroke', CANCEL_STROKE)
      elements.hex.setAttribute('stroke-width', on ? '1.5' : '1')
      elements.hex.removeAttribute('stroke-dasharray')
      elements.text.setAttribute('fill', CANCEL_TEXT)
      return
    }

    elements.hex.setAttribute('fill', on ? HEX_FILL_ON : HEX_FILL)
    elements.hex.setAttribute('stroke', on ? HEX_STROKE_ON : HEX_STROKE)
    elements.hex.setAttribute('stroke-width', on ? '1.5' : '1')
    if (isBack) elements.hex.setAttribute('stroke-dasharray', '4 4')
    else elements.hex.removeAttribute('stroke-dasharray')
    elements.text.setAttribute('fill', on ? TEXT_ON : isBack ? TEXT_BACK : TEXT_OFF)
  }

  /** Take the ring off screen. The built subtree stays in memory. */
  clear(): void {
    this.#active?.svg.remove()
    this.#active = null
    this.#activeName = null
    this.#highlight = null
    this.#backDirection = null
    this.#cancelArmed = false
    if (this.#host) this.#host.style.display = 'none'
  }
}
