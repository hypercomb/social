// presentation/tiles/recents.queen.ts
//
// `recents` — the word for the recents view (documentation/recents-and-the-
// quick-tray.md). Every act has a word; this one opens every atom this hive
// made, newest at the centre.
//
// Syntax:
//   recents            — the full-screen view
//   recents <text>     — the same, narrowed by name or path
//   recents panel      — the same census as a list in the index panel
//
// TRANSIENT: a replayed `recents:open` would reopen the view for a late
// subscriber. `panel` is not a behaviour word, so the command line leaves it
// to this queen.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class RecentsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'recents'
  override description = 'Show every tile this hive made, newest at the centre'
  override descriptionKey = 'slash.recents'
  override options = ['', '<text>', 'panel']
  override examples = [
    { input: '/recents', result: 'Every tile this hive made, newest at the centre' },
    { input: '/recents plan', result: 'Only those whose name or path holds "plan"' },
    { input: '/recents panel', result: 'The same tiles as a list' },
  ]

  override slashComplete(): readonly string[] { return ['panel'] }

  protected async execute(args: string): Promise<void> {
    const text = args.trim()
    if (text === 'panel') EffectBus.emit('aggregate:view-open', { id: 'recents' })
    else EffectBus.emitTransient('recents:open', { filter: text })
  }
}

const _recents = new RecentsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RecentsQueenBee', _recents)
