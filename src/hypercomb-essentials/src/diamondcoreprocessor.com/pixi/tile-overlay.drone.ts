// hypercomb-essentials/src/diamondcoreprocessor.com/pixi/tile-overlay.drone.ts
// Contextual action overlay: shows clickable icons at hex vertices on occupied tiles.

import { Drone } from '@hypercomb/core'
import { Application, Container, Text, TextStyle, Point } from 'pixi.js'
import type { HostReadyPayload } from './pixi-host.drone.js'
import type { Axial } from '../input/hex-detector.js'
import type { HistoryService } from '../core/history.service.js'

type CellCountPayload = { count: number; labels: string[] }

export class TileOverlayDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'contextual action overlay on occupied hex tiles'

  private app: Application | null = null
  private renderContainer: Container | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: Application['renderer'] | null = null

  private overlay: Container | null = null
  private removeIcon: Text | null = null
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

  // occupied positions — precomputed from render:cell-count + axial service
  private occupiedByAxial = new Map<string, { index: number; label: string }>()

  protected override deps = {
    detector: '@diamondcoreprocessor.com/HexDetector',
    axial: '@diamondcoreprocessor.com/AxialService',
  }
  protected override listens = ['render:host-ready', 'render:mesh-offset', 'render:cell-count']
  protected override emits = ['tile:hover', 'tile:action']

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

    this.loadIconFont().then(() => {
      if (!this.overlay || !this.renderContainer) return

      const icon = new Text({
        text: 'h',
        style: new TextStyle({
          fontFamily: 'hypercomb-icons',
          fontSize: 16,
          fill: 0xffffff,
        }),
      })
      icon.anchor.set(0.5)
      icon.alpha = 0.5
      // position in the bottom nook of the hex
      icon.position.set(0, this.circumRadiusPx - 8)

      this.removeIcon = icon
      this.overlay.addChild(icon)
    })

    this.renderContainer.addChild(this.overlay)
    this.renderContainer.sortableChildren = true
  }

  private async loadIconFont(): Promise<void> {
    try {
      const font = new FontFace('hypercomb-icons', 'url(/fonts/hypercomb-icons.ttf)')
      const loaded = await font.load()
      document.fonts.add(loaded)
    } catch {
      // font may already be loaded via CSS @font-face
    }
    await document.fonts.ready
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

    // remove icon is at (0, circumRadiusPx - 8) relative to overlay center
    const iconWorldX = overlayX
    const iconWorldY = overlayY + this.circumRadiusPx - 8

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

  private handleRemove = async (label: string): Promise<void> => {
    const lineage = (window as any).ioc?.get?.('@hypercomb.social/Lineage')
    const historyService = (window as any).ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as HistoryService | undefined
    if (!lineage || !historyService) return

    const sig = await historyService.sign(lineage)
    await historyService.record(sig, { op: 'remove', seed: label, at: Date.now() })
    // record() dispatches synchronize, which triggers ShowHoneycombDrone re-render
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
