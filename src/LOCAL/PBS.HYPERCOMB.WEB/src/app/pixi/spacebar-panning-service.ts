// src/app/pixi/spacebar-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false

  protected shouldStart(down: PointerEvent): boolean {
    return this.keyboard.spaceDown() && ['mouse', 'touch'].includes(down.pointerType)
  }

  protected isMoveRelevant(move: PointerEvent): boolean {
    return this.keyboard.spaceDown() && ['mouse', 'touch'].includes(move.pointerType)
  }

  protected override getPanThreshold(): number { return 2 }

  constructor() {
    super()

    // ---- cursor -------------------------------------------------
    effect(() => {
      const space = this.keyboard.spaceDown()
      const canvas = this.pixi.app?.canvas
      if (!canvas) return
      canvas.style.cursor = space ? 'grab' : 'default'
    })

    // ---- EFFECT 1: start anchor on *any* move while space held ----
    effect(() => {
      const space = this.keyboard.spaceDown()
      const move = this.ps.pointerMoveEvent()
      const pos = this.ps.position()

      // start anchor on the **first** move (mouse OR touch)
      if (space && move && !this.anchored) {
        this.startAnchorAt(pos.x, pos.y)
        this.awaitingFirstMove = true
      }
      // stop when space is released
      else if (!space && this.anchored) {
        this.saveTransform()
        this.clearAnchor()
        this.awaitingFirstMove = false
        const canvas = this.pixi.app?.canvas
        if (canvas) canvas.style.cursor = 'default'
      }
    })

    // ---- EFFECT 2: eliminate jump on first real move ------------
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