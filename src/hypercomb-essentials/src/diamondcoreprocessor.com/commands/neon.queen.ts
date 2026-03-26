// diamondcoreprocessor.com/commands/neon.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /neon — toggle the neon color toolbar.
 *
 * Shows a vertical swatch strip on the left edge of the canvas.
 * Click a swatch to change the hover overlay neon color.
 */
export class NeonQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'neon'
  override description = 'Toggle the neon hover color toolbar'

  protected execute(): void {
    EffectBus.emit('neon:toggle-toolbar', {})
  }
}

const _neon = new NeonQueenBee()
window.ioc.register('@diamondcoreprocessor.com/NeonQueenBee', _neon)
