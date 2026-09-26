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
import { hostCurrentBranch } from './host-gesture.js'

export class PublishQueenBee {
  readonly command = 'publish'
  readonly description =
    'Show what your published hive is serving right now, next to what has changed here since — one row per branch, with publish, re-check and unpublish per row. `publish here` publishes the layer you stand on to its hosts.'
  readonly descriptionKey = 'slash.publish'

  async invoke(args: string): Promise<void> {
    // `publish here` — publish the layer you stand on to the hosts THIS layer
    // names (its host marks, else your standing host), with the `shared`
    // list riding along: the offering act. Joining offers what this served.
    if (String(args ?? '').trim().toLowerCase() === 'here') { await hostCurrentBranch(); return }
    EffectBus.emit('publish:view-toggle', {})
  }
}

const _publish = new PublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublishQueenBee', _publish)
