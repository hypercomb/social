// diamondcoreprocessor.com/commands/player.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

const DISMISSED_KEY = 'hc:player-dismissed'

/**
 * /ebook — open the track player.
 *
 * The track player no longer auto-opens. Invoking this queen clears
 * any persisted dismissal flag and opens the player.
 */
export class PlayerQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'ebook'
  override description = 'Open the track player'

  protected execute(_args: string): void {
    try { localStorage.removeItem(DISMISSED_KEY) } catch { /* storage unavailable */ }
    EffectBus.emit('player:open', {})
  }
}

const _player = new PlayerQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PlayerQueenBee', _player)
