// hypercomb-legacy/src/app/pixi/zoom-input.base.ts

import { Injectable, inject } from '@angular/core'
import { Point } from 'pixi.js'
import { PixiDataServiceBase } from '../database/pixi-data-service-base'
import { PointerState } from 'src/app/state/input/pointer-state'
import { ZoomService } from './zoom-service'
import { LinkNavigationService } from 'src/app/navigation/link-navigation-service'

@Injectable()
export abstract class ZoomInputBase extends PixiDataServiceBase {
  protected readonly ps = inject(PointerState)
  protected readonly zoom = inject(ZoomService)
  protected readonly navigation = inject(LinkNavigationService)

  // ---------------------------------------------
  // pivot helpers (css → pixi global)
  // ---------------------------------------------

  // css-space pivot (client coords)
  protected getDefaultPivotCss(): { x: number; y: number } {
    return this.state.isLocked()
      ? this.screen.getWindowCenter()
      : this.ps.position()
  }

  // convert browser css pixels to pixi global (canvas backing pixels)
  protected mapCssToPixiGlobal(css: { x: number; y: number }): { x: number; y: number } {
    const app = this.pixi.app
    const canvas = app?.canvas as HTMLCanvasElement | undefined
    if (!app || !canvas) return css

    // preferred: pixi renderer event mapper (handles resolution, density, transforms)
    const events = (app.renderer as any)?.events
    if (events?.mapPositionToPoint) {
      const out = new Point()
      events.mapPositionToPoint(out, css.x, css.y)
      return { x: out.x, y: out.y }
    }

    // fallback: derive from canvas backing size vs css rect
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return css

    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height

    return {
      x: (css.x - rect.left) * sx,
      y: (css.y - rect.top) * sy,
    }
  }

  // ---------------------------------------------
  // zoom actions
  // ---------------------------------------------

  // relative zoom, e.g. factor = 1.05 or 1 / 1.05
  protected zoomRelative(factor: number, pivotCss?: { x: number; y: number }): void {
    if (!this.pixi.container) return

    const css = pivotCss ?? this.getDefaultPivotCss()
    const p = this.mapCssToPixiGlobal(css)

    this.zoom.applyZoom(factor, p)
    this.navigation.setResetTimeout()
    this.state.setCancelled(true) // gesture should not trigger clicks
  }

  // absolute zoom to a specific scale (used by pinch)
  protected zoomToScale(newScale: number, pivotCss?: { x: number; y: number }): void {
    if (!this.pixi.container) return

    const css = pivotCss ?? this.getDefaultPivotCss()
    const p = this.mapCssToPixiGlobal(css)

    this.zoom.setZoom(newScale, p)
    this.navigation.setResetTimeout()
    this.state.setCancelled(true)
  }
}
