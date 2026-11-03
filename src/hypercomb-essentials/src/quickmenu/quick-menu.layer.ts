// quickmenu/quick-menu.layer.ts
//
// The quick menu drawn in the hive's render layer, around one tile.
//
// The DOM ring (quick-menu.overlay.ts) still covers website, tree, slides —
// surfaces that are not the hex canvas. On a tile the menu is ordinary scene
// geometry: it pans and zooms with the hive, the cursor stays visible, and
// you point at an option. Nothing here hides the pointer or takes a lock.

import { EffectBus } from '@hypercomb/core'
import { Container, Graphics, Point, Text, TextStyle, type Application } from 'pixi.js'
import { containerScreenScale, screenTextResolution } from '../presentation/grid/screen-text-resolution.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { drawsAsGlyph } from '../commands/material-glyph.js'
import { drawHoney } from './quick-menu.honey-graphics.js'
import { backIcon, HONEY, LAYOUT, ringSeed, slotIndexOf } from './quick-menu.honey.js'
import { currentOperands, operandNote } from './quick-menu.operands.js'
import {
  cellUnit,
  menuMetrics,
  onMiddle,
  slotUnder,
  type MenuMetrics,
} from './quick-menu.tile-menu.js'
import {
  HEX_RADIUS,
  QUICK_MENU_RING,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
  type QuickMenuSlot,
} from './quick-menu.types.js'

/** How much the rest of the hive is veiled while the flower is up. */
const VEIL_ALPHA = 0.5
const VEIL_EXTENT = 100000
/** The middle blinks at this rate while the options sleep after a way back. */
const CUE_PULSE_MS = 420
/** Coming back to the middle wakes the options one after another, this far apart. */
const CUE_SWEEP_MS = 55

/** Read at every cue, never cached: the preference can change while the flower is up. */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

type LabelOf =(slot: { label: string; labelKey?: string }) => string

type PendingMenu = {
  definition: QuickMenuDefinition
  labelOf: LabelOf
  back: QuickMenuDirection | null
  backLabel: string
}

/** One tile of the flower, in the hive's own axial cells (`render:flower`). */
export type FlowerCell = {
  q: number
  r: number
  label: string
  /** This is the tile being worked on, wearing its own look. */
  subject?: boolean
  lit?: boolean
  /** Worn beside the name: how many other tiles the verbs here will reach. */
  note?: string
  /** A Material Symbols glyph worn in place of the name. On an option of the
   *  quick menu (`honey`) it is worn above the name, which stays. */
  icon?: string
  /** An option of the quick menu: the hive pours it in honey (hex-sdf, aShapeMode
   *  3..7) instead of the page's own tile. Never the subject. */
  honey?: boolean
  /** The way back, in crystallised honey. */
  back?: boolean
}

type SlotView = {
  readonly direction: QuickMenuDirection
  readonly hex: Graphics
  readonly text: Text
  readonly back: boolean
  /** The slot's honey seed: the same slot looks the same on every open. */
  readonly seed: number
}

type HostReady = {
  container?: Container
  canvas?: HTMLCanvasElement
  renderer?: Application['renderer']
}

export function axialToPixel(q: number, r: number, spacing: number, flat: boolean): { x: number; y: number } {
  return flat
    ? { x: 1.5 * spacing * q, y: Math.sqrt(3) * spacing * (r + q / 2) }
    : { x: Math.sqrt(3) * spacing * (q + r / 2), y: spacing * 1.5 * r }
}

function pixelToAxial(x: number, y: number, spacing: number, flat: boolean): { q: number; r: number } {
  if (flat) {
    const q = x / (1.5 * spacing)
    return { q: Math.round(q), r: Math.round(y / (Math.sqrt(3) * spacing) - q / 2) }
  }
  const r = y / (1.5 * spacing)
  return { q: Math.round(x / (Math.sqrt(3) * spacing) - r / 2), r: Math.round(r) }
}

