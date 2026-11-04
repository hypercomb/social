// quickmenu/quick-menu.layer.ts
//
// The quick menu drawn in the hive's render layer, around one tile.
//
// The DOM ring (quick-menu.overlay.ts) still covers website, tree, slides —
// surfaces that are not the hex canvas. On a tile the menu is ordinary scene
// geometry: it pans and zooms with the hive, the cursor stays visible, and
// you point at an option. Nothing here hides the pointer or takes a lock.

import { EffectBus } from '@hypercomb/core'
import { Container, Graphics, GraphicsPath, Point, Text, TextStyle, type Application, type Sprite, type Texture } from 'pixi.js'
import { containerScreenScale, screenTextResolution } from '../presentation/grid/screen-text-resolution.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { drawsAsGlyph } from '../commands/material-glyph.js'
import {
  drawHexMask,
  drawHoney,
  drawHoneyRim,
  drawSheenBand,
  drawSheenZone,
  honeyArtFrames,
  honeyArtSprite,
} from './quick-menu.honey-graphics.js'
import {
  backgroundFor,
  backIcon,
  bloomPose,
  BLOOM,
  driftPose,
  HONEY,
  LAYOUT,
  motionFor,
  ringSeed,
  SHEEN,
  sheenAlpha,
  sheenOffset,
  sheenZones,
  slotGlyph,
  slotIndexOf,
  type TileMotion,
} from './quick-menu.honey.js'
import { HONEY_ART_EFFECT, HONEY_ART_TILE, warmHoneyArt, type HoneyArt } from './quick-menu.honey-art.js'
import { HONEY_BACKGROUNDS } from './quick-menu.backgrounds.js'
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

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A glyph's path data parsed once, holes kept (the ring's drawings are outlines). */
const glyphPaths = new Map<string, GraphicsPath>()
function glyphPath(d: string): GraphicsPath {
  let path = glyphPaths.get(d)
  if (!path) glyphPaths.set(d, path = new GraphicsPath(d, true))
  return path
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
  /** Which crafted background an option wears, 0..9 (backgroundFor): never
   *  the same twice in one flower. Absent on the way back and the subject. */
  art?: number
}

type SlotView = {
  readonly direction: QuickMenuDirection
  /** The whole tile, centred on the slot: what the bloom scales and fades. */
  readonly node: Container
  /** The honey, or with a crafted background only its rim and lit halo. */
  readonly hex: Graphics
  readonly text: Text
  /** The slot's icon above its word, in the word's ink, when the ring draws one. */
  readonly icon: Graphics | null
  readonly back: boolean
  /** The slot's honey seed: the same slot looks the same on every open. */
  readonly seed: number
  /** slotIndexOf(direction): the bloom's and the light's place in the order. */
  readonly index: number
  /** The crafted background and its two frames, when the slot wears one, with
   *  its slow camera and the light that crosses it. */
  readonly art: {
    readonly sprite: Sprite
    readonly rest: Texture
    readonly lit: Texture
    /** The sprite's scale and turn at rest (the drift multiplies the one and follows the other). */
    readonly base: number
    readonly turn: number
    readonly motion: TileMotion
    readonly sheen: Container
    readonly bands: readonly { readonly band: Graphics; readonly share: number }[]
  } | null
}

