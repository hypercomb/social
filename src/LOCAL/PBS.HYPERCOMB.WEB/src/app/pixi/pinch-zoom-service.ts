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
  private minScale = 0
  private maxScale = 0
  private readonly isPinching = signal(false)
  private initialScale = 0
  private startDistance = 0
  private prevDistance = 0
  private zoomSpeed = 2.8 // Adjusted for smoother feel
  private smoothingFactor = 0.6 // For exponential smoothing
  private deltaHistory: number[] = []
  constructor() {
    super()
    effect(
      (onCleanup) => {
        const container = this.pixi.container
        const positions = this.ps.pointerPositions()
        if (!container) return
        const canvas = this.pixi.canvas()
        if (!canvas) return
        if (this.minScale === 0 && this.maxScale === 0) {
          this.minScale = this.ls.minScale
          this.maxScale = this.ls.maxScale
          container.eventMode = 'static'
          container.hitArea ??= new Rectangle(-1e6, -1e6, 2e6, 2e6) as IHitArea
          canvas.style.touchAction = 'none'
        }
        if (positions.size < 2 || this.state.hasMode(HypercombMode.Transport)) {
          if (this.isPinching()) {
            this.zoomService.triggerSave()
          }
          this.isPinching.set(false)
          this.initialScale = 0
          this.startDistance = 0
          this.prevDistance = 0
          this.deltaHistory = []
          return
        }
        const [p1, p2] = Array.from(positions.values()) as { x: number; y: number }[]
        if (!p1 || !p2) return
        const center = this.center(p1, p2)
        const distance = this.distance(p1, p2)
        if (!this.isPinching()) {
          if (distance <= 0) return
          this.initialScale = container.scale.x
          this.startDistance = distance
          this.prevDistance = distance
          this.isPinching.set(true)
          this.deltaHistory = []
          return
        }
        if (this.prevDistance <= 0 || this.startDistance <= 0) {
          this.isPinching.set(false)
          return
        }
        if (Math.abs(distance - this.prevDistance) < 3) return // ignore jitter
        const rawFactor = distance / this.startDistance
        const damp = this.settings.isMac ? 0.375 : 1.5
        let delta = Math.pow(rawFactor, this.zoomSpeed * damp)
        // Apply smoothing
        this.deltaHistory.push(delta)
        if (this.deltaHistory.length > 5) this.deltaHistory.shift()
        delta = this.deltaHistory.reduce((sum, d) => sum + d, 0) / this.deltaHistory.length
        if (this.deltaHistory.length > 1) {
          const prevSmooth = this.deltaHistory[this.deltaHistory.length - 2]
          delta = prevSmooth * this.smoothingFactor + delta * (1 - this.smoothingFactor)
        }
        if (Math.abs(delta - 1) < 0.005) return // skip negligible
        const newScale = this.initialScale * delta
        this.zoomService.setZoom(newScale, center)
        this.navigation.setResetTimeout()
        this.prevDistance = distance
        onCleanup(() => {
          this.isPinching.set(false)
          this.initialScale = 0
          this.startDistance = 0
          this.prevDistance = 0
          this.deltaHistory = []
        })
      },
      { injector: this.injector }
    )
  }
  private distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)
  private center = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })
}