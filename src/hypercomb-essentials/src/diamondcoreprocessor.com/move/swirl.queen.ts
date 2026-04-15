// diamondcoreprocessor.com/move/swirl.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class SwirlQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'movement'
  readonly command = 'swirl'
  override readonly aliases = []
  override description = 'Arrange tiles into the index spiral'
  override descriptionKey = 'slash.swirl'

  protected execute(): void {
    EffectBus.emit('layout:swirl', {})
  }
}

const _swirl = new SwirlQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SwirlQueenBee', _swirl)
