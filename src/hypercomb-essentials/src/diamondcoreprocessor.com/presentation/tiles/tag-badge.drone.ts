// diamondcoreprocessor.com/presentation/tiles/tag-badge.drone.ts
//
// Per-tile TAG badge — a small, cold chip that makes a tagged tile "more
// defined" on the canvas without shouting. For each visible tile that carries
// tags it draws a row of colour-coded dots (one per tag, capped, with a "+N"
// overflow) inside a faint steel-edged pill, anchored to the tile's TOP-LEFT
// corner. The presence badge owns the top-right; the action overlay owns the
// bottom row — this corner is free.
//
// Data:
//   • render:cell-tags  { byLabel: { [label]: string[] } } — the per-cell tag
//     names show-cell aggregates (decoration `tag` kind ∪ legacy props.tags).
//   • render:cell-count — tile labels → axial coords (anchor positions).
//   • tags:registry     — a tag's colour changed → recolour in place.
// Colours come from the global TagRegistry keyed by name (same source as the
// controls-bar pills); an uncoloured tag falls back to a deterministic hue.
//
// Positioning mirrors presence-badge exactly: the layer is a child of the
// zoom/pan render root (HostReadyPayload.container) and each chip is placed at
// axialToPixel(coord) + meshOffset + a corner offset, so chips track tiles
// through pan and zoom for free. eventMode 'none' — never intercepts clicks.

import { Drone } from '@hypercomb/core'
import { Container, Text, Graphics } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'

const TAG_REGISTRY_KEY = '@hypercomb.social/TagRegistry'

type Axial = { q: number; r: number }
type CellCountPayload = { labels?: string[]; coords?: Axial[] }
type CellTagsPayload = { byLabel?: Record<string, string[]> }

// The badge sits just below the presence/action chrome and never overlaps it
// (this is the top-LEFT corner). Dots are small and quiet — no glow, no flash.
const BADGE_Z = 9997
const DOT_R = 3            // dot radius (px, hex-local — stage scales it)
const DOT_GAP = 3          // centre-to-centre spacing between dots
const MAX_DOTS = 4         // beyond this, the last slot becomes "+N"
const PAD = 4              // pill padding around the dot row
const PILL_FILL = 0x0c1c2e
const PILL_FILL_ALPHA = 0.62
const PILL_STROKE = 0x7eb6d6   // steel hairline — matches the cold chrome
const PILL_STROKE_ALPHA = 0.5

/** Parse a CSS hex colour (`#rgb` / `#rrggbb`) to a Pixi number, or null. */
function hexToNum(hex: string): number | null {
  const s = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(s)) return parseInt(s, 16)
  if (/^[0-9a-f]{3}$/i.test(s)) return parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16)
  return null
}

/** Deterministic fallback colour for an uncoloured tag — DJB2 hash → bright,
 *  legible hue (matches the spirit of the controls-bar fallback). */
function fallbackColor(name: string): number {
  let h = 5381
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0
  const hue = ((h >>> 0) % 360) / 360
  const c = 0.55, x = c * (1 - Math.abs(((hue * 6) % 2) - 1)), m = 0.55 - c / 2
  const sec = (hue * 6) | 0
  let r = 0, g = 0, b = 0
  if (sec === 0) { r = c; g = x } else if (sec === 1) { r = x; g = c }
  else if (sec === 2) { g = c; b = x } else if (sec === 3) { g = x; b = c }
  else if (sec === 4) { r = x; b = c } else { r = c; b = x }
  return ((Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255))
}

