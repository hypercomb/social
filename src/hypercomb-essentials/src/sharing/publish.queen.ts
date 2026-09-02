// sharing/publish.queen.ts
//
// `/publish` — open the publish differential.
//
// Branch-scoped publication: what the world sees, what changed here, where a
// branch publishes, and the publish/re-publish/unpublish acts for that row.
// The durable host and package directory stays in `/hosts`; this surface only
// consumes its destinations.
//
// Toggling only — the panel owns its own lifecycle from `publish:render`.

import { EffectBus } from '@hypercomb/core'

export class PublishQueenBee {
  readonly command = 'publish'
  readonly description =
    'Show what your published hive is serving right now, next to what has changed here since — one row per branch, with publish, re-check and unpublish per row.'
  readonly descriptionKey = 'slash.publish'

  async invoke(_args: string): Promise<void> {
    EffectBus.emit('publish:view-toggle', {})
  }
}

const _publish = new PublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublishQueenBee', _publish)
