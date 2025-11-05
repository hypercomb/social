import { Injectable } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  protected shouldStart(down: PointerEvent): boolean {
    return down.pointerType === "touch"
  }
  protected isMoveRelevant(move: PointerEvent): boolean {
    return move.pointerType === "touch"
  }
  // keep small threshold for touch to avoid accidental pans
  protected override getPanThreshold(): number { return this.PAN_THRESHOLD }
}
