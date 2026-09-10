// presentation/tiles/tile-name.drone.ts
//
// THE NAMES ON THE HIVE ARE REAL TEXT. This layer draws every rendered tile's
// name as a DOM span over the canvas — the browser's own text engine lays it
// out from the font's outlines at the scale it is displayed, so a name is
// vector-sharp at rest, at 10× and at 0.3×, with the same hinting and
// antialiasing as any other text on the page. Nothing here is baked, cached
// or sampled; there is no atlas to wrap and no raster to outgrow.
//
// Jaime, 2026-09-09, on the SDF names: "aren't these supposed to be vector
// fonts?" — they were a distance-field raster of an 18px face, sampled at
// whatever the zoom was, and magnified letters rounded off at the raster's
// texel size. This is the answer.
//
// What stays in the shader: the band behind the name, its hover growth, the
// ruler, the crossfades. show-cell sets u_glyphs to 0 while this layer is
// mounted (tile-names:dom), so the SDF glyphs are simply not drawn; the atlas
// keeps baking for `labelPresent` (the band gate reads the UV rect) and for
// the launcher strips, which draw their own name and which this layer stands
// aside for (ShowCellDrone.shaderDrawsName).
//
// Placement mirrors the shader exactly: the name sits on the hex centre, moves
// up (u_bandRows − 1) rows while the hovered tile's band grows to hold the
// icons, rotates with pivot, hides with hideText (reappearing under the
// pointer), shows again in text-only mode, and disappears with the text
// toggle. Every one of those answers comes from ShowCellDrone so the two
// paths cannot disagree.
//
// The layer is ONE transformed element: the world div carries the render
// container's worldTransform as a CSS matrix (one style write per frame the
// camera moves), and each name is positioned once, in world units, at its
// tile. Names are laid out at LAYOUT_PX and scaled down to NAME_EM world px so
// no browser minimum-font-size ever bites; the browser rasterises through the
// whole transform chain, so the effective size is what gets painted. No
// will-change on purpose — Chrome pins a will-change layer's raster scale and
// the names would blur under zoom.

import { Drone } from '@hypercomb/core'
import type { Application, Container } from 'pixi.js'
import { DEFAULT_HEX_GEOMETRY, type HexGeometry } from '../grid/hex-geometry.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

type Axial = { q: number; r: number }
type CellCountPayload = { count: number; labels: string[]; coords: Axial[] }
type BandRowsPayload = { rows: number; label: string | null }
type HoverPayload = { label: string | null }
type ShowCellLike = {
  nameHidden(label: string): boolean
  displayNameFor(label: string): string
  shaderDrawsName(label: string): boolean
}

const SHOW_CELL_KEY = '@diamondcoreprocessor.com/ShowCellDrone'

/** CSS layout size of a name. Scaled down to NAME_EM; never painted at this size. */
const LAYOUT_PX = 40
/** Em of a name, in world px. ONE SIZE FOR EVERY NAME — a long name is never
 *  shrunk to fit. The SDF bake shrank any label wider than its cell, so
 *  "pheromone-workflow" rendered visibly smaller than "sea" and the hive read
 *  as several type sizes at once (Jaime, 2026-09-09: "we need a little bit
 *  more consistency with the height and the width of the font ... it just
 *  tries to fit to text"). A name too wide now WRAPS at this same size, so
 *  every glyph on the hive is the same glyph. */
const NAME_EM = 5.6
/** BIG HEAD MODE — the genesis screen's treatment on the tiles: the same face,
 *  uppercase, wide-tracked, and large enough to read across the room. */
const BIG_HEAD_EM = 7.5
const BIG_HEAD_TRACKING = 0.16
/** BIG HEAD IS A STICKY MODE — how the hive is being read, not a one-off act,
 *  so it outlives a reload. The slash behaviour writes this key; the names seed
 *  themselves from it before the first paint, so a reloaded hive comes up big
 *  without waiting for anyone to re-emit `render:big-head-mode`. */
