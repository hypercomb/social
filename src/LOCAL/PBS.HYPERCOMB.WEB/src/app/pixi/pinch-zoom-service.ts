// src/app/pixi/pinch-zoom-service.ts
import { Injectable, Injector, effect, inject, signal } from '@angular/core'
import { IHitArea, Rectangle } from 'pixi.js'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'
import { PointerState } from 'src/app/state/input/pointer-state'
import { LayoutState } from '../layout/layout-state'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'
import { ZoomService } from './zoom-service'
import { PanningManager } from './panning-manager'  // ← NEW

@Injectable({ providedIn: 'root' })
export class PinchZoomService extends PixiDataServiceBase {
  private readonly ps = inject(PointerState)
  private readonly ls = inject(LayoutState)
  private readonly navigation = inject(LinkNavigationService)
  private readonly injector = inject(Injector)
  private readonly zoomService = inject(ZoomService)
  private readonly panning = inject(PanningManager)  // ← NEW: Control panning

  private minScale = 0
  private maxScale = 0

  // Pinch state
  private readonly isPinching = signal(false)
  private startDistance = 0
  private startCenter = { x: 0, y: 0 }
  private startScaleX = 1
  private startPosX = 0
  private startPosY = 0
  public pinchTimestamp: number | null = null

  constructor() {
    super()
    effect(
      async (onCleanup) => {
        const container = this.pixi.container
        const positions = this.ps.pointerPositions()
        if (!container || !this.pixi.canvas()) return

        // Lazy init
        if (this.minScale === 0) {
          this.minScale = this.ls.minScale
          this.maxScale = this.ls.maxScale
          container.eventMode = 'static'
          container.hitArea ??= new Rectangle(-1e6, -1e6, 2e6, 2e6) as IHitArea
          this.pixi.canvas()!.style.touchAction = 'none'
        }

        // === DISABLE PANNING DURING PINCH ===
        if (positions.size >= 2) {
          this.panning.getTouch().disable()
          this.panning.getSpacebar().disable()
        }
        // === RE-ENABLE WHEN PINCH ENDS ===
        else if (positions.size === 0 && this.isPinching()) {
          this.panning.getTouch().enable()
          this.panning.getSpacebar().enable()
        }

        if (positions.size < 2 || this.state.hasMode(HypercombMode.Transport)) {
          if (this.isPinching()) this.isPinching.set(false)
          return
        }

        const pointers = Array.from(positions.values())
        if (pointers.length < 2) return
        const [p1, p2] = pointers as [{ x: number; y: number }, { x: number; y: number }]

        if (!this.isPinching()) {
          // Pinch start
          this.startDistance = this.distance(p1, p2)
          this.startCenter = this.center(p1, p2)
          this.startScaleX = container.scale.x
          this.startPosX = container.x
          this.startPosY = container.y
          this.pinchTimestamp = Date.now()
          this.isPinching.set(true)
          return
        }

        // Pinch update
        const currDistance = this.distance(p1, p2)
        if (this.startDistance <= 0) return

        let factor = currDistance / this.startDistance
        const damp = this.settings.isMac ? 0.375 : 1.5
        factor = 1 + (factor - 1) * damp

        const newScale = this.clamp(this.startScaleX * factor, this.minScale, this.maxScale)
        await this.zoomService.setZoom(newScale, this.startCenter)

        this.navigation.setResetTimeout()

        onCleanup(() => this.isPinching.set(false))
      },
      { injector: this.injector }
    )
  }

  private distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y)

  private center = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })

  private clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(v, lo), hi)
}