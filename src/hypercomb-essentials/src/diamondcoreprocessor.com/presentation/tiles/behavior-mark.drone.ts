// diamondcoreprocessor.com/presentation/tiles/behavior-mark.drone.ts
//
// BehaviorMarkDrone — the on-grid half of BEHAVIOUR BINDING.
//
// A bound behaviour belongs to ONE tile (see documentation/behavior-binding.md).
// The panel already does the right thing at both ends: at the bound tile the
// row is offered and marked, everywhere else it is withdrawn. But that leaves
// a hole one level up. Standing on the PARENT, the tile that carries the
// behaviour looks like every other hexagon — the one place the binding is a
// fact about the tile, and the grid says nothing.
//
// Hoisting the behaviour into the parent's Beehaviors panel would be the wrong
// fix: that list answers "what can I do to THIS tile", and a child's behaviour
// is not that. The mark belongs on the CHILD — the tile advertises itself, and
// you learn the behaviour exists by looking at the hexagon that has it. Marks
// classify; they never resolve. Tapping does nothing here: this is a cue, not
// a control (the behaviour is reached by entering the tile, as before).
//
// Matching is EXACT, never subtree. A binding covers its descendants for
// dormancy purposes, but the mark states "it lives here" — painting it on
// every descendant would say the opposite, loudly, on a deep branch.
//
// Positioning mirrors presence-badge exactly (same layer parent, same axial
// maths, so marks track pan and zoom for free) but takes the TOP-LEFT corner:
// the bee-count badge owns top-right and the two must never collide.

