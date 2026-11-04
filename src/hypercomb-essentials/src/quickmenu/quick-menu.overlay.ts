// quickmenu/quick-menu.overlay.ts
//
// The drawn ring. Plain DOM + inline SVG, deliberately NOT Pixi.
//
// ── Why not Pixi ──────────────────────────────────────────────────────
//
// The quick menu has to appear over EVERY surface — hexagons, website, tree,
// slides, the workflow designer — and only one of those is a Pixi stage. A DOM
// overlay is the one renderer that is correct everywhere, owes nothing to the
// stage's lifecycle, and cannot be caught behind a view that swapped the canvas
// out from under it.
//
// ── Prebuilt, never built on the gesture ──────────────────────────────
//
// Every registered menu is rasterised to a detached `<svg>` ONCE, at warm time,
// and kept in memory. Summoning is `appendChild` of an existing subtree plus a
// few style writes — no element creation, no layout of new nodes, no
// measurement. Highlighting rewrites attributes on cached element references;
// it never touches innerHTML and never rebuilds, and a slot whose state did not
// change is not written at all.
//
// Cold-start safety: `ensure()` builds on demand if a summon somehow beats the
// warm pass, so a first gesture is correct even when it is slow.
//
// ── The tile ──────────────────────────────────────────────────────────
//
// Each option is a slab of dark honey (quick-menu.honey.ts carries the numbers
// and the argument). Per slot, bottom to top, all in SLOT-LOCAL coordinates so
// every gradient and path is defined once per menu:
//
//   contact shadow (light themes) · body · lit body · honey group
//   (bloom, pour lip with its frozen drip, the one drip that moves when lit,
//   meniscus, transmitted edge, specular sliver and glint) · rim · icon · label
//
// Back is crystallised honey, cancel is burnt honey; neither has a lip or drips.
// Only the label text node is ever rewritten; icons are path data on cached
// nodes, never a font ligature in a detached tree.
//
// ── The crafted backgrounds ───────────────────────────────────────────
//
// Once the ten backgrounds are drawn (quick-menu.honey-art.ts, once, at warm)
// each option wears its own (backgroundFor: no two alike in one ring) in place
// of the procedural body, lip, bloom, meniscus and sliver: two <image>s, the
// picture at rest and its pre-lit copy, and lighting a tile fades the lit one
// in. The lit tile alone keeps the one slow drip, hung from the top wall. Back
// and cancel keep their own honey. Until the pictures are ready, and wherever
// one failed, the slot is the procedural honey above.

import { THEME_IOC_KEY } from '@hypercomb/core'
import {
  HEX_RADIUS,
  QUICK_MENU_RING,
  RING_DISTANCE,
  slotOffset,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
} from './quick-menu.types.js'
import {
  BODY_BACK,
  BODY_BACK_LIT,
  BODY_CANCEL,
  BODY_LIT,
  BODY_REST,
  HONEY,
  HONEY_STYLE_ID,
  LAYOUT,
  backIcon,
  backgroundFor,
  beadShade,
  blobStart,
  cancelIcon,
  emptyIcon,
  estimateWidth,
  fitLabel,
  hexPoints,
  honeyStyleSheet,
  lipPath,
  neckPath,
  neckScales,
  radialStops,
  ringSeed,
  slotGlyph,
  slotHoney,
  slotIndexOf,
  wallY,
  type GradientStop,
  type LabelFit,
  type Measure,
} from './quick-menu.honey.js'
import { HONEY_ART_BOX, warmHoneyArt, type HoneyArt } from './quick-menu.honey-art.js'
import { HONEY_BACKGROUNDS } from './quick-menu.backgrounds.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

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
const HEX_POINTS = hexPoints(HEX_RADIUS)

/** One hexagon's life, as the overlay sees it. */
type SlotKind = 'rest' | 'lit' | 'back' | 'backLit' | 'cancel' | 'cancelLit'

type LabelBuilder = (slot: { label: string; labelKey?: string }) => string

interface SlotElements {
  /** The body, filled with the state's ramp. */
  readonly hex: SVGPolygonElement
  readonly lit: SVGPolygonElement
  /** Everything honey: bloom, lip, drips, meniscus, sliver. Hidden on back and cancel. */
  readonly honey: SVGGElement
  readonly drip: SVGGElement
  /** Procedural honey only: a crafted background carries its own light. */
  readonly sliver: SVGPathElement | null
  readonly glint: SVGCircleElement | null
  /** The slot's crafted background at rest and pre-lit, when it wears one. */
  readonly artRest: SVGImageElement | null
  readonly artLit: SVGImageElement | null
  readonly rim: SVGPolygonElement
  readonly ico: SVGGElement
  readonly icoPath: SVGPathElement
  readonly text: SVGTextElement
  /** Label as declared for this menu — restored whenever `back` moves. */
  readonly label: string
  /** This slot's own drawing, when the ring has one for its icon name. */
  readonly glyph: string | undefined
  readonly isCentre: boolean
  readonly sliverScale: number
  readonly steel: string
  /** `url(#…)` references to this menu's ramps, fixed at build. */
  readonly refs: Readonly<Record<'body' | 'lit' | 'back' | 'backlit' | 'cancel', string>>
  /** Mutable: what is on screen right now, so an unchanged state is not rewritten. */
  key: string
  shown: string
  glyphShown: string
}

