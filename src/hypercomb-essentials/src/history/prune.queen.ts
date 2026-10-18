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
// The word answers on the canvas: the deleted tiles appear where you stand.
// It does not raise the history window. A window opens only from its own
// door, and `history` (or its icon) is that door if you want the toggle.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { PruneService } from './prune.service.js'

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
    // a request to leave. Escape or the back gesture is the way out, as is the
    // toggle in the history window when you have opened it yourself.
    if (prune.active) return
    await prune.enter()
    // The hive's one destructive mode, entered with no window raised: say
    // where you are in place, and carry History's door on the toast.
    const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc
      ?.get?.('@hypercomb.social/I18n') as { t?: (k: string) => string } | undefined
    const tr = (key: string, fallback: string): string => {
      const out = i18n?.t?.(key)
      return out && out !== key ? out : fallback
    }
    EffectBus.emit('toast:show', {
      type: 'info',
      message: tr('prune.entered', 'Deleted tiles. Delete destroys them for good here; Escape leaves.'),
      actionLabel: tr('prune.history', 'History'),
      actionEffect: 'history:view-open',
      actionPayload: undefined,
    })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): a dependency registers nothing;
// its owner bee registers it.
window.ioc.register('@diamondcoreprocessor.com/PruneService', new PruneService())

const _prune = new PruneQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PruneQueenBee', _prune)
