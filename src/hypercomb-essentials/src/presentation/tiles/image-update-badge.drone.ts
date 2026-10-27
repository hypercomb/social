// presentation/tiles/image-update-badge.drone.ts
//
// THE NEW-PICTURES BADGE — a small mint dot on the top-left shoulder of a tile
// when a domain has reported pictures for that tile's NAME that this participant
// has not been shown (sharing/image-updates.ts). Pressing it opens the images
// wall, where the new pictures are marked: take one, or dismiss. Answering —
// either way — clears the badge.
//
// Presence's badge is a notification that never takes a click; this one is the
// one that does, so it carries its own hit test (the layer is non-interactive
// by design) and swallows the press it answers so the tile underneath is not
// also entered.
//
// What is "unseen" is the participant's own private record (image-updates.ts);
// the same name answers the same anywhere in the hierarchy.

import { Drone } from '@hypercomb/core'
import { Container, Graphics, Point, Text } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.worker.js'
import { TileBadgeLayer, BADGE_CORNER, type Axial } from './badge-layer.js'
import { trackSceneText } from '../grid/screen-text-resolution.js'
import { IMAGE_UPDATES_EFFECT, unseenPictures } from '../../sharing/image-updates.js'

type CellCountPayload = { count: number; labels: string[]; coords: Axial[] }

const BADGE_Z = 9997                 // under the presence badge and the icon overlay
const RADIUS = 6.5
/** How far from the dot's centre a press still counts as on it — a small target deserves a forgiving one. */
const HIT_RADIUS = RADIUS * 1.7
const FILL = 0xa8ffd8
const RING = 0x0c1c2e
const INK = 0x0c1c2e
/** Re-ask the (cached, rate-limited) answer now and then so a badge raised by a late host report appears. */
const POLL_MS = 20_000

