// commands/rewind.queen.ts

import { EffectBus, QueenBee } from '@hypercomb/core'

/**
 * /rewind — toggle the visual undo picker.
 *
 * The Rewind window (hypercomb-shared rewind-window) is the two-stage
 * undo surface: pick a moment by its TILES (hex thumbnail filmstrip),
 * then step the BEHAVIOURS inside that range. Same string-contract
 * pattern as /history — the shared component owns its visibility and
 * listens on the bus, keeping the essentials → shared dependency
 * direction unviolated.
 */
export class RewindQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'rewind'
  override description = 'Open the visual rewind window'
  override descriptionKey = 'slash.rewind'
  override examples = [{ input: '/rewind', result: 'Rewind window opens; repeat to hide it' }]

  protected execute(_args: string): void {
    EffectBus.emit('rewind:toggle', {})
  }
}

const _rewind = new RewindQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RewindQueenBee', _rewind)
