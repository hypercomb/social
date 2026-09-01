// navigation/zoom/fit.queen.ts

import { QueenBee } from '@hypercomb/core'

/**
 * fit — zooms the viewport to fit all visible content with 5px padding.
 *
 * Type `fit` in the command line to snap the viewport to show all tiles.
 */
export class FitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'fit'
  override description = 'Zoom to fit all visible content'
  override examples = [{ input: '/fit', result: 'Viewport zooms to show all tiles' }]

  protected execute(_args: string): void {
    const zoom = window.ioc.get<any>('@diamondcoreprocessor.com/ZoomDrone')
    if (zoom?.zoomToFit) {
      // 'user' — /fit is an explicit gesture and must survive a reload, the
      // same as the `0` / `r` keybindings and the control-bar fit button.
      // Omitted, the source defaults to 'auto' and the fit was never stored.
      zoom.zoomToFit(false, 'user')
    } else {
      console.warn('[fit] ZoomDrone not available')
    }
  }
}

const _fit = new FitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FitQueenBee', _fit)
