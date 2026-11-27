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
/** The colour of a tile that is on, where the shell names none: the authored green, and the dark ink on it. */
const LIT = 0x6fd39a
const INK = 0x0c1c2e
const PLATE = 6.5
/** How far outside the plate the branch ring sits. */
const RING_GAP = 2.6

/** The badge's two colours: the plate, and the bulb and rim drawn on it. */
export type BulbColours = { readonly lit: number; readonly ink: number }

/** A CSS colour as the computed style says it (`rgb(r, g, b)` or `color(srgb r g b)`), as the number a canvas draws
 *  with. Null for anything else. */
export const colourNumber = (said: string): number | null => {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(said.trim())
  const srgb = rgb ? null : /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(said.trim())
  const parts = rgb ? rgb.slice(1, 4).map(Number) : srgb ? srgb.slice(1, 4).map(part => Number(part) * 255) : null
  if (!parts || parts.some(part => !Number.isFinite(part))) return null
  const [r, g, b] = parts.map(part => Math.max(0, Math.min(255, Math.round(part)))) as [number, number, number]
  return (r << 16) | (g << 8) | b
}

/** A colour the page's own tokens name, as a canvas number: the token's value painted on a probe and read back, so a
 *  `color-mix()` comes back resolved. Null where the shell names no such token. */
const tokenColour = (token: string, wrap: (value: string) => string = value => value): number | null => {
  try {
    const root = document.documentElement
    const value = getComputedStyle(root).getPropertyValue(token).trim()
    if (!value || !document.body) return null
    const probe = document.createElement('span')
    probe.style.color = wrap(value)
    if (!probe.style.color) return null
    probe.style.display = 'none'
    document.body.append(probe)
    const said = getComputedStyle(probe).color
    probe.remove()
    return colourNumber(said)
  } catch { return null }
}

/** The colours the shell gives a tile that is on (_material-tokens.scss `--hc-pools-on`, deep on a bright look and
 *  pale on a dark one) and the pane as the ink on it, as every accent takes. The authored pair where it names none. */
export const bulbColours = (): BulbColours => {
  const lit = tokenColour('--hc-pools-on')
  const ink = lit === null ? null : tokenColour('--hc-panel-pane', value => `rgb(${value})`)
  return lit === null || ink === null ? { lit: LIT, ink: INK } : { lit, ink }
}

/** One badge: the plate, the bulb on it, and the second ring when the whole branch is lit. */
const drawBulb = (g: Graphics, branch: boolean, { lit, ink }: BulbColours): void => {
  g.clear()
  if (branch) g.circle(0, 0, PLATE + RING_GAP).stroke({ color: lit, width: 1.4, alpha: 0.95 })
  g.circle(0, 0, PLATE).fill({ color: lit, alpha: 1 }).stroke({ color: ink, width: 1.1, alpha: 0.9 })
  g.circle(0, -1.3, 2.9).fill({ color: ink, alpha: 1 })
  g.roundRect(-1.7, 1.1, 3.4, 1.9, 0.5).fill({ color: ink, alpha: 1 })
  g.rect(-1.1, 3.5, 2.2, 0.9).fill({ color: ink, alpha: 1 })
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
    'render:set-orientation', 'render:set-hive-visible', LIGHTS_MODE, LIGHTS_CHANGED, 'theme:changed',
  ]
  protected override emits: string[] = []

  #layer = new TileBadgeLayer(BADGE_Z)
  /** Your own tiles on this page, by label. A peer's tile is never yours to light. */
  #coordByLabel = new Map<string, Axial>()
  #badges = new Map<string, { g: Graphics; branch: boolean }>()
  #active = false
  #hiveHidden = false
  #initialized = false
  /** The colours the bulbs are drawn in: read when pools mode comes up and again when the theme changes. */
  #colours: BulbColours = { lit: LIT, ink: INK }

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
      if (this.#active) this.#colours = bulbColours()
      this.#refresh()
    })
    this.onEffect(LIGHTS_CHANGED, () => this.#refresh())
    // A theme of its own, or the system's turning dark or light: the green deepens or pales, and every bulb with it.
    this.onEffect('theme:changed', () => this.#recolour())
    try { this.#scheme = matchMedia('(prefers-color-scheme: dark)') } catch { this.#scheme = null }
    this.#scheme?.addEventListener?.('change', this.#onScheme)
  }

  #scheme: MediaQueryList | null = null
  #onScheme = (): void => { this.#recolour() }

  /** Read the colours again, and draw every bulb in them when they moved. */
  #recolour(): void {
    const next = bulbColours()
    if (next.lit === this.#colours.lit && next.ink === this.#colours.ink) return
    this.#colours = next
    for (const badge of this.#badges.values()) drawBulb(badge.g, badge.branch, next)
  }

  protected override dispose(): void {
    this.#scheme?.removeEventListener?.('change', this.#onScheme)
    this.#scheme = null
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
        drawBulb(g, branch, this.#colours)
        layer.addChild(g)
        badge = { g, branch }
        this.#badges.set(label, badge)
      } else if (badge.branch !== branch) {
        drawBulb(badge.g, branch, this.#colours)
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
