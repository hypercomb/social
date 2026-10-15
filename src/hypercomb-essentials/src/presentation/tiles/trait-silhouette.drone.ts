// presentation/tiles/trait-silhouette.drone.ts
//
// OPEN TRAITS, DRAWN — the hexagon silhouettes of documentation/traits.md.
//
// A tile that wears traits names its next layer before that layer exists. Standing in it, every
// trait no child answers yet is drawn as a silhouette in the next free slot of the spiral: a faint
// hexagon, its inner ring, and the word. Pressing one creates the tile by that name through the same
// commit `create <name>` runs. Giving a trait with the `trait` word makes its tile at once: the drone
// hears `trait:given`, draws the silhouette, and when the tile lands it plays the arrival there —
// the outline brightens, opens out over the new tile and fades.
//
// A silhouette is NOT a tile. It never enters the cell list, the counts, the click routing, or any
// store: it is drawn on its own layer, recomputed from the level's own facts (the tile's `trait:want`
// records and the labels on screen), and gone the moment nothing is open. No network, no search.
//
// Geometry is mirrored, as drop-landing.drone and move-preview.drone mirror it: mesh spacing and
// orientation, the slot coords from `render:cell-count`, the spiral from AxialService.

import { Drone, EffectBus, sameTraitWord } from '@hypercomb/core'
import { Container, Graphics, Point, Text } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { trackSceneText } from '../grid/screen-text-resolution.js'
import { traitFillsAt, traitsAt, standing } from '../../commands/trait-read.js'
import { openTraitWords, silhouetteSlots, type Axial, type Silhouette } from './trait-silhouette.js'

type AxialServiceLike = { items?: Map<number, Axial> }
type CellCount = { locationKey?: string; labels?: string[]; coords?: Axial[] }
type HexDetectorLike = { pixelToAxial(px: number, py: number, flat?: boolean): Axial }

// Faint by design: the outline of something that is not there yet. Values follow the welcome
// hive's silhouette (body .12 / stroke .50 / ring .55), dimmed because nothing washes these.
const BODY_FILL = 0xffffff
const BODY_FILL_ALPHA = 0.04
const STROKE = 0xcfe3ef
const STROKE_ALPHA = 0.42
const RING_ALPHA = 0.22
const LABEL = 0xcfe3ef
const LABEL_ALPHA = 0.7
/** Under every live drawing layer (drop landing 6999, move cluster 7001+), above the mesh. */
const SILHOUETTE_Z = 6990
/** A press that travels further than this is a pan, not a press. */
const PRESS_JITTER_PX = 8
/** Decoration writes notify before they commit; read again after the commit has landed. */
const REREAD_MS = 300
/** The arrival: a given trait's silhouette brightens and opens out over its new tile, then is gone. */
const ARRIVAL_MS = 520
/** A given trait whose tile never lands stops being drawn as arriving after this long. */
const ARRIVING_TTL_MS = 6000
/** Above the resting silhouettes, so the arrival plays over the tile that just landed. */
const ARRIVAL_Z = 6991

