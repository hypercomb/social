// sharing/hosts.queen.ts
//
// `/hosts` — the hosts you carry.
//
// Companion to `/publish`, with a clean ownership boundary. Publish is
// branch-scoped: where this branch goes and what the world serves. Hosts is
// the durable directory: which domains you carry and which packages they
// offer, before any branch chooses a destination.
//
// Toggling only; the panel owns its lifecycle from `hosts:render`.

import { EffectBus } from '@hypercomb/core'

export class HostsQueenBee {
  readonly command = 'hosts'
  readonly description =
    'Open your host directory — add or remove a host, inspect its packages, and add one to your hive. Publish uses this directory for branch destinations.'
  readonly descriptionKey = 'slash.hosts'

  async invoke(_args: string): Promise<void> {
    EffectBus.emit('hosts:view-toggle', {})
  }
}

const _hosts = new HostsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HostsQueenBee', _hosts)
