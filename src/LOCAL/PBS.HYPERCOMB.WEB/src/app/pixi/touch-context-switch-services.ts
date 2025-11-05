import { Injectable, effect, inject } from "@angular/core"
import { ShortcutPixiRegistrations } from "src/app/shortcuts/shortcut-registration-base"
import { PointerState } from "src/app/state/input/pointer-state"
import { PanningManager } from "./panning-manager"
import { ZoomService } from "./zoom-service"
import { Point } from "pixi.js"

@Injectable({ providedIn: "root" })
export class TouchContextSwitchService extends ShortcutPixiRegistrations {
  private readonly ps = inject(PointerState)
  private readonly zoom = inject(ZoomService)
  private readonly panning = inject(PanningManager)
  private activePointers = new Set<number>()
  private initialized = false
  private pinchStartDist: number | null = null
  private pinchStartScale: number | null = null

  constructor() {
    super()

    // Add pointer on down
    effect(() => {
      const e = this.ps.pointerDownEvent()
      if (!e) return
      this.activePointers.add(e.pointerId)
      this.updateContext()
    })

    // Remove pointer on up or cancel
    effect(() => {
      const e = this.ps.pointerUpEvent() ?? this.ps.pointerCancelEvent()
      if (!e) return
      this.activePointers.delete(e.pointerId)
      this.updateContext()
      if (this.activePointers.size < 2) {
        this.pinchStartDist = null
        this.pinchStartScale = null
      }
    })

    // Pinch zoom detection
    effect(() => {
      if ( this.activePointers.size === 2) {
        const positions = Array.from(this.activePointers)
          .map(id => this.ps.pointerPositions().get(id))
          .filter(Boolean)
        if (positions.length === 2) {
          const [p1, p2] = positions as [Point, Point]
          const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
          if (this.pinchStartDist === null) {
            this.pinchStartDist = dist
            this.pinchStartScale = this.zoom.currentScale
          } else {
            const scaleFactor = dist / this.pinchStartDist
            const newScale = Math.max(0.2, Math.min(10, (this.pinchStartScale ?? 1) * scaleFactor))
            this.zoom.setZoom(newScale, { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 })
          }
        }
      }
    })

    // optional: disable browser pinch/zoom
    effect(() => {
      setTimeout(() => {
        this.initialized = true
      }, 50)

      if (!this.initialized) return
      const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
      if (!canvas) return
      canvas.style.touchAction = "none"
    })
  }

private updateContext() {
  if (!this.initialized) return;
  const count = this.activePointers.size;
  const latestDown = this.ps.pointerDownEvent(); // Most recent down event
  const isTouch = latestDown?.pointerType === 'touch';
  const touch = this.panning.getTouch();
  const mouse = this.panning.getSpacebar();

  if (count === 1) {
    if (isTouch) {
      touch.enable();
      mouse.disable();
    } else {
      // Mouse: do nothing (let PanningManager handle) or explicitly mouse.enable()
      mouse.enable();
      touch.disable();
    }
  } else if (count >= 2) {
    // Multi-touch: disable both for pinch
    touch.disable();
    mouse.disable();
  } else {
    mouse.enable();
    touch.enable();
  }
}
}
