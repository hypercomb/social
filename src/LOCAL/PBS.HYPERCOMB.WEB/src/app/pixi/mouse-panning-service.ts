import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  protected shouldStart(down: PointerEvent): boolean {
    return this.keyboard.spaceDown() && down.pointerType === "mouse" && down.button === 0
  }
  protected isMoveRelevant(move: PointerEvent): boolean {
    return this.keyboard.spaceDown() && move.pointerType === "mouse"
  }
  protected override getPanThreshold(): number { return 0 } // no threshold for spacebar

  constructor() {
    super()
    // stop cleanly if space released mid-drag
    effect(() => {
      if (!this.keyboard.spaceDown() && this.anchored) {
        this.saveTransform()
        this.clearAnchor()
      }
    })
  }
}
