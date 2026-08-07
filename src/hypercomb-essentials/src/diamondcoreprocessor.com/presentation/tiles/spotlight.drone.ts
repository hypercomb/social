// diamondcoreprocessor.com/presentation/tiles/spotlight.drone.ts
//
// SPOTLIGHT — "the thing you are looking for is HERE."
//
// A spotlight is a pointing finger, not a state: something (the agent panel,
// /spotlight, any behaviour) says `spotlight:show {targets}` and the named
// tiles glow on the current layer. The glow asks nothing and blocks nothing —
// it exists only to be found, so FINDING it is what puts it out: the moment
// the pointer passes over a lit tile (or it is tapped, on screens with no
// hover) that tile's light fades. Navigating anywhere else puts them all out
// — the cue was about a place, and you left.
//
// Deliberately NOT selection. Selection is participant intent, lives in the
// URL bracket, and drives actions; a spotlight is a hint someone else raised,
// carries no meaning beyond "look", and never outlives being seen.
//
// A target named before its layer has rendered is held, not dropped — the
// caller may navigate and show in the same breath, and the glow appears when
// `render:cell-count` delivers the labels.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import type { Axial } from '../../navigation/hex-detector.js'
import { type HexGeometry, DEFAULT_HEX_GEOMETRY } from '../grid/hex-geometry.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[] }

// ── look ────────────────────────────────────────────────────────
// Warm lamplight — distinct from selection green and leader amber.
const GLOW_COLOR            = 0xffd98c
const GLOW_FILL_ALPHA       = 0.10
const HALO_OFFSET           = 7
const HALO_ALPHA            = 0.14
const STROKE_WIDTH          = 2.0
const STROKE_MIN_ALPHA      = 0.40
const STROKE_MAX_ALPHA      = 0.95

// Faster breath than selection's 3s — this one is calling out.
const PULSE_PERIOD_MS       = 1600
const FADE_MS               = 400
const ANIM_FPS_CAP          = 30

