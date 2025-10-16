import { Injectable, inject, effect } from "@angular/core"
import { PixiManager } from "src/app/pixi/pixi-manager"
import { PointerState } from "./pointer-state"

@Injectable({ providedIn: 'root' })
export class PointerBindingService {
  private readonly pixi = inject(PixiManager)
  private readonly ps = inject(PointerState)

  constructor() {
    effect(() => {
      const canvas = this.pixi.canvas()
      if (canvas) this.ps.initialize(canvas)
    })
  }
}