import { Drone } from '@hypercomb/core'
import { Container, Sprite, Graphics, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { renderMaterialGlyphToTexture } from './hex-icon-button.js'
import {
  allBindings, behaviorPath, isKindGloballyOff, ENABLEMENT_CHANGED,
} from '../../sharing/behavior-enablement.js'
import type { VisualBeeRegistry } from '../../commands/visual-bee-registry.js'

const VISUAL_BEE_REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'

type Axial = { q: number; r: number }
type CellCountPayload = { labels: string[]; coords: Axial[] }
type LineageLike = { explorerSegments?: () => readonly string[] }

/** Glyph size (px) and the layer's z-order. The action overlay sits at 9999
 *  and the presence badge at 9998; marks go under both, so a hovered action
 *  icon always wins a coincident pixel. */
const GLYPH_PX = 13
const MARK_Z = 9997

/** How many marks one tile shows before the rest are dropped. A tile that
 *  belongs to three behaviours is already unusual; four would be ornament. */
const MAX_MARKS = 3

/** Horizontal step between marks on the same tile, rightward from the corner. */
const MARK_STEP = GLYPH_PX + 6

/** Fallback glyph when the bound kind names no bee we can see — a binding
 *  outlives its module (bind ahead of install, or a module that left), and
 *  the tile must still say something rather than nothing. */
const UNKNOWN_GLYPH = 'deployed_code_alert'

export class BehaviorMarkDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Marks a child tile on the grid when a behaviour is BOUND to it — the on-grid half of behaviour binding.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset',
    'render:geometry-changed', 'render:set-orientation',
    ENABLEMENT_CHANGED,
  ]
  protected override emits: string[] = []

  #container: Container | null = null
  #layer: Container | null = null

  // Geometry mirrors presence-badge: spacing drives axialToPixel, circumRadius
  // sizes the corner offset, flat selects the axial formula.
  #spacing = 38
  #circum = 32
  #flat = false
  #meshOffset = { x: 0, y: 0 }

  #coordByLabel = new Map<string, Axial>()

  /** Live marks by tile label. Each is a row of plate+glyph cells on one
   *  hexagon; the cell is held explicitly so layout never walks `parent`. */
  #marks = new Map<string, { box: Container; cells: Array<{ cell: Container; glyph: Sprite }> }>()

  /** Baked ligature textures, shared across every tile that shows the kind. */
  #textures = new Map<string, Texture>()
  #baking = new Set<string>()

  #lastKey = ''
  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // render:host-ready is sticky (last-value replay), so we get the container
    // even if the host booted before this drone's first pulse.
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#container = payload.container
      this.#ensureLayer()
      this.#refresh(true)
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#coordByLabel.clear()
      const labels = payload?.labels ?? []
      const coords = payload?.coords ?? []
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]
        const coord = coords[i]
        if (label && coord) this.#coordByLabel.set(label, { q: coord.q, r: coord.r })
      }
      this.#refresh(true)
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#meshOffset = { x: offset?.x ?? 0, y: offset?.y ?? 0 }
      this.#reposition()
    })

    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (geo) => {
      if (typeof geo?.spacing === 'number' && geo.spacing > 0) this.#spacing = geo.spacing
      if (typeof geo?.circumRadiusPx === 'number' && geo.circumRadiusPx > 0) this.#circum = geo.circumRadiusPx
      this.#reposition()
    })

    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => {
      this.#flat = !!p?.flat
      this.#reposition()
    })

    // Bind, free, or flip a global switch and every mark repaints at once —
    // the same event every other enablement surface listens to.
    this.onEffect(ENABLEMENT_CHANGED, () => this.#refresh(true))
  }

  protected override dispose(): void {
    for (const m of this.#marks.values()) m.box.destroy({ children: true })
    this.#marks.clear()
    if (this.#layer) { this.#layer.destroy({ children: true }); this.#layer = null }
  }

  #ensureLayer(): void {
    if (!this.#container || this.#layer) return
    this.#layer = new Container()
    this.#layer.zIndex = MARK_Z
    this.#layer.eventMode = 'none'      // a cue, never a control
    this.#container.addChild(this.#layer)
    this.#container.sortableChildren = true
  }

  /** Current navigation segments — the parent of every visible tile. */
  #segments(): readonly string[] {
    try {
      const lineage = (window as unknown as { ioc?: { get?: (k: string) => unknown } })
        .ioc?.get?.(LINEAGE_KEY) as LineageLike | undefined
      const segs = lineage?.explorerSegments?.() ?? []
      return (Array.isArray(segs) ? segs : []).map(s => String(s ?? '').trim()).filter(Boolean)
    } catch { return [] }
  }

  /** Bound kinds per canonical path, EXACT — a binding's own tile only. A
   *  globally-off kind contributes nothing: dormant means the tile has
   *  nothing to advertise. */
  #boundByPath(): Map<string, string[]> {
    const byPath = new Map<string, string[]>()
    for (const [kind, bindings] of Object.entries(allBindings())) {
      if (isKindGloballyOff(kind)) continue
      for (const b of bindings) {
        const list = byPath.get(b.path)
        if (list) list.push(kind)
        else byPath.set(b.path, [kind])
      }
    }
    return byPath
  }

  /** The Material ligature a kind shows, from the bee that declares it. */
  #glyphFor(kind: string): string {
    try {
      const registry = (window as unknown as { ioc?: { get?: (k: string) => unknown } })
        .ioc?.get?.(VISUAL_BEE_REGISTRY_KEY) as VisualBeeRegistry | undefined
      const bee = registry?.byDecorationKind?.(kind)
      return bee?.toggleIcon || bee?.iconName || UNKNOWN_GLYPH
    } catch { return UNKNOWN_GLYPH }
  }

  /** Bake a ligature once, then repaint so placeholder sprites swap to it. */
  #textureFor(ligature: string): Texture | null {
    const cached = this.#textures.get(ligature)
    if (cached) return cached
    if (!this.#baking.has(ligature)) {
      this.#baking.add(ligature)
      void renderMaterialGlyphToTexture(ligature)
        .then(tex => { this.#textures.set(ligature, tex); this.#refresh(true) })
        .catch(() => { /* font unavailable — the plate still reads as a mark */ })
    }
    return null
  }

  #refresh(force = false): void {
    if (!this.#layer) return
    const byPath = this.#boundByPath()
    const segments = this.#segments()

    // What each visible tile should show, in one pass.
    const wanted = new Map<string, string[]>()
    if (byPath.size > 0) {
      for (const label of this.#coordByLabel.keys()) {
        const kinds = byPath.get(behaviorPath([...segments, label]))
        if (kinds?.length) wanted.set(label, kinds.slice(0, MAX_MARKS))
      }
    }

    // Cheap no-op guard: skip the rebuild when nothing visible changed.
    let key = ''
    for (const [label, kinds] of wanted) key += `${label}:${kinds.join(',')}|`
    if (!force && key === this.#lastKey) return
    this.#lastKey = key

    for (const [label, kinds] of wanted) this.#upsert(label, kinds)
    for (const [label, m] of this.#marks) {
      if (!wanted.has(label)) { m.box.destroy({ children: true }); this.#marks.delete(label) }
    }
  }

  #upsert(label: string, kinds: readonly string[]): void {
    const coord = this.#coordByLabel.get(label)
    if (!coord) return
    let m = this.#marks.get(label)
    if (!m) {
      const box = new Container()
      box.eventMode = 'none'
      this.#layer!.addChild(box)
      m = { box, cells: [] }
      this.#marks.set(label, m)
    }

    // One plate + glyph per bound kind, laid out rightward from the corner.
    for (let i = m.cells.length; i < kinds.length; i++) {
      const plate = new Graphics()
      plate.circle(0, 0, GLYPH_PX * 0.72).fill({ color: 0x0c1c2e, alpha: 0.66 })
      const glyph = new Sprite(Texture.EMPTY)
      glyph.anchor.set(0.5)
      glyph.width = glyph.height = GLYPH_PX
      glyph.tint = 0xd6a35c          // the same warm note the panel's belongs-to mark carries
      const cell = new Container()
      cell.addChild(plate, glyph)
      m.box.addChild(cell)
      m.cells.push({ cell, glyph })
    }
    while (m.cells.length > kinds.length) {
      m.cells.pop()?.cell.destroy({ children: true })
    }

    for (let i = 0; i < kinds.length; i++) {
      const { cell, glyph } = m.cells[i]
      const tex = this.#textureFor(this.#glyphFor(kinds[i]))
      if (tex && glyph.texture !== tex) {
        glyph.texture = tex
        glyph.width = glyph.height = GLYPH_PX
      }
      cell.position.set(i * MARK_STEP, 0)
    }

    this.#place(m.box, coord)
  }

  #place(box: Container, coord: Axial): void {
    const px = this.#axialToPixel(coord.q, coord.r)
    // Top-LEFT of the hex — the mirror of presence-badge's corner, so the two
    // ornaments can both be present without ever overlapping.
    box.position.set(
      px.x + this.#meshOffset.x - this.#circum * 0.5,
      px.y + this.#meshOffset.y - this.#circum * 0.74,
    )
  }

  #reposition(): void {
    for (const [label, m] of this.#marks) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#place(m.box, coord)
    }
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}

const _behaviorMark = new BehaviorMarkDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/BehaviorMarkDrone', _behaviorMark,
)
