// diamondcoreprocessor.com/commands/instructions.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class InstructionsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'instructions'
  override readonly aliases = []
  override description = 'Toggle instruction overlay'
  override descriptionKey = 'slash.instructions'

  protected execute(): void {
    EffectBus.emit('instruction:toggle', undefined)
  }
}

const _instructions = new InstructionsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/InstructionsQueenBee', _instructions)
