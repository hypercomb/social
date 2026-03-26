// diamondcoreprocessor.com/history/revise.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { HistoryCursorService } from './history-cursor.service.js'

/**
 * /revise — toggles revision mode (the history clock).
 *
 * When active, the history slider is visible and the user can
 * scrub through time. Ctrl+Z / Ctrl+Y step through ops.
 * The "Restore" button promotes the cursor state to head.
 *
 * Running `/revise` again (or pressing Escape) exits revision mode,
 * jumping the cursor back to head.
 */
export class ReviseQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'revise'
  override readonly aliases = ['rev', 'history']

  override description = 'Toggle revision mode (history clock)'

  #active = false

  get active(): boolean {
    return this.#active
  }

  protected execute(_args: string): void {
    if (this.#active) {
      this.#exit()
    } else {
      this.#enter()
    }
  }

  #enter(): void {
    this.#active = true
    EffectBus.emit('revise:mode-changed', { active: true })
    console.log('[/revise] Revision mode ON — scrub the clock, Restore to promote.')
  }

  #exit(): void {
    // Jump cursor to head before closing
    const cursor = get<HistoryCursorService>('@diamondcoreprocessor.com/HistoryCursorService')
    if (cursor?.state.rewound) {
      cursor.jumpToLatest()
    }

    this.#active = false
    EffectBus.emit('revise:mode-changed', { active: false })
    console.log('[/revise] Revision mode OFF — back to head.')
  }
}

const _revise = new ReviseQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ReviseQueenBee', _revise)
