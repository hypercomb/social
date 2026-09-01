// /views — the ways this layer can be shown.
//
// There is no Views window any more. Views are not a separate kind of thing
// with a separate home: they are beehaviours, listed in the Beehaviors panel
// beside every other one, told apart only by the background their row stands
// on. So the command opens THAT panel with its lens narrowed to views — the
// same list the window used to be, minus the window.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class ViewsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'views'
  override readonly aliases = ['view-library']
  override description = 'Show the views this layer can be drawn as'

  protected execute(): void {
    EffectBus.emit('features:lens', { lens: 'views' })
  }
}

const _views = new ViewsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ViewsQueenBee', _views)
