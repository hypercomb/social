// src/app/pixi/touch-panning-service.ts
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

    return dist > this.getPanThreshold()
  }

  protected override getPanThreshold(): number {
    return 6
  }

  constructor() {
    super()

    // on touch down: only clear cancellation flag
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || down.pointerType !== "touch") return

      // new gesture started — clear cancelled flag only
      this.state.setCancelled(false)
      // do not set state.panning here; beginPan() will do that after threshold
    })

    // the existing up / cancel effects can stay as you had them
    effect(() => {
      const upSeq = this.ps.upSeq()
      if (upSeq === 0) return
      if (!this.anchored) return
      this.commitTransform()
    })

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
