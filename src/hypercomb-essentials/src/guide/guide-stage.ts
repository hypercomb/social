// guide/guide-stage.ts
//
// The middle of the screen while the guide is open. The camera flies the tile
// here the way a held alt does, the hive falls back behind the quick menu's
// veil, and the ideas are hive tiles in hive cells (`render:flower`). The
// camera is moved on the render container directly, never through
// ViewportPersistence, so the page's saved pan and zoom are the same after.

import { EffectBus } from '@hypercomb/core'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../presentation/grid/hex-geometry.js'
import { axialToPixel, QuickMenuLayer, type FlowerCell } from '../quickmenu/quick-menu.layer.js'
import { viewportIsFramed } from '../sequence/frame-lock.js'
import { ringCells, ringsFor, type Axial, type GuideFrame } from './guide-place.js'

/** On-screen distance between neighbouring tiles at most, in px. */
const TILE_PX = 92
/** Space kept clear round the rings, in px. */
const EDGE_MARGIN = 20
/** The board's own width plus its gap, kept free beside the rings. */
const BOARD_ROOM = 348
/** The free area stays clear of the line above and the bar below, in px. */
const FRAME_TOP = 72
const FRAME_BOTTOM = 64
const FRAME_SIDE = 20
/** How long the camera takes each way. */
const FLY_MS = 480
const HOME_MS = 420

type Pt = { x: number; y: number }
type Camera = { scale: number; x: number; y: number }

type Host = {
  app: { stage: { position: Pt; scale: { x: number } } }
  container: { position: Pt & { set(x: number, y: number): void }; scale: { x: number; set(s: number): void } }
  canvas: HTMLCanvasElement
  renderer: { screen: { width: number; height: number } }
}

const ease = (t: number): number => 1 - (1 - t) ** 3

export class GuideStage {
  readonly #layer = new QuickMenuLayer()
  #host: Host | null = null
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #offset: Pt = { x: 0, y: 0 }
  #flat = false
  #anim = 0
  #home: Camera | null = null
  #centre: Axial = { q: 0, r: 0 }
  #rings = 1

