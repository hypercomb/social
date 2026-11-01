// keyboard-desk/keyboard.queen.ts
//
// `keyboard` — open the keyboard desk. The desk is the bee's; the word only asks.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class KeyboardQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keyboard'
  override description = 'Open the keyboard: see what every key does and choose your own chords'
  override descriptionKey = 'slash.keyboard'
  override examples = [
    { input: 'keyboard', result: 'Opens the keyboard. Click a key or press it, then choose a behaviour from the tiles' },
  ]

  protected async execute(): Promise<void> {
    EffectBus.emit('keyboard:open', {})
  }
}

const _keyboard = new KeyboardQueenBee()
window.ioc.register('@diamondcoreprocessor.com/KeyboardQueenBee', _keyboard)
