import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false
  private initialized = false

  protected shouldStart(): boolean { return false } // unused for keyboard
  protected isMoveRelevant(): boolean { return true }
  protected override getPanThreshold(): number { return 0 }

  constructor() {
    super()
    this.usePanThreshold = false // ✅ disable threshold for keyboard panning

    // update cursor
    effect(() => {
      setTimeout(() => this.initialized = true, 50)
      if (!this.initialized) return
      const space = this.keyboard.spaceDown()
      const canvas = this.pixi.app?.canvas
      if (canvas) canvas.style.cursor = space ? 'grab' : 'default'
    })

    // start / end logic
    effect(() => {
      const space = this.keyboard.spaceDown()
      const move = this.ps.pointerMoveEvent()
      const pos = this.ps.position()

      if (space && move && !this.anchored) {
        this.startAnchorAt(pos.x, pos.y)
        this.awaitingFirstMove = true
      } else if (!space && this.anchored) {
        this.commitTransform()  // now properly updates the cell and saves
        this.awaitingFirstMove = false
        const canvas = this.pixi.app?.canvas
        if (canvas) canvas.style.cursor = 'default'
      }

    })

    // correct initial grab offset
    effect(() => {
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored || !this.awaitingFirstMove) return
      if (!this.keyboard.spaceDown()) return
      this.downScreenX = move.clientX
      this.downScreenY = move.clientY
      this.awaitingFirstMove = false
      const canvas = this.pixi.app?.canvas
      if (canvas) canvas.style.cursor = 'grabbing'
    })
  }
}
