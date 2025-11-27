import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  protected override anchorOnDown = true

  protected shouldStart(down: PointerEvent): boolean {
    return down.pointerType === "touch"
  }

  protected override isMoveRelevant(move: PointerEvent): boolean {
    if (move.pointerType !== "touch") return false

    const down = this.ps.pointerDownEvent()
    if (!down) return false

    const dx = move.clientX - down.clientX
    const dy = move.clientY - down.clientY
    const dist = Math.hypot(dx, dy)

    // only treat the move as relevant if it passes the threshold
    return dist > this.getPanThreshold()
  }

  protected override getPanThreshold(): number {
    return 6
  }

  constructor() {
    super()

    // -------------------------------------------------------------
    // FIXED: Touch pointerdown should NOT immediately set panning=true.
    // It should only clear cancellation, just like desktop.
    // Panning will be set later by beginPan() when threshold is passed.
    // -------------------------------------------------------------
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || down.pointerType !== "touch") return

      // new gesture → clear cancellation only
      this.state.setCancelled(false)

      // ❌ removed:
      // this.state.panning = true
      //
      // Touch should behave like mouse:
      // threshold triggers panning → beginPan() sets panning = true
    })

    // ensure that on pointerup the transform is committed
    effect(() => {
      const upSeq = this.ps.upSeq()
      if (upSeq === 0) return
      if (!this.anchored) return
      this.commitTransform() // updates position + saves
    })

    // safety cleanup if the user cancels gesture
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
