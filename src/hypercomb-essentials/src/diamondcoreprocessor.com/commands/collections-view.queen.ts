// diamondcoreprocessor.com/commands/collections-view.queen.ts
//
// `/collections` — open the right-docked Collections entrance (the `sets/`
// index, filterable). The panel itself is shell UI: the ONE aggregate index
// (hypercomb-shared/ui/aggregate-index) rendering the `collections` source.
// This queen only fires the open effect, keeping the essentials/shell boundary
// clean.
//
// It deliberately does NOT navigate: the panel is a tool window you can open
// over any page, and `/sets` is reachable on its own (the pools button, or just
// walking there). Opening the entrance and moving the participant are separate
// intents — the controls-bar pools button is the one that does both.

import { QueenBee, EffectBus } from '@hypercomb/core'
// The aggregate index rides the queen that owns 'aggregate:view-open'.
// The FILE lives in groups/ (the domain that owns aggregation); the
// IMPORTER is here, with the door that opens it.
// ONE importer: dup-inlining rule.
import '../groups/aggregate-index.view.js'

export class CollectionsViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'collections'
  override readonly aliases = ['sets']
  override description = 'Open the collections entrance'
  override examples = [
    { input: '/collections', result: 'Opens the right-docked collections panel' },
  ]

  protected async execute(): Promise<void> {
    EffectBus.emit('aggregate:view-open', { id: 'collections' })
  }
}

const _collectionsView = new CollectionsViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CollectionsViewQueenBee', _collectionsView)
