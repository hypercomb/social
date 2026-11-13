// sharing/contribute.queen.ts
//
// `contribute` — put a list for the tile you stand on onto a host, under your
// own key, for anyone who explores that name (`explore recipes`) to find.
//
//   contribute                     the names of the tiles under this one
//   contribute soup, bread         these values instead
//   contribute ... @example.com    on that host (else the branch's first host)
//
// The act is contribute.ts. It publishes under the participant's key, so a
// model is refused the word: only the participant says it.

import { QueenBee } from '@hypercomb/core'
import { contributeHere } from './contribute.js'

export class ContributeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'contribute'
  override description = 'Contribute a list for the tile you stand on, under your key, on a host'
  override descriptionKey = 'slash.contribute'
  // Free-text values and an `@host:port` are the word's own, never tag grammar.
  override rawArgs = true
  override options = ['', '<value>, <value>, ...', '[<value>, ...] @<host>']
  override examples = [
    { input: 'contribute', result: 'The names of the tiles under this one become a list for it, on the branch\'s host' },
    { input: 'contribute soup, bread @example.com', result: 'Those values become a list for this tile on example.com, under your key' },
  ]
  override machine = {
    forms: 'contribute [<value>, ...] [@<host>]',
    example: '/contribute soup, bread',
    bare: true,
    reach: 'additive' as const,
    scope: 'network' as const,
    refuse: (): string => '/contribute publishes under the participant\'s key; only the participant says it',
  }

  protected async execute(args: string): Promise<void> {
    await contributeHere(args)
  }
}

const _contribute = new ContributeQueenBee()
window.ioc.register('@ContributeQueenBee', _contribute)
