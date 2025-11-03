import { Injectable, effect, inject } from "@angular/core"
import { ShortcutPixiRegistrations } from "src/app/shortcuts/shortcut-registration-base"
import { PointerState } from "src/app/state/input/pointer-state"
import { TouchPanningService } from "./touch-panning-service"

@Injectable({ providedIn: 'root' })
export class TouchContextSwitchService extends ShortcutPixiRegistrations {
  private readonly touch = inject(TouchPanningService)
  private readonly ps = inject(PointerState)

  private activePointers = new Set<number>()

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
    })

    // remove pointer on cancel
    effect(() => {
      const e = this.ps.pointerCancelEvent()
      if (!e) return
      this.activePointers.delete(e.pointerId)
      this.updateContext()
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

    } else {
      // no pointers: allow services to keep their last state your pinch/pan services already end gracefully
    }
  }
}


