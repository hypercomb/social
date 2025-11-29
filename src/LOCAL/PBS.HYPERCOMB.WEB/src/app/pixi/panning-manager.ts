
// src/app/pixi/panning-manager.ts
import { Injectable, inject, effect } from "@angular/core"
import { KeyboardService } from "../interactivity/keyboard/keyboard-service"
import { SpacebarPanningService } from "./spacebar-panning-service"
import { TouchPanningService } from "./touch-panning-service"

@Injectable({ providedIn: "root" })
export class PanningManager {
  private readonly spacebar = inject(SpacebarPanningService)
  private readonly touch = inject(TouchPanningService)
  private readonly keyboard = inject(KeyboardService)

  constructor() {

    // Space always wins – enable space, disable touch
    effect(() => {
      if (this.keyboard.spaceDown()) {
        this.spacebar.enable()
        this.touch.disable()
      } else {
        // Normal state: both are allowed (the context switcher will pick one)
        this.spacebar.enable()
        this.touch.enable()
      }
    })
    
    // === Optional: Initial device detection (fallback) ===
    // This is now secondary — spacebar overrides everything
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch" && !this.keyboard.spaceDown()) {
        this.touch.enable()
        this.spacebar.disable()
      }
    }, { once: true })  // Run only once on first touch

    // Reset on blur (safety)
    window.addEventListener("blur", () => {
      this.touch.enable()
      this.spacebar.enable()
    })
  }

  public getSpacebar() { return this.spacebar }
  public getTouch() { return this.touch }
}
