// history/prune.queen.ts
//
// `prune` — the word that opens the layer of deleted tiles.
//
// HIDDEN ON PURPOSE. `slashHidden` keeps it out of autocomplete and out of
// the behaviour list, the same posture `/flatten` and `/sweep` take, and for
// a stronger reason: this is the only door in the hive onto an operation
// that actually destroys a participant's tiles. A word you have to know is
// the first gate; the mode's own confirm is the second; and the fact that
// the purge only ever applies to tiles that were ALREADY deleted is the
// third. None of the three is sufficient alone.
//
// It takes no arguments and ignores whatever it is given, so "prune my hive"
// works exactly like "prune" — the participant is speaking, not passing
// parameters, and the mode always opens at the location they are standing
// on.
//
// Opening also raises the history window: the deleted tiles ARE history, the
// window is where the toggle for this mode lives, and a participant who
// arrived here by typing should be able to see the same control they could
// have clicked.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { PruneService } from './prune.service.js'

export class PruneQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'prune'
  override description = 'Open the layer of deleted tiles at this location'
  override examples = [
    { input: '/prune', result: 'Shows the tiles deleted here, ready to be destroyed for good' },
  ]
  // Destructive, and the ONLY path to a hard delete — never surfaced in
  // autocomplete. The participant has to know the word.
  override slashHidden = true

  protected async execute(_args: string): Promise<void> {
    const prune = get('@diamondcoreprocessor.com/PruneService') as PruneService | undefined
    if (!prune) return
    // Idempotent: saying it twice while already standing on the layer is not
    // a request to leave. The toggle in the history window is the way out,
    // as is Escape or the back gesture.
    if (!prune.active) await prune.enter()
    EffectBus.emit('history:view-open', undefined)
  }
}

const _prune = new PruneQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PruneQueenBee', _prune)
