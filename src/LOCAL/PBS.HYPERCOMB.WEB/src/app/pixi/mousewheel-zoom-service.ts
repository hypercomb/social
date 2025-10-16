import { DestroyRef, Injectable, effect, inject } from "@angular/core"
import { HypercombMode } from "src/app/core/models/enumerations"
import { PointerState } from "src/app/state/input/pointer-state"
import { PixiServiceBase } from "./pixi-service-base"
import { ZoomService } from "./zoom-service"

@Injectable({ providedIn: "root" })
export class MousewheelZoomService extends PixiServiceBase {
  private readonly ps = inject(PointerState)
  private readonly zoom = inject(ZoomService)
  private readonly destroyRef = inject(DestroyRef)

  constructor() {
    super()

    effect(() => {
      const app = this.pixi.ready()
      if (!app) return

      this.enable()

    })
    this.destroyRef.onDestroy(() => this.disable())
  }
  public initialize = async (): Promise<void> => {

    // ✅ auto cleanup when service is destroyed
    this.destroyRef.onDestroy(() => {
      this.disable()
    })
  }

  private enabled = false

  private enable(): void {
    if (this.enabled) return
    const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
    canvas?.addEventListener("wheel", this.onWheel, { passive: false })
    this.enabled = true
  }

  private disable(): void {
    if (!this.enabled) return
    const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
    canvas?.removeEventListener("wheel", this.onWheel)
    this.enabled = false
  }

  private onWheel = (event: WheelEvent): void => {
    // ✅ block zoom if in transport mode
    if (this.state.hasMode(HypercombMode.Transport)) return

    // ✅ pick center point based on lock state
    const location = this.state.isLocked()
      ? this.screen.getWindowCenter()
      : this.ps.position()

    // ✅ zoom in/out
    if (event.deltaY < 0) {
      this.zoom.zoomIn(location)
    } else {
      this.zoom.zoomOut(location)
    }

    // ✅ stop default page scroll
    event.preventDefault()
    event.stopPropagation()
  }
}
