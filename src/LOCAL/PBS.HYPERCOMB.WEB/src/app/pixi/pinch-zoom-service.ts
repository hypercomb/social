import { Injectable, Injector, effect, inject, signal } from '@angular/core'
import { IHitArea, Rectangle } from 'pixi.js'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'
import { PointerState } from 'src/app/state/input/pointer-state'
import { LayoutState } from '../layout/layout-state'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'
import { ZoomService } from './zoom-service'

@Injectable({ providedIn: 'root' })
export class PinchZoomService extends PixiDataServiceBase {
  private readonly ps = inject(PointerState)
  private readonly ls = inject(LayoutState)
  private readonly navigation = inject(LinkNavigationService)
  private readonly injector = inject(Injector)
  private readonly zoomService = inject(ZoomService)

  private minScale = 0
  private maxScale = 0

  // pinch working state
  private readonly isPinching = signal(false)
  private startDistance = 0
  private startCenter = { x: 0, y: 0 }
  private startScaleX = 1
  private startScaleY = 1
  private startPosX = 0
  private startPosY = 0

  public pinchTimestamp: number | null = null

  constructor() {
    super()

    effect(
      async (onCleanup) => {
        const container = this.pixi.container // reactive read
        const positions = this.ps.pointerPositions() // reactive read

        if (!container) return // pixi not ready yet

        const canvas = this.pixi.canvas()
        if (!canvas) return // pixi not ready yet


        // lazy-init once per container
        if (this.minScale === 0 && this.maxScale === 0) {
          this.minScale = this.ls.minScale
          this.maxScale = this.ls.maxScale
          container.eventMode = 'static'
          container.hitArea ??= new Rectangle(-1e6, -1e6, 2e6, 2e6) as IHitArea
          const canvas = this.pixi.canvas()!
          canvas.style.touchAction = 'none'
        }

        if (positions.size < 2 || this.state.hasMode(HypercombMode.Transport)) {
          this.isPinching.set(false)
          return
        }

        const [p1, p2] = Array.from(positions.values()) as { x: number; y: number }[]
        if (!p1 || !p2) return

        if (!this.isPinching()) {
          // pinch start
          this.startDistance = this.distance(p1, p2)
          this.startCenter = this.center(p1, p2)
          this.startScaleX = container.scale.x
          this.startScaleY = container.scale.y
          this.startPosX = container.x
          this.startPosY = container.y
          this.pinchTimestamp = Date.now()
          this.isPinching.set(true)
          return
        }

        // pinch update
        const currDistance = this.distance(p1, p2)
        if (this.startDistance <= 0) return

        let factor = currDistance / this.startDistance
        const damp = this.settings.isMac ? 0.375 : 1.5
        factor = 1 + (factor - 1) * damp

        const newScale = this.clamp(this.startScaleX * factor, this.minScale, this.maxScale)

        // use the same adjustZoom logic from ZoomService
        const { x: px, y: py } = this.startCenter
        await this.zoomService.setZoom(newScale, { x: px, y: py })

        this.navigation.setResetTimeout()


        const wxOld = (px - this.startPosX) / this.startScaleX
        const wyOld = (py - this.startPosY) / this.startScaleY

        container.scale.set(newScale, newScale)
        container.x = px - wxOld * newScale
        container.y = py - wyOld * newScale

        const cell = this.stack.cell()!
        cell.scale = newScale
        cell.x = container.x
        cell.y = container.y

        await this.saveTransform()

        this.navigation.setResetTimeout()

        // cleanup if PixiManager replaces the container
        onCleanup(() => {
          this.isPinching.set(false)
        })
      },
      {
        injector: this.injector
      },
    )
  }

  // helpers
  private distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y)

  private center = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })

  private clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(v, lo), hi)
}
