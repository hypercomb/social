// src/app/pixi/touch-zoom-service.ts
import { Injectable, Injector, effect, inject, signal } from '@angular/core'
import { IHitArea, Rectangle } from 'pixi.js'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'
import { PointerState } from 'src/app/state/input/pointer-state'
import { LayoutState } from '../layout/layout-state'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'
import { ZoomService } from './zoom-service'
import { TouchPanningService } from './touch-panning-service'

@Injectable({ providedIn: 'root' })
export class TouchZoomService extends PixiDataServiceBase {
  private readonly ps = inject(PointerState)
  private readonly ls = inject(LayoutState)
  private readonly navigation = inject(LinkNavigationService)
  private readonly injector = inject(Injector)
  private readonly zoomService = inject(ZoomService)
  private readonly touchPan = inject(TouchPanningService)

  private minScale = 0
  private maxScale = 0

  // locked during pinch
  private isPinching = signal(false)

  // scaling
  private initialScale = 0
  private startDistance = 0
  private prevDistance = 0

  // robust anchor
  private pinchCenter = { x: 0, y: 0 }
  private pinchLocked = false
  private primaryFinger: { x: number; y: number } | null = null

  // smoothing
  private zoomSpeed = 2.4
  private smoothingFactor = 0.6
  private deltaHistory: number[] = []

  constructor() {
    super()

    effect(
      (onCleanup) => {
        const container = this.pixi.container
        const positions = this.ps.pointerPositions()
        const touches = Array.from(positions.values()) as { x: number; y: number }[]
        const pinching = this.isPinching()
        if (!container) return

        if (positions.size === 0) {
          this.primaryFinger = null
        } else if (positions.size === 1 && !pinching) {
          this.primaryFinger = { ...touches[0] }
        }

        // === STATE: less than 2 fingers → stop pinch, allow panning ===
        if (positions.size < 2 || this.state.hasMode(HypercombMode.Transport)) {

          if (pinching) {
            this.saveTransform()
            if (touches.length === 1) {
              this.primaryFinger = { ...touches[0] }
              this.touchPan.resumeAfterPinch(touches[0])
            }
          }

          this.isPinching.set(false)
          this.pinchLocked = false

          // reset internal values
          this.initialScale = 0
          this.startDistance = 0
          this.prevDistance = 0
          this.deltaHistory = []

          return
        }

        // === pinch handling ===
        const [p1, p2] = touches as { x: number; y: number }[]
        if (!p1 || !p2) return

        const center = this.center(p1, p2)
        const distance = this.distance(p1, p2)

        // begin pinch
        if (!this.isPinching()) {
          if (distance <= 0) return

          this.touchPan.cancelPanSession()
          this.isPinching.set(true)
          this.initialScale = container.scale.x
          this.startDistance = distance
          this.prevDistance = distance
          this.deltaHistory = []

          const pivot = this.primaryFinger ?? center
          this.pinchCenter = { ...pivot }
          this.pinchLocked = true

          return
        }

        // defensive: invalid distance
        if (this.prevDistance <= 0 || this.startDistance <= 0) {
          this.isPinching.set(false)
          return
        }

        // ignore micro jitter
        if (Math.abs(distance - this.prevDistance) < 3) return

        // compute delta
        const rawFactor = distance / this.startDistance
        const damp = this.settings.isMac ? 0.38 : 1.4
        let delta = Math.pow(rawFactor, this.zoomSpeed * damp)

        // moving average smoothing
        this.deltaHistory.push(delta)
        if (this.deltaHistory.length > 5) this.deltaHistory.shift()

        delta = this.deltaHistory.reduce((s, d) => s + d, 0) / this.deltaHistory.length

        if (this.deltaHistory.length > 1) {
          const prev = this.deltaHistory[this.deltaHistory.length - 2]
          delta = prev * this.smoothingFactor + delta * (1 - this.smoothingFactor)
        }

        // negligible
        if (Math.abs(delta - 1) < 0.004) return

        const newScale = this.initialScale * delta

        // zoom around locked anchor
        this.zoomService.setZoom(newScale, this.pinchCenter)

        // reset timeout
        this.navigation.setResetTimeout()

        this.prevDistance = distance

        // cleanup on effect re-run
        onCleanup(() => {
          this.isPinching.set(false)
          this.pinchLocked = false
          this.initialScale = 0
          this.startDistance = 0
          this.prevDistance = 0
          this.deltaHistory = []
        })
      },
      { injector: this.injector }
    )
  }

  // math helpers
  private distance(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  private center(a: { x: number; y: number }, b: { x: number; y: number }) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    }
  }
}