type BuiltMenu = {
  readonly svg: SVGSVGElement
  /** The drawn pointer. The real cursor is locked away while the ring is up,
   *  so this is the only thing telling you where your hand is. */
  readonly cursor: SVGGElement
  readonly slots: Map<QuickMenuDirection, SlotElements>
}

let menuCounter = 0

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const name in attrs) el.setAttribute(name, String(attrs[name]))
  parent?.appendChild(el)
  return el
}

function gradient(
  parent: Element,
  kind: 'linearGradient' | 'radialGradient',
  id: string,
  attrs: Record<string, string | number>,
  stops: readonly GradientStop[],
): void {
  const g = node(kind, { id, ...attrs }, parent)
  for (const stop of stops) {
    const s = node('stop', { offset: stop.offset, 'stop-color': stop.color }, g)
    if (stop.opacity !== undefined) s.setAttribute('stop-opacity', String(stop.opacity))
  }
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
  #override = false
  /** Reduced motion is read at every paint; the drip only runs when this is true. */
  #motion = true
  /** `--md-is-light`, read once at warm: the contact edge is the only thing that follows the theme. */
  #light = false
  #themeRead = false
  #themeWatched = false
  #fontsWatched = false
  #fontsTimer: ReturnType<typeof setTimeout> | null = null
  /** The centre override as last cut: the 12-character cut and what the measure made of it. */
  #clipped: { cut: string; shown: string } | null = null

  /** The latest definition seen per name, so a theme change can rebuild what was warm. */
  #known = new Map<string, QuickMenuDefinition>()
  /** Definitions still waiting for their idle slot, built one per tick. */
  #queue: QuickMenuDefinition[] = []
  #pumping = false
  #labelOf: LabelBuilder | null = null

  /** Label fits, measured at warm and read as a lookup afterwards. */
  #fits = new Map<string, LabelFit>()
  #measureWith: Measure | null = null
  #family = ''

  /** The ten crafted backgrounds, once drawn; null until then (procedural honey). */
  #art: HoneyArt | null = null
  #artAsked = false

  /** Is a ring on screen right now? */
  get painted(): boolean {
    return this.#active !== null
  }

  // ── warm ────────────────────────────────────────────────────────────

  /**
   * Build the host and every supplied menu ahead of first use. Idempotent. The
   * first menu is built now so the common summon is ready at once; the rest are
   * built one per idle callback, so no single task carries the whole set.
   */
  warm(definitions: readonly QuickMenuDefinition[], labelOf: LabelBuilder): void {
    this.#ensureHost()
    this.#ensureStyle()
    this.#readTheme()
    this.#watchTheme()
    this.#watchFonts()
    this.#labelOf = labelOf
    this.#primeMeasure()
    this.#primeFit(labelOf({ label: 'back', labelKey: 'quickmenu.back' }), true)
    this.#primeFit(this.#cancelLabel, true)
    this.#askArt()

    for (const definition of definitions) this.#known.set(definition.name, definition)
    this.#queue = definitions.filter(d => !this.#built.has(d.name))
    const first = this.#queue.shift()
    if (first) this.ensure(first, labelOf)
    this.#pump()
  }

  /** Return the prebuilt menu, building it if the warm pass hasn't run. */
  ensure(definition: QuickMenuDefinition, labelOf: LabelBuilder): BuiltMenu {
    const cached = this.#built.get(definition.name)
    if (cached) return cached
    this.#known.set(definition.name, definition)
    this.#ensureHost()
    this.#ensureStyle()
    if (!this.#themeRead) this.#readTheme()
    this.#primeMeasure()
    const built = this.#build(definition, labelOf)
    this.#built.set(definition.name, built)
    return built
  }

  /** Drop a cached build — call when a definition is replaced or the locale
   *  changes, so the next summon re-renders its labels. */
  invalidate(name?: string): void {
    if (name) this.#built.delete(name)
    else {
      this.#built.clear()
      this.#fits.clear()
      this.#clipped = null
      this.#measureWith = null
    }
  }

  /** Start drawing the crafted backgrounds (once per page, off the gesture). */
  #askArt(): void {
    if (this.#artAsked) return
    this.#artAsked = true
    void warmHoneyArt(HONEY_BACKGROUNDS).then(art => { if (art) this.useArt(art) })
  }

  /** Wear the crafted backgrounds: every menu already built is built again,
   *  one per idle slot, the way a theme change rebuilds. */
  useArt(art: HoneyArt): void {
    if (this.#art === art) return
    this.#art = art
    if (this.#built.size > 0 || this.#queue.length > 0) this.#rewarm()
  }

  #pump(): void {
    if (this.#pumping || this.#queue.length === 0) return
    this.#pumping = true
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    const step = () => {
      this.#pumping = false
      const next = this.#queue.shift()
      if (next && this.#labelOf && !this.#built.has(next.name)) this.ensure(next, this.#labelOf)
      this.#pump()
    }
    if (idle) idle(step, { timeout: 1500 })
    else setTimeout(step, 0)
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

  /** The one document stylesheet: drip keyframes, the lit crossfade, reduced motion, forced colours. */
  #ensureStyle(): void {
    if (document.getElementById(HONEY_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = HONEY_STYLE_ID
    style.textContent = honeyStyleSheet()
    document.head.appendChild(style)
  }

  // ── theme ───────────────────────────────────────────────────────────

  #readTheme(): void {
    this.#themeRead = true
    try {
      this.#light = getComputedStyle(document.documentElement).getPropertyValue('--md-is-light').trim() === '1'
    } catch {
      this.#light = false
    }
  }

  /** The contact edge follows the theme; rebuild when it changes, as the locale does. */
  #watchTheme(): void {
    if (this.#themeWatched) return
    const ioc = (globalThis as { ioc?: { whenReady?: (key: string, cb: (service: unknown) => void) => void } }).ioc
    if (!ioc?.whenReady) return
    this.#themeWatched = true
    ioc.whenReady(THEME_IOC_KEY, service => {
      ;(service as EventTarget | undefined)?.addEventListener?.('change', () => {
        // ThemeService also says 'change' when a theme is registered or re-asserted;
        // the only thing this ring reads is --md-is-light, so most events change nothing.
        const before = this.#light
        this.#readTheme()
        if (this.#light === before) return
        this.#rewarm()
      })
    })
  }

  /** Drop what was built and rebuild it one menu per idle slot. Menus still
   *  waiting for their first slot keep their place in the queue. */
  #rewarm(): void {
    const warm = [...this.#built.keys()]
    this.invalidate()
    this.#primeMeasure()
    const labelOf = this.#labelOf
    if (!labelOf) return
    this.#primeFit(labelOf({ label: 'back', labelKey: 'quickmenu.back' }), true)
    this.#primeFit(this.#cancelLabel, true)
    const waiting = new Set(this.#queue.map(d => d.name))
    for (const name of warm) {
      const definition = this.#known.get(name)
      if (definition && !waiting.has(name)) this.#queue.push(definition)
    }
    this.#pump()
  }

  /** Every fit is measured in the font the label is set in. If the web font
   *  arrives after the first warm, those widths were fallback widths: measure again. */
  #watchFonts(): void {
    if (this.#fontsWatched) return
    const fonts = (globalThis.document as Document | undefined)?.fonts
    if (!fonts?.addEventListener) return
    this.#fontsWatched = true
    fonts.addEventListener('loadingdone', () => {
      if (this.#fontsTimer !== null) clearTimeout(this.#fontsTimer)
      // a page's fonts land in a burst: one rewarm for the lot
      this.#fontsTimer = setTimeout(() => {
        this.#fontsTimer = null
        this.#rewarm()
      }, 120)
    })
  }

  // ── label fit ───────────────────────────────────────────────────────

  /** A canvas measure in the font the label will really be set in. Warm only. */
  #primeMeasure(): void {
    if (this.#measureWith) return
    this.#family = this.#host ? getComputedStyle(this.#host).fontFamily || 'sans-serif' : 'sans-serif'
    let context: CanvasRenderingContext2D | null = null
    try {
      context = document.createElement('canvas').getContext('2d')
    } catch {
      context = null
    }
    this.#measureWith = context
      ? (text, size) => {
          context.font = `400 ${size}px ${this.#family}`
          return context.measureText(text).width + LAYOUT.letterSpacing * size * [...text].length
        }
      : estimateWidth
  }

  #fitKey(text: string, glyph: boolean): string {
    return (glyph ? 'i:' : 't:') + text
  }

  #primeFit(text: string, glyph: boolean): LabelFit {
    const key = this.#fitKey(text, glyph)
    const known = this.#fits.get(key)
    if (known) return known
    const base = glyph ? LAYOUT.ring.labelSize : LAYOUT.textOnly.labelSize
    const usable = glyph ? LAYOUT.usableIcon : LAYOUT.usableText
    const fit = fitLabel(text, base, usable, this.#measureWith ?? estimateWidth)
    this.#fits.set(key, fit)
    return fit
  }

  /** On the gesture: a lookup, or arithmetic. Never a measurement. An unprimed
   *  string is only guessed at, so it may shrink but is never stretched. */
  #fitNow(text: string, glyph: boolean): LabelFit {
    const known = this.#fits.get(this.#fitKey(text, glyph))
    if (known) return known
    const base = glyph ? LAYOUT.ring.labelSize : LAYOUT.textOnly.labelSize
    return fitLabel(text, base, glyph ? LAYOUT.usableIcon : LAYOUT.usableText, estimateWidth, false)
  }

  /** The centre override (a tile's own name), cut to what the slot can hold.
   *  Cut by the canvas measure in the label's font, once per distinct name (one
   *  measureText, no layout): a name too wide even at the floor loses characters
   *  to an ellipsis rather than being squeezed. Without a canvas it is the
   *  12-character cut alone. */
  #clipOverride(label: string): string {
    const cut = label.length > 12 ? label.slice(0, 11) + '…' : label
    const measure = this.#measureWith
    if (!measure || measure === estimateWidth) return cut
    if (this.#clipped?.cut === cut) return this.#clipped.shown
    // an override is per summon: only the latest is kept in the fit table
    if (this.#clipped) this.#fits.delete(this.#fitKey(this.#clipped.shown, false))
    const usable = LAYOUT.usableText
    let shown = cut
    if (fitLabel(shown, LAYOUT.textOnly.labelSize, usable, measure).textLength !== undefined) {
      const chars = [...shown.replace(/…$/, '')]
      while (chars.length > 1) {
        chars.pop()
        shown = chars.join('') + '…'
        if (measure(shown, LAYOUT.floorSize) <= usable) break
      }
    }
    this.#clipped = { cut, shown }
    this.#fits.set(this.#fitKey(shown, false), fitLabel(shown, LAYOUT.textOnly.labelSize, usable, measure))
    return shown
  }

  // ── build ───────────────────────────────────────────────────────────

  #build(definition: QuickMenuDefinition, labelOf: LabelBuilder): BuiltMenu {
    const uid = `hq${++menuCounter}`
    const id = (name: string): string => `${uid}-${name}`
    const url = (name: string): string => `url(#${id(name)})`

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('width', String(BOX_WIDTH))
    svg.setAttribute('height', String(BOX_HEIGHT))
    svg.setAttribute('viewBox', `0 0 ${BOX_WIDTH} ${BOX_HEIGHT}`)
    svg.setAttribute('role', 'group')
    svg.setAttribute('aria-label', labelOf({ label: definition.title, labelKey: definition.titleKey }))
    svg.setAttribute('data-motion', 'live')
    svg.style.cssText = 'position:absolute;overflow:visible;'

    // Shared by every slot of THIS menu, in slot-local units. Ids are unique per
    // build and the defs live inside the svg: a gradient referenced through a
    // display:none host would not resolve.
    const defs = node('defs', {}, svg)
    const R = HEX_RADIUS
    const radial = { gradientUnits: 'userSpaceOnUse', cx: 0, cy: 0, r: R }
    gradient(defs, 'radialGradient', id('body'), radial, radialStops(BODY_REST))
    gradient(defs, 'radialGradient', id('lit'), radial, radialStops(BODY_LIT))
    gradient(defs, 'radialGradient', id('back'), radial, radialStops(BODY_BACK))
    gradient(defs, 'radialGradient', id('backlit'), radial, radialStops(BODY_BACK_LIT))
    gradient(defs, 'radialGradient', id('cancel'), radial, radialStops(BODY_CANCEL))
    gradient(
      defs, 'radialGradient', id('bloom'),
      { gradientUnits: 'userSpaceOnUse', cx: HONEY.bloom.cx.toFixed(2), cy: HONEY.bloom.cy.toFixed(2), r: HONEY.bloom.r },
      HONEY.bloom.stops.map(s => ({ offset: s.offset, color: HONEY.bloom.color, opacity: s.alpha })),
    )
    gradient(
      defs, 'linearGradient', id('lip'),
      { gradientUnits: 'userSpaceOnUse', x1: 0, y1: HONEY.lip.y1, x2: 0, y2: HONEY.lip.y2 },
      HONEY.lip.stops,
    )
    gradient(
      defs, 'linearGradient', id('bead'),
      { gradientUnits: 'objectBoundingBox', x1: 0, y1: 0, x2: 0, y2: 1 },
      [{ offset: 0, color: HONEY.bead.top }, { offset: 1, color: HONEY.bead.bottom }],
    )
    gradient(
      defs, 'linearGradient', id('men'),
      { gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: HONEY.meniscus.x2.toFixed(2), y2: HONEY.meniscus.y2.toFixed(2) },
      [
        { offset: 0, color: HONEY.meniscus.color, opacity: HONEY.meniscus.alphaMin },
        { offset: 1, color: HONEY.meniscus.color, opacity: HONEY.meniscus.alphaMax },
      ],
    )
    gradient(
      defs, 'linearGradient', id('trn'),
      { gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: HONEY.transmitted.x2.toFixed(2), y2: HONEY.transmitted.y2.toFixed(2) },
      [
        { offset: 0, color: HONEY.transmitted.color, opacity: 0 },
        { offset: 0.35, color: HONEY.transmitted.color, opacity: 0 },
        { offset: 1, color: HONEY.transmitted.color, opacity: HONEY.transmitted.alphaMax },
      ],
    )
    gradient(
      defs, 'linearGradient', id('sliv'),
      {
        gradientUnits: 'userSpaceOnUse',
        x1: HONEY.sliver.x1.toFixed(2), y1: HONEY.sliver.y1.toFixed(2),
        x2: HONEY.sliver.x2.toFixed(2), y2: HONEY.sliver.y2.toFixed(2),
      },
      [
        { offset: 0, color: HONEY.sliver.color, opacity: 0 },
        { offset: 0.5, color: HONEY.sliver.color, opacity: 1 },
        { offset: 1, color: HONEY.sliver.color, opacity: 0 },
      ],
    )
    const clip = node('clipPath', { id: id('hex') }, defs)
    node('polygon', { points: HEX_POINTS }, clip)

    const steel = this.#light ? HONEY.steelLight : HONEY.steel
    const declared = slotsByDirection(definition)
    const slots = new Map<QuickMenuDirection, SlotElements>()

    for (const direction of ['centre', ...QUICK_MENU_RING] as QuickMenuDirection[]) {
      const slot = declared.get(direction)
      if (!slot) continue
      const offset = slotOffset(direction)
      const cx = HALF_WIDTH + offset.x
      const cy = HALF_HEIGHT + offset.y
      const label = labelOf(slot)
      const isCentre = direction === 'centre'
      const honey = slotHoney(ringSeed(slotIndexOf(direction), definition.name))

      // The ring's own drawing for the slot's icon name. A name with no drawing,
      // and every user-authored word, is text-only: the word is the identity.
      // An empty label shows the dots instead.
      const glyph = slotGlyph(slot.icon) ?? (label === '' ? slotGlyph(emptyIcon) : undefined)

      const g = node('g', { transform: `translate(${cx.toFixed(2)},${cy.toFixed(2)})` }, svg)

      if (this.#light) {
        node('polygon', {
          class: 'hc-qm-shadow', points: HEX_POINTS, fill: HONEY.contact.color,
          transform: `translate(0,${HONEY.contact.dy})`, 'aria-hidden': 'true',
        }, g)
      }
      const hex = node('polygon', {
        class: 'hc-qm-base', points: HEX_POINTS, fill: url('body'), 'fill-opacity': HONEY.bodyAlpha,
      }, g)

      // The crafted background, when it is drawn: the picture and its pre-lit copy.
      const artIndex = backgroundFor(definition.name, direction)
      const art = this.#art?.ready[artIndex] ? this.#art : null
      let artRest: SVGImageElement | null = null
      let artLit: SVGImageElement | null = null
      if (art) {
        const frame = {
          x: HONEY_ART_BOX.x, y: HONEY_ART_BOX.y, width: HONEY_ART_BOX.width, height: HONEY_ART_BOX.height,
          preserveAspectRatio: 'none', 'clip-path': url('hex'), 'aria-hidden': 'true',
        }
        artRest = node('image', { class: 'hc-qm-art', href: art.rest[artIndex] ?? '', ...frame }, g)
        artLit = node('image', { class: 'hc-qm-art-lit', href: art.lit[artIndex] ?? '', ...frame }, g)
        artLit.style.opacity = '0'
      }

      const lit = node('polygon', {
        class: 'hc-qm-lit', points: HEX_POINTS, fill: url('lit'), 'fill-opacity': HONEY.bodyAlpha,
        stroke: HONEY.lit.rim, 'stroke-opacity': HONEY.lit.haloAlpha, 'stroke-width': HONEY.lit.haloWidth,
        'clip-path': url('hex'), 'aria-hidden': 'true',
      }, g)
      lit.style.opacity = '0'

      // ── the honey group ──
      // With a crafted background it holds the drip alone, hung from the top
      // wall (there is no pour lip to hang it from) and clipped to the tile.
      const layers = node('g', { class: 'hc-hq', 'aria-hidden': 'true' }, g)
      const shade = (d: string): Record<string, string | number> => ({
        d, fill: 'none', stroke: HONEY.bead.shade, 'stroke-opacity': HONEY.bead.shadeAlpha,
        'stroke-width': HONEY.bead.shadeWidth.toFixed(2), 'stroke-linecap': 'round',
      })
      const b = honey.b
      let dripParent: SVGGElement = layers
      if (art) {
        layers.setAttribute('clip-path', url('hex'))
        dripParent = node('g', { transform: `translate(0,${(wallY(b.x) - b.y0).toFixed(2)})` }, layers)
      } else {
        node('polygon', { points: HEX_POINTS, fill: url('bloom') }, layers)
        const lipLayer = node('g', { 'clip-path': url('hex') }, layers)
        const lipD = lipPath(honey)
        node('path', {
          d: lipD, transform: `translate(0,${HONEY.lip.shadowDy})`, fill: HONEY.lip.shadow,
        }, lipLayer)
        node('path', { d: lipD, fill: url('lip'), 'fill-opacity': HONEY.lip.alpha }, lipLayer)
        const a = honey.a
        node('path', shade(beadShade(a.x, a.y0 + a.h, a.radius)), lipLayer)
      }

      // Drip B: the one that moves, on the lit tile only. Neck, bead and glint
      // are separate nodes so each can follow its own keyframes; the class that
      // starts them sits on the parent, set by #style.
      const y1 = b.y0 + b.h
      const scales = neckScales(b.h)
      const origin = (x: number, y: number): string => `transform-origin:${x.toFixed(2)}px ${y.toFixed(2)}px`
      const anim = node('g', { class: 'hc-qd' }, dripParent)
      const dripGroup = node('g', { class: 'hc-qd-drip' }, anim)
      dripGroup.setAttribute('style', origin(b.x, b.y0))
      const neck = node('path', { class: 'hc-qd-neck', d: neckPath(b), fill: HONEY.lip.neck }, dripGroup)
      neck.setAttribute('style', `--sy-swell:${scales.swell.toFixed(3)};--sy-neck:${scales.neck.toFixed(3)};${origin(b.x, b.y0)}`)
      const bead = node('circle', {
        class: 'hc-qd-bead', cx: b.x.toFixed(2), cy: y1.toFixed(2), r: b.radius.toFixed(2), fill: url('bead'),
      }, dripGroup)
      bead.setAttribute('style', origin(b.x, y1))
      const beadGlint = node('ellipse', {
        class: 'hc-qd-glint',
        cx: (b.x - 0.3 * b.radius).toFixed(2), cy: (y1 - 0.38 * b.radius).toFixed(2),
        rx: (0.3 * b.radius).toFixed(2), ry: (0.2 * b.radius).toFixed(2),
        fill: HONEY.bead.glint, 'fill-opacity': HONEY.bead.glintAlpha,
      }, dripGroup)
      beadGlint.setAttribute('style', origin(b.x, y1))
      // The shade follows the bead, so it shares the bead's keyframes.
      const beadShadeEl = node('path', { class: 'hc-qd-bead', ...shade(beadShade(b.x, y1, b.radius)) }, dripGroup)
      beadShadeEl.setAttribute('style', origin(b.x, y1))

      const drop = blobStart(b)
      const blob = node('g', { class: 'hc-qd-blob', opacity: 0 }, anim)
      blob.setAttribute('style', origin(drop.cx, drop.cy))
      node('circle', { cx: drop.cx.toFixed(2), cy: drop.cy.toFixed(2), r: drop.r.toFixed(2), fill: url('bead') }, blob)
      node('path', shade(beadShade(drop.cx, drop.cy, drop.r)), blob)
      node('ellipse', {
        cx: (drop.cx - 0.3 * drop.r).toFixed(2), cy: (drop.cy - 0.38 * drop.r).toFixed(2),
        rx: (0.3 * drop.r).toFixed(2), ry: (0.2 * drop.r).toFixed(2),
        fill: HONEY.bead.glint, 'fill-opacity': HONEY.bead.glintAlpha,
      }, blob)

      let sliver: SVGPathElement | null = null
      let glint: SVGCircleElement | null = null
      if (!art) {
        node('polygon', {
          points: hexPoints(HONEY.meniscus.circumradius), fill: 'none',
          stroke: url('men'), 'stroke-width': HONEY.meniscus.width,
        }, layers)
        node('polygon', {
          points: hexPoints(HONEY.transmitted.circumradius), fill: 'none',
          stroke: url('trn'), 'stroke-width': HONEY.transmitted.width,
        }, layers)
        sliver = node('path', {
          d: `M${HONEY.sliver.x1.toFixed(2)} ${HONEY.sliver.y1.toFixed(2)}L${HONEY.sliver.x2.toFixed(2)} ${HONEY.sliver.y2.toFixed(2)}`,
          fill: 'none', stroke: url('sliv'), 'stroke-width': HONEY.sliver.width.toFixed(2), 'stroke-linecap': 'round',
          'stroke-opacity': (HONEY.sliver.peakRest * honey.sliverScale).toFixed(3),
        }, layers)
        glint = node('circle', {
          cx: HONEY.glint.x.toFixed(2), cy: HONEY.glint.y.toFixed(2), r: HONEY.glint.rRest.toFixed(2),
          fill: HONEY.glint.color, 'fill-opacity': HONEY.glint.alpha,
        }, layers)
      }

      // The outermost hairline; also where back draws its dashes and lit its gold.
      const rim = node('polygon', {
        class: 'hc-qm-rim', points: HEX_POINTS, fill: 'none', stroke: steel, 'stroke-width': 1,
      }, g)

      // Icon: a cached path on the 24 grid, swapped by `d` for back and cancel.
      const place = isCentre ? LAYOUT.centre : LAYOUT.ring
      const ico = node('g', { class: 'hc-qm-ico', 'aria-hidden': 'true' }, g)
      const icoPath = node('path', { class: 'hc-qm-ink', d: glyph ?? '', fill: HONEY.ink.rest }, ico)

      const fit = this.#primeFit(label, glyph !== undefined)
      const text = node('text', {
        class: 'hc-qm-ink', x: 0, y: glyph ? place.labelY : LAYOUT.textOnly.labelY,
        'text-anchor': 'middle', fill: HONEY.ink.rest, 'font-size': fit.size,
        'font-family': 'inherit', 'font-weight': 400, 'letter-spacing': `${LAYOUT.letterSpacing}em`,
      }, g)
      text.textContent = label

      const elements: SlotElements = {
        hex, lit, honey: layers, drip: anim, sliver, glint, artRest, artLit, rim, ico, icoPath, text,
        label, glyph, isCentre, sliverScale: honey.sliverScale, steel,
        refs: { body: url('body'), lit: url('lit'), back: url('back'), backlit: url('backlit'), cancel: url('cancel') },
        key: '', shown: label, glyphShown: glyph ?? '',
      }
      if (glyph) {
        ico.setAttribute('transform', this.#iconTransform(isCentre))
      } else {
        ico.setAttribute('display', 'none')
      }
      if (fit.textLength !== undefined) {
        text.setAttribute('textLength', String(fit.textLength))
        text.setAttribute('lengthAdjust', 'spacingAndGlyphs')
      }
      slots.set(direction, elements)
    }

    // The drawn pointer, appended last so it rides over the hexagons. Two
    // shapes: a dark halo so it stays visible on a lit slot, and the mark
    // itself. Small and quiet — it reports position, it does not decorate.
    const cursor = document.createElementNS(SVG_NS, 'g')
    cursor.setAttribute('aria-hidden', 'true')
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

  #iconTransform(centre: boolean): string {
    const p = centre ? LAYOUT.centre : LAYOUT.ring
    return p.iconScale === 1
      ? `translate(${p.iconX},${p.iconY})`
      : `translate(${p.iconX},${p.iconY}) scale(${p.iconScale.toFixed(4)})`
  }

  /** Move the drawn pointer to `dx`,`dy` from the ring centre. */
  setCursor(dx: number, dy: number): void {
    const cursor = this.#active?.cursor
    if (!cursor) return
    cursor.setAttribute('transform', `translate(${(HALF_WIDTH + dx).toFixed(1)},${(HALF_HEIGHT + dy).toFixed(1)})`)
    // At the very moment of summoning the pointer is dead centre, which is the
    // middle tile's icon: the dot would be the loudest thing on the ring and sit
    // on the glyph. It appears with the first movement, which is when a hand
    // needs telling where it is.
    const rest = dx === 0 && dy === 0
    if (rest !== cursor.hasAttribute('display')) {
      if (rest) cursor.setAttribute('display', 'none')
      else cursor.removeAttribute('display')
    }
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
    labelOf: LabelBuilder,
    backLabel: string,
    fromOrigin?: { x: number; y: number },
  ): void {
    const host = this.#ensureHost()
    const built = this.ensure(definition, labelOf)

    if (this.#active && this.#active !== built) this.#active.svg.remove()

    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.#motion = !reducedMotion
    const mode = reducedMotion ? 'still' : 'live'
    if (built.svg.getAttribute('data-motion') !== mode) built.svg.setAttribute('data-motion', mode)

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
    this.#override = false
    this.#highlight = null

    for (const [direction, elements] of built.slots) {
      this.#setText(elements, direction === backDirection ? backLabel : elements.label)
      this.#style(direction, elements, false)
    }
    this.setCursor(0, 0)
  }

  /** Which menu is on screen, by name. */
  get activeName(): string | null {
    return this.#activeName
  }

  /** Light the slot for `direction`, dimming the rest. Cheap enough to call
   *  on every pointermove: a state change on the slot that left and the slot
   *  that arrived, and nothing else. */
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
    this.#setText(elements, armed ? this.#cancelLabel : this.#centreLabel)
    this.#style('centre', elements, this.#highlight === 'centre')
  }

  /**
   * Relabel the centre for THIS summon only — the tile a touch long-press was
   * held over, so the zero-travel slot names its subject instead of the ring's
   * generic verb. The built subtree is shared and cached, so the override is
   * written to the live text node only; the next `paint` restores every slot
   * from its built label, which is what keeps a per-summon word out of the
   * cache. Truncated: a slot is one hexagon wide, and a tile name is not. The
   * override is shown text-only (the verb's icon would name the wrong thing).
   */
  setCentreOverride(label: string | null): void {
    if (!this.#active) return
    const elements = this.#active.slots.get('centre')
    if (!elements) return
    const shown = label ? this.#clipOverride(label) : elements.label
    this.#centreLabel = shown
    this.#override = !!label
    if (this.#cancelArmed) return
    this.#setText(elements, shown)
    this.#style('centre', elements, this.#highlight === 'centre')
  }

  #cancelLabel = 'cancel'

  /** Supply the localised word for the armed centre. */
  set cancelLabel(value: string) {
    this.#cancelLabel = value
    if (this.#measureWith) this.#primeFit(value, true)
  }

  /** The label node is the only thing whose text is ever rewritten. */
  #setText(elements: SlotElements, value: string): void {
    elements.text.textContent = value
    elements.shown = value
  }

  // ── state ───────────────────────────────────────────────────────────

  /**
   * Show `elements` in the state the ring is in. Writes attributes and style on
   * cached nodes and nothing else, and skips the lot when the slot's state key
   * (kind, motion, override, the word on it) has not changed.
   */
  #style(direction: QuickMenuDirection, elements: SlotElements, on: boolean): void {
    const isBack = direction === this.#backDirection
    const isCancel = direction === 'centre' && this.#cancelArmed
    const kind: SlotKind = isCancel
      ? (on ? 'cancelLit' : 'cancel')
      : isBack
        ? (on ? 'backLit' : 'back')
        : (on ? 'lit' : 'rest')
    const override = direction === 'centre' && this.#override && !isCancel && !isBack
    const motion = kind === 'lit' && this.#motion
    const key = `${kind}|${motion ? 1 : 0}|${override ? 1 : 0}|${elements.shown}`
    if (elements.key === key) return
    elements.key = key

    const ink =
      kind === 'lit' ? HONEY.ink.lit
        : kind === 'back' || kind === 'backLit' ? HONEY.ink.back
          : kind === 'cancel' || kind === 'cancelLit' ? HONEY.ink.cancel
            : HONEY.ink.rest

    // ── body, honey, rim ──
    switch (kind) {
      case 'rest':
      case 'lit': {
        const isLit = kind === 'lit'
        elements.hex.setAttribute('fill', elements.refs.body)
        elements.hex.setAttribute('fill-opacity', String(HONEY.bodyAlpha))
        if (elements.artRest) {
          // the picture carries the body; lit fades its pre-lit copy in, and
          // the lit polygon keeps only its halo
          this.#setArt(elements, true, isLit)
          this.#setLit(elements, isLit, 'none', isLit)
          if (isLit) elements.honey.removeAttribute('display')
          else elements.honey.setAttribute('display', 'none')
        } else {
          this.#setLit(elements, isLit, elements.refs.lit, isLit)
          elements.honey.removeAttribute('display')
        }
        this.#setRim(elements, isLit ? HONEY.lit.rim : elements.steel, isLit ? HONEY.lit.rimWidth : 1, isLit ? HONEY.lit.rimAlpha : 1, null)
        elements.sliver?.setAttribute(
          'stroke-opacity',
          ((isLit ? HONEY.sliver.peakLit : HONEY.sliver.peakRest) * elements.sliverScale).toFixed(3),
        )
        elements.glint?.setAttribute('r', (isLit ? HONEY.glint.rLit : HONEY.glint.rRest).toFixed(2))
        // The drip is the only thing that moves, and only on the lit tile.
        elements.drip.classList.toggle('hc-qd-run', motion)
        break
      }
      case 'back':
      case 'backLit': {
        const isLit = kind === 'backLit'
        elements.hex.setAttribute('fill', elements.refs.back)
        elements.hex.setAttribute('fill-opacity', String(HONEY.backAlpha))
        this.#setArt(elements, false, false)
        this.#setLit(elements, isLit, elements.refs.backlit, false)
        elements.honey.setAttribute('display', 'none')
        elements.drip.classList.remove('hc-qd-run')
        this.#setRim(elements, isLit ? HONEY.back.rimLit : HONEY.back.rim, HONEY.back.rimWidth, 1, HONEY.back.dash)
        break
      }
      default: {
        const isLit = kind === 'cancelLit'
        elements.hex.setAttribute('fill', elements.refs.cancel)
        elements.hex.setAttribute('fill-opacity', String(HONEY.bodyAlpha))
        this.#setArt(elements, false, false)
        this.#setLit(elements, false, elements.refs.lit, false)
        elements.honey.setAttribute('display', 'none')
        elements.drip.classList.remove('hc-qd-run')
        // The cue acts on the rim alone: it swells when the pointer is back home.
        this.#setRim(elements, HONEY.cancel.rim, isLit ? HONEY.cancel.rimWidth + 0.5 : HONEY.cancel.rimWidth, isLit ? 1 : 0.8, null)
        break
      }
    }

    // ── icon and label ──
    const glyph = isCancel ? slotGlyph(cancelIcon) : isBack ? slotGlyph(backIcon) : override ? undefined : elements.glyph
    const centreCell = elements.isCentre
    if (glyph) {
      if (elements.glyphShown !== glyph) {
        elements.icoPath.setAttribute('d', glyph)
        elements.glyphShown = glyph
      }
      elements.ico.setAttribute('transform', this.#iconTransform(centreCell))
      elements.ico.removeAttribute('display')
    } else {
      elements.ico.setAttribute('display', 'none')
    }
    const place = centreCell ? LAYOUT.centre : LAYOUT.ring
    const fit = this.#fitNow(elements.shown, glyph !== undefined)
    elements.text.setAttribute('y', String(glyph ? place.labelY : LAYOUT.textOnly.labelY))
    elements.text.setAttribute('font-size', String(fit.size))
    if (fit.textLength !== undefined) {
      elements.text.setAttribute('textLength', String(fit.textLength))
      elements.text.setAttribute('lengthAdjust', 'spacingAndGlyphs')
    } else {
      elements.text.removeAttribute('textLength')
      elements.text.removeAttribute('lengthAdjust')
    }
    elements.icoPath.setAttribute('fill', ink)
    elements.text.setAttribute('fill', ink)
  }

  #setLit(elements: SlotElements, visible: boolean, fill: string, halo: boolean): void {
    elements.lit.setAttribute('fill', fill)
    elements.lit.setAttribute('stroke-opacity', halo ? String(HONEY.lit.haloAlpha) : '0')
    elements.lit.style.opacity = visible ? '1' : '0'
  }

  /** The crafted background: shown or not, and its pre-lit copy faded in or out. */
  #setArt(elements: SlotElements, shown: boolean, lit: boolean): void {
    const { artRest, artLit } = elements
    if (!artRest || !artLit) return
    if (shown) {
      artRest.removeAttribute('display')
      artLit.removeAttribute('display')
    } else {
      artRest.setAttribute('display', 'none')
      artLit.setAttribute('display', 'none')
    }
    artLit.style.opacity = shown && lit ? '1' : '0'
  }

  #setRim(elements: SlotElements, stroke: string, width: number, opacity: number, dash: string | null): void {
    elements.rim.setAttribute('stroke', stroke)
    elements.rim.setAttribute('stroke-width', String(width))
    elements.rim.setAttribute('stroke-opacity', String(opacity))
    if (dash) elements.rim.setAttribute('stroke-dasharray', dash)
    else elements.rim.removeAttribute('stroke-dasharray')
  }

  /** Take the ring off screen. The built subtree stays in memory. */
  clear(): void {
    this.#active?.svg.remove()
    this.#active = null
    this.#activeName = null
    this.#highlight = null
    this.#backDirection = null
    this.#cancelArmed = false
    this.#override = false
    if (this.#host) this.#host.style.display = 'none'
  }
}
