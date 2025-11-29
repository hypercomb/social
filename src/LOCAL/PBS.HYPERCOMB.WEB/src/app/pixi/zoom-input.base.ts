// src/app/pixi/zoom-input.base.ts
  import { Injectable, inject } from '@angular/core'
  import { PixiDataServiceBase } from '../database/pixi-data-service-base'
  import { PointerState } from 'src/app/state/input/pointer-state'
  import { ZoomService } from './zoom-service'
  import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'

  @Injectable()
  export abstract class ZoomInputBase extends PixiDataServiceBase {
    protected readonly ps = inject(PointerState)
    protected readonly zoom = inject(ZoomService)
    protected readonly navigation = inject(LinkNavigationService)

    // default pivot is the same logic you already use for mousewheel
    protected getDefaultPivot(): { x: number; y: number } {
      return this.state.isLocked()
        ? this.screen.getWindowCenter()
        : this.ps.position()
    }

    // relative zoom, e.g. factor = 1.05 or 1 / 1.05
    protected zoomRelative(factor: number, pivot?: { x: number; y: number }): void {
      if (!this.pixi.container) return
      const p = pivot ?? this.getDefaultPivot()
      this.zoom.applyZoom(factor, p)
      this.navigation.setResetTimeout()
      this.state.setCancelled(true) // this gesture should not trigger clicks
    }

    // absolute zoom to a specific scale (used by pinch)
    protected zoomToScale(newScale: number, pivot?: { x: number; y: number }): void {
      if (!this.pixi.container) return
      const p = pivot ?? this.getDefaultPivot()
      this.zoom.setZoom(newScale, p)
      this.navigation.setResetTimeout()
      this.state.setCancelled(true)
    }
  }