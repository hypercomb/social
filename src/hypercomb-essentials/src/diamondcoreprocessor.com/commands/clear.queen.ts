// diamondcoreprocessor.com/commands/clear.queen.ts

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'

export class ClearQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'clear'
  override readonly aliases = []
  override description = 'Clear active filter'
  override descriptionKey = 'slash.clear'

  protected execute(): void {
    EffectBus.emit('search:filter', { keyword: '' })
    void new hypercomb().act()
  }
}

const _clear = new ClearQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ClearQueenBee', _clear)
