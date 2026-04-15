// diamondcoreprocessor.com/commands/push-to-talk.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

export class PushToTalkQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'push-to-talk'
  override readonly aliases = []
  override description = 'Toggle push-to-talk mic button'
  override descriptionKey = 'slash.push-to-talk'

  protected execute(): void {
    const current = localStorage.getItem('hc:push-to-talk') === 'true'
    const next = !current
    localStorage.setItem('hc:push-to-talk', String(next))
    EffectBus.emit('push-to-talk:toggle', { enabled: next })
  }
}

const _pushToTalk = new PushToTalkQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PushToTalkQueenBee', _pushToTalk)