const BIG_HEAD_KEY = 'hc:big-head'
const NAME_TRACKING = 0.04
/** A name is kept INSIDE its tile: it may run this many circumradii wide and
 *  is then cut with an ellipsis. A point-top hexagon is √3·R across its middle,
 *  where the band sits, so 1.55 uses nearly the whole tile and still leaves the
 *  border its margin. Cutting is the only lever left once size is fixed and
 *  wrapping is out — and a name must never spill onto its neighbour
 *  (Jaime, 2026-09-09: "the text can't go over the outside"). */
const MAX_WIDTH_R = 1.55
/** Half-height of one band row — the shader's `u_radiusPx * 0.15`. */
const ROW_H_R = 0.15
/** Runs after Pixi's own render (UPDATE_PRIORITY.LOW = −25) so the transform
 *  read is the one that was just drawn, never a frame behind. */
const TICK_PRIORITY = -26

// THE SPLASH'S FACE. The hive's first words — "CLICK TO ENTER" on the genesis
// screen — are set in the platform's monospace, and Jaime asked for the names
// to speak in the same voice (2026-09-09). Same stack as splash.js, so the
// tile names and that first screen resolve to the identical family on every
// platform. The splash's .42em tracking is a wordmark treatment, not a reading
// one — at tile size it would shred a name into loose letters, so the names
// take a modest track instead ("maybe not the extra wide spacing but the same
// text"). BIG HEAD MODE (see /big-head-mode) is the treatment worn whole:
// uppercase, wider track, and a much larger em.
const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
/** A monospace's regular IS its reading weight; 300 would synthesise on faces
 *  that have no light cut. --hc-tile-name-weight overrides. */
const NAME_WEIGHT = 400

const STYLE = `
.hc-tile-names{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;user-select:none;z-index:1}
.hc-tile-names-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}
.hc-tile-names span{position:absolute;left:0;top:0;white-space:nowrap;line-height:1;transform-origin:0 0;
  overflow:hidden;text-overflow:ellipsis;
  font-family:var(--hc-tile-name-font,${FONT_STACK});font-weight:var(--hc-tile-name-weight,${NAME_WEIGHT});
  font-size:${LAYOUT_PX}px;letter-spacing:${NAME_TRACKING}em;color:var(--hc-tile-name-color,#fff);
  text-align:center}
.hc-tile-names span[hidden]{display:none}
.hc-tile-names.hc-big-head span{letter-spacing:${BIG_HEAD_TRACKING}em;text-transform:uppercase}
`

