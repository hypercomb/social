import { Injectable, effect } from "@angular/core"
import { Point } from "pixi.js"
import { PanningServiceBase } from "./panning-service.base"

@Injectable({ providedIn: "root" })
export class TouchPanningService extends PanningServiceBase {
  private anchorVecX = 0
  private anchorVecY = 0
  private startPosX = 0
  private startPosY = 0
  private downScreenX = 0
  private downScreenY = 0
  private dragThresholdReached = false
  private readonly PAN_THRESHOLD = 6

  constructor() {
    super()

    // 🔹 pointer down → anchor start
    effect(() => {
      if (this.ps.downSeq() === 0) return
      const down = this.ps.pointerDownEvent()
      if (!down || down.pointerType !== "touch") return
      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return
      const parent = container.parent ?? container

      const downGlobal = this.domToGlobal(down)
      const centerGlobal = this.canvasCenterGlobal()
      const pointerLocal = parent.worldTransform.applyInverse(downGlobal, new Point())
      const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

      this.anchorVecX = pointerLocal.x - centerLocal.x
      this.anchorVecY = pointerLocal.y - centerLocal.y
      this.startPosX = container.position.x
      this.startPosY = container.position.y
      this.downScreenX = down.clientX
      this.downScreenY = down.clientY
      this.dragThresholdReached = false
      this.anchored = true
      this.setActive(true)
    })

    // 🔹 pointer move → threshold check + pan
    effect(() => {
      if (this.ps.moveSeq() === 0) return
      const move = this.ps.pointerMoveEvent() ?? this.ps.pointerDownEvent()
      if (!move || move.pointerType !== "touch" || !this.anchored) return

      const dx = move.clientX - this.downScreenX
      const dy = move.clientY - this.downScreenY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (!this.dragThresholdReached && dist < this.PAN_THRESHOLD) return
      this.dragThresholdReached = true

      const container = this.pixi.container
      const app = this.pixi.app
      if (!container || !app) return
      const parent = container.parent ?? container

      const currGlobal = this.domToGlobal(move)
      const centerGlobal = this.canvasCenterGlobal()
      const pointerLocal = parent.worldTransform.applyInverse(currGlobal, new Point())
      const centerLocal = parent.worldTransform.applyInverse(centerGlobal, new Point())

      const currVecX = pointerLocal.x - centerLocal.x
      const currVecY = pointerLocal.y - centerLocal.y
      const nextX = this.startPosX + (currVecX - this.anchorVecX)
      const nextY = this.startPosY + (currVecY - this.anchorVecY)
      container.position.set(nextX, nextY)
    })

    // 🔹 pointer up → save + reset
    effect(() => {
      if (this.ps.upSeq() === 0) return
      this.saveTransform()
      this.clearAnchor()
      this.setActive(false)
    })
  }

  protected override onPixiReady(): void {
    this.safeInit()
  }
}
