// diamondcoreprocessor.com/commands/player.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

const DISMISSED_KEY = 'hc:player-dismissed'

/**
 * /player — re-open the track player after it has been dismissed.
 *
 * The track player is shown by default on first visit. Once the user
 * dismisses it, that decision is persisted in localStorage and the
 * player never auto-opens again. Invoking this queen clears the
 * dismissal flag and re-opens the player.
 */
export class PlayerQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'player'
  override readonly aliases = ['track', 'audio']
  override description = 'Re-open the track player'

  protected execute(_args: string): void {
    try { localStorage.removeItem(DISMISSED_KEY) } catch { /* storage unavailable */ }
    EffectBus.emit('player:open', {})
  }
}

const _player = new PlayerQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PlayerQueenBee', _player)
