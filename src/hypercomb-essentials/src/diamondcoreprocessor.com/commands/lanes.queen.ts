// diamondcoreprocessor.com/commands/lanes.queen.ts
//
// Mobile-only global door to the orientation-aware three-lane arrangement.
// Unlike the per-location `a` cycle this selects the target directly and never
// installs a sequence target on the current tile.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class LanesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lanes'
  override readonly aliases = ['three', 'three-lanes']
  override description =
    'In mobile mode, arrange tiles into three point-top columns or three flat-top rows'
  override descriptionKey = 'slash.lanes'
  override examples = [
    {
      input: '/lanes',
      result: 'Fits three readable lanes across the screen and leaves the long axis pannable',
    },
  ]

  protected execute(): void {
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.threeLanes' })
  }
}

const _lanes = new LanesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanesQueenBee', _lanes)
