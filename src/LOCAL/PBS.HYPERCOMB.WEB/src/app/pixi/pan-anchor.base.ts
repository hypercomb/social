import { signal } from "@angular/core"
import { PixiDataServiceBase } from "src/app/database/pixi-data-service-base"

export abstract class PanAnchorBase extends PixiDataServiceBase {
  protected lastX = 0
  protected lastY = 0
  protected anchored = false
  protected crossed = false
  protected readonly _cancelled = signal(false)
  public readonly cancelled = this._cancelled.asReadonly()

  // begin tracking at screen coords
  protected beginPan = (x: number, y: number): void => {
    this.lastX = x
    this.lastY = y
    this.anchored = true
    this.crossed = false
    this._cancelled.set(false)
  }

  // compute delta since last commit
  protected deltaFrom = (x: number, y: number): { dx: number; dy: number } => ({
    dx: x - this.lastX,
    dy: y - this.lastY
  })

  // mark threshold crossed once
  protected checkThreshold = (dx: number, dy: number, t: number, onFirstCross: () => void): void => {
    if (!this.crossed && (Math.abs(dx) > t || Math.abs(dy) > t)) {
      this.crossed = true
      this._cancelled.set(true)
      onFirstCross()
    }
  }

  // advance anchor to current point
  protected commitPoint = (x: number, y: number): void => {
    this.lastX = x
    this.lastY = y
  }

  // clear tracking
  protected clearPan = (): void => {
    this.lastX = 0
    this.lastY = 0
    this.anchored = false
    this.crossed = false
    this._cancelled.set(false)
  }
}
