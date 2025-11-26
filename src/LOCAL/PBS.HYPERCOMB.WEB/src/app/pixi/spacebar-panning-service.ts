// src/app/pixi/spacebar-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false
  private initialized = false

  // base wired effects won't use these for keyboard panning
  protected shouldStart(): boolean { return false }
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

    // 🔹 Anchor on mouse down while space is held
    // NOTE: intentionally NOT using downSeq here.
    effect(() => {
      if (!this.isEnabled()) return
      if (!this.keyboard.spaceDown()) return

      if (this.anchored) return                // already in a drag for this gesture
      const position = this.ps.position()
      // normal anchor from current position
      this.startAnchorAt(position.x, position.y)
      this.debug.log('panning', this.ps.position())
      // first move will realign the origin so there's no visible snap
      this.awaitingFirstMove = true
    })

    // 🔹 If space is released mid-drag, finalize the pan
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

  // 🔹 Pan implementation with "no first-frame glitch"
  protected override performPan(move: PointerEvent): void {
    const container = this.pixi.container
    const app = this.pixi.app
    if (!container || !app) return

    // only while space held & mouse drag
    if (!this.keyboard.spaceDown()) return
    if (move.pointerType !== "mouse") return
    if (!this.anchored) return

    if (this.awaitingFirstMove) {
      // Align drag origin on the first real move so dx/dy start at 0
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

  // Ensure Back/Branch hard-resets our internal flag too
  public override cancelPanSession(): void {
    super.cancelPanSession()
    this.awaitingFirstMove = false
  }
}
