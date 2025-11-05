import { Injectable } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

// src/app/pixi/touch-panning-service.ts
@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  protected override anchorOnDown = true  // ← Enable down anchoring

  protected shouldStart(down: PointerEvent): boolean {
    return down.pointerType === "touch"
  }

  protected isMoveRelevant(move: PointerEvent): boolean {
    return move.pointerType === "touch"
  }

  protected override getPanThreshold(): number { return 6 }
}