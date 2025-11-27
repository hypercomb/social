// src/app/pixi/touch-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  protected override anchorOnDown = true

  protected shouldStart(down: PointerEvent): boolean {
    return down.pointerType === "touch"
  }

  // revert to simple relevance check; threshold is handled in base class
  protected override isMoveRelevant(move: PointerEvent): boolean {
    return move.pointerType === "touch"
  }

  protected override getPanThreshold(): number {
    return 6
  }

  constructor() {
    super()

    // touch down: clear cancelled flag only, do not mark as panning yet
    effect(() => {
      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || down.pointerType !== "touch") return

      this.state.setCancelled(false)
      // beginPan() will set state.panning once drag passes threshold
    })

    // pointerup → commit transform if we were anchored
    effect(() => {
      const upSeq = this.ps.upSeq()
      if (upSeq === 0) return
      if (!this.anchored) return
      this.commitTransform()
    })

    // cancel → also commit transform if mid-gesture
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
