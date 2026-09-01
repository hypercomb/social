// commands/spotlight.queen.ts

import { EffectBus, QueenBee } from '@hypercomb/core'

/**
 * /spotlight — light a tile up so it can be found.
 *
 * Emits `spotlight:show {targets}`; the SpotlightDrone (presentation/tiles)
 * draws the glow on the current layer and puts it out the moment the pointer
 * finds the tile. Several names, comma-separated, light together. `/spotlight
 * off` (or no argument) puts every light out.
 */
export class SpotlightQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'spotlight'
  override readonly aliases = []
  override description = 'Light a tile up until it is found'
  override descriptionKey = 'slash.spotlight'
  override options = ['<tile>', '<tile>, <tile>', 'off']
  override examples = [
    { input: '/spotlight recipes', result: 'The tile "recipes" glows; hovering it puts the light out' },
    { input: '/spotlight off', result: 'Every spotlight goes out' },
  ]

  protected execute(args: string): void {
    const text = args.trim()
    if (!text || text.toLowerCase() === 'off') {
      EffectBus.emit('spotlight:clear', {})
      return
    }
    const targets = text.split(',').map(s => s.trim()).filter(Boolean)
    EffectBus.emit('spotlight:show', { targets })
  }
}

const _spotlightQueen = new SpotlightQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SpotlightQueenBee', _spotlightQueen)
