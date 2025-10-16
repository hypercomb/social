import { Injectable, signal } from "@angular/core"

@Injectable({ providedIn: "root" })
export class WheelState {
  private readonly tick = signal(0)
  private lastDeltaY = 0

  /** increments once per wheel event */
  public readonly pulse = this.tick.asReadonly()

  /** non-reactive accessor for last deltaY */
  public get deltaY(): number {
    return this.lastDeltaY
  }

  private target: HTMLElement | Window | null = null

  public initialize(target: HTMLElement | Window = window) {
    if (this.target) return
    this.target = target
   
    target.addEventListener("wheel", this.handleWheel, { passive: false })
  }

  public dispose() {
    if (this.target) {
      this.target.removeEventListener("wheel", this.handleWheel)
      this.target = null
    }
  }

  private handleWheel = (evt: Event) => {
    const e = evt as WheelEvent
    e.preventDefault()
    this.lastDeltaY = e.deltaY
    this.tick.update(n => n + 1) // 🔑 one increment = one pulse
  }
}
