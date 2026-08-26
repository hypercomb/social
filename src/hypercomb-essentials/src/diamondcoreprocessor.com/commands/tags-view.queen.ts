// diamondcoreprocessor.com/commands/tags-view.queen.ts
//
// `/tags` — open the right-docked Tags management panel (the tag view). The
// panel itself is shell UI (hypercomb-shared/ui/tags-viewer); this queen only
// fires the open effect, keeping the essentials/shell boundary clean.

import { QueenBee, EffectBus } from '@hypercomb/core'
// The tags viewer rides the queen that owns 'tags:view-open'. The FILE
// lives in pheromones/ — tags ARE pheromones, and pheromone-tiles.view
// is already its neighbour. ONE importer: dup-inlining rule.
import '../pheromones/tags-viewer.view.js'

export class TagsViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tags'
  override readonly aliases = []
  override description = 'Open the tag view'
  override descriptionKey = 'slash.tags'
  override examples = [
    { input: '/tags', result: 'Opens the right-docked tags panel' },
  ]

  protected async execute(): Promise<void> {
    EffectBus.emit('tags:view-open', {})
  }
}

const _tagsView = new TagsViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TagsViewQueenBee', _tagsView)
