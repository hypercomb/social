import { DestroyRef, Injectable, effect, inject } from '@angular/core'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { PointerState } from 'src/app/state/input/pointer-state'
import { PixiServiceBase } from './pixi-service-base'
import { ZoomService } from './zoom-service'

@Injectable({ providedIn: 'root' })
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
  private enabled = false
  private enable(): void {
    if (this.enabled) return
    const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
    canvas?.addEventListener('wheel', this.onWheel, { passive: false })
    this.enabled = true
  }
  private disable(): void {
    if (!this.enabled) return
    const canvas = this.pixi.app?.canvas as HTMLCanvasElement | undefined
    canvas?.removeEventListener('wheel', this.onWheel)
    this.enabled = false
  }
  private onWheel = (event: WheelEvent): void => {
    if (this.state.hasMode(HypercombMode.Transport)) return
    const location = this.state.isLocked()
      ? this.screen.getWindowCenter()
      : this.ps.position()
    const direction = event.deltaY < 0 ? 'IN' : 'OUT'
    const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05
    this.debug.log('mousewheel', `${direction} factor=${factor.toFixed(3)} pivot=`, location)
    if (event.deltaY < 0) {
      this.zoom.zoomIn(location)
    } else {
      this.zoom.zoomOut(location)
    }
    event.preventDefault()
    event.stopPropagation()
  }
}