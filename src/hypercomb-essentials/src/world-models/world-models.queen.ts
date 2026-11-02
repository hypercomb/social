// world-models/world-models.queen.ts
//
// /world-models — open the entrance. The page is the whole command. The chat
// harness is not here; it loads later, from the door, once that door exists.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class WorldModelsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'world-models'

  override description = 'Open the world models entrance'
  override options = []
  override examples = [
    { input: '/world-models', result: 'Opens the entrance. Five traits are open, and nothing is connected yet.' },
  ]

  protected execute(_args: string): void {
    EffectBus.emit('world-models:open', {})
  }
}

const ioc = (globalThis as { ioc?: { register?: (key: string, value: unknown) => void } }).ioc
ioc?.register?.('@diamondcoreprocessor.com/WorldModelsQueenBee', new WorldModelsQueenBee())
