// commands/upgrade.queen.ts
//
// `/upgrade` — open the Packages window.
//
// ── Why this exists ───────────────────────────────────────────────────
//
// A behaviour, typed where every other verb is typed, that opens the one
// place updating happens: the Packages window, where each part of the app is
// on or off and an update mark sits on what the followed publisher moved.

import { QueenBee, EffectBus, INSTALL_IOC_KEY, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { isUpgradeAllowed, setUpgradeAllowed } from '../sharing/upgrade-allow.js'

export class UpgradeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'upgrade'
  override description = 'Open Packages — what loads, and what has an update. `upgrade allow` lets your followed publisher\'s updates apply on their own; `upgrade refuse` takes that back'
  override descriptionKey = 'slash.upgrade'
  override examples = [
    { input: '/upgrade', result: 'Opens Packages — an update mark sits on what the publisher you follow moved' },
    { input: 'upgrade allow', result: 'From now on an update from the publisher you follow is taken the moment it is seen — your choice, never forced' },
    { input: 'upgrade refuse', result: 'Back to the notice: updates wait for you to press Update all' },
  ]

  protected async execute(args: string): Promise<void> {
    // ALLOW, NEVER FORCE (jwize 2026-09-24). The sub-words are not behaviour
    // words of their own, so the line runs as one act.
    const word = (args ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (word === 'allow' || word === 'refuse') {
      const allow = word === 'allow'
      setUpgradeAllowed(allow)
      const i18n = window.ioc.get<I18nProvider>(I18N_IOC_KEY)
      EffectBus.emit('activity:log', {
        message: allow
          ? (i18n?.t('upgrade.allowed') ?? 'updates from the publisher you follow will be taken on their own — `upgrade refuse` undoes this')
          : (i18n?.t('upgrade.refused') ?? 'updates wait for you again — take them in Packages'),
        icon: '⬡',
      })
      return
    }
    if (word === 'allowed') {
      EffectBus.emit('activity:log', { message: isUpgradeAllowed() ? 'updates are allowed to apply on their own' : 'updates wait for you (say `upgrade allow` to change that)', icon: '⬡' })
      return
    }
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
