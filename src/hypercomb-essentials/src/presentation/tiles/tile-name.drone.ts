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
import { TILE_STACK_DEPTHS, type TileStackDepths } from './tile-stack.js'

type Axial = { q: number; r: number }
type CellCountPayload = { count: number; labels: string[]; coords: Axial[] }
type BandRowsPayload = { rows: number; label: string | null }
type HoverPayload = { label: string | null }
/** What a dive's name needs (show-cell's DiveCell). */
type DiveNameCell = { q: number; r: number; label: string; hideText?: boolean }
type FlowerCell = Axial & { label: string; subject?: boolean; icon?: string; lit?: boolean; note?: string; honey?: boolean; back?: boolean }
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

/** THE HOLDER COUNT wears the beeswax tone the shader lines a held tile with
 *  (hex-sdf, vPresence), so the number and the wax read as one cue. */
const HOLDERS_INK = '#f7d180'

// THE QUICK MENU'S HONEY OPTIONS (hex-sdf honeyTile) set a glyph and a word apart
// on the tile, in the inks the shader wears: cream on rest honey, near-black on
// lit honey, a dimmer cream on the crystallised way back. Plain fill: no halo,
// outline or shadow on either (the hard rule of the SDF names holds here too).
const HONEY_INK = '#fff1cf'
const HONEY_INK_LIT = '#1a1003'
const HONEY_INK_BACK = '#e6d4a8'
const HONEY_TRACKING = 0.02
/** The tile's circumradius over the apothem the geometry reports as `circumRadiusPx`. */
const APOTHEM = 0.8660254
/** All lengths below are fractions of R, the tile's circumradius (the shader's
 *  keep-outs: the glyph owns |x| < 0.33 R above +0.09 R, the word |x| < 0.72 R
 *  from +0.17 R down, and the drips stay out of both). */
const HONEY_ICON_R = 0.52
const HONEY_ICON_Y_R = -0.20
const HONEY_LABEL_R = 0.25
const HONEY_LABEL_Y_R = 0.32
/** A word is set at HONEY_LABEL_R, or smaller to fit this width, never below the floor. */
const HONEY_LABEL_FIT_R = 1.41
const HONEY_LABEL_FLOOR_R = 0.196
/** A word with no glyph stands alone, as the ring sets it (13 px at R = 46, baseline
 *  +4.5, which is the middle of the tile) and may take the ring's wider 70 px. */
const HONEY_TEXT_ONLY_R = 13 / 46
const HONEY_TEXT_ONLY_Y_R = 0
const HONEY_TEXT_ONLY_FIT_R = 70 / 46
/** A glyph under this many screen px is dropped; the word stays. */
const HONEY_ICON_MIN_PX = 11

