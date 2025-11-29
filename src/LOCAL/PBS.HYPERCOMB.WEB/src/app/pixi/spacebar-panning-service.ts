// src/app/pixi/spacebar-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false 
  private initialized = false

  // base wired effects won't use these for keyboard panning
  protected shouldStart(): boolean { return false }
  protected isMoveRelevant(): boolean { return true }
  protected override getPanThreshold(): number { return 0 }

  constructor() {
    super()

    // immediate pan once anchored – no 6px threshold for spacebar
    this.usePanThreshold = false

    // cursor feedback only
    effect(() => {
      setTimeout(() => (this.initialized = true), 50)
      if (!this.initialized) return
      const canvas = this.pixi.app?.canvas
      if (!canvas) return
      canvas.style.cursor = this.keyboard.spaceDown() ? "grab" : "default"
    })

    // 🔹 anchor on mouse while space is held
    // note: intentionally NOT using downSeq; we anchor from current pointer position
    effect(() => {
      if (!this.isEnabled()) return
      if (!this.keyboard.spaceDown()) return
      if (this.anchored) return // already in a drag for this gesture

      const position = this.ps.position()
      // lock pan to whatever pointer is driving PointerState; pointerId is optional
      this.startAnchorAt(position.x, position.y)
      this.debug.log("panning", "spacebar anchor", position)
      // first move will realign origin so there is no visible snap
      this.awaitingFirstMove = true
    })

    // 🔹 if space is released mid-drag, finalize the pan
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

  // 🔹 pan implementation with "no first-frame glitch"
  protected override performPan(move: PointerEvent): void {
    const container = this.pixi.container
    const app = this.pixi.app
    if (!container || !app) return

    // only while space held & mouse drag
    if (!this.keyboard.spaceDown()) return
    if (move.pointerType !== "mouse") return
    if (!this.anchored) return

    if (this.awaitingFirstMove) {
      // align drag origin on the first real move so dx/dy start at 0
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

  // ensure Back/Branch hard-resets our internal flag too
  public override cancelPanSession(): void {
    super.cancelPanSession()
    this.awaitingFirstMove = false

    const canvas = this.pixi.app?.canvas
    if (canvas) canvas.style.cursor = "default"
  }
}