export class SpotlightDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'glow a tile so it can be found; found is dismissed'

  #app: Application | null = null
  #renderContainer: Container | null = null
  #layer: Graphics | null = null

  #meshOffset = { x: 0, y: 0 }
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #flat = false

  #axialByLabel = new Map<string, Axial>()

  /** Lit tiles, by label. */
  #targets = new Set<string>()
  /** Dismissed tiles mid-fade: label → when the fade began. */
  #fading = new Map<string, number>()

  #tickerBound = false
  #lastFrameTime = 0

  #effectsRegistered = false

  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:cell-count',
    'render:set-orientation', 'render:geometry-changed',
    'spotlight:show', 'spotlight:clear', 'tile:hover', 'tile:click',
  ]

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#app = payload.app
      this.#renderContainer = payload.container
      this.#initLayer()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = offset
      this.#redraw()
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#axialByLabel.clear()
      for (let i = 0; i < payload.count; i++) {
        const label = payload.labels[i]
        const coord = payload.coords[i]
        if (label && coord) this.#axialByLabel.set(label, coord)
      }
      this.#redraw()
    })

    this.onEffect<{ flat: boolean }>('render:set-orientation', (payload) => {
      this.#flat = payload.flat
      this.#redraw()
    })

    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => {
      this.#geo = geo
      this.#redraw()
    })

    this.onEffect<{ targets?: string[] }>('spotlight:show', (payload) => {
      const targets = (payload?.targets ?? []).map(String).filter(Boolean)
      if (!targets.length) return
      for (const label of targets) {
        this.#targets.add(label)
        this.#fading.delete(label)
      }
      this.#startAnimation()
      this.#redraw()
    })

    this.onEffect('spotlight:clear', () => this.#clearAll())

    // Found. Hover is the desktop acknowledgment; click is the touch one —
    // on a phone nothing hovers, but the tap that opens the tile still says
    // "seen", and by then the light has done its job.
    this.onEffect<{ label?: string | null }>('tile:hover', (p) => this.#dismiss(p?.label))
    this.onEffect<{ label?: string | null }>('tile:click', (p) => this.#dismiss(p?.label))

    // Leaving the place puts the lights out — EXCEPT the navigation the show
    // itself rides on: callers navigate first, then emit, so by the time the
    // show arrives this clear has already run.
    window.addEventListener('navigate', this.#onNavigate)
    window.addEventListener('popstate', this.#onNavigate)
  }

  #onNavigate = (): void => this.#clearAll()

  protected override dispose(): void {
    window.removeEventListener('navigate', this.#onNavigate)
    window.removeEventListener('popstate', this.#onNavigate)
    this.#stopAnimation()
    if (this.#layer) {
      this.#layer.parent?.removeChild(this.#layer)
      this.#layer.destroy()
      this.#layer = null
    }
  }

  #dismiss(label: string | null | undefined): void {
    if (!label || !this.#targets.has(label)) return
    this.#targets.delete(label)
    this.#fading.set(label, performance.now())
    this.#redraw()
  }

  #clearAll(): void {
    if (!this.#targets.size && !this.#fading.size) return
    this.#targets.clear()
    this.#fading.clear()
    this.#stopAnimation()
    this.#layer?.clear()
  }

  // ── animation ─────────────────────────────────────────────────

  #startAnimation(): void {
    if (this.#tickerBound || !this.#app) return
    this.#tickerBound = true
    this.#lastFrameTime = 0
    this.#app.ticker.add(this.#onAnimTick)
  }

  #stopAnimation(): void {
    if (!this.#tickerBound || !this.#app) return
    this.#app.ticker.remove(this.#onAnimTick)
    this.#tickerBound = false
  }

  #onAnimTick = (): void => {
    if (!this.#targets.size && !this.#fading.size) { this.#stopAnimation(); return }
    const now = performance.now()
    if (now - this.#lastFrameTime < 1000 / ANIM_FPS_CAP) return
    this.#lastFrameTime = now
    this.#redraw()
  }

  // ── drawing ───────────────────────────────────────────────────

  #initLayer(): void {
    if (!this.#renderContainer || this.#layer) return
    this.#layer = new Graphics()
    this.#layer.zIndex = 5500
    this.#renderContainer.addChild(this.#layer)
    this.#renderContainer.sortableChildren = true
  }

  #redraw(): void {
    const layer = this.#layer
    if (!layer) return
    layer.clear()
    if (!this.#targets.size && !this.#fading.size) return

    const now = performance.now()
    const pulse01 = (Math.sin(((now % PULSE_PERIOD_MS) / PULSE_PERIOD_MS) * Math.PI * 2) + 1) / 2

    for (const label of this.#targets) {
      this.#drawGlow(label, pulse01, 1)
    }
    for (const [label, began] of this.#fading) {
      const t = (now - began) / FADE_MS
      if (t >= 1) { this.#fading.delete(label); continue }
      this.#drawGlow(label, pulse01, 1 - t)
    }
  }

  #drawGlow(label: string, pulse01: number, strength: number): void {
    const layer = this.#layer
    const coord = this.#axialByLabel.get(label)
    if (!layer || !coord) return

    const pos = this.#axialToPixel(coord.q, coord.r, this.#flat)
    const cx = pos.x + this.#meshOffset.x
    const cy = pos.y + this.#meshOffset.y
    const r = this.#geo.circumRadiusPx
    const angleOffset = this.#flat ? 0 : Math.PI / 6

    // outer halo
    layer.poly(this.#hexVerts(cx, cy, r + HALO_OFFSET, angleOffset), true)
    layer.fill({ color: GLOW_COLOR, alpha: HALO_ALPHA * strength })

    // soft fill
    const verts = this.#hexVerts(cx, cy, r, angleOffset)
    layer.poly(verts, true)
    layer.fill({ color: GLOW_COLOR, alpha: GLOW_FILL_ALPHA * strength })

    // breathing edge
    const strokeAlpha = STROKE_MIN_ALPHA + pulse01 * (STROKE_MAX_ALPHA - STROKE_MIN_ALPHA)
    layer.poly(verts, true)
    layer.stroke({ color: GLOW_COLOR, alpha: strokeAlpha * strength, width: STROKE_WIDTH })
  }

  #hexVerts(cx: number, cy: number, r: number, angleOffset: number): number[] {
    const verts: number[] = []
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + angleOffset
      verts.push(cx + r * Math.cos(angle), cy + r * Math.sin(angle))
    }
    return verts
  }

  #axialToPixel(q: number, r: number, flat = false) {
    return flat
      ? { x: 1.5 * this.#geo.spacing * q, y: Math.sqrt(3) * this.#geo.spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#geo.spacing * (q + r / 2), y: this.#geo.spacing * 1.5 * r }
  }
}

const _spotlight = new SpotlightDrone()
window.ioc.register('@diamondcoreprocessor.com/SpotlightDrone', _spotlight)