export class TraitSilhouetteDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  override description = 'Draws each open trait as a hexagon silhouette where its tile would sit.'

  protected override deps = { axial: '@diamondcoreprocessor.com/AxialService' }
  protected override listens = [
    'render:host-ready', 'render:mesh-offset', 'render:cell-count',
    'render:geometry-changed', 'render:set-orientation', 'decorations:changed', 'trait:given',
  ]
  protected override emits = ['command:create-cells', 'activity:log']

  #container: Container | null = null
  #canvas: HTMLCanvasElement | null = null
  #renderer: { events?: { mapPositionToPoint?: (out: Point, x: number, y: number) => void }; screen: { width: number; height: number } } | null = null
  #layer: Container | null = null
  #arrivalLayer: Container | null = null
  #ticker: { add: (fn: () => void) => void; remove: (fn: () => void) => void } | null = null
  #meshOffset = { x: 0, y: 0 }
  #spacing = 38
  #flat = false

  #labels: string[] = []
  #coords: Axial[] = []
  /** The trait words of the level we stand in, and which level that was. */
  #words: string[] = []
  #wordsAt = ''
  #readToken = 0
  #rereadTimer: ReturnType<typeof setTimeout> | null = null
  #shown: Silhouette[] = []
  /** Traits just given here, drawn before their record is read back: word → when it was given. */
  #arriving = new Map<string, number>()
  /** Silhouettes playing their arrival over the tile that replaced them. */
  #arrivals: { node: Container; q: number; r: number }[] = []
  #down: { id: number; x: number; y: number } | null = null
  #wired = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true

    this.onEffect<HostReadyPayload>('render:host-ready', (p) => {
      this.#container = p.container
      this.#canvas = p.canvas
      this.#renderer = p.renderer as never
      this.#ticker = (p.app?.ticker ?? null) as never
      this.#initLayer()
      this.#draw()
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (o) => { this.#meshOffset = o; this.#place() })
    this.onEffect<{ spacing?: number }>('render:geometry-changed', (g) => {
      if (g?.spacing) { this.#spacing = g.spacing; this.#draw() }
    })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#flat = !!p?.flat; this.#draw() })
    this.onEffect<CellCount>('render:cell-count', (p) => {
      this.#labels = p?.labels ?? []
      this.#coords = p?.coords ?? []
      const at = this.#here()
      if (at !== this.#wordsAt) void this.#readWords()
      else this.#draw()
    })
    this.onEffect<{ segments?: readonly string[]; words?: readonly string[] }>('trait:given', (p) => {
      if ((p?.segments ?? []).join('/') !== this.#here()) return
      const now = Date.now()
      for (const word of p?.words ?? []) this.#arriving.set(word, now)
      this.#draw()
    })
    this.onEffect('decorations:changed', () => {
      if (this.#rereadTimer) clearTimeout(this.#rereadTimer)
      this.#rereadTimer = setTimeout(() => { this.#rereadTimer = null; void this.#readWords() }, REREAD_MS)
    })

    window.addEventListener('pointerdown', this.#onDown, { passive: true })
    window.addEventListener('pointerup', this.#onUp, { passive: true })
    window.addEventListener('pointercancel', this.#onCancel, { passive: true })
  }

  protected override dispose(): void {
    window.removeEventListener('pointerdown', this.#onDown)
    window.removeEventListener('pointerup', this.#onUp)
    window.removeEventListener('pointercancel', this.#onCancel)
    if (this.#rereadTimer) clearTimeout(this.#rereadTimer)
    for (const l of [this.#layer, this.#arrivalLayer]) {
      l?.parent?.removeChild(l)
      l?.destroy({ children: true })
    }
    this.#layer = null
    this.#arrivalLayer = null
    this.#arrivals = []
  }

  /** The level we stand in, as one string. The hive root never wears traits. */
  #here(): string { return standing().join('/') }

  async #readWords(): Promise<void> {
    const token = ++this.#readToken
    const segments = standing()
    const at = segments.join('/')
    let words: string[] = []
    if (segments.length > 0) {
      // A trait with its own version already works, and one filled by choice is answered: only the
      // ones still waiting for a filler are holes.
      try {
        const [specs, fills] = await Promise.all([traitsAt(segments), traitFillsAt(segments)])
        words = specs
          .filter(t => !t.own && !fills.some(f => sameTraitWord(f.record.payload?.word, t.word)))
          .map(t => t.word)
      } catch { words = [] }
    }
    if (token !== this.#readToken || at !== this.#here()) return
    this.#words = words
    this.#wordsAt = at
    this.#draw()
  }

  #initLayer(): void {
    if (!this.#container || this.#layer) return
    this.#layer = new Container()
    this.#layer.zIndex = SILHOUETTE_Z
    this.#layer.eventMode = 'none'
    this.#container.addChild(this.#layer)
    this.#arrivalLayer = new Container()
    this.#arrivalLayer.zIndex = ARRIVAL_Z
    this.#arrivalLayer.eventMode = 'none'
    this.#container.addChild(this.#arrivalLayer)
    this.#container.sortableChildren = true
  }

  /** Rebuild every silhouette: the set or the look changed. */
  #draw(): void {
    const layer = this.#layer
    if (!layer) return
    for (const child of layer.removeChildren()) child.destroy({ children: true })
    const previous = this.#shown
    const arriving = this.#arrivingWords()
    const resting = this.#wordsAt === this.#here() ? this.#words : []
    const open = openTraitWords([...resting, ...arriving.filter(w => !resting.includes(w))], this.#labels)
    const axial = this.resolve<AxialServiceLike>('axial')
    this.#shown = open.length ? silhouetteSlots(open, this.#coords, i => axial?.items?.get(i) ?? null) : []
    for (const s of this.#shown) layer.addChild(this.#node(s.word))

    // A silhouette whose tile has just landed plays its arrival where it stood, then is gone.
    for (const was of previous) {
      if (this.#shown.some(s => s.word === was.word)) continue
      if (!this.#labels.some(label => sameTraitWord(label, was.word))) continue
      this.#arriving.delete(was.word)
      this.#playArrival(was)
    }
    this.#place()
  }

  /** Given traits still waiting for their tile; a stale one is dropped. */
  #arrivingWords(): string[] {
    const now = Date.now()
    for (const [word, at] of this.#arriving) if (now - at > ARRIVING_TTL_MS) this.#arriving.delete(word)
    return [...this.#arriving.keys()]
  }

  /** The silhouette brightens and opens out over the tile that replaced it, then fades. Skipped when
   *  the participant asks for reduced motion, or when there is no frame clock to drive it. */
  #playArrival(s: Silhouette): void {
    const host = this.#arrivalLayer
    const ticker = this.#ticker
    let reduced = false
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { /* no media queries */ }
    if (!host || !ticker || reduced) return

    const node = this.#node(s.word)
    host.addChild(node)
    const entry = { node, q: s.q, r: s.r }
    this.#arrivals.push(entry)
    this.#place()

    const start = performance.now()
    const finish = (): void => {
      ticker.remove(step)
      clearTimeout(fallback)
      this.#arrivals = this.#arrivals.filter(a => a !== entry)
      node.parent?.removeChild(node)
      node.destroy({ children: true })
    }
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / ARRIVAL_MS)
      const ease = 1 - Math.pow(1 - t, 3)
      node.scale.set(1 + 0.12 * ease)
      // Bright at first (the silhouette "takes"), then gone as the tile shows through.
      node.alpha = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75
      if (t >= 1) finish()
    }
    // A hidden tab never runs frames; the timeout still clears the node.
    const fallback = setTimeout(finish, ARRIVAL_MS * 3)
    ticker.add(step)
  }

  /** Move the silhouettes with the mesh; nothing is rebuilt on a pan. */
  #place(): void {
    for (const a of this.#arrivals) {
      const p = this.#axialToPixel(a.q, a.r)
      a.node.position.set(p.x + this.#meshOffset.x, p.y + this.#meshOffset.y)
    }
    const layer = this.#layer
    if (!layer) return
    this.#shown.forEach((s, i) => {
      const node = layer.children[i]
      if (!node) return
      const p = this.#axialToPixel(s.q, s.r)
      node.position.set(p.x + this.#meshOffset.x, p.y + this.#meshOffset.y)
    })
  }

  #node(word: string): Container {
    const node = new Container()
    const radius = this.#hexRadius()
    const body = new Graphics()
    body.poly(this.#hexVerts(radius), true)
    body.fill({ color: BODY_FILL, alpha: BODY_FILL_ALPHA })
    body.poly(this.#hexVerts(radius), true)
    body.stroke({ color: STROKE, alpha: STROKE_ALPHA, width: 1.2, join: 'round' })
    // The inner ring is what reads "tile", not "hexagon" (the welcome hive's silhouette).
    body.poly(this.#hexVerts(radius * 0.62), true)
    body.stroke({ color: STROKE, alpha: RING_ALPHA, width: 1, join: 'round' })
    node.addChild(body)

    const width = this.#flat ? radius * 2 : Math.sqrt(3) * radius
    const text = new Text({
      text: word,
      style: { fontFamily: 'DM Mono, ui-monospace, monospace', fontSize: Math.max(8, radius * 0.27), fill: LABEL, align: 'center' },
    })
    text.alpha = LABEL_ALPHA
    text.anchor.set(0.5)
    if (text.width > width * 0.82) text.scale.set((width * 0.82) / text.width)
    if (this.#container) trackSceneText(text, this.#container)
    node.addChild(text)
    return node
  }

  // ── press ─────────────────────────────────────────────────────────────

  #onDown = (e: PointerEvent): void => {
    this.#down = null
    if (!this.#shown.length || !e.isPrimary || e.button > 0) return
    if (e.target !== this.#canvas) return
    this.#down = { id: e.pointerId, x: e.clientX, y: e.clientY }
  }

  #onCancel = (): void => { this.#down = null }

  #onUp = (e: PointerEvent): void => {
    const down = this.#down
    this.#down = null
    if (!down || down.id !== e.pointerId) return
    if (Math.abs(e.clientX - down.x) > PRESS_JITTER_PX || Math.abs(e.clientY - down.y) > PRESS_JITTER_PX) return
    const at = this.#clientToAxial(e.clientX, e.clientY)
    if (!at) return
    const hit = this.#shown.find(s => s.q === at.q && s.r === at.r)
    if (!hit) return
    // The tile by that name, through the shell's own create commit — the same one `create` runs.
    let accepted = false
    EffectBus.emitTransient('command:create-cells', {
      name: hit.word,
      accept: () => { accepted = true },
      complete: () => { /* the next render pass replaces the silhouette with the tile */ },
    })
    if (!accepted) EffectBus.emit('activity:log', { message: `could not create "${hit.word}" — the command line is unavailable`, icon: '⬡' })
  }

  #clientToAxial(cx: number, cy: number): Axial | null {
    const detector = window.ioc.get<HexDetectorLike>('@diamondcoreprocessor.com/HexDetector')
    if (!detector || !this.#container || !this.#renderer || !this.#canvas) return null
    const out = new Point()
    if (this.#renderer.events?.mapPositionToPoint) this.#renderer.events.mapPositionToPoint(out, cx, cy)
    else {
      const rect = this.#canvas.getBoundingClientRect()
      out.set((cx - rect.left) * (this.#renderer.screen.width / rect.width), (cy - rect.top) * (this.#renderer.screen.height / rect.height))
    }
    const local = this.#container.toLocal(out)
    return detector.pixelToAxial(local.x - this.#meshOffset.x, local.y - this.#meshOffset.y, this.#flat)
  }

  // ── geometry, mirrored from drop-landing.drone ────────────────────────

  #hexRadius(): number {
    const settings = window.ioc.get<{ hexagonDimensions?: { circumRadius?: number } }>('@diamondcoreprocessor.com/Settings')
    return settings?.hexagonDimensions?.circumRadius ?? 32
  }

  #hexVerts(radius: number): number[] {
    const verts: number[] = []
    const start = this.#flat ? 0 : -Math.PI / 2
    for (let i = 0; i < 6; i++) {
      const angle = start + (Math.PI / 3) * i
      verts.push(radius * Math.cos(angle), radius * Math.sin(angle))
    }
    return verts
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}

const _traitSilhouette = new TraitSilhouetteDrone()
window.ioc.register('@diamondcoreprocessor.com/TraitSilhouetteDrone', _traitSilhouette)
