// presentation/tiles/holder-badge.drone.ts
//
// Per-tile HOLDER count — how many participants hold their own version of
// this tile. It is the density mark: scanning a page, the badge tells you
// which tiles the swarm has actually crowded into, without hovering a
// single hex.
//
// This is NOT presence. presence-badge.drone counts peers who are inside a
// tile RIGHT NOW (a bee and a live number that decays when they wander
// off); this counts the participants who have PUBLISHED a version of the
// tile, which persists whether or not anyone is currently looking. The two
// sit on opposite shoulders of the hex for exactly that reason — a tile can
// be busy and thin, or deep and deserted, and those read differently.
//
// Data source: the participant stack (tile-stack.ts). show-cell resolves
// the variants each render pass and setTileStacks publishes the depths on
// TILE_STACK_DEPTHS; only labels held by more than one participant ride, so
// an ordinary tile is never marked. Depth is exactly what the wheel rolls
// through, so the number is also the length of the roll it offers.
//
// Until now that depth was legible only as a 50% grey-blue mix in the
// border (show-cell's STACK_BORDER) — enough to notice a stack, never
// enough to compare two of them. The badge carries the figure the tint can
// only hint at, in the same hue so the two read as one cue.

import { Drone } from '@hypercomb/core'
import { Container, Text, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { TILE_STACK_DEPTHS, type TileStackDepths } from './tile-stack.js'
import { TileBadgeLayer, BADGE_CORNER, type Axial } from './badge-layer.js'
import { trackSceneText } from '../grid/screen-text-resolution.js'

type CellCountPayload = {
  count: number
  labels: string[]
  coords: Axial[]
}

/** The grey-blue show-cell mixes into a stacked tile's border
 *  (STACK_BORDER, [0.62, 0.68, 0.78]) as a packed hex. The badge wears the
 *  border's own colour so depth reads as one cue in two intensities. */
const STACK_INK = 0x9eadc7
/** Pill ground. Same near-black the presence badge uses, so two badges on
 *  one tile sit at the same visual weight instead of competing. */
const PILL_BG = 0x0c1c2e

/** Height of the stack glyph — three offset slabs suggesting depth. Small:
 *  it is a determiner for the number, not an icon in its own right. */
const GLYPH_W = 11
const GLYPH_H = 12
/** Just under the presence badge (9998) and the action overlay (9999).
 *  They never overlap — opposite corners — but a coincident pixel should
 *  go to the interactive layer. */
const BADGE_Z = 9997

export class HolderBadgeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Per-tile holder badge — shows how many participants hold their own version of each tile, marking the densely populated ones.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset',
    'render:geometry-changed', 'render:set-orientation',
    'location:changed',
    TILE_STACK_DEPTHS,
  ]
  protected override emits: string[] = []

  #badgeLayer = new TileBadgeLayer(BADGE_Z)
  #coordByLabel = new Map<string, Axial>()
  #depths: Readonly<Record<string, number>> = {}
  #badges = new Map<string, { box: Container; bg: Graphics; glyph: Graphics; text: Text }>()
  #lastKey = ''
  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // render:host-ready is sticky, so we get the container even if the
    // host booted before this drone's first pulse.
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      if (payload?.container) { this.#badgeLayer.attach(payload.container); this.#refresh(true) }
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

    this.onEffect<TileStackDepths>(TILE_STACK_DEPTHS, (payload) => {
      this.#depths = payload?.depths ?? {}
      this.#refresh()
    })

    // DEPTHS BELONG TO A PAGE, and arriving somewhere else must drop them
    // even if nothing republishes. show-cell can serve a page from its cache
    // and return before it ever resolves peers, so a badge counted on one
    // page would otherwise still be sitting on a same-named tile of another.
    this.onEffect('location:changed', () => {
      this.#depths = {}
      this.#refresh(true)
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.#badgeLayer.setMeshOffset(offset)
      this.#reposition()
    })

    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (geo) => {
      this.#badgeLayer.setGeometry(geo)
      this.#reposition()
    })

    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => {
      this.#badgeLayer.setOrientation(!!p?.flat)
      this.#reposition()
    })
  }

  protected override dispose(): void {
    for (const b of this.#badges.values()) b.box.destroy({ children: true })
    this.#badges.clear()
    this.#badgeLayer.destroy()
  }

  #refresh(force = false): void {
    if (!this.#badgeLayer.layer) return

    // Cheap no-op guard: a render pass republishes the same depths far more
    // often than they change, and a rebuild per pass would churn every hex.
    let key = ''
    for (const label of Object.keys(this.#depths).sort()) {
      if (this.#coordByLabel.has(label)) key += `${label}:${this.#depths[label]}|`
    }
    if (!force && key === this.#lastKey) return
    this.#lastKey = key

    const wanted = new Set<string>()
    for (const [label, depth] of Object.entries(this.#depths)) {
      if (depth < 2) continue          // one holder is not a stack
      const coord = this.#coordByLabel.get(label)
      if (!coord) continue             // held elsewhere — no tile here to anchor to
      wanted.add(label)
      this.#upsert(label, coord, depth)
    }
    for (const [label, b] of this.#badges) {
      if (!wanted.has(label)) { b.box.destroy({ children: true }); this.#badges.delete(label) }
    }
  }

  #upsert(label: string, coord: Axial, depth: number): void {
    let b = this.#badges.get(label)
    if (!b) {
      const box = new Container()
      box.eventMode = 'none'
      const bg = new Graphics()
      const glyph = new Graphics()
      const text = new Text({
        text: String(depth),
        style: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 13,
          fontWeight: '700',
          fill: 0xffffff,
          stroke: { color: PILL_BG, width: 3 },
        },
      })
      text.anchor.set(1, 0.5)          // grows leftward from the anchor
      this.#drawGlyph(glyph)
      trackSceneText(text, this.#badgeLayer.layer!)
      box.addChild(bg, glyph, text)
      this.#badgeLayer.layer!.addChild(box)
      b = { box, bg, glyph, text }
      this.#badges.set(label, b)
    }

    b.text.text = String(depth)

    // Layout mirrors the presence badge on the other shoulder: the pill
    // hangs LEFTWARD from the anchor, glyph outermost, count against the hex.
    b.text.position.set(-4, 1)
    b.glyph.position.set(-(b.text.width + 8 + GLYPH_W), -GLYPH_H / 2)

    const w = b.text.width + GLYPH_W + 16
    const h = GLYPH_H + 6
    b.bg.clear()
      .roundRect(-w, -h / 2, w, h, h / 2)
      .fill({ color: PILL_BG, alpha: 0.66 })

    this.#badgeLayer.place(b.box, coord, BADGE_CORNER.topLeft)
  }

  /** Three offset slabs, back to front — the flattest possible reading of
   *  "there are more of these underneath". Drawn rather than baked: it is
   *  a handful of rects and a texture would need a canvas we may not have. */
  #drawGlyph(g: Graphics): void {
    const slabH = 3
    const step = (GLYPH_H - slabH) / 2
    for (let i = 0; i < 3; i++) {
      const inset = (2 - i) * 1.5
      g.roundRect(inset, i * step, GLYPH_W - inset * 2, slabH, 1.2)
       .fill({ color: STACK_INK, alpha: 0.55 + i * 0.2 })
    }
  }

  #reposition(): void {
    for (const [label, b] of this.#badges) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#badgeLayer.place(b.box, coord, BADGE_CORNER.topLeft)
    }
  }
}

const _holderBadge = new HolderBadgeDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/HolderBadgeDrone', _holderBadge,
)
