// diamondcoreprocessor.com/commands/docs.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class DocsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'docs'
  override readonly aliases = []
  override description = 'Browse project documentation'
  override descriptionKey = 'slash.docs'

  protected execute(args: string): void {
    EffectBus.emit('docs:open', { page: args.trim() || '' })
  }
}

const _docs = new DocsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DocsQueenBee', _docs)
