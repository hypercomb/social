// pools/pools-badge.drone.ts
//
// THE LIT BADGE. While pools mode is up, every tile on the page that is ON
// wears a small light bulb on its right shoulder, always visible, so what is
// offered reads at a glance without hovering anything. A tile lit as a whole
// branch wears the same bulb inside a second ring: this, and everything under
// it. A tile that is off wears nothing: the renderer already dims it.
//
// Being on is a mark the participant keeps (presentation/tiles/tile-public.ts),
// membership and never truth (P6), and this drone only READS it. It draws its
// own ornaments in the shared badge layer and never touches a cell, so lighting
// a tile repaints one badge and no page (V2). The bulb is drawn with Pixi
// Graphics: no font, no texture, nothing fetched (T7). The badge takes no
// pointer: the tap is the tile's.
//
// Placement is the badge layer's (presentation/tiles/badge-layer.ts): a child
// of the zoom and pan root, so a badge tracks its tile for free.

import { Drone, get } from '@hypercomb/core'
import { Graphics } from 'pixi.js'
import { BADGE_CORNER, TileBadgeLayer, type Axial } from '../presentation/tiles/badge-layer.js'
import type { HostReadyPayload } from '../presentation/tiles/pixi-host.worker.js'
import { isBranchPublic, isCellPublic } from '../presentation/tiles/tile-public.js'
import { LIGHTS_CHANGED, LIGHTS_MODE, type LightsMode } from './lights-contract.js'

type CellCountPayload = { labels?: string[]; coords?: Axial[]; externalLabels?: string[] }

/** Under the new-pictures dot (9997), the presence badge (9998) and the action overlay (9999). */
const BADGE_Z = 9996
/** The colour of a tile that is on, as the hover band draws it. */
const LIT = 0x6fd39a
const INK = 0x0c1c2e
const PLATE = 6.5
/** How far outside the plate the branch ring sits. */
const RING_GAP = 2.6

/** One badge: the plate, the bulb on it, and the second ring when the whole branch is lit. */
const drawBulb = (g: Graphics, branch: boolean): void => {
  g.clear()
  if (branch) g.circle(0, 0, PLATE + RING_GAP).stroke({ color: LIT, width: 1.4, alpha: 0.95 })
  g.circle(0, 0, PLATE).fill({ color: LIT, alpha: 1 }).stroke({ color: INK, width: 1.1, alpha: 0.9 })
  g.circle(0, -1.3, 2.9).fill({ color: INK, alpha: 1 })
  g.roundRect(-1.7, 1.1, 3.4, 1.9, 0.5).fill({ color: INK, alpha: 1 })
  g.rect(-1.1, 3.5, 2.2, 0.9).fill({ color: INK, alpha: 1 })
}

export class PoolsBadgeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Per-tile light bulb while pools mode is up: a tile that is on wears it, and a branch lit whole wears it inside a second ring.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset', 'render:geometry-changed',
    'render:set-orientation', 'render:set-hive-visible', LIGHTS_MODE, LIGHTS_CHANGED,
  ]
  protected override emits: string[] = []

  #layer = new TileBadgeLayer(BADGE_Z)
  /** Your own tiles on this page, by label. A peer's tile is never yours to light. */
  #coordByLabel = new Map<string, Axial>()
  #badges = new Map<string, { g: Graphics; branch: boolean }>()
  #active = false
  #hiveHidden = false
  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      if (!payload?.container) return
      // A new render root gets a new layer, and the old one's bulbs went with it.
      const before = this.#layer.layer
      const layer = this.#layer.attach(payload.container)
      if (layer !== before) this.#badges.clear()
      layer.visible = !this.#hiveHidden
      this.#refresh()
    })
    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.#coordByLabel.clear()
      const labels = payload?.labels ?? []
      const coords = payload?.coords ?? []
      const external = new Set(payload?.externalLabels ?? [])
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i]
        const coord = coords[i]
        if (label && coord && !external.has(label)) this.#coordByLabel.set(label, { q: coord.q, r: coord.r })
      }
      this.#refresh()
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => { this.#layer.setMeshOffset(offset); this.#reposition() })
    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (geo) => { this.#layer.setGeometry(geo); this.#reposition() })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#layer.setOrientation(!!p?.flat); this.#reposition() })
    // The images wall, the screensaver and the like own the surface: no badge over them.
    this.onEffect<{ visible: boolean }>('render:set-hive-visible', (p) => {
      this.#hiveHidden = p?.visible === false
      if (this.#layer.layer) this.#layer.layer.visible = !this.#hiveHidden
    })
    this.onEffect<LightsMode>(LIGHTS_MODE, (mode) => {
      this.#active = mode?.active === true
      this.#refresh()
    })
    this.onEffect(LIGHTS_CHANGED, () => this.#refresh())
  }

  protected override dispose(): void {
    this.#clear()
    this.#layer.destroy()
  }

  #clear(): void {
    for (const badge of this.#badges.values()) badge.g.destroy()
    this.#badges.clear()
  }

  /** Put a bulb on every tile that is on, take it off every tile that is not. Nothing is up outside pools mode. */
  #refresh(): void {
    const layer = this.#layer.layer
    if (!layer) return
    if (!this.#active) { this.#clear(); return }
    const location = get<{ explorerLabel?(): string }>('@hypercomb.social/Lineage')?.explorerLabel?.() ?? '/'
    const wanted = new Set<string>()
    for (const [label, coord] of this.#coordByLabel) {
      if (!isCellPublic(location, label)) continue
      wanted.add(label)
      const branch = isBranchPublic(location, label)
      let badge = this.#badges.get(label)
      if (!badge) {
        const g = new Graphics()
        g.eventMode = 'none'
        drawBulb(g, branch)
        layer.addChild(g)
        badge = { g, branch }
        this.#badges.set(label, badge)
      } else if (badge.branch !== branch) {
        drawBulb(badge.g, branch)
        badge.branch = branch
      }
      this.#layer.place(badge.g, coord, BADGE_CORNER.topRight)
    }
    for (const [label, badge] of this.#badges) {
      if (!wanted.has(label)) { badge.g.destroy(); this.#badges.delete(label) }
    }
  }

  #reposition(): void {
    for (const [label, badge] of this.#badges) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#layer.place(badge.g, coord, BADGE_CORNER.topRight)
    }
  }
}

const _poolsBadge = new PoolsBadgeDrone()
window.ioc.register('@diamondcoreprocessor.com/PoolsBadgeDrone', _poolsBadge)
