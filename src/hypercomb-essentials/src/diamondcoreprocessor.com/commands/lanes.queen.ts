// diamondcoreprocessor.com/commands/lanes.queen.ts
//
// Mobile/command-line door to the orientation-aware three-lane arrangement.
// Unlike the `a` shortcut this selects the target directly, so invoking it is
// deterministic regardless of where the participant last stopped the cycle.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class LanesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'lanes'
  override readonly aliases = ['three', 'three-lanes']
  override description =
    'Arrange tiles into three point-top columns or three flat-top rows'
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