  constructor() {
    EffectBus.on<Partial<Host>>('render:host-ready', payload => {
      if (!payload?.app || !payload.container || !payload.canvas || !payload.renderer) return
      this.#host = payload as Host
    })
    EffectBus.on<Pt>('render:mesh-offset', offset => { if (offset) this.#offset = offset })
    EffectBus.on<HexGeometry>('render:geometry-changed', geo => { if (geo?.circumRadiusPx) this.#geo = geo })
    EffectBus.on<{ flat: boolean }>('render:set-orientation', payload => { this.#flat = !!payload?.flat })
  }

  /** A hive canvas, not a framed page. */
  get available(): boolean {
    return !!this.#host && !viewportIsFramed()
  }

  /** The space the board may use: the canvas, which already gives way to docked panels. */
  get free(): GuideFrame {
    const rect = this.#host?.canvas.getBoundingClientRect()
    if (!rect) return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    return {
      left: rect.left + FRAME_SIDE,
      top: rect.top + FRAME_TOP,
      right: rect.right - FRAME_SIDE,
      bottom: rect.bottom - FRAME_BOTTOM,
    }
  }

  /** The middle of the canvas, in client coordinates. */
  get middle(): Pt {
    const rect = this.#host?.canvas.getBoundingClientRect()
    if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }

  /** How far one tile reaches from its centre at the current camera, in client px. */
  get tileReach(): number {
    return this.#geo.spacing * this.#screenScale()
  }

  /** How far the whole of `rings` reaches sideways from the middle, in client px. */
  extent(rings: number): number {
    return this.#extentX(rings) * this.#screenScale()
  }

  /** Fly the tile at this cell to the middle, sized so its rings fit. */
  fly(cell: Axial, ideas: number, onFrame: () => void, done: () => void, ms = FLY_MS): void {
    const host = this.#host
    if (!host) { done(); return }
    this.#home ??= { scale: host.container.scale.x, x: host.container.position.x, y: host.container.position.y }
    this.#centre = cell
    this.#rings = Math.max(1, ringsFor(ideas))
    this.#layer.place(cell.q, cell.r)
    this.#tween(this.#framed(), ms, onFrame, done)
  }

  /** The window changed size: the tile stays in the middle. */
  settle(): void {
    if (!this.#home) return
    this.#tween(this.#framed(), 0, () => undefined, () => undefined)
  }

  /** The camera goes back to the exact pan and zoom it left. */
  home(onFrame: () => void, done: () => void, ms = HOME_MS): void {
    const home = this.#home
    if (!home) { done(); return }
    this.#tween(home, ms, onFrame, () => {
      this.#home = null
      done()
    })
  }

  dim(on: boolean): void {
    this.#layer.dim(on)
  }

  /** Paint the subject and these ideas in the cells round it. No ideas paints the subject alone. */
  paint(subject: string, ideas: readonly Pick<FlowerCell, 'label' | 'icon' | 'lit'>[]): void {
    const offsets = ringCells(ideas.length)
    const cells: FlowerCell[] = [{ ...this.#centre, label: subject, subject: true }]
    ideas.forEach((idea, index) => {
      const offset = offsets[index]
      if (offset) cells.push({ ...idea, q: this.#centre.q + offset.q, r: this.#centre.r + offset.r })
    })
    EffectBus.emit('render:flower', { cells })
  }

  clear(): void {
    EffectBus.emit('render:flower', { cells: null })
    this.#layer.dim(false)
  }

  /** Where each of `count` idea tiles is on screen, in client coordinates. */
  points(count: number): readonly Pt[] {
    return ringCells(count).map(offset => {
      const at = axialToPixel(this.#centre.q + offset.q, this.#centre.r + offset.r, this.#geo.spacing, this.#flat)
      return this.#layer.clientAtLocal(at.x + this.#offset.x, at.y + this.#offset.y) ?? { x: -1, y: -1 }
    })
  }

  /** Stop the flight where it is, for a window that is going away. */
  cancel(): void {
    cancelAnimationFrame(this.#anim)
    this.#anim = 0
  }

  #extentX(rings: number): number {
    const spacing = this.#geo.spacing
    return this.#flat
      ? 1.5 * spacing * rings + spacing
      : Math.sqrt(3) * spacing * (rings + 0.5)
  }

  #extentY(rings: number): number {
    const spacing = this.#geo.spacing
    return this.#flat
      ? Math.sqrt(3) * spacing * (rings + 0.5)
      : 1.5 * spacing * rings + spacing
  }

  #screenScale(): number {
    const host = this.#host
    if (!host) return 1
    return host.container.scale.x * (host.app.stage.scale.x || 1)
  }

  /** The tile in the middle, at the size that leaves its rings and the board on screen. */
  #framed(): Camera {
    const host = this.#host!
    const { width, height } = host.renderer.screen
    const stage = host.app.stage
    const ss = stage.scale.x || 1
    const wanted = TILE_PX / this.#geo.spacing
    const tall = (height / 2 - EDGE_MARGIN) / this.#extentY(this.#rings)
    const wide = (width / 2 - BOARD_ROOM) / this.#extentX(this.#rings)
    const scale = Math.min(wanted, tall, Math.max(wide, tall / 2)) / ss
    const at = axialToPixel(this.#centre.q, this.#centre.r, this.#geo.spacing, this.#flat)
    return {
      scale,
      x: (width / 2 - stage.position.x) / ss - scale * (at.x + this.#offset.x),
      y: (height / 2 - stage.position.y) / ss - scale * (at.y + this.#offset.y),
    }
  }

  #tween(to: Camera, ms: number, onFrame: () => void, done: () => void): void {
    const host = this.#host
    if (!host) { done(); return }
    cancelAnimationFrame(this.#anim)
    const from: Camera = { scale: host.container.scale.x, x: host.container.position.x, y: host.container.position.y }
    const start = performance.now()
    const step = (now: number): void => {
      const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms)
      const k = ease(t)
      host.container.scale.set(from.scale + (to.scale - from.scale) * k)
      host.container.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k)
      onFrame()
      if (t < 1) this.#anim = requestAnimationFrame(step)
      else { this.#anim = 0; done() }
    }
    if (ms <= 0) step(start)
    else this.#anim = requestAnimationFrame(step)
  }
}
