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
import {
  menuMetrics,
  slotUnder,
  type MenuMetrics,
} from './quick-menu.tile-menu.js'
import {
  DIRECTION_UNIT,
  QUICK_MENU_RING,
  slotsByDirection,
  type QuickMenuDefinition,
  type QuickMenuDirection,
  type QuickMenuSlot,
} from './quick-menu.types.js'

const FILL = 0x0b0f14
const STROKE = 0x7eb6d6
const TEXT_ON = '#d8e6ee'
const TEXT_OFF = '#8aa0ac'

type LabelOf = (slot: { label: string; labelKey?: string }) => string

type SlotView = {
  readonly direction: QuickMenuDirection
  readonly hex: Graphics | null
  readonly text: Text
  readonly back: boolean
}

type HostReady = {
  container?: Container
  canvas?: HTMLCanvasElement
  renderer?: Application['renderer']
}

function hexPoints(r: number, flat: boolean): number[] {
  const out: number[] = []
  const base = flat ? 0 : -Math.PI / 2
  for (let i = 0; i < 6; i++) {
    const a = base + (Math.PI / 3) * i
    out.push(Math.cos(a) * r, Math.sin(a) * r)
  }
  return out
}

function axialToPixel(q: number, r: number, spacing: number, flat: boolean): { x: number; y: number } {
  return flat
    ? { x: 1.5 * spacing * q, y: Math.sqrt(3) * spacing * (r + q / 2) }
    : { x: Math.sqrt(3) * spacing * (q + r / 2), y: spacing * 1.5 * r }
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
  #slots = new Map<QuickMenuDirection, SlotView>()
  #byDirection = new Map<QuickMenuDirection, QuickMenuSlot>()
  #showing = false
  #lit: QuickMenuDirection | null = null
  /** The last show(), kept so a host that arrives afterwards can still draw. */
  #pending: {
    definition: QuickMenuDefinition
    labelOf: LabelOf
    back: QuickMenuDirection | null
    backLabel: string
  } | null = null

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
    this.#place()
  }

  show(
    definition: QuickMenuDefinition,
    labelOf: LabelOf,
    back: QuickMenuDirection | null,
    backLabel: string,
  ): void {
    this.#showing = true
    this.#lit = null
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
    root.removeChildren()
    this.#slots.clear()
    root.visible = true

    const metrics = this.#metrics()
    const font = this.#font(metrics.radius)
    const lit = this.#lit
    // The six directions are the options. The tile already occupies the centre,
    // so the centre slot is not drawn on top of it.
    for (const direction of QUICK_MENU_RING) {
      const slot = this.#byDirection.get(direction)
      if (!slot) continue
      const isBack = direction === pending.back
      const word = isBack ? pending.backLabel : pending.labelOf(slot)
      const unit = DIRECTION_UNIT[direction]
      const hex = this.#hex(metrics.radius, false, isBack)
      const text = new Text({
        text: word,
        style: font,
        resolution: this.#textResolution(),
        roundPixels: true,
      })
      text.anchor.set(0.5)
      const max = metrics.radius * 1.75
      if (text.width > max && text.width > 0) text.scale.set(max / text.width)
      text.position.set(unit.x * metrics.reach, unit.y * metrics.reach)
      if (hex) {
        hex.position.set(text.position.x, text.position.y)
        root.addChild(hex)
      }
      root.addChild(text)
      this.#slots.set(direction, { direction, hex, text, back: isBack })
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
  }

  hide(): void {
    this.#showing = false
    this.#lit = null
    this.#pending = null
    if (this.#root) this.#root.visible = false
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

  #metrics(): MenuMetrics {
    return menuMetrics(this.#geo.circumRadiusPx)
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
    if (!root || !at) return
    const px = axialToPixel(at.q, at.r, this.#geo.spacing, this.#flat)
    root.position.set(px.x + this.#offset.x, px.y + this.#offset.y)
  }

  #hex(radius: number, on: boolean, back: boolean): Graphics {
    const g = new Graphics()
    this.#drawHex(g, radius, on, back)
    return g
  }

  #drawHex(g: Graphics, radius: number, on: boolean, back: boolean): void {
    const pts = hexPoints(radius, this.#flat)
    g.clear()
    g.poly(pts, true)
    g.fill({ color: FILL, alpha: on ? 0.94 : 0.88 })
    g.poly(pts, true)
    g.stroke({ color: STROKE, width: on ? 1.6 : 1, alpha: on ? 0.75 : back ? 0.28 : 0.4 })
  }

  #style(direction: QuickMenuDirection, on: boolean): void {
    const view = this.#slots.get(direction)
    if (!view) return
    if (view.hex) this.#drawHex(view.hex, this.#metrics().radius, on, view.back)
    view.text.style.fill = on ? TEXT_ON : view.back ? '#6e8794' : TEXT_OFF
  }

  #font(radius: number): TextStyle {
    const family = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--hc-font').trim()
      : ''
    return new TextStyle({
      fontFamily: family || 'system-ui, sans-serif',
      fontSize: Math.max(8, Math.round(radius * 0.46)),
      fontWeight: '600',
      fill: TEXT_OFF,
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
