import { Injectable, inject, effect } from "@angular/core"
import { PointerState } from "./pointer-state"
import { PIXI_MANAGER } from "src/app/shared/tokens/i-pixi-manager.token"

@Injectable({ providedIn: 'root' })
export class PointerBindingService {
  private readonly pixi = inject(PIXI_MANAGER)
  private readonly ps = inject(PointerState)

  constructor() {
    effect(() => {
      const canvas = this.pixi.canvas()
      if (canvas) this.ps.initialize(canvas)
    })
  }
}
