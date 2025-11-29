// src/app/pixi/mousewheel-zoom-service.ts
import { DestroyRef, Injectable, effect, inject } from '@angular/core'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { ZoomInputBase } from './zoom-input.base'

@Injectable({ providedIn: 'root' })
export class MousewheelZoomService extends ZoomInputBase {
  private readonly destroyRef = inject(DestroyRef)
  private enabled = false

  constructor() {
    super()

    effect(() => {
      const app = this.pixi.ready()
      if (!app) return
      this.enable()
    })

    this.destroyRef.onDestroy(() => this.disable())
  }

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

    const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05
    this.debug.log('mousewheel', event.deltaY < 0 ? 'in' : 'out', factor)

    // let base handle pivot + zoom service + click cancel
    this.zoomRelative(factor)

    event.preventDefault()
    event.stopPropagation()
  }
}
