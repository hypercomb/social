// commands/tags-view.queen.ts
//
// `/tags` — open the right-docked Tags management panel (the tag view). The
// panel itself is shell UI (hypercomb-shared/ui/tags-viewer); this queen only
// fires the open effect, keeping the essentials/shell boundary clean.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class TagsViewQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tags'
  override description = 'Open the tags panel, listing the tags you know with their colours and counts'
  override descriptionKey = 'slash.tags'
  override examples = [
    { input: '/tags', result: 'Opens the tags panel, listing every tag you know with its colour and how many visible tiles carry it' },
  ]

  protected async execute(): Promise<void> {
    EffectBus.emit('tags:view-open', {})
  }
}

const _tagsView = new TagsViewQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TagsViewQueenBee', _tagsView)
