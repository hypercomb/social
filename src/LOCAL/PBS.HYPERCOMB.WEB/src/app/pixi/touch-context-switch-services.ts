import { Injectable, effect, inject } from "@angular/core"
import { ShortcutPixiRegistrations } from "src/app/shortcuts/shortcut-registration-base"
import { PointerState } from "src/app/state/input/pointer-state"
import { TouchPanningService } from "./touch-panning-service"
import { ZoomService } from "./zoom-service"
import { Point } from "pixi.js"

@Injectable({ providedIn: 'root' })
export class TouchContextSwitchService extends ShortcutPixiRegistrations {
  private readonly touch = inject(TouchPanningService)
  private readonly ps = inject(PointerState)
  private readonly zoom = inject(ZoomService)
  
  private activePointers = new Set<number>()
  private pinchStartDist: number | null = null
  private pinchStartScale: number | null = null;

  constructor() {
    super()

    // add pointer on down
    effect(() => {
      const e = this.ps.pointerDownEvent()
      if (!e) return
      this.activePointers.add(e.pointerId)
      this.updateContext()
    })

    // remove pointer on up
    effect(() => {
      const e = this.ps.pointerUpEvent()
      if (!e) return
      this.activePointers.delete(e.pointerId)
      this.updateContext()
      // Reset pinch state
      if (this.activePointers.size < 2) {
        this.pinchStartDist = null;
        this.pinchStartScale = null;
      }
    })

    // remove pointer on cancel
    effect(() => {
      const e = this.ps.pointerCancelEvent()
      if (!e) return
      this.activePointers.delete(e.pointerId)
      this.updateContext()
      // Reset pinch state
      if (this.activePointers.size < 2) {
        this.pinchStartDist = null;
        this.pinchStartScale = null;
      }
    })

    // Pinch zoom detection
    effect(() => {
      if (this.activePointers.size === 2) {
        const positions = Array.from(this.activePointers).map(id => this.ps.pointerPositions().get(id)).filter(Boolean)
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

    effect(() => {
      const e = this.ks.keyUp() 
      if (!e) return

      this.ks.when(e).only('Space')
      // spacebar held down â†’ enable touch
      e.preventDefault()
      this.touch.enable()
    })

    effect(() => {
      if (localStorage.getItem('professional')) {

        const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
        if (!canvas) return

        // disable browser gestures
        canvas.style.touchAction = 'none'
      }
    })
  }

  // private helpers
  private updateContext() {
    const count = this.activePointers.size

    // 1 pointer â†’ pan 2+ pointers â†’ pinch 0 â†’ let things settle
    if (count === 1) {
      this.touch.enable()
    } else if (count >= 2) {
      this.touch.disable()
      // Pinch zoom handled above
    } else {
      // no pointers: allow services to keep their last state your pinch/pan services already end gracefully
    }
  }
}


