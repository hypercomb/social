import { Injectable, inject } from "@angular/core"
import { MousePanningService } from "./mouse-panning-service"
import { TouchPanningService } from "./touch-panning-service"

@Injectable({ providedIn: "root" })
export class PanningManager {
  private readonly mouse = inject(MousePanningService)
  private readonly touch = inject(TouchPanningService)

  private activeType: "mouse" | "touch" | null = null

  constructor() {
    // 🔹 Detect pointerdown immediately and grant exclusive ownership
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        this.activeType = "touch"
        this.touch.enable()
        this.mouse.disable()
      } else if (e.pointerType === "mouse" || e.pointerType === "pen") {
        this.activeType = "mouse"
        this.mouse.enable()
        this.touch.disable()
      }
    })

    // 🔹 When all pointers lifted → re-enable both
    window.addEventListener("pointerup", () => this.resetControl())
    window.addEventListener("pointercancel", () => this.resetControl())
    window.addEventListener("blur", () => this.resetControl())
  }

  private resetControl(): void {
    // return both to enabled neutral state
    this.activeType = null
    this.mouse.enable()
    this.touch.enable()
  }

  public getMouse() { return this.mouse }
  public getTouch() { return this.touch }
}
