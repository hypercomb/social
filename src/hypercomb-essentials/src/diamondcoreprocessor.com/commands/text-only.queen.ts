// diamondcoreprocessor.com/commands/text-only.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class TextOnlyQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'text-only'
  override readonly aliases = []
  override description = 'Toggle text-only mode (hide images)'
  override descriptionKey = 'slash.text-only'

  #active = false

  protected execute(): void {
    this.#active = !this.#active
    EffectBus.emit('render:set-text-only', { textOnly: this.#active })
  }
}

const _textOnly = new TextOnlyQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TextOnlyQueenBee', _textOnly)
