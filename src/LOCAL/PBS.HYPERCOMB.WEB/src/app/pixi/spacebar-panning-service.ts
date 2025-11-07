// src/app/pixi/spacebar-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false
  private initialized = false

  // base effects call these, but for keyboard panning we're driving manually
  protected shouldStart(): boolean { return false }
  protected isMoveRelevant(): boolean { return true }
  protected override getPanThreshold(): number { return 0 }

  constructor() {
    super()
    this.usePanThreshold = false // immediate pan once anchored

    // cursor feedback only
    effect(() => {
      setTimeout(() => (this.initialized = true), 50)
      if (!this.initialized) return
      const canvas = this.pixi.app?.canvas
      if (!canvas) return
      canvas.style.cursor = this.keyboard.spaceDown() ? "grab" : "default"
    })

    // anchor on mouse down while space is held
    effect(() => {
      if (!this.isEnabled()) return

      const downSeq = this.ps.downSeq()
      if (downSeq === 0) return

      const down = this.ps.pointerDownEvent()
      if (!down) return
      if (down.button !== 0) return               // primary only
      if (down.pointerType !== "mouse") return
      if (!this.keyboard.spaceDown()) return

      // standard anchor: capture container pos + down coords
      this.startAnchorAt(down.clientX, down.clientY)

      // but we will re-align on the first move to avoid any visual snap
      this.awaitingFirstMove = true
    })

    // if space is released mid-drag, finalize
    effect(() => {
      if (!this.isEnabled()) return
      if (this.keyboard.spaceDown()) return
      if (!this.anchored) return

      this.commitTransform()
      this.awaitingFirstMove = false

      const canvas = this.pixi.app?.canvas
      if (canvas) canvas.style.cursor = "default"
    })
  }

  // 🔹 Critical: avoid the first-frame glitch by correcting BEFORE applying delta
  protected override performPan(move: PointerEvent): void {
    const container = this.pixi.container
    const app = this.pixi.app
    if (!container || !app) return

    // Only pan while space is held & mouse is used
    if (!this.keyboard.spaceDown() || move.pointerType !== "mouse") return

    if (this.awaitingFirstMove) {
      // Align the drag origin to the first move so dx/dy start at 0
      this.downScreenX = move.clientX
      this.downScreenY = move.clientY
      this.awaitingFirstMove = false

      const canvas = this.pixi.app?.canvas
      if (canvas) canvas.style.cursor = "grabbing"
    }

    const resolution = app.renderer.resolution
    const dx = (move.clientX - this.downScreenX) * resolution
    const dy = (move.clientY - this.downScreenY) * resolution

    container.position.set(this.startPosX + dx, this.startPosY + dy)
  }
}
