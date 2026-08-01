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
    'In mobile mode, arrange tiles into readable lanes: 3 to scan, 2 to browse, 1 to read'
  override descriptionKey = 'slash.lanes'
  override examples = [
    {
      input: '/lanes',
      result: 'Fits the current lane count across the screen and leaves the long axis pannable',
    },
    {
      input: '/lanes 1',
      result: 'One lane — the widest hexagons, for reading',
    },
    {
      input: '/lanes off',
      result: 'Releases the lane viewport; pan and zoom go back to free',
    },
  ]

  protected execute(args: string): void {
    const arg = (args ?? '').trim().toLowerCase()
    if (arg === 'off' || arg === 'free') {
      EffectBus.emit('lanes:off', {})
      return
    }
    const n = Number(arg)
    if (Number.isFinite(n) && n > 0) {
      EffectBus.emit('lanes:set', { lanes: n })
      return
    }
    EffectBus.emit('keymap:invoke', { cmd: 'sequence.threeLanes' })
  }
}

const _lanes = new LanesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LanesQueenBee', _lanes)
