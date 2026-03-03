// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
// Contextual action overlay: shows clickable icons at hex vertices on occupied tiles.

import { Drone } from '@hypercomb/core'
import { Application, Container, Graphics, Text, TextStyle, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial } from '../input/hex-detector.js'
import type { HistoryEffectPayload } from '../core/history.service.js'

type CellCountPayload = { count: number; labels: string[] }

// icon offset from hex center (flat-top hex, bottom-right vertex area)
const ICON_OFFSET_X = 16
const ICON_OFFSET_Y = 28

export class TileOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'contextual action overlay on occupied hex tiles'

  private app: Application | null = null
  private renderContainer: Container | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: Application['renderer'] | null = null

  private overlay: Container | null = null
  private removeIcon: Container | null = null
  private meshOffset = { x: 0, y: 0 }
  private currentAxial: Axial | null = null
  private currentIndex: number | undefined = undefined

  private readonly circumRadiusPx = 32
  private readonly gapPx = 6
  private readonly spacing = 38 // circumRadiusPx + gapPx

  private cellCount = 0
  private cellLabels: string[] = []

  private initialized = false
  private listening = false
  private _hoverLog = 0

  // occupied positions — precomputed from render:cell-count + axial service
  private occupiedByAxial = new Map<string, { index: number; label: string }>()

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count']
  protected override emits = ['tile:hover', 'tile:action', 'history:op']

  protected override sense = (): boolean => {
    const prev = this.initialized
    this.initialized = true
    return !prev
  }

  protected override heartbeat = async (): Promise<void> => {
    this.onEffect<HostReadyPayload>('render:host-ready', (payload) => {
      this.app = payload.app
      this.renderContainer = payload.container
      this.canvas = payload.canvas
      this.renderer = payload.renderer
      this.initOverlay()
      this.attachListeners()
    })

    this.onEffect<{ x: number; y: number }>('render:mesh-offset', (offset) => {
      this.meshOffset = offset
      if (this.currentAxial) {
        this.positionOverlay(this.currentAxial.q, this.currentAxial.r)
      }
    })

    this.onEffect<CellCountPayload>('render:cell-count', (payload) => {
      this.cellCount = payload.count
      this.cellLabels = payload.labels
      console.log('[TileOverlay] render:cell-count →', payload.count)
      this.rebuildOccupiedMap()
      // re-evaluate visibility for current hover
      if (this.overlay && this.currentAxial) {
        this.currentIndex = this.lookupIndex(this.currentAxial.q, this.currentAxial.r)
        this.updateVisibility()
      }
    })
  }

  protected override dispose(): void {
    if (this.listening) {
      document.removeEventListener('pointermove', this.onPointerMove)
      document.removeEventListener('click', this.onClick)
      this.listening = false
    }
    if (this.overlay) {
      this.overlay.destroy({ children: true })
      this.overlay = null
      this.removeIcon = null
    }
  }

  // -------------------------------------------------
  // overlay setup
  // -------------------------------------------------

  private initOverlay(): void {
    if (!this.renderContainer || this.overlay) return

    this.overlay = new Container()
    this.overlay.visible = false
    this.overlay.zIndex = 9999

    // create icon immediately with a Graphics fallback, upgrade to font async
    this.removeIcon = new Container()
    this.removeIcon.position.set(ICON_OFFSET_X, ICON_OFFSET_Y)

    // fallback: simple red X drawn with Graphics (always works)
    const fallback = new Graphics()
    fallback.circle(0, 0, 8)
    fallback.fill({ color: 0xff4444, alpha: 0.85 })
    const s = 4
    fallback.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 1 })
    fallback.moveTo(-s, -s).lineTo(s, s).stroke()
    fallback.moveTo(s, -s).lineTo(-s, s).stroke()
    this.removeIcon.addChild(fallback)

    this.overlay.addChild(this.removeIcon)
    this.renderContainer.addChild(this.overlay)
    this.renderContainer.sortableChildren = true

    console.log('[TileOverlay] overlay created with fallback icon')

    // async: try to upgrade to the icon font glyph
    this.loadIconFont().then((loaded) => {
      if (!loaded || !this.removeIcon) return
      console.log('[TileOverlay] upgrading to hypercomb-icons font')

      // remove the Graphics fallback
      this.removeIcon.removeChildren()

      const icon = new Text({
        text: 'h',
        style: new TextStyle({
          fontFamily: 'hypercomb-icons',
          fontSize: 16,
          fill: 0xff4444,
        }),
      })
      icon.anchor.set(0.5)
      this.removeIcon.addChild(icon)
    })
  }

  private async loadIconFont(): Promise<boolean> {
    try {
      const font = new FontFace('hypercomb-icons', 'url(/fonts/hypercomb-icons.ttf)')
      const loaded = await font.load()
      document.fonts.add(loaded)
      await document.fonts.ready
      return true
    } catch (e) {
      console.warn('[TileOverlay] font load failed:', e)
      return false
    }
  }

  // -------------------------------------------------
  // listener setup
  // -------------------------------------------------

  private attachListeners(): void {
    if (this.listening) return
    this.listening = true
    document.addEventListener('pointermove', this.onPointerMove)
    document.addEventListener('click', this.onClick)
  }

  // -------------------------------------------------
  // pointer tracking
  // -------------------------------------------------

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.renderContainer || !this.overlay || !this.renderer || !this.canvas) return

    const detector = this.resolve<{ pixelToAxial(px: number, py: number): Axial }>('detector')
    if (!detector) return

    // 1. CSS client → pixi global
    const pixiGlobal = this.clientToPixiGlobal(e.clientX, e.clientY)

    // 2. pixi global → renderContainer local
    const local = this.renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))

    // 3. subtract mesh centering offset → mesh-local coords
    const meshLocalX = local.x - this.meshOffset.x
    const meshLocalY = local.y - this.meshOffset.y

    // 4. O(1) axial rounding
    const axial = detector.pixelToAxial(meshLocalX, meshLocalY)

    // 5. skip if same hex
    if (this.currentAxial && this.currentAxial.q === axial.q && this.currentAxial.r === axial.r) return

    this.currentAxial = axial

    // 6. determine index for this axial coordinate (O(1) precomputed lookup)
    this.currentIndex = this.lookupIndex(axial.q, axial.r)

    if (this._hoverLog < 5) {
      console.log('[TileOverlay] hover q:', axial.q, 'r:', axial.r, '→ index:', this.currentIndex, 'cellCount:', this.cellCount, 'occupied:', this.occupiedByAxial.size)
      this._hoverLog++
    }

    // 7. position the overlay (visibility decided by updateVisibility)
    this.positionOverlay(axial.q, axial.r)

    // 8. broadcast for other drones
    this.emitEffect('tile:hover', { q: axial.q, r: axial.r })
  }

  // -------------------------------------------------
  // click detection
  // -------------------------------------------------

  private onClick = (e: MouseEvent): void => {
    if (!this.overlay?.visible || !this.renderContainer || !this.renderer || !this.canvas) return
    if (this.currentIndex === undefined || this.currentIndex >= this.cellCount) return

    // convert click to overlay-local coords
    const pixiGlobal = this.clientToPixiGlobal(e.clientX, e.clientY)
    const local = this.renderContainer.toLocal(new Point(pixiGlobal.x, pixiGlobal.y))

    // overlay position in renderContainer space
    const overlayX = this.overlay.position.x
    const overlayY = this.overlay.position.y

    // remove icon offset from overlay center
    const iconWorldX = overlayX + ICON_OFFSET_X
    const iconWorldY = overlayY + ICON_OFFSET_Y

    const dx = local.x - iconWorldX
    const dy = local.y - iconWorldY
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist <= 12) {
      const entry = this.occupiedByAxial.get(TileOverlayDrone.axialKey(this.currentAxial!.q, this.currentAxial!.r))
      const label = entry?.label
      if (!label) return

      this.emitEffect('tile:action', {
        action: 'remove',
        q: this.currentAxial!.q,
        r: this.currentAxial!.r,
        index: this.currentIndex,
        label,
      })

      this.handleRemove(label)
    }
  }

  private handleRemove = (label: string): void => {
    const payload: HistoryEffectPayload = {
      op: 'remove',
      seed: label,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }
    this.emitEffect('history:op', payload)
  }

  // -------------------------------------------------
  // visibility
  // -------------------------------------------------

  private updateVisibility(): void {
    if (!this.overlay) return
    const occupied = this.currentIndex !== undefined && this.currentIndex < this.cellCount
    this.overlay.visible = occupied
  }

  // -------------------------------------------------
  // positioning
  // -------------------------------------------------

  private positionOverlay(q: number, r: number): void {
    if (!this.overlay) return

    const px = this.axialToPixel(q, r)
    this.overlay.position.set(
      px.x + this.meshOffset.x,
      px.y + this.meshOffset.y
    )

    this.updateVisibility()
  }

  private axialToPixel(q: number, r: number) {
    return {
      x: Math.sqrt(3) * this.spacing * (q + r / 2),
      y: this.spacing * 1.5 * r
    }
  }

  // -------------------------------------------------
  // occupied position lookup (precomputed from render:cell-count)
  // -------------------------------------------------

  private static axialKey(q: number, r: number): string {
    return `${q},${r}`
  }

  private rebuildOccupiedMap(): void {
    this.occupiedByAxial.clear()
    const axial = this.resolve<any>('axial')
    if (!axial?.items) return

    for (let i = 0; i < this.cellCount; i++) {
      const coord = axial.items.get(i) as Axial | undefined
      const label = this.cellLabels[i]
      if (!coord || !label) break
      this.occupiedByAxial.set(TileOverlayDrone.axialKey(coord.q, coord.r), { index: i, label })
    }
  }

  private lookupIndex(q: number, r: number): number | undefined {
    return this.occupiedByAxial.get(TileOverlayDrone.axialKey(q, r))?.index
  }

  // -------------------------------------------------
  // coordinate mapping (same approach as ZoomDrone)
  // -------------------------------------------------

  private clientToPixiGlobal(cx: number, cy: number) {
    const events = (this.renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, cx, cy)
      return { x: out.x, y: out.y }
    }

    const rect = this.canvas!.getBoundingClientRect()
    const screen = this.renderer!.screen
    return {
      x: (cx - rect.left) * (screen.width / rect.width),
      y: (cy - rect.top) * (screen.height / rect.height)
    }
  }
}

const _tileOverlay = new TileOverlayDrone()
window.ioc.register('@diamondcoreprocessor.com/TileOverlayDrone', _tileOverlay)
