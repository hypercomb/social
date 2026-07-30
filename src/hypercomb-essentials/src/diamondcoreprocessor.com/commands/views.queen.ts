// /views — open the friendly view-library toolwindow.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class ViewsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'views'
  override readonly aliases = ['view-library']
  override description = 'Open the Views window to attach, preview, and manage readable views'

  protected execute(): void {
    EffectBus.emit('views:open', {})
  }
}

const _views = new ViewsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ViewsQueenBee', _views)