export class QuickMenuLayer {
  #root: Container | null = null
  #render: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: Application['renderer'] | null = null
  #offset = { x: 0, y: 0 }
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #flat = false
  #at: { q: number; r: number } | null = null
  #local: { x: number; y: number } | null = null
  #veil: Graphics | null = null
  /** The tile a flight's flower is about; null for the ring drawn in place. */
  #subject: string | null = null
  /** The flight has landed: the hive itself draws the flower (`render:flower`). */
  #bloomed = false
  #slots = new Map<QuickMenuDirection, SlotView>()
  #byDirection = new Map<QuickMenuDirection, QuickMenuSlot>()
  #showing = false
  #lit: QuickMenuDirection | null = null
  /** The last show(), kept so a host that arrives afterwards can still draw. */
  #pending: PendingMenu | null = null
  /** The sleeping cue: the middle cell blinks lit until the pointer returns. */
  #cueCentre = false
  /** The waking cue: the option the sweep has reached. */
  #cueSweep: QuickMenuDirection | null = null
  #cueTimer: ReturnType<typeof setInterval> | null = null
  /** The options sleep after a way back, until the pointer returns to the middle
   *  (with or without a timer: reduced motion cues without one). */
  #asleep = false

  constructor() {
    EffectBus.on<HostReady>('render:host-ready', (payload) => {
      if (!payload?.container) return
      this.#render = payload.container
      this.#canvas = payload.canvas ?? null
      this.#renderer = payload.renderer ?? null
      this.#ensureRoot()
      if (this.#showing) this.#paintSlots()
    })
    EffectBus.on<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      if (!offset) return
      this.#offset = offset
      this.#place()
    })
    EffectBus.on<HexGeometry>('render:geometry-changed', (geo) => {
      if (!geo?.circumRadiusPx) return
      this.#geo = geo
      if (this.#showing) this.#paintSlots()
      else this.#place()
    })
    EffectBus.on<{ flat: boolean }>('render:set-orientation', (payload) => {
      this.#flat = !!payload?.flat
      if (this.#showing) this.#paintSlots()
      else this.#place()
    })
  }

  get showing(): boolean {
    return this.#showing
  }

  place(q: number, r: number): void {
    this.#at = { q, r }
    this.#local = null
    this.#place()
  }

  /** Centre the menu on a point in the render container's own space — the
   *  place a chosen pathway sits, which is no tile's axial cell. */
  placeLocal(x: number, y: number): void {
    this.#local = { x, y }
    this.#place()
  }

  /** Fade the rest of the hive back (or restore it). The hex mesh's shader has
   *  no global alpha, so the fade is a veil in the page's own background colour
   *  laid between the hive and the flower. */
  dim(on: boolean): void {
    if (!on || !this.#render) {
      if (this.#veil) this.#veil.visible = false
      return
    }
    if (!this.#veil) {
      const veil = new Graphics()
      veil.eventMode = 'none'
      veil.zIndex = 10040
      this.#veil = veil
    }
    const veil = this.#veil
    if (veil.parent !== this.#render) this.#render.addChild(veil)
    this.#render.sortableChildren = true
    const colour = getComputedStyle(document.body).backgroundColor
    const rgb = colour.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number)
    const hex = rgb && rgb.length === 3 ? (rgb[0] << 16) | (rgb[1] << 8) | rgb[2] : 0xffffff
    veil.clear()
    veil.rect(-VEIL_EXTENT, -VEIL_EXTENT, VEIL_EXTENT * 2, VEIL_EXTENT * 2)
    veil.fill({ color: hex, alpha: VEIL_ALPHA })
    veil.visible = true
  }

  /** The tile a flight is about. A flower is held back until it blooms. */
  setSubject(label: string | null): void {
    this.#subject = label
  }

  /** The flight has landed. From here the options are hive tiles in hive cells,
   *  drawn by the hive's own renderer, and this layer only says which. */
  bloom(): void {
    this.#bloomed = true
    this.#paintSlots()
  }

  #paintFlower(pending: PendingMenu): void {
    const at = this.centreLocal()
    if (!at) return
    const cellAt = (x: number, y: number) =>
      pixelToAxial(x - this.#offset.x, y - this.#offset.y, this.#geo.spacing, this.#flat)
    const cells: FlowerCell[] = []
    // The tile wears how many it speaks for, so a verb on the ring never
    // reads as acting on this tile alone when it will reach the rest of the set.
    if (this.#subject) {
      const note = operandNote(this.#subject, currentOperands(this.#subject))
      cells.push({ ...cellAt(at.x, at.y), label: this.#subject, subject: true, lit: this.#cueCentre, ...(note ? { note } : {}) })
    }
    const { reach, flat } = this.#metrics()
    for (const direction of QUICK_MENU_RING) {
      const slot = this.#byDirection.get(direction)
      const isBack = direction === pending.back
      if (!slot && !isBack) continue
      const unit = cellUnit(direction, flat)
      // The glyph is worn only when the icon font draws it as one: a name it
      // cannot ligate would be spelled out across the tile. Without it the word
      // stands alone.
      const icon = isBack ? backIcon : slot?.icon
      cells.push({
        ...cellAt(at.x + unit.x * reach, at.y + unit.y * reach),
        label: isBack ? pending.backLabel : pending.labelOf(slot!),
        lit: direction === (this.#lit ?? this.#cueSweep),
        honey: true,
        ...(isBack ? { back: true } : {}),
        ...(icon && drawsAsGlyph(icon) === true ? { icon } : {}),
      })
    }
    EffectBus.emit('render:flower', { cells })
  }

  // ── the way back, shown ─────────────────────────────────────────────

  /** Right-click took the flower back a ring and the options sleep: the middle
   *  blinks, asking for the pointer. */
  disarm(): void {
    this.#stopCue()
    this.#asleep = true
    this.#cueCentre = true
    this.#repaintFlower()
    // Lit swaps the whole body ramp (about 2.7x luminance), so a blink is a
    // flash: with reduced motion the middle simply stays lit until the pointer
    // returns.
    if (prefersReducedMotion()) return
    this.#cueTimer = setInterval(() => {
      this.#cueCentre = !this.#cueCentre
      this.#repaintFlower()
    }, CUE_PULSE_MS)
  }

  /** The pointer is back in the middle: the blink stops and the options wake
   *  in turn round the ring. */
  rearm(): void {
    if (!this.#asleep) return
    this.#stopCue()
    // No wake sweep under reduced motion: the options are simply awake.
    if (prefersReducedMotion()) { this.#repaintFlower(); return }
    const pending = this.#pending
    const ring = QUICK_MENU_RING.filter(d => this.#byDirection.has(d) || d === pending?.back)
    let next = 0
    this.#cueTimer = setInterval(() => {
      if (next >= ring.length) { this.#stopCue(); this.#repaintFlower(); return }
      this.#cueSweep = ring[next++]
      this.#repaintFlower()
    }, CUE_SWEEP_MS)
    this.#repaintFlower()
  }

  #stopCue(): void {
    if (this.#cueTimer !== null) clearInterval(this.#cueTimer)
    this.#cueTimer = null
    this.#asleep = false
    this.#cueCentre = false
    this.#cueSweep = null
  }

  #repaintFlower(): void {
    if (this.#bloomed && this.#pending) this.#paintFlower(this.#pending)
  }

  /** A point in the render container's space, in client coordinates. */
  clientAtLocal(x: number, y: number): { x: number; y: number } | null {
    if (!this.#render || !this.#canvas || !this.#renderer) return null
    const global = this.#render.toGlobal(new Point(x, y))
    const rect = this.#canvas.getBoundingClientRect()
    const screen = this.#renderer.screen
    return {
      x: rect.left + global.x * (rect.width / screen.width),
      y: rect.top + global.y * (rect.height / screen.height),
    }
  }

  /** Where the menu is centred, in the render container's space. */
  centreLocal(): { x: number; y: number } | null {
    return this.#root ? { x: this.#root.position.x, y: this.#root.position.y } : null
  }

  /** Where one option sits, in the render container's space. */
  slotLocal(direction: QuickMenuDirection): { x: number; y: number } | null {
    const at = this.centreLocal()
    if (!at) return null
    const { reach, flat } = this.#metrics()
    const unit = cellUnit(direction, flat)
    return { x: at.x + unit.x * reach, y: at.y + unit.y * reach }
  }

  /** The menu's size in the render container's space. */
  get metrics(): MenuMetrics {
    return this.#metrics()
  }

  show(
    definition: QuickMenuDefinition,
    labelOf: LabelOf,
    back: QuickMenuDirection | null,
    backLabel: string,
  ): void {
    this.#showing = true
    this.#lit = null
    this.#stopCue()
    this.#pending = { definition, labelOf, back, backLabel }
    this.#byDirection = slotsByDirection(definition)
    this.#ensureRoot()
    this.#paintSlots()
  }

  /** Draw the remembered menu. A show() that beat the hive host waits here
   *  until the container exists; a geometry or orientation change redraws. */
  #paintSlots(): void {
    const pending = this.#pending
    const root = this.#root
    if (!this.#showing || !pending || !root) return
    this.#clearRoot(root)
    if (this.#subject !== null) {
      // A flight: nothing is drawn here. Until it lands the real tile flies in
      // on its own; once it has, the hive draws the flower.
      root.visible = false
      this.#place()
      if (this.#bloomed) this.#paintFlower(pending)
      return
    }
    root.visible = true

    const metrics = this.#metrics()
    const font = this.#font(metrics.radius)
    const lit = this.#lit
    // The six directions are the options. The tile already occupies the centre,
    // so the centre slot is not drawn on top of it.
    for (const direction of QUICK_MENU_RING) {
      const slot = this.#byDirection.get(direction)
      const isBack = direction === pending.back
      // The way back is drawn even when the ring has no verb there.
      if (!slot && !isBack) continue
      const word = isBack ? pending.backLabel : pending.labelOf(slot!)
      const unit = cellUnit(direction, metrics.flat)
      const seed = ringSeed(slotIndexOf(direction), pending.definition.name)
      const hex = new Graphics()
      const text = new Text({
        text: word,
        style: font,
        resolution: this.#textResolution(),
        roundPixels: true,
      })
      text.anchor.set(0.5)
      // The word alone (no glyph here), set to the width the ring gives a bare word.
      const max = (metrics.radius * LAYOUT.usableText) / HEX_RADIUS
      if (text.width > max && text.width > 0) text.scale.set(max / text.width)
      text.position.set(unit.x * metrics.reach, unit.y * metrics.reach)
      hex.position.set(text.position.x, text.position.y)
      root.addChild(hex)
      root.addChild(text)
      this.#slots.set(direction, { direction, hex, text, back: isBack, seed })
      this.#style(direction, direction === lit)
    }
    this.#place()
  }

  highlight(direction: QuickMenuDirection | null): void {
    if (this.#lit === direction) return
    const previous = this.#lit
    this.#lit = direction
    if (previous) this.#style(previous, false)
    if (direction) this.#style(direction, true)
    if (this.#bloomed && this.#pending) this.#paintFlower(this.#pending)
  }

  hide(): void {
    this.#showing = false
    this.#lit = null
    this.#stopCue()
    this.#pending = null
    this.#local = null
    this.#subject = null
    if (this.#bloomed) EffectBus.emit('render:flower', { cells: null })
    this.#bloomed = false
    this.dim(false)
    if (this.#root) {
      this.#clearRoot(this.#root)
      this.#root.visible = false
    }
  }

  /** Take every slot off the root AND free it: a Graphics keeps its draw data
   *  (now a whole body, lip and drips) until it is destroyed, so merely removing
   *  it would orphan seven of them on every redraw. */
  #clearRoot(root: Container): void {
    for (const child of root.removeChildren()) child.destroy({ children: true })
    this.#slots.clear()
  }

  slotFor(direction: QuickMenuDirection): QuickMenuSlot | undefined {
    return this.#byDirection.get(direction)
  }

  /** The slot under a viewport point, or null when the menu is down or the
   *  point misses every option. */
  slotAtClient(clientX: number, clientY: number, mode: 'gesture' | 'pick'): QuickMenuDirection | null {
    if (!this.#showing || !this.#root || !this.#render) return null
    const here = this.#world(clientX, clientY)
    if (!here) return null
    return slotUnder(here.x - this.#root.position.x, here.y - this.#root.position.y, this.#metrics(), mode)
  }

  /** Is a viewport point on the middle cell of the menu now showing? */
  onMiddleAtClient(clientX: number, clientY: number): boolean {
    if (!this.#showing || !this.#root || !this.#render) return false
    const here = this.#world(clientX, clientY)
    if (!here) return false
    return onMiddle(here.x - this.#root.position.x, here.y - this.#root.position.y, this.#metrics())
  }

  #metrics(): MenuMetrics {
    return menuMetrics(this.#geo.circumRadiusPx, this.#geo.spacing, this.#flat)
  }

  #ensureRoot(): void {
    if (this.#root || !this.#render) return
    const root = new Container()
    root.eventMode = 'none'
    root.visible = false
    root.zIndex = 10050
    this.#render.sortableChildren = true
    this.#render.addChild(root)
    this.#root = root
  }

  #place(): void {
    const root = this.#root
    const at = this.#at
    if (root && this.#local) { root.position.set(this.#local.x, this.#local.y); return }
    if (!root || !at) return
    const px = axialToPixel(at.q, at.r, this.#geo.spacing, this.#flat)
    root.position.set(px.x + this.#offset.x, px.y + this.#offset.y)
  }

  /** A slot in honey (quick-menu.honey-graphics.ts), and its word in the ink
   *  the state calls for: cream at rest, near-black on bright lit honey, a
   *  dimmer cream on the crystallised way back. */
  #style(direction: QuickMenuDirection, on: boolean): void {
    const view = this.#slots.get(direction)
    if (!view) return
    drawHoney(view.hex, this.#metrics().radius, this.#flat, { lit: on, back: view.back }, view.seed)
    view.text.style.fill = view.back ? HONEY.ink.back : on ? HONEY.ink.lit : HONEY.ink.rest
  }

  /** The word alone, as the ring sets a bare word: 13 px at R = 46, weight 400
   *  (the default face fakes anything bolder). */
  #font(radius: number): TextStyle {
    const family = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()
      : ''
    return new TextStyle({
      fontFamily: family || 'system-ui, sans-serif',
      fontSize: Math.max(8, Math.round((radius * LAYOUT.textOnly.labelSize) / HEX_RADIUS)),
      fontWeight: '400',
      fill: HONEY.ink.rest,
      align: 'center',
    })
  }

  #textResolution(): number {
    const renderer = this.#renderer as { resolution?: number } | null
    return screenTextResolution(containerScreenScale(this.#root), renderer?.resolution)
  }

  #world(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!this.#render || !this.#canvas || !this.#renderer) return null
    const events = (this.#renderer as unknown as {
      events?: { mapPositionToPoint?: (out: Point, x: number, y: number) => void }
    }).events
    const global = new Point()
    if (events?.mapPositionToPoint) events.mapPositionToPoint(global, clientX, clientY)
    else {
      const rect = this.#canvas.getBoundingClientRect()
      const screen = this.#renderer.screen
      global.x = (clientX - rect.left) * (screen.width / rect.width)
      global.y = (clientY - rect.top) * (screen.height / rect.height)
    }
    return this.#render.toLocal(global)
  }
}
