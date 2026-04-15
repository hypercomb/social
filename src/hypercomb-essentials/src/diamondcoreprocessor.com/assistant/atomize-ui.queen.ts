// diamondcoreprocessor.com/assistant/atomize-ui.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class AtomizeUiQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'atomize-ui'
  override readonly aliases = []
  override description = 'Toggle the atomizer toolbar'
  override descriptionKey = 'slash.atomize-ui'

  protected execute(): void {
    EffectBus.emit('atomizer-bar:toggle', { active: true })
  }
}

const _atomizeUi = new AtomizeUiQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AtomizeUiQueenBee', _atomizeUi)
