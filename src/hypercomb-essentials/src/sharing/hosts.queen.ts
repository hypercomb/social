// sharing/hosts.queen.ts
//
// `/hosts` — the hosts you carry.
//
// Third verb alongside `/host` and `/publish`, and the split is the same one
// those two already make. `/host` is the GESTURE (publish this branch, hand me
// a link). `/publish` is the STATE (what is the world serving, what changed
// here since). `/hosts` is the SET — who you can reach, before any question of
// what to send them.
//
// Toggling only; the panel owns its lifecycle from `hosts:render`.

import { EffectBus } from '@hypercomb/core'

export class HostsQueenBee {
  readonly command = 'hosts'
  readonly aliases = ['community', 'domains'] as const
  readonly description =
    'The hosts you carry — add one you have been given, drop one you no longer want, and see which of your branches name it. The list your branches choose their addresses from.'
  readonly descriptionKey = 'slash.hosts'

  async invoke(_args: string): Promise<void> {
    EffectBus.emit('hosts:view-toggle', {})
  }
}

const _hosts = new HostsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HostsQueenBee', _hosts)
