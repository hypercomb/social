// diamondcoreprocessor.com/presentation/tiles/presence-badge.drone.ts
//
// Per-tile "bee count" badge — a small notification overlay that shows
// HOW MANY swarm participants are currently exploring INSIDE each child
// tile. The number rides next to the same hand-authored bee ("AB") used
// by the swarm animation, baked once to a static texture.
//
// This is the NOTIFICATION half of the tile chrome (top-corner, never
// clickable), complementary to — not a replacement for — two existing
// cues: show-cell already paints an ambient presence GLOW from the same
// snapshot, and the action overlay (tile-overlay.drone) owns the bottom
// click row. The badge adds the precise count the glow can only hint at.
//
// Data source: SwarmDrone.presenceGlowSnapshot() → Map<childName,count>
// of LIVE peers inside each child at the current location (self-excluded,
// deduped by pubkey, 135s-stale-filtered). It is naturally empty outside
// a swarm, so badges only appear when peers are actually present.
//
// Positioning mirrors tile-overlay exactly: the badge layer is a child of
// the zoom/pan render root (HostReadyPayload.container), and each badge is
// placed at axialToPixel(coord) + meshOffset + a top-right corner offset,
// so badges track tiles through pan and zoom for free.

import { Drone } from '@hypercomb/core'
import { Container, Sprite, Text, Graphics, Texture } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { bakeBeeAtlas } from '../avatars/bee-ab-atlas.js'

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'

type Axial = { q: number; r: number }
type CellCountPayload = {
  count: number
  labels: string[]
  coords: Axial[]
  noImageLabels?: string[]
}

// Bee glyph size (px) inside a badge, and the layer's z-order. The action
// overlay sits at 9999; badges live just under it (they never overlap —
// actions are bottom-anchored, badges top-anchored — but keeping them
// below means a hovered action icon always wins a coincident pixel).
const BEE_PX = 17
const BADGE_Z = 9998

// Re-read cadence for staleness decay: a peer's presence ping expires
// after PEER_STALE_MS (~135s) with no wire event, so the snapshot count
// silently drops on read. Nothing emits on that expiry, so we re-poll on
// a gentle interval to let stale badges fade without a user action.
const POLL_MS = 5000

