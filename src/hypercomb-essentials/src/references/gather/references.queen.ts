// references/gather/references.queen.ts
//
// `/references` — open the Portals/References pair for the page you stand on.
//
// Portals on the left is where a group is picked: while the pair is open every
// portal row carries a link button, lit on the group this page gathers from.
// References on the right says what this page is — the groups it gathers from
// (× to unlink), and, when the page is itself a group, the pages it feeds
// (switch them on, add one by name, send the tiles you selected). Both follow
// you from page to page and close together.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class ReferencesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'references'
  override description = 'Open Portals and References together to see and manage this page\'s links'
  override descriptionKey = 'slash.references'
  override examples = [
    { input: '/references', result: 'Portals opens on the left, References on the right, both about this page' },
  ]

  override machine = {
    forms: '',
    example: '/references',
    bare: true,
    reach: 'additive' as const,
    scope: 'page' as const,
    refuse: (): string | undefined => undefined,
  }

  protected async execute(): Promise<void> {
    EffectBus.emit('references:manage', {})
  }
}

const _references = new ReferencesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ReferencesQueenBee', _references)
