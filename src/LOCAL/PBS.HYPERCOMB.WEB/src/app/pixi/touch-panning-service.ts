import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  protected override anchorOnDown = true

  protected shouldStart(down: PointerEvent): boolean {
    return down.pointerType === "touch"
  }

  protected isMoveRelevant(move: PointerEvent): boolean {
    return move.pointerType === "touch"
  }

  protected override getPanThreshold(): number {
    return 6
  }


  constructor() {
    super()

    // 🔹 mark start of touch gesture immediately on pointerdown
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || down.pointerType !== "touch") return

      // a new gesture started — reset cancellation flags
      this.state.setCancelled(false)

      // mark that we are in a potential panning state
      this.state.panning = true
    })

    // ensure that on pointerup the transform is committed
    effect(() => {
      const upSeq = this.ps.upSeq()
      if (upSeq === 0) return
      if (!this.anchored) return
      this.commitTransform() // ✅ now updates the cell and saves
    })

    // optional: safety cleanup if the user cancels gesture
    effect(() => {
      const cancelSeq = this.ps.cancelSeq()
      if (cancelSeq === 0) return
      if (this.anchored) {
        this.commitTransform()
      }
    })
  }

  public resumeAfterPinch(position: { x: number; y: number }): void {
    if (!this.isEnabled()) return
    if (this.anchored) return
    this.startAnchorAt(position.x, position.y)
    this.dragThresholdReached = true
    this.beginPan()
  }
}
