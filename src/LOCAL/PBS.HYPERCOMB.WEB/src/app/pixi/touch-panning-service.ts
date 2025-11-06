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

  protected override getPanThreshold(): number { return 6 }

  constructor() {
    super()

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
}