export class ImageUpdateBadgeDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'presentation'
  public override description =
    'Per-tile new-pictures badge — a tile whose name has pictures from domains you have not been shown; press it to choose or dismiss.'
  public override effects = ['render'] as const

  protected override deps = {}
  protected override listens: string[] = [
    'render:host-ready', 'render:cell-count', 'render:mesh-offset', 'render:geometry-changed',
    'render:set-orientation', 'render:set-hive-visible', IMAGE_UPDATES_EFFECT,
  ]
  protected override emits: string[] = ['images:open']

  #layer = new TileBadgeLayer(BADGE_Z)
  #renderer: HostReadyPayload['renderer'] | null = null
  #canvas: HTMLCanvasElement | null = null
  #container: Container | null = null
  #coordByLabel = new Map<string, Axial>()
  #badges = new Map<string, { box: Container; text: Text; count: number }>()
  #hiveHidden = false
  #pollTimer: ReturnType<typeof setInterval> | null = null
  #initialized = false
  /** The label a press began on, from pointerdown to the release that opens its wall. */
  #pressed: string | null = null
  #swallowClick = false

  protected override sense = () => true

  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<HostReadyPayload>('render:host-ready', (p) => {
      if (!p?.container) return
      this.#container = p.container
      this.#renderer = p.renderer
      this.#canvas = p.canvas
      this.#layer.attach(p.container)
      this.#refresh()
    })
    this.onEffect<CellCountPayload>('render:cell-count', (p) => {
      this.#coordByLabel.clear()
      const labels = p?.labels ?? []
      const coords = p?.coords ?? []
      for (let i = 0; i < labels.length; i++) if (labels[i] && coords[i]) this.#coordByLabel.set(labels[i], { q: coords[i].q, r: coords[i].r })
      this.#refresh()
    })
    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (o) => { this.#layer.setMeshOffset(o); this.#reposition() })
    this.onEffect<{ spacing?: number; circumRadiusPx?: number }>('render:geometry-changed', (g) => { this.#layer.setGeometry(g); this.#reposition() })
    this.onEffect<{ flat?: boolean }>('render:set-orientation', (p) => { this.#layer.setOrientation(!!p?.flat); this.#reposition() })
    // The images wall, the screensaver and the like own the surface: no badge over them.
    this.onEffect<{ visible: boolean }>('render:set-hive-visible', (p) => {
      this.#hiveHidden = !p?.visible
      if (this.#layer.layer) this.#layer.layer.visible = !this.#hiveHidden
    })
    this.onEffect(IMAGE_UPDATES_EFFECT, () => this.#refresh())

    this.#pollTimer = setInterval(() => this.#refresh(), POLL_MS)
    window.addEventListener('pointerdown', this.#onDown, true)
    window.addEventListener('pointerup', this.#onUp, true)
    window.addEventListener('click', this.#onClick, true)
  }

  protected override dispose(): void {
    if (this.#pollTimer) { clearInterval(this.#pollTimer); this.#pollTimer = null }
    window.removeEventListener('pointerdown', this.#onDown, true)
    window.removeEventListener('pointerup', this.#onUp, true)
    window.removeEventListener('click', this.#onClick, true)
    for (const b of this.#badges.values()) b.box.destroy({ children: true })
    this.#badges.clear()
    this.#layer.destroy()
  }

  #refresh(): void {
    if (!this.#layer.layer) return
    const wanted = new Set<string>()
    for (const [label, coord] of this.#coordByLabel) {
      const count = unseenPictures(label).size
      if (count <= 0) continue
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
      const dot = new Graphics()
      dot.circle(0, 0, RADIUS).fill({ color: FILL, alpha: 1 }).stroke({ color: RING, width: 1.2, alpha: 0.9 })
      const text = new Text({
        text: '',
        style: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', fontSize: 9, fontWeight: '700', fill: INK },
      })
      text.anchor.set(0.5)
      trackSceneText(text, this.#layer.layer!)
      box.addChild(dot, text)
      this.#layer.layer!.addChild(box)
      b = { box, text, count: -1 }
      this.#badges.set(label, b)
    }
    if (b.count !== count) { b.text.text = count > 9 ? '9+' : String(count); b.count = count }
    this.#layer.place(b.box, coord, BADGE_CORNER.topLeft)
  }

  #reposition(): void {
    for (const [label, b] of this.#badges) {
      const coord = this.#coordByLabel.get(label)
      if (coord) this.#layer.place(b.box, coord, BADGE_CORNER.topLeft)
    }
  }

  // ── the press ──────────────────────────────────────────────────────

  /** The badge under a screen point, in the render container's own space. */
  #badgeAt(clientX: number, clientY: number): string | null {
    if (this.#hiveHidden || !this.#container || !this.#renderer || !this.#canvas || this.#badges.size === 0) return null
    const events = (this.#renderer as { events?: { mapPositionToPoint?: (p: Point, x: number, y: number) => void } }).events
    const global = new Point()
    if (events?.mapPositionToPoint) events.mapPositionToPoint(global, clientX, clientY)
    else {
      const rect = this.#canvas.getBoundingClientRect()
      const screen = this.#renderer.screen
      global.set((clientX - rect.left) * (screen.width / rect.width), (clientY - rect.top) * (screen.height / rect.height))
    }
    const p = this.#container.toLocal(global)
    for (const [label, b] of this.#badges) {
      if (Math.hypot(p.x - b.box.position.x, p.y - b.box.position.y) <= HIT_RADIUS) return label
    }
    return null
  }

  #onDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const label = this.#badgeAt(e.clientX, e.clientY)
    if (!label) return
    this.#pressed = label
    e.preventDefault()
    e.stopImmediatePropagation()       // the tile under the badge must not also be pressed
  }

  #onUp = (e: PointerEvent): void => {
    const label = this.#pressed
    if (!label) return
    this.#pressed = null
    e.preventDefault()
    e.stopImmediatePropagation()
    this.#swallowClick = true
    // Released on the same badge it was pressed on — otherwise it was a drag away.
    if (this.#badgeAt(e.clientX, e.clientY) !== label) return
    const segments = window.ioc.get<{ explorerSegments?: () => readonly string[] }>('@hypercomb.social/Lineage')
      ?.explorerSegments?.() ?? []
    this.emitEffect('images:open', { label, segments: [...segments] })
  }

  #onClick = (e: MouseEvent): void => {
    if (!this.#swallowClick) return
    this.#swallowClick = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }
}

const _imageUpdateBadge = new ImageUpdateBadgeDrone()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ImageUpdateBadgeDrone', _imageUpdateBadge,
)