export class PresenceBadgeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Per-tile bee-count badge — shows how many swarm participants are exploring inside each child tile.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset',
    'render:geometry-changed', 'render:set-orientation',
    'swarm:interest-changed', 'swarm:presence-changed', 'swarm:peers-changed',
  ]
  protected override emits: string[] = []

  #container: Container | null = null
  #layer: Container | null = null
  #beeTexture: Texture | null = null

  // Geometry mirrors the overlay: spacing drives axialToPixel, circumRadius
  // sizes the corner offset, flat selects the axial formula.
  #spacing = 38
  #circum = 32
  #flat = false
  #meshOffset = { x: 0, y: 0 }

  // Current visible tiles (label → axial) and which of them render no image
  // (the "no content" cue), both from render:cell-count.
  #coordByLabel = new Map<string, Axial>()
  #noImage = new Set<string>()

  // Live badge sprites by tile label.
  #badges = new Map<string, { box: Container; bg: Graphics; bee: Sprite; text: Text }>()
  #pollTimer: ReturnType<typeof setInterval> | null = null
  #lastKey = ''
  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    // render:host-ready is sticky (last-value replay), so we get the
    // container even if the host booted before this drone's first pulse.
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#container = payload.container
      this.#ensureLayer()
      void this.#bakeBee()
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
      this.#noImage = new Set(payload?.noImageLabels ?? [])
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

    // Live joins/leaves arrive as swarm effects; the poll covers expiry.
    this.onEffect('swarm:interest-changed', () => this.#refresh())
    this.onEffect('swarm:presence-changed', () => this.#refresh())
    this.onEffect('swarm:peers-changed', () => this.#refresh())
    this.#pollTimer = setInterval(() => this.#refresh(), POLL_MS)
  }

  protected override dispose(): void {
    if (this.#pollTimer) { clearInterval(this.#pollTimer); this.#pollTimer = null }
    for (const b of this.#badges.values()) b.box.destroy({ children: true })
    this.#badges.clear()
    if (this.#layer) { this.#layer.destroy({ children: true }); this.#layer = null }
  }

  #ensureLayer(): void {
    if (!this.#container || this.#layer) return
    this.#layer = new Container()
    this.#layer.zIndex = BADGE_Z
    this.#layer.eventMode = 'none'           // notification only — never intercepts clicks
    this.#container.addChild(this.#layer)
    this.#container.sortableChildren = true
  }

  // Bake one static bee frame (mid-flap) to a texture, reusing the swarm's
  // atlas baker with a single cell. Refresh once it lands so any badges
  // created with the placeholder swap to the real glyph.
  async #bakeBee(): Promise<void> {
    if (this.#beeTexture) return
    try {
      const atlas = await bakeBeeAtlas(1, 64)
      if (atlas?.texture) { this.#beeTexture = atlas.texture; this.#refresh(true) }
    } catch { /* canvas unavailable — badges fall back to count-only */ }
  }

  #snapshot(): ReadonlyMap<string, number> {
    try {
      const swarm = (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(SWARM_KEY) as
        | { presenceGlowSnapshot?: () => ReadonlyMap<string, number> }
        | undefined
      return swarm?.presenceGlowSnapshot?.() ?? new Map()
    } catch { return new Map() }
  }

  #refresh(force = false): void {
    if (!this.#layer) return
    const snap = this.#snapshot()

    // Cheap no-op guard: skip a full rebuild when nothing visible changed.
    let key = ''
    for (const [label, count] of snap) {
      if (count > 0 && this.#coordByLabel.has(label)) {
        key += `${label}:${count}:${this.#noImage.has(label) ? 'e' : 'f'}|`
      }
    }
    if (!force && key === this.#lastKey) return
    this.#lastKey = key

    const wanted = new Set<string>()
    for (const [label, count] of snap) {
      if (count <= 0) continue
      const coord = this.#coordByLabel.get(label)
      if (!coord) continue   // bees in a place with no visible tile here — nothing to anchor to (yet)
      wanted.add(label)
      this.#upsert(label, coord, count)
    }
    for (const [label, b] of this.#badges) {
      if (!wanted.has(label)) { b.box.destroy({ children: true }); this.#badges.delete(label) }
    }
  }

  #upsert(label: string, coord: Axial, count: number): void {
    let b = this.#badges.get(label)
    if (!b) {
      const box = new Container()
      box.eventMode = 'none'
      const bg = new Graphics()
      const bee = new Sprite(this.#beeTexture ?? Texture.EMPTY)
      bee.anchor.set(0.5)
      bee.width = bee.height = BEE_PX
      const text = new Text({
        text: String(count),
        style: {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 13,
          fontWeight: '700',
          fill: 0xffffff,
          stroke: { color: 0x0c1c2e, width: 3 },
        },
      })
      text.anchor.set(0, 0.5)
      box.addChild(bg, bee, text)
      this.#layer!.addChild(box)
      b = { box, bg, bee, text }
      this.#badges.set(label, b)
    }

    if (this.#beeTexture && b.bee.texture !== this.#beeTexture) {
      b.bee.texture = this.#beeTexture
      b.bee.width = b.bee.height = BEE_PX
    }
    b.text.text = String(count)

    // Layout: bee on the left, count to its right, pill behind both.
    b.bee.position.set(0, 0)
    b.text.position.set(BEE_PX * 0.5 + 3, 1)

    const empty = this.#noImage.has(label)   // "present but no content" cue
    const padL = BEE_PX * 0.5 + 5
    const padR = b.text.width + 6
    const h = BEE_PX + 5
    b.bg.clear()
    const r = b.bg.roundRect(-padL, -h / 2, padL + b.text.position.x + padR - 3, h, h / 2)
    if (empty) {
      // Empty room: hollow outline + dimmed bee — "someone's here, nothing's here yet".
      r.stroke({ color: 0x7eb6d6, width: 1.5, alpha: 0.9 }).fill({ color: 0x0c1c2e, alpha: 0.32 })
      b.bee.alpha = 0.5
    } else {
      r.fill({ color: 0x0c1c2e, alpha: 0.66 })
      b.bee.alpha = 1
    }

    this.#place(b.box, coord)
  }

  #place(box: Container, coord: Axial): void {
    const px = this.#axialToPixel(coord.q, coord.r)
    const cx = px.x + this.#meshOffset.x
    const cy = px.y + this.#meshOffset.y
    // Top-right of the hex. Tuned against the ~32px circumradius; the pill
    // extends rightward from the bee so it reads as a corner ornament.
    box.position.set(cx + this.#circum * 0.42, cy - this.#circum * 0.78)
  }

  #reposition(): void {
    for (const [label, b] of this.#badges) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#place(b.box, coord)
    }
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}

const _presenceBadge = new PresenceBadgeDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/PresenceBadgeDrone', _presenceBadge,
)
