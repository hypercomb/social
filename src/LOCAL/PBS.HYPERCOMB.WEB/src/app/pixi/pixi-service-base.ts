// pixi-service-base.ts
import { inject, effect } from "@angular/core"
import { Application } from "pixi.js"
import { ScreenService } from "src/app/unsorted/utility/screen-service"
import { PIXI_MANAGER, IPixiManager } from "../shared/tokens/i-pixi-manager.token"
import { Settings } from "../unsorted/settings"
import { DebugService } from "../core/diagnostics/debug-service"
import { KeyboardState } from "../interactivity/keyboard/keyboard-state"
import { HypercombState } from "../state/core/hypercomb-state"
import { ContextStack } from "../core/controller/context-stack"
import { StorageManager } from "../helper/storage-manager"
import { HONEYCOMB_SVC } from "../shared/tokens/i-comb-service.token"

export abstract class PixiServiceBase {
  protected readonly cellstate = inject(HONEYCOMB_SVC)
  protected readonly storage = inject(StorageManager)
  protected readonly screen = inject(ScreenService)
  protected readonly debug = inject(DebugService)
  protected readonly pixi = inject(PIXI_MANAGER) as IPixiManager
  protected readonly settings = inject(Settings)
  protected readonly ks = inject(KeyboardState)
  protected readonly state = inject(HypercombState)
  public readonly stack = inject(ContextStack)


  constructor() {

    // bind late via PixiManager.ready signal
    effect(() => {
      const app = this.pixi.ready()
      if (app) {
        this.onPixiReady(app)
      } else {
      }
    })
  }

  /**
   * hook subclasses can override to run logic once pixi is initialized
   */
  protected onPixiReady(app: Application): void {
  }


  // hexagon dimensions come from PixiManager.settings

  protected get hexagonOffsetX(): number { return this.settings.hexagonOffsetX }
  protected get hexagonOffsetY(): number { return this.settings.hexagonOffsetY }
  protected get hexagonWidth(): number { return this.settings.width }
  protected get hexagonHeight(): number { return this.settings.height }
}
