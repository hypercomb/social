// src/app/pixi/pinch-zoom-service.ts
import { Injectable, effect, inject, signal } from '@angular/core'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { ZoomInputBase } from './zoom-input.base'
import { TouchPanningService } from './touch-panning-service'

@Injectable({ providedIn: 'root' })
export class PinchZoomService extends ZoomInputBase {
  private readonly touchPan = inject(TouchPanningService)

  private readonly isPinching = signal(false)

  private pivot: { x: number; y: number } | null = null
  private baselineDistance = 0
  private startScale = 1

  // track which pointer id is the mouse so we can ignore it for pinch
  private mousePointerId: number | null = null

  constructor() {
    super()

    effect(() => {
      const container = this.pixi.container
      const positions = this.ps.pointerPositions()
      const lastMove = this.ps.pointerMoveEvent()
      const lastDown = this.ps.pointerDownEvent()
      if (!container) return

      // update mouse pointer id from latest mouse event
      const last = lastMove ?? lastDown
      if (last && last.pointerType === 'mouse') {
        this.mousePointerId = last.pointerId
      }

      const allEntries = Array.from(
        positions.entries()
      ) as [number, { x: number; y: number }][]

      // drop mouse pointer from the set so remaining entries behave as touches
      const touchEntries = allEntries.filter(([id]) => id !== this.mousePointerId)
      const count = touchEntries.length

      // no touch pointers → end any active pinch
      if (count === 0) {
        if (this.isPinching()) {
          this.stopPinch()
        }
        return
      }

      // block zoom in transport mode
      if (this.state.hasMode(HypercombMode.Transport)) {
        this.stopPinch()
        return
      }

      // start pinch when 2 or more touch pointers exist
      if (!this.isPinching() && count >= 2) {
        const [, p1] = touchEntries[0]
        const [, p2] = touchEntries[1]

        const dist = this.getDistance(p1, p2)
        if (dist <= 0) return

        this.pivot = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2
        }
        this.baselineDistance = dist
        this.startScale = this.zoom.currentScale

        // kill any active touch pan and disable it during pinch
        this.touchPan.cancelPanSession()
        this.touchPan.disable()

        // mark gesture as pinch so clicks are cancelled
        this.isPinching.set(true)
        this.state.setCancelled(true)
        return
      }

      // update pinch while 2 or more touches remain
      if (this.isPinching() && count >= 2) {
        const [, p1] = touchEntries[0]
        const [, p2] = touchEntries[1]
        if (!this.pivot) return
        if (this.baselineDistance <= 0) return

        const dist = this.getDistance(p1, p2)
        const delta = dist - this.baselineDistance

        // small jitter → ignore
        if (Math.abs(delta) < 4) return

        // classic pinch: scale factor based on distance ratio
        const factor = dist / this.baselineDistance
        const newScale = this.startScale * factor

        this.zoomToScale(newScale, this.pivot)
        return
      }

      // pinch was active and now only 1 touch remains → hand off to pan
      if (this.isPinching() && count === 1) {
        const [pointerId, p] = touchEntries[0]
        this.stopPinch()

        // re-enable touch pan and continue from current finger position
        this.touchPan.enable()
        this.touchPan.beginPanFromTouch(p.x, p.y, pointerId)
        return
      }

      // if not pinching and only 1 touch exists, do nothing here:
      // touch panning service handles normal one-finger pan
    })
  }

  private getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return Math.hypot(dx, dy)
  }

  private stopPinch(): void {
    if (!this.isPinching()) return

    this.isPinching.set(false)
    this.pivot = null
    this.baselineDistance = 0
    this.startScale = this.zoom.currentScale

    // allow normal touch panning after gesture ends
    this.touchPan.enable()
  }
}
