import { Injectable, inject, computed } from "@angular/core"
import { WheelState } from "src/app/common/mouse/wheel-state"
import { PixiServiceBase } from "src/app/pixi/pixi-service-base"
import { TileImageState } from "src/app/cells/models/cell-image-state"

@Injectable({ providedIn: 'root' })
export class HexagonScalingService extends PixiServiceBase {
  private readonly images = inject(TileImageState)
  private readonly wheelState = inject(WheelState)

  private targetElement: HTMLElement | null = null

  private readonly scalingEffect = computed(() => {
    // const event = this.wheelState.wheel()
    // if (!event || !this.targetElement) return

    // const rect = this.targetElement.getBoundingClientRect()
    // const { clientX: mouseX, clientY: mouseY } = event

    // if (mouseX < rect.left || mouseX > rect.right || mouseY < rect.top || mouseY > rect.bottom) {
    //   return
    // }

    // const scaleFactor = event.deltaY < 0 ? 1.05 : 1 / 1.05
    // this.images.scale *= scaleFactor

    // this.debug.log('scaling', `image scale changed: ${this.images.scale}`)
    throw new Error('Not implemented yet')
  })

  public start(target: HTMLElement) {
    this.targetElement = target
    this.wheelState.initialize(target)
  }

  public stop() {

    this.targetElement = null
  }
}


