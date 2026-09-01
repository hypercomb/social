// sharing/publish.queen.ts
//
// `/publish` — open the publish differential.
//
// The counterpart verb to `/host`. `/host` is the GESTURE (publish the branch
// I am standing in, hand me a link); `/publish` is the STATE (what does the
// world actually see, and what has changed here since). Keeping them separate
// keeps each one honest: a gesture that also reported status would have to
// guess, and a status surface that also published would hide which branch it
// acted on.
//
// Toggling only — the panel owns its own lifecycle from `publish:render`.

import { EffectBus } from '@hypercomb/core'

export class PublishQueenBee {
  readonly command = 'publish'
  readonly aliases = ['published', 'live', 'publish-status'] as const
  readonly description =
    'Show what your published hive is serving right now, next to what has changed here since — one row per branch, with publish, re-check and unpublish per row.'
  readonly descriptionKey = 'slash.publish'

  async invoke(_args: string): Promise<void> {
    EffectBus.emit('publish:view-toggle', {})
  }
}

const _publish = new PublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublishQueenBee', _publish)