/** The band of light runs top-left to bottom-right on screen. */
const SHEEN_DIR = { x: Math.cos((SHEEN.angleDeg * Math.PI) / 180), y: Math.sin((SHEEN.angleDeg * Math.PI) / 180) }

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
  /** The crafted backgrounds, once drawn (quick-menu.honey-art.ts). */
  #art: HoneyArt | null = null
  /** When the ring now showing appeared (performance.now()): the bloom, the
   *  drift and the light all run from here. Reset by show(), never by a redraw. */
  #motionStart = 0
  /** The ring's frame loop: a requestAnimationFrame chain that runs only while
   *  a ring is drawn in place, the tab is visible and motion is allowed. */
  #motionRaf = 0
  #visibilityWatched = false
  /** Reduced motion, read at every paint of the ring (not every frame): the
   *  tiles are simply there and the pictures still. */
  #still = false

  constructor() {
    EffectBus.on<HostReady>('render:host-ready', (payload) => {
      if (!payload?.container) return
      this.#render = payload.container
      this.#canvas = payload.canvas ?? null
      this.#renderer = payload.renderer ?? null
      this.#ensureRoot()
      // warm: the pictures are drawn once, now, never on a gesture
      void warmHoneyArt(HONEY_BACKGROUNDS)
      if (this.#showing) this.#paintSlots()
    })
    EffectBus.on<HoneyArt>(HONEY_ART_EFFECT, (art) => {
      if (!art || art === this.#art) return
      this.#art = art
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
        ...(isBack ? { back: true } : { art: backgroundFor(pending.definition.name, direction) }),
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
    // a new ring blooms; a redraw of the same one (geometry, the pictures arriving) does not
    this.#motionStart = now()
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
      this.#stopMotion()
      this.#place()
      if (this.#bloomed) this.#paintFlower(pending)
      return
    }
    root.visible = true

    const metrics = this.#metrics()
    const k = metrics.radius / HEX_RADIUS
    const font = this.#font(metrics.radius, LAYOUT.textOnly.labelSize)
    const iconFont = this.#font(metrics.radius, LAYOUT.ring.labelSize)
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
      const index = slotIndexOf(direction)
      const seed = ringSeed(index, pending.definition.name)
      // Each tile is one container on its slot, everything in it centred on
      // the origin: the bloom scales and fades the container, nothing else.
      const node = new Container()
      node.position.set(unit.x * metrics.reach, unit.y * metrics.reach)
      const hex = new Graphics()
      // The icon above the word, as the DOM ring wears it; a name the ring has
      // no drawing for leaves the word alone, centred.
      const glyph = slotGlyph(isBack ? backIcon : slot!.icon)
      const icon = glyph ? new Graphics().path(glyphPath(glyph)).fill(0xffffff) : null
      if (icon) {
        icon.scale.set(k * LAYOUT.ring.iconScale)
        icon.position.set(LAYOUT.ring.iconX * k, LAYOUT.ring.iconY * k)
      }
      // Each word its own style: the ink changes per tile when one is lit.
      const style = (icon ? iconFont : font).clone()
      const text = new Text({
        text: word,
        style,
        resolution: this.#textResolution(),
        roundPixels: true,
      })
      text.anchor.set(0.5)
      // LAYOUT's label y is a baseline; the anchor is the middle of the line.
      if (icon) text.position.set(0, (LAYOUT.ring.labelY - LAYOUT.ring.labelSize * 0.35) * k)
      const max = k * (icon ? LAYOUT.usableIcon : LAYOUT.usableText)
      if (text.width > max && text.width > 0) text.scale.set(max / text.width)
      const variation = backgroundFor(pending.definition.name, direction)
      const art = isBack ? null : this.#artFor(variation, index, metrics.radius, metrics.flat)
      if (art) {
        node.addChild(art.sprite)
        node.addChild(art.mask)
        node.addChild(art.sheen)
      }
      node.addChild(hex)
      if (icon) node.addChild(icon)
      node.addChild(text)
      root.addChild(node)
      this.#slots.set(direction, { direction, node, hex, text, icon, back: isBack, seed, index, art })
      this.#style(direction, direction === lit)
    }
    this.#place()
    this.#still = prefersReducedMotion()
    this.#pose(now())
    this.#runMotion()
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
    this.#stopMotion()
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
    if (view.art) {
      view.art.sprite.texture = on ? view.art.lit : view.art.rest
      // the light is a little stronger on the lit tile, and capped over the word
      for (const { band, share } of view.art.bands) band.alpha = sheenAlpha(share, on)
      drawHoneyRim(view.hex, this.#metrics().radius, this.#flat, on)
    } else {
      drawHoney(view.hex, this.#metrics().radius, this.#flat, { lit: on, back: view.back }, view.seed)
    }
    const ink = view.back ? HONEY.ink.back : on ? HONEY.ink.lit : HONEY.ink.rest
    view.text.style.fill = ink
    if (view.icon) view.icon.tint = ink
  }

  /** A crafted background as a Sprite masked to the hexagon, with its slow
   *  camera and the light that crosses it, or null while the pictures are not
   *  drawn (or this one failed): the slot is honey then. */
  #artFor(variation: number, slotIndex: number, radius: number, flat: boolean): (NonNullable<SlotView['art']> & { mask: Graphics }) | null {
    const frames = this.#art ? honeyArtFrames(this.#art) : null
    const rest = frames?.rest[variation]
    const lit = frames?.lit[variation]
    if (!rest || !lit) return null
    const sprite = honeyArtSprite(rest, radius, flat)
    const mask = new Graphics()
    drawHexMask(mask, radius, flat)
    sprite.mask = mask

    // The light: one band per region (capped over the word, feathered out to
    // the peak), each masked to its region; the regions tile the hexagon.
    // Drawn once; the frame loop only moves the bands.
    const sheen = new Container()
    sheen.visible = false
    const bands = sheenZones().map(zone => {
      const band = new Graphics()
      drawSheenBand(band, radius)
      band.rotation = (SHEEN.angleDeg * Math.PI) / 180
      const region = new Graphics()
      drawSheenZone(region, radius, flat, zone)
      band.mask = region
      band.alpha = sheenAlpha(zone.share, false)
      sheen.addChild(region)
      sheen.addChild(band)
      return { band, share: zone.share }
    })
    return {
      sprite, mask, rest, lit,
      base: (2 * radius) / HONEY_ART_TILE.height,
      turn: flat ? -Math.PI / 6 : 0,
      motion: motionFor(variation, slotIndex),
      sheen, bands,
    }
  }

  // ── ambient motion ──────────────────────────────────────────────────

  /** Every tile at time `at`: its bloom, its picture's drift, the light's place.
   *  Transforms and alphas on what was drawn at paint; nothing is redrawn. */
  #pose(at: number): void {
    const motion = !this.#still
    const elapsed = at - this.#motionStart
    const s = this.#metrics().radius / HEX_RADIUS
    for (const view of this.#slots.values()) {
      const bloom = motion ? bloomPose(elapsed, view.index) : { scale: 1, opacity: 1 }
      view.node.scale.set(bloom.scale)
      view.node.alpha = bloom.opacity
      const art = view.art
      if (!art) continue
      const drift = motion ? driftPose(elapsed / 1000, art.motion) : { scale: 1, dx: 0, dy: 0 }
      art.sprite.scale.set(art.base * drift.scale)
      // the drift is along the picture's own axes, so a turned picture turns it too
      const cos = Math.cos(art.turn), sin = Math.sin(art.turn)
      art.sprite.position.set((drift.dx * cos - drift.dy * sin) * s, (drift.dx * sin + drift.dy * cos) * s)
      const offset = motion ? sheenOffset(elapsed / 1000, view.index) : null
      art.sheen.visible = offset !== null
      if (offset !== null) {
        for (const { band } of art.bands) band.position.set(SHEEN_DIR.x * offset * s, SHEEN_DIR.y * offset * s)
      }
    }
  }

  /** Is there anything left to move? Pictures drift for as long as the ring is
   *  up; procedural honey only blooms. */
  #moving(at: number): boolean {
    if (!this.#showing || !this.#root?.visible || this.#still) return false
    for (const view of this.#slots.values()) if (view.art) return true
    return at - this.#motionStart < BLOOM.durationMs + BLOOM.staggerMs * 7
  }

  /** Run the frame loop while there is something to move and the tab is
   *  visible: a hidden tab holds the pose and restarts when shown. */
  #runMotion(): void {
    if (this.#motionRaf || typeof requestAnimationFrame !== 'function') return
    if (typeof document !== 'undefined' && document.hidden) { this.#watchVisibility(); return }
    if (!this.#moving(now())) return
    this.#watchVisibility()
    const tick = (): void => {
      this.#motionRaf = 0
      const at = now()
      this.#pose(at)
      if (!this.#moving(at) || (typeof document !== 'undefined' && document.hidden)) return
      this.#motionRaf = requestAnimationFrame(tick)
    }
    this.#motionRaf = requestAnimationFrame(tick)
  }

  #stopMotion(): void {
    if (this.#motionRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#motionRaf)
    this.#motionRaf = 0
    if (this.#visibilityWatched && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibility)
      this.#visibilityWatched = false
    }
  }

  #watchVisibility(): void {
    if (this.#visibilityWatched || typeof document === 'undefined') return
    document.addEventListener('visibilitychange', this.#onVisibility)
    this.#visibilityWatched = true
  }

  #onVisibility = (): void => {
    if (document.hidden) {
      if (this.#motionRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#motionRaf)
      this.#motionRaf = 0
      return
    }
    this.#runMotion()
  }

  /** A slot's word at `size` px at R = 46 (LAYOUT: 13 alone, 11.5 under an
   *  icon), weight 400 (the default face fakes anything bolder). */
  #font(radius: number, size: number): TextStyle {
    const family = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()
      : ''
    return new TextStyle({
      fontFamily: family || 'system-ui, sans-serif',
      fontSize: Math.max(8, Math.round((radius * size) / HEX_RADIUS)),
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
