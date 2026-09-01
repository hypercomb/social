// commands/aliases/aliases.queen.ts
//
// /aliases — call the behaviours what YOU call them.
//
//   /aliases            — open the aliases window
//   /aliases present    — open it looking at that behaviour
//
// The window is where the giving happens: each behaviour's canonical name,
// the names you've given it, the old code-declared names as candidates, and
// a field for one of your own. The command line only opens the door — a
// christening is a choice from a list, and a list is a window's job.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class AliasesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'aliases'
  override description = 'Give behaviours your own names'
  override descriptionKey = 'slash.aliases'
  override options = ['<behaviour>']
  override examples = [
    { input: '/aliases', result: 'Opens the aliases window' },
    { input: '/aliases present', result: 'Opens it looking at the present behaviour' },
  ]

  override slashComplete(args: string): readonly string[] {
    const drone = get('@diamondcoreprocessor.com/SlashBehaviourDrone') as
      { entries?: () => { name: string; hidden?: boolean }[] } | undefined
    const names = (drone?.entries?.() ?? [])
      .filter(e => !e.hidden && e.name !== this.command)
      .map(e => e.name)
      .sort()
    const q = args.toLowerCase().trim()
    if (!q) return names
    return names.filter(n => n.startsWith(q))
  }

  protected execute(args: string): void {
    EffectBus.emit('aliases:open', { filter: args.trim().toLowerCase() })
  }
}

const _aliases = new AliasesQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/AliasesQueenBee', _aliases)