export class TileNameDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Draws every tile name as real DOM text over the canvas — vector-sharp at any zoom — in the place the shader would have drawn it.'

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset', 'render:geometry-changed',
    'render:set-orientation', 'render:set-pivot', 'render:set-text-only', 'tile:toggle-text',
    'tile:hover', 'overlay:band-rows', 'render:big-head-mode',
  ]
  protected override emits: string[] = ['tile-names:dom']

  #initialized = false
  #app: Application | null = null
  #container: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #root: HTMLDivElement | null = null
  #world: HTMLDivElement | null = null
  #spans = new Map<string, HTMLSpanElement>()
  #cells = new Map<string, Axial>()
  #meshOffset = { x: 0, y: 0 }
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #flat = false
  #pivot = false
  #visible = true
  #hovered: string | null = null
  #bigHead = (() => { try { return localStorage.getItem(BIG_HEAD_KEY) === '1' } catch { return false } })()
  #band: BandRowsPayload = { rows: 1, label: null }
  #last = [NaN, NaN, NaN, NaN, NaN, NaN]
  #tick = (): void => this.#follow()
  #onResize = (): void => this.#fitRoot()

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<HostReadyPayload>('render:host-ready', (p) => this.#mount(p))
    this.onEffect<CellCountPayload>('render:cell-count', (p) => this.#setCells(p))
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (o) => { this.#meshOffset = o; this.#placeAll() })
    this.onEffect<HexGeometry>('render:geometry-changed', (geo) => { this.#geo = geo; this.#placeAll() })
    this.onEffect<{ flat: boolean }>('render:set-orientation', (p) => { this.#flat = p.flat; this.#placeAll() })
    this.onEffect<{ pivot: boolean }>('render:set-pivot', (p) => { this.#pivot = p.pivot; this.#placeAll() })
    this.onEffect('render:set-text-only', () => this.#refreshAll())
    this.onEffect('tile:toggle-text', () => { this.#visible = !this.#visible; if (this.#root) this.#root.hidden = !this.#visible })
    this.onEffect<HoverPayload>('tile:hover', (p) => { this.#hovered = p?.label ?? null; this.#refreshAll() })
    this.onEffect<BandRowsPayload>('overlay:band-rows', (p) => { this.#band = { rows: p?.rows ?? 1, label: p?.label ?? null }; this.#placeAll() })
    this.onEffect<{ on: boolean }>('render:big-head-mode', (p) => {
      this.#bigHead = !!p?.on
      this.#root?.classList.toggle('hc-big-head', this.#bigHead)
      this.#placeAll()
    })

    // Fallback metrics measure wrong until the face arrives; re-fit then.
    document.fonts?.load(`${NAME_WEIGHT} ${LAYOUT_PX}px 'Source Sans 3'`).then(() => this.#placeAll()).catch(() => { /* face optional */ })
  }

  protected override dispose(): void {
    this.#app?.ticker.remove(this.#tick)
    this.#app?.renderer.off?.('resize', this.#onResize)
    this.#root?.remove()
    this.#root = null
    this.#world = null
    this.#spans.clear()
    this.emitEffect('tile-names:dom', { on: false })
  }

  // ── mount ──────────────────────────────────────────────────────────

  #mount(p: HostReadyPayload): void {
    this.#app?.ticker.remove(this.#tick)
    this.#root?.remove()
    this.#app = p.app
    this.#container = p.container
    this.#canvas = p.canvas

    if (!document.querySelector('style[data-hc-tile-names]')) {
      const style = document.createElement('style')
      style.setAttribute('data-hc-tile-names', '')
      style.textContent = STYLE
      document.head.appendChild(style)
    }

    const root = document.createElement('div')
    root.className = this.#bigHead ? 'hc-tile-names hc-big-head' : 'hc-tile-names'
    root.hidden = !this.#visible
    const world = document.createElement('div')
    world.className = 'hc-tile-names-world'
    root.appendChild(world)
    const parent = p.canvas.parentElement ?? document.body
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    p.canvas.insertAdjacentElement('afterend', root)
    this.#root = root
    this.#world = world
    this.#spans.clear()
    this.#last = [NaN, NaN, NaN, NaN, NaN, NaN]
    this.#fitRoot()
    p.renderer.on?.('resize', this.#onResize)
    p.app.ticker.add(this.#tick, undefined, TICK_PRIORITY)

    for (const label of this.#cells.keys()) this.#spanFor(label)
    this.#placeAll()
    this.emitEffect('tile-names:dom', { on: true })
  }

  /** The root is the canvas's CSS box, so names past its edge clip exactly
   *  where the picture does. Screen px are CSS px (autoDensity). */
  #fitRoot(): void {
    if (!this.#root || !this.#canvas || !this.#app) return
    const screen = this.#app.renderer.screen
    this.#root.style.left = `${this.#canvas.offsetLeft}px`
    this.#root.style.top = `${this.#canvas.offsetTop}px`
    this.#root.style.width = `${screen.width}px`
    this.#root.style.height = `${screen.height}px`
  }

  /** One style write per frame the camera moved. */
  #follow(): void {
    if (!this.#world || !this.#container) return
    const m = this.#container.worldTransform
    const l = this.#last
    if (m.a === l[0] && m.b === l[1] && m.c === l[2] && m.d === l[3] && m.tx === l[4] && m.ty === l[5]) return
    this.#last = [m.a, m.b, m.c, m.d, m.tx, m.ty]
    this.#world.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.tx},${m.ty})`
  }

  // ── cells ──────────────────────────────────────────────────────────

  #setCells(p: CellCountPayload): void {
    const next = new Map<string, Axial>()
    const n = Math.min(p.labels?.length ?? 0, p.coords?.length ?? 0)
    for (let i = 0; i < n; i++) if (p.labels[i]) next.set(p.labels[i], p.coords[i])
    for (const [label, span] of this.#spans) {
      if (!next.has(label)) { span.remove(); this.#spans.delete(label) }
    }
    this.#cells = next
    if (!this.#world) return
    for (const label of next.keys()) this.#spanFor(label)
    this.#placeAll()
  }

  #spanFor(label: string): HTMLSpanElement | null {
    if (!this.#world) return null
    let span = this.#spans.get(label)
    if (!span) {
      span = document.createElement('span')
      this.#spans.set(label, span)
      this.#world.appendChild(span)
    }
    return span
  }

  #showCell(): ShowCellLike | null {
    return (window.ioc.get<ShowCellLike>(SHOW_CELL_KEY) as ShowCellLike | undefined) ?? null
  }

  /** Text, visibility and placement for every name — cheap, and the answers
   *  live in show-cell, so this is also the retitle / locale path (both repaint,
   *  and a repaint re-emits render:cell-count). */
  #placeAll(): void {
    const sc = this.#showCell()
    for (const [label, axial] of this.#cells) {
      const span = this.#spanFor(label)
      if (span) this.#place(span, label, axial, sc)
    }
  }

  #refreshAll(): void { this.#placeAll() }

  #place(span: HTMLSpanElement, label: string, axial: Axial, sc: ShowCellLike | null): void {
    const text = sc?.displayNameFor(label) ?? label
    if (span.textContent !== text) span.textContent = text

    const hidden = !!sc && (sc.shaderDrawsName(label) || (label !== this.#hovered && sc.nameHidden(label)))
    if (span.hidden !== hidden) span.hidden = hidden
    if (hidden) return

    const R = this.#geo.circumRadiusPx
    const px = this.#axialToPixel(axial.q, axial.r)
    const x = px.x + this.#meshOffset.x
    const rows = this.#band.label === label ? Math.max(1, this.#band.rows) : 1
    const y = px.y + this.#meshOffset.y - (rows - 1) * ROW_H_R * R

    // ONE SIZE, ONE LINE, ALWAYS. A name is never shrunk to fit and never
    // wrapped (Jaime, 2026-09-09: "no wrapping") — both are ways of letting the
    // tile decide how its name is set, and the whole point is that every name
    // on the hive wears the same alphabet. A name longer than its tile simply
    // runs wider; nothing about its letters changes.
    const em = this.#bigHead ? BIG_HEAD_EM : NAME_EM
    const scale = em / LAYOUT_PX
    // Cut, never spill. maxWidth is in the span's own layout units, so it is
    // the world bound divided back through the scale the span is drawn at.
    span.style.maxWidth = `${(MAX_WIDTH_R * R) / scale}px`
    const rotate = this.#pivot ? ' rotate(90deg)' : ''
    span.style.transform = `translate(${x}px,${y}px)${rotate} scale(${scale}) translate(-50%,-50%)`
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    const s = this.#geo.spacing
    return this.#flat
      ? { x: 1.5 * s * q, y: Math.sqrt(3) * s * (r + q / 2) }
      : { x: Math.sqrt(3) * s * (q + r / 2), y: s * 1.5 * r }
  }
}

const _tileNames = new TileNameDrone()
window.ioc.register('@diamondcoreprocessor.com/TileNameDrone', _tileNames)
