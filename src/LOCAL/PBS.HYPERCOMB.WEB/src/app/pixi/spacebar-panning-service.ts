// src/app/pixi/spacebar-panning-service.ts
import { Injectable, effect } from "@angular/core"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class SpacebarPanningService extends PanningServiceBase {
  private awaitingFirstMove = false

  // No button check — only space + mouse move
  protected shouldStart(down: PointerEvent): boolean {
    return this.keyboard.spaceDown() && ['mouse', 'touch'].includes(down.pointerType)
  }

  protected isMoveRelevant(move: PointerEvent): boolean {
    return this.keyboard.spaceDown() && ['mouse', 'touch'].includes(move.pointerType)
  }

  protected override getPanThreshold(): number {
    return 2
  }

  constructor() {
    super()

    // In SpacebarPanningService constructor
    effect(() => {
      const space = this.keyboard.spaceDown()
      const canvas = this.pixi.app?.canvas
      if (!canvas) return
      canvas.style.cursor = space ? 'grab' : 'default'
    })
    // === EFFECT 1: Start anchoring when space is held + mouse moves over canvas ===
    effect(() => {
      const space = this.keyboard.spaceDown()
      const move = this.ps.pointerMoveEvent()
      const pos = this.ps.position()

      if (space && move?.pointerType === "mouse" && !this.anchored) {
        // Anchor at current position — prevents jump
        this.startAnchorAt(pos.x, pos.y)
        this.awaitingFirstMove = true
      }
      else if (!space && this.anchored) {
        // Space released — end panning
        this.saveTransform()
        this.clearAnchor()
        this.awaitingFirstMove = false

        // Reset cursor
        const canvas = this.pixi.app?.canvas
        if (canvas) canvas.style.cursor = 'default'
      }
    })

    // === EFFECT 2: On first move after anchor, reset downScreen to avoid jump ===
    effect(() => {
      const move = this.ps.pointerMoveEvent()
      if (!move || !this.anchored || !this.awaitingFirstMove) return
      if (!this.keyboard.spaceDown() || move.pointerType !== "mouse") return

      // Reset base point to current mouse position
      this.downScreenX = move.clientX
      this.downScreenY = move.clientY
      this.awaitingFirstMove = false

      // Switch to grabbing cursor
      const canvas = this.pixi.app?.canvas
      if (canvas) canvas.style.cursor = 'grabbing'
    })

    // === EFFECT 3: Panning handled by base class via performPan() ===
    // → Uses moveSeq → isMoveRelevant → performPan()
  }
}