// src/app/pixi/touch-panning-service.ts
import { Injectable } from "@angular/core"
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

  // called by pinch zoom when 1 finger remains
  public beginPanFromTouch(x: number, y: number, pointerId?: number): void {
    if (this.anchored) {
      this.cancelPanSession()
    }
    this.enable()
    this.startAnchorAt(x, y, pointerId)
  }

  constructor() {
    super()
  }
}
