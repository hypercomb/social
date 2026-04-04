// diamondcoreprocessor.com/navigation/zoom/fit.queen.ts

import { QueenBee } from '@hypercomb/core'

/**
 * fit — zooms the viewport to fit all visible content with 5px padding.
 *
 * Type `fit` in the command line to snap the viewport to show all tiles.
 */
export class FitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'fit'
  override readonly aliases = []

  override description = 'Zoom to fit all visible content'

  protected execute(_args: string): void {
    const zoom = window.ioc.get<any>('@diamondcoreprocessor.com/ZoomDrone')
    if (zoom?.zoomToFit) {
      zoom.zoomToFit()
    } else {
      console.warn('[fit] ZoomDrone not available')
    }
  }
}

const _fit = new FitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FitQueenBee', _fit)