const STYLE = `
.hc-tile-names{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none;user-select:none;z-index:1}
.hc-tile-names-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}
.hc-tile-names-world>span{position:absolute;left:0;top:0;display:flex;align-items:baseline;justify-content:center;
  white-space:nowrap;line-height:1;transform-origin:0 0;
  font-family:var(--hc-tile-name-font,${FONT_STACK});font-weight:var(--hc-tile-name-weight,${NAME_WEIGHT});
  font-size:${LAYOUT_PX}px;letter-spacing:${NAME_TRACKING}em;color:var(--hc-tile-name-color,#fff)}
.hc-tile-names-world>span[hidden]{display:none}
.hc-tile-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.hc-tile-name-holders{flex:none;margin-left:.45em;font-size:.5em;letter-spacing:0;color:var(--hc-tile-name-holders-color,${HOLDERS_INK})}
.hc-tile-name-holders[hidden]{display:none}
.hc-tile-names.hc-big-head .hc-tile-names-world>span{letter-spacing:${BIG_HEAD_TRACKING}em;text-transform:uppercase}
.hc-tile-names.hc-diving .hc-tile-names-world>span:not(.hc-dive-name){display:none}
.hc-tile-names.hc-flower-up .hc-tile-names-world>span{opacity:.5}
.hc-tile-names.hc-flower-up .hc-tile-names-world>span.hc-flower-name{opacity:1}
.hc-flower-note{flex:none;margin-left:.45em;font-size:.6em;letter-spacing:0;color:var(--hc-accent,#d9a441)}
.hc-flower-icon{font-size:2.4em;line-height:1;opacity:.82}
.hc-flower-icon.lit{opacity:1;color:var(--hc-accent,#d9a441)}
.hc-tile-names-world>span.hc-flower-name.hc-honey{color:${HONEY_INK};letter-spacing:${HONEY_TRACKING}em;text-transform:none}
.hc-tile-names-world>span.hc-flower-name.hc-honey.lit{color:${HONEY_INK_LIT}}
.hc-tile-names-world>span.hc-flower-name.hc-honey.back{color:${HONEY_INK_BACK}}
.hc-tile-names-world>span.hc-flower-name.hc-honey .hc-flower-icon{font-size:1em;opacity:1;color:inherit}
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
    'tile:hover', 'overlay:band-rows', 'render:big-head-mode', 'render:name-visibility', 'render:set-hive-visible', 'render:dive', 'render:dive-painted', 'render:flower',
    TILE_STACK_DEPTHS, 'location:changed',
  ]
  protected override emits: string[] = ['tile-names:dom']

  #initialized = false
  /** Participant depth per label on this page — the holder count's source. */
  #depths: Readonly<Record<string, number>> = {}
  #app: Application | null = null
  #container: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #root: HTMLDivElement | null = null
  #world: HTMLDivElement | null = null
  #spans = new Map<string, HTMLSpanElement>()
  /** What each name's span was last placed with (#place) — its styles as set. */
  #placedAs = new WeakMap<HTMLSpanElement, string>()
  /** The quick menu's flower: its tiles' names, and the cells they cover. */
  #flower: FlowerCell[] = []
  #flowerSpans: HTMLSpanElement[] = []
  /** The honey options' glyphs among them: dropped when the tile is too small to hold one. */
  #flowerIcons: HTMLSpanElement[] = []
  /** Width of a word in em at the name face, by face and word (see #honeyLabelEm). */
  #wordEm = new Map<string, number>()
  #measure: CanvasRenderingContext2D | null | undefined
  #cells = new Map<string, Axial>()
  #meshOffset = { x: 0, y: 0 }
  #geo: HexGeometry = DEFAULT_HEX_GEOMETRY
  #flat = false
  #pivot = false
  #visible = true
  /** A takeover owns the surface (render:set-hive-visible { visible: false }). */
  #hiveHidden = false
  /** One name per tile of the dive on screen. */
  #diveSpans: HTMLSpanElement[] = []
  /** A wave dive is painted over this page (render:dive-painted, count > 0). */
  #diving = false
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
    // A live edit (the tile editor's preview) changed whether a name shows.
    this.onEffect('render:name-visibility', () => this.#refreshAll())
    // Image only states its mode (`{ imageOnly }`, image-only.queen.ts); a
    // bare emit still flips.
    this.onEffect<{ imageOnly?: boolean } | undefined>('tile:toggle-text', (p) => {
      this.#visible = p?.imageOnly == null ? !this.#visible : !p.imageOnly
      this.#syncRoot()
    })
    // A takeover (the images wall, the screensaver) hides the Pixi hive, but the
    // names are DOM text over the canvas and would be left floating on top of
    // whatever took the surface. They follow the hive: hidden with it, back with it.
    this.onEffect<{ visible: boolean }>('render:set-hive-visible', (p) => {
      this.#hiveHidden = !p?.visible
      this.#syncRoot()
    })
    // A dive paints other tiles in this page's slots with the page's mesh hidden.
    // The page's names would sit over pictures they do not belong to, so they
    // step aside and the dive's own names stand in the same layer.
    this.onEffect<{ cells?: readonly DiveNameCell[] | null }>('render:dive', (p) => this.#setDive(p?.cells ?? []))
    this.onEffect<{ count?: number }>('render:dive-painted', (p) => {
      this.#diving = (p?.count ?? 0) > 0
      this.#syncRoot()
    })
    this.onEffect<{ cells?: FlowerCell[] | null }>('render:flower', (p) => this.#setFlower(p?.cells ?? []))
    this.onEffect<HoverPayload>('tile:hover', (p) => { this.#hovered = p?.label ?? null; this.#refreshAll() })
    // Depths belong to a page: arriving somewhere else drops them, so a count
    // from the last page never lands on a same-named tile of this one.
    this.onEffect<TileStackDepths>(TILE_STACK_DEPTHS, (p) => { this.#depths = p?.depths ?? {}; this.#placeHovered() })
    this.onEffect('location:changed', () => { this.#depths = {}; this.#placeHovered() })
    this.onEffect<BandRowsPayload>('overlay:band-rows', (p) => { this.#band = { rows: p?.rows ?? 1, label: p?.label ?? null }; this.#placeAll() })
    this.onEffect<{ on: boolean }>('render:big-head-mode', (p) => {
      this.#bigHead = !!p?.on
      this.#root?.classList.toggle('hc-big-head', this.#bigHead)
      this.#placeAll()
    })

    // Fallback metrics measure wrong until the face arrives; re-fit then.
    document.fonts?.load(`${NAME_WEIGHT} ${LAYOUT_PX}px 'Source Sans 3'`).then(() => { this.#wordEm.clear(); this.#placeAll() }).catch(() => { /* face optional */ })
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
    root.hidden = !this.#visible || this.#hiveHidden
    root.classList.toggle('hc-diving', this.#diving)
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

  #syncRoot(): void {
    if (!this.#root) return
    this.#root.hidden = !this.#visible || this.#hiveHidden
    this.#root.classList.toggle('hc-diving', this.#diving)
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
    this.#fitFlowerIcons()
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

  /** The flower's tiles are tiles, so their names are names: the same text in
   *  the same place, over the cells they cover. The rest of the hive's names
   *  fall back with the rest of the hive. */
  #setFlower(cells: FlowerCell[]): void {
    // Read once, before any span is added or removed, so the style is clean: the
    // word measure below must not ask for it again after each appended span.
    const family = cells.some(c => c.honey && !c.subject) ? this.#nameFamily() : FONT_STACK
    this.#flower = cells
    for (const span of this.#flowerSpans) span.remove()
    this.#flowerSpans = []
    this.#flowerIcons = []
    this.#root?.classList.toggle('hc-flower-up', cells.length > 0)
    const sc = this.#showCell()
    for (const cell of cells) {
      if (cell.honey && !cell.subject) { this.#honeyName(cell, family); continue }
      // A name the tile keeps to itself stays unwritten, but the note says how
      // many tiles the menu speaks for and must always be read.
      const nameless = !!cell.subject && !!sc?.nameHidden(cell.label)
      if (nameless && !cell.note) continue
      const span = document.createElement('span')
      span.className = 'hc-flower-name'
      if (!nameless) {
        const name = document.createElement('span')
        name.className = 'hc-tile-name-text'
        name.textContent = cell.icon ?? (cell.subject ? sc?.displayNameFor(cell.label) ?? cell.label : cell.label)
        if (cell.icon) name.className = cell.lit ? 'hc-flower-icon mat-sym lit' : 'hc-flower-icon mat-sym'
        span.appendChild(name)
      }
      if (cell.note) {
        const note = document.createElement('span')
        note.className = 'hc-flower-note'
        note.textContent = cell.note
        span.appendChild(note)
      }
      const px = this.#axialToPixel(cell.q, cell.r)
      const at = this.#placement(px.x + this.#meshOffset.x, px.y + this.#meshOffset.y)
      span.style.maxWidth = at.maxWidth
      span.style.transform = at.transform
      this.#world?.appendChild(span)
      this.#flowerSpans.push(span)
    }
    this.#fitFlowerIcons()
    this.#placeAll()
  }

  /** A honey option: its glyph above its word, two things set apart, each sized
   *  to the tile — never one span, so the word stays when the glyph does not fit.
   *  R is the tile's true circumradius; the geometry's `circumRadiusPx` is the
   *  apothem. They are not rotated with the pivot: the honey is not. */
  #honeyName(cell: FlowerCell, family: string): void {
    const R = this.#geo.circumRadiusPx / APOTHEM
    const textOnly = !cell.icon
    const px = this.#axialToPixel(cell.q, cell.r)
    const x = px.x + this.#meshOffset.x
    const y = px.y + this.#meshOffset.y
    const className = `hc-flower-name hc-honey${cell.lit ? ' lit' : ''}${cell.back ? ' back' : ''}`
    const fitR = textOnly ? HONEY_TEXT_ONLY_FIT_R : HONEY_LABEL_FIT_R
    const set = (span: HTMLSpanElement, at: number, em: number): void => {
      // #placement bounds a span in the geometry's own radius, the apothem
      const placed = this.#placement(x, y + at * R, em, fitR / APOTHEM, false)
      span.className = className
      span.style.maxWidth = placed.maxWidth
      span.style.transform = placed.transform
      this.#world?.appendChild(span)
      this.#flowerSpans.push(span)
    }
    if (cell.icon) {
      const span = document.createElement('span')
      const glyph = document.createElement('span')
      glyph.className = 'hc-flower-icon mat-sym'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = cell.icon
      span.appendChild(glyph)
      set(span, HONEY_ICON_Y_R, HONEY_ICON_R * R)
      this.#flowerIcons.push(span)
    }
    if (cell.label) {
      const span = document.createElement('span')
      const word = document.createElement('span')
      word.className = 'hc-tile-name-text'
      word.textContent = cell.label
      span.appendChild(word)
      set(span, textOnly ? HONEY_TEXT_ONLY_Y_R : HONEY_LABEL_Y_R, this.#honeyLabelEm(cell.label, R, family, textOnly))
    }
  }

  /** The em a word is set in: its size, shrunk to fit the tile's width, never
   *  below the floor (past it the span's ellipsis takes over). Under a glyph the
   *  word is 0.25 R; alone it is the ring's text-only size. */
  #honeyLabelEm(text: string, R: number, family: string, textOnly: boolean): number {
    const size = textOnly ? HONEY_TEXT_ONLY_R : HONEY_LABEL_R
    const fitR = textOnly ? HONEY_TEXT_ONLY_FIT_R : HONEY_LABEL_FIT_R
    const fit = (fitR * R) / Math.max(this.#wordWidthEm(text, family), 1e-3)
    return Math.max(HONEY_LABEL_FLOOR_R * R, Math.min(size * R, fit))
  }

  /** The face the names are set in (the page's own variable, else the stack). */
  #nameFamily(): string {
    return this.#root ? getComputedStyle(this.#root).getPropertyValue('--hc-tile-name-font').trim() || FONT_STACK : FONT_STACK
  }

  /** A word's width in em, measured once per face and word on a canvas. */
  #wordWidthEm(text: string, family: string): number {
    const key = `${family}|${text}`
    let em = this.#wordEm.get(key)
    if (em === undefined) {
      if (this.#measure === undefined) this.#measure = document.createElement('canvas').getContext('2d')
      let width = text.length * 0.6 * LAYOUT_PX
      if (this.#measure) {
        this.#measure.font = `${NAME_WEIGHT} ${LAYOUT_PX}px ${family}`
        width = this.#measure.measureText(text).width
      }
      em = width / LAYOUT_PX + text.length * HONEY_TRACKING
      this.#wordEm.set(key, em)
    }
    return em
  }

  /** Drop a honey glyph that would be under HONEY_ICON_MIN_PX on screen, bring
   *  it back when the tile is larger. The word is never dropped. */
  #fitFlowerIcons(): void {
    if (this.#flowerIcons.length === 0) return
    const R = this.#geo.circumRadiusPx / APOTHEM
    const hidden = HONEY_ICON_R * R * (this.#container?.worldTransform.a ?? 1) < HONEY_ICON_MIN_PX
    for (const span of this.#flowerIcons) if (span.hidden !== hidden) span.hidden = hidden
  }

  /** A dive's tiles are tiles, so their names are names: the same text in the
   *  same place. Replaced whole on every paint; a page of a dive is small. */
  #setDive(cells: readonly DiveNameCell[]): void {
    for (const span of this.#diveSpans) span.remove()
    this.#diveSpans = []
    for (const cell of cells) {
      if (cell.hideText) continue
      const span = document.createElement('span')
      span.className = 'hc-dive-name'
      const name = document.createElement('span')
      name.className = 'hc-tile-name-text'
      name.textContent = cell.label
      span.appendChild(name)
      const px = this.#axialToPixel(cell.q, cell.r)
      const at = this.#placement(px.x + this.#meshOffset.x, px.y + this.#meshOffset.y)
      span.style.maxWidth = at.maxWidth
      span.style.transform = at.transform
      this.#world?.appendChild(span)
      this.#diveSpans.push(span)
    }
  }

  #spanFor(label: string): HTMLSpanElement | null {
    if (!this.#world) return null
    let span = this.#spans.get(label)
    if (!span) {
      span = document.createElement('span')
      const name = document.createElement('span')
      name.className = 'hc-tile-name-text'
      const holders = document.createElement('small')
      holders.className = 'hc-tile-name-holders'
      holders.hidden = true
      span.append(name, holders)
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

  /** Only the hovered name can carry a holder count, so a depth update
   *  repaints that one name and nothing else. */
  #placeHovered(): void {
    const label = this.#hovered
    if (label === null) return
    const axial = this.#cells.get(label)
    const span = this.#spans.get(label)
    if (axial && span) this.#place(span, label, axial, this.#showCell())
  }

  #place(span: HTMLSpanElement, label: string, axial: Axial, sc: ShowCellLike | null): void {
    const text = sc?.displayNameFor(label) ?? label
    const name = span.firstElementChild as HTMLElement
    if (name.textContent !== text) name.textContent = text

    // THE HOLDER COUNT — how many participants hold their own version of this
    // tile, you included. Under the pointer only, on one name only, small and
    // right after it: a number on every tile was noise (Jaime, 2026-09-10:
    // "Distraction is not good"). It sits inside the name's own width, so a
    // long name is cut a little sooner rather than the number spilling out.
    const holders = span.lastElementChild as HTMLElement
    const depth = label === this.#hovered ? (this.#depths[label] ?? 0) : 0
    const count = depth > 1 ? String(depth) : ''
    if (holders.textContent !== count) holders.textContent = count
    if (holders.hidden !== !count) holders.hidden = !count

    const covered = this.#flower.some(c => c.q === axial.q && c.r === axial.r)
    const hidden = covered || (!!sc && (sc.shaderDrawsName(label) || sc.nameHidden(label)))
    if (span.hidden !== hidden) span.hidden = hidden
    if (hidden) return

    const R = this.#geo.circumRadiusPx
    const px = this.#axialToPixel(axial.q, axial.r)
    const x = px.x + this.#meshOffset.x
    const rows = this.#band.label === label ? Math.max(1, this.#band.rows) : 1
    const y = px.y + this.#meshOffset.y - (rows - 1) * ROW_H_R * R
    const { maxWidth, transform } = this.#placement(x, y)
    // A name that has not moved is not written again: every render pass places
    // every name, and at a meeting of a thousand tiles re-setting two styles
    // per name (each parsed again by the browser) was a cost of every pass —
    // the participant's own create among them (SCALE-1).
    const placed = `${maxWidth}|${transform}`
    if (this.#placedAs.get(span) === placed) return
    this.#placedAs.set(span, placed)
    span.style.maxWidth = maxWidth
    span.style.transform = transform
  }

  /** `em`, `widthR` and `pivot` are for the honey options, which set their own
   *  size and bound (the flower's names keep the hive's one size otherwise). */
  #placement(
    x: number, y: number,
    em = this.#bigHead ? BIG_HEAD_EM : NAME_EM,
    widthR = MAX_WIDTH_R,
    pivot = this.#pivot,
  ): { maxWidth: string; transform: string } {
    const R = this.#geo.circumRadiusPx

    // ONE SIZE, ONE LINE, ALWAYS. A name is never shrunk to fit and never
    // wrapped (Jaime, 2026-09-09: "no wrapping") — both are ways of letting the
    // tile decide how its name is set, and the whole point is that every name
    // on the hive wears the same alphabet. A name longer than its tile simply
    // runs wider; nothing about its letters changes.
    const scale = em / LAYOUT_PX
    // Cut, never spill. maxWidth is in the span's own layout units, so it is
    // the world bound divided back through the scale the span is drawn at.
    const maxWidth = `${(widthR * R) / scale}px`
    const rotate = pivot ? ' rotate(90deg)' : ''
    const transform = `translate(${x}px,${y}px)${rotate} scale(${scale}) translate(-50%,-50%)`
    return { maxWidth, transform }
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
