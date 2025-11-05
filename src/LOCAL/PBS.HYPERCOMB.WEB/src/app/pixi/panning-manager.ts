
import { Injectable, inject, effect } from "@angular/core"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SpacebarPanningService } from "./mouse-panning-service"
import { TouchPanningService } from "./touch-panning-service"

@Injectable({ providedIn: "root" })
export class PanningManager {
  private readonly spacebar = inject(SpacebarPanningService)
  private readonly touch = inject(TouchPanningService)
  private readonly keyboard = inject(KeyboardService)

  private activeType: "spacebar" | "touch" | null = null

  constructor() {
    // 🔹 detect pointer type (default activation)
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        this.activeType = "touch"
        this.touch.enable()
        this.spacebar.disable()
      } else if (e.pointerType === "mouse" || e.pointerType === "pen") {
        this.activeType = "spacebar"
        this.spacebar.enable()
        this.touch.disable()
      }
    })

    // 🔹 reset on release or blur
    window.addEventListener("pointerup", () => this.resetControl())
    window.addEventListener("pointercancel", () => this.resetControl())
    window.addEventListener("blur", () => this.resetControl())

    // 🟡 cautious: allow spacebar override even on touch devices
    effect(() => {
      const space = this.keyboard.spaceDown()
      if (space && this.keyboard.spaceDown()) {
        // temporarily give control to spacebar service
        this.spacebar.enable()
        this.touch.disable()
        this.activeType = "spacebar"
      } else if (!space && this.activeType === "touch") {
        // restore touch control only if it was the active type
        this.touch.enable()
        this.spacebar.disable()
      } else if (!space) {
        // reset to neutral when space is released
        this.resetControl()
      }
    })
  }

  private resetControl(): void {
    this.activeType = null
    this.spacebar.enable()
    this.touch.enable()
  }

  public getSpacebar() { return this.spacebar }
  public getTouch() { return this.touch }
}