export class TagBadgeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Per-tile tag badge — colour-coded dots marking which tags define each visible tile.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:cell-tags',
    'render:mesh-offset', 'render:geometry-changed', 'render:set-orientation',
    'tags:registry',
  ]
  protected override emits: string[] = []

  #container: Container | null = null
  #layer: Container | null = null

  #spacing = 38
  #circum = 32
  #flat = false
  #meshOffset = { x: 0, y: 0 }

  #coordByLabel = new Map<string, Axial>()
  #tagsByLabel = new Map<string, string[]>()
  #badges = new Map<string, Container>()
  #lastKey = ''
  #initialized = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.#container = payload.container
      this.#ensureLayer()
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
      this.#refresh()
    })

    this.onEffect<CellTagsPayload>('render:cell-tags', (payload) => {
      this.#tagsByLabel.clear()
      const byLabel = payload?.byLabel ?? {}
      for (const [label, tags] of Object.entries(byLabel)) {
        if (Array.isArray(tags) && tags.length) this.#tagsByLabel.set(label, tags.filter(t => typeof t === 'string'))
      }
      this.#refresh()
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

    // A tag's colour changed in the registry — repaint dots (force).
    this.onEffect('tags:registry', () => this.#refresh(true))
  }

  protected override dispose(): void {
    for (const box of this.#badges.values()) box.destroy({ children: true })
    this.#badges.clear()
    if (this.#layer) { this.#layer.destroy({ children: true }); this.#layer = null }
  }

  #ensureLayer(): void {
    if (!this.#container || this.#layer) return
    this.#layer = new Container()
    this.#layer.zIndex = BADGE_Z
    this.#layer.eventMode = 'none'
    this.#container.addChild(this.#layer)
    this.#container.sortableChildren = true
  }

  #color(name: string): number {
    try {
      const registry = (window as unknown as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(TAG_REGISTRY_KEY) as
        | { color?: (n: string) => string } | undefined
      const hex = registry?.color?.(name) ?? ''
      const num = hex ? hexToNum(hex) : null
      return num ?? fallbackColor(name)
    } catch { return fallbackColor(name) }
  }

  #refresh(force = false): void {
    if (!this.#layer) return

    // Cheap no-op guard: rebuild only when the visible tag set changed.
    let key = ''
    for (const [label, coord] of this.#coordByLabel) {
      const tags = this.#tagsByLabel.get(label)
      if (tags?.length) key += `${label}:${coord.q},${coord.r}:${tags.join('.')}|`
    }
    if (!force && key === this.#lastKey) return
    this.#lastKey = key

    const wanted = new Set<string>()
    for (const [label, coord] of this.#coordByLabel) {
      const tags = this.#tagsByLabel.get(label)
      if (!tags?.length) continue
      wanted.add(label)
      this.#upsert(label, coord, tags)
    }
    for (const [label, box] of this.#badges) {
      if (!wanted.has(label)) { box.destroy({ children: true }); this.#badges.delete(label) }
    }
  }

  #upsert(label: string, coord: Axial, tags: string[]): void {
    // Rebuild the chip contents from scratch — tag sets are small and change
    // rarely, so a clean redraw is simpler than diffing individual dots.
    let box = this.#badges.get(label)
    if (box) box.destroy({ children: true })
    box = new Container()
    box.eventMode = 'none'

    const bg = new Graphics()
    box.addChild(bg)

    const shown = Math.min(tags.length, MAX_DOTS)
    const overflow = tags.length - shown
    // When overflowing, the last visible slot is a "+N" label, so draw one
    // fewer dot to make room for it.
    const dotCount = overflow > 0 ? shown - 1 : shown

    let x = 0
    for (let i = 0; i < dotCount; i++) {
      const dot = new Graphics()
      dot.circle(x + DOT_R, 0, DOT_R).fill({ color: this.#color(tags[i]) })
      box.addChild(dot)
      x += DOT_R * 2 + DOT_GAP
    }

    let contentW = x - DOT_GAP
    if (overflow > 0) {
      const more = new Text({
        text: `+${overflow + 1}`,
        style: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 9, fontWeight: '700', fill: 0xcfe2ee },
      })
      more.anchor.set(0, 0.5)
      more.position.set(x, 0)
      box.addChild(more)
      contentW = x + more.width
    }
    if (contentW < DOT_R * 2) contentW = DOT_R * 2

    // Pill behind the row — cold fill + steel hairline.
    const h = DOT_R * 2 + PAD * 2
    bg.roundRect(-PAD, -h / 2, contentW + PAD * 2, h, h / 2)
      .fill({ color: PILL_FILL, alpha: PILL_FILL_ALPHA })
      .stroke({ color: PILL_STROKE, width: 1, alpha: PILL_STROKE_ALPHA })
    // Pull the freshly-filled pill behind the dots.
    box.setChildIndex(bg, 0)

    this.#layer!.addChild(box)
    this.#badges.set(label, box)
    this.#place(box, coord)
  }

  #place(box: Container, coord: Axial): void {
    const px = this.#axialToPixel(coord.q, coord.r)
    const cx = px.x + this.#meshOffset.x
    const cy = px.y + this.#meshOffset.y
    // Top-left of the hex, mirroring presence-badge's top-right anchor.
    box.position.set(cx - this.#circum * 0.62, cy - this.#circum * 0.74)
  }

  #reposition(): void {
    for (const [label, box] of this.#badges) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#place(box, coord)
    }
  }

  #axialToPixel(q: number, r: number): { x: number; y: number } {
    return this.#flat
      ? { x: 1.5 * this.#spacing * q, y: Math.sqrt(3) * this.#spacing * (r + q / 2) }
      : { x: Math.sqrt(3) * this.#spacing * (q + r / 2), y: this.#spacing * 1.5 * r }
  }
}

const _tagBadge = new TagBadgeDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/TagBadgeDrone', _tagBadge,
)
