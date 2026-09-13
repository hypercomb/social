// commands/upgrade.queen.ts
//
// `/upgrade` — open the Packages window.
//
// ── Why this exists ───────────────────────────────────────────────────
//
// A behaviour, typed where every other verb is typed, that opens the one
// place updating happens: the Packages window, where each part of the app is
// on or off and an update mark sits on what the followed publisher moved.

import { QueenBee, EffectBus, INSTALL_IOC_KEY } from '@hypercomb/core'

export class UpgradeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'upgrade'
  override description = 'Open Packages — what loads, and what has an update'
  override descriptionKey = 'slash.upgrade'
  override examples = [
    { input: '/upgrade', result: 'Opens Packages — an update mark sits on what the publisher you follow moved' },
  ]

  protected async execute(): Promise<void> {
    // The dev shell imports modules directly at dev-time — there is no OPFS
    // install to replace, so say so rather than opening a window with nothing
    // to take.
    if (!window.ioc.get(INSTALL_IOC_KEY)) {
      EffectBus.emit('activity:log', { message: 'This shell loads modules directly — there is nothing to upgrade', icon: '⬡' })
      return
    }
    EffectBus.emit('packages:open', {})
  }
}

const _upgrade = new UpgradeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UpgradeQueenBee', _upgrade)
