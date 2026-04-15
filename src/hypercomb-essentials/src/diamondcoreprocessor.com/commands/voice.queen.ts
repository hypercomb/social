// diamondcoreprocessor.com/commands/voice.queen.ts

import { QueenBee } from '@hypercomb/core'

export class VoiceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'voice'
  override readonly aliases = []
  override description = 'Toggle voice input (speech-to-text)'
  override descriptionKey = 'slash.voice'

  protected execute(): void {
    const svc = get('@hypercomb.social/VoiceInputService') as { toggle?: () => void } | undefined
    svc?.toggle?.()
  }
}

const _voice = new VoiceQueenBee()
window.ioc.register('@diamondcoreprocessor.com/VoiceQueenBee', _voice)
