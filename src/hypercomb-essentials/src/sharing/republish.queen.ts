// sharing/republish.queen.ts
//
// `republish` — publish again whatever has moved on since it went out (jwize 2026-10-26: "we are still not seeding the
// hives' updated imagery, or at least a way to publish the latest images").
//
//   republish        every published page whose head here differs from the one the world sees — a new picture, a new
//                    note — in one go, after one question that names them
//
// A picture set on a tile changes the tile's own layer, so its head here is no longer the head the index names; the Publish
// panel already calls that row `drift`. This word picks those rows for you and runs them as the panel's "selected apps"
// run does, to the hosts each page names. It publishes nothing that was never published, and withdraws nothing.
//
// Like every publish form it is the participant's to say: a machine is refused.

import { EffectBus, QueenBee } from '@hypercomb/core'

export class RepublishQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'republish'
  override description = 'Publish again every published page that has changed since it went out — new pictures included'
  override descriptionKey = 'slash.republish'
  override examples = [
    { input: '/republish', result: 'Names the published pages that have moved on, asks once, and republishes them to the hosts they name' },
  ]

  readonly machine = {
    forms: '',
    example: '/republish',
    reach: 'destructive' as const,
    scope: 'network' as const,
    consequence: 'sends what is here now to the hosts each changed page names; whatever is served may be copied and cannot be taken back',
    refuse: (): string => 'republish is the participant\'s to say, like every publish form',
  }

  protected execute(): void {
    EffectBus.emit('publish:run-drifted', {})
  }
}

const _republish = new RepublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RepublishQueenBee', _republish)
