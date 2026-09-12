// commands/upgrade.queen.ts
//
// `/upgrade` — open the hosts window on your own domain's builds.
//
// ── Why this exists ───────────────────────────────────────────────────
//
// An installed hive had no participant-reachable way to move to a newer
// build: the header notice lights only when a check decides an update is
// available, and `window.upgradeHypercomb()` needs a console, which a phone
// does not have. So: a behaviour, typed where every other verb is typed.
//
// ── Updating happens in the hosts window (2026-09-12) ─────────────────
//
// This verb used to install the shell's bundled build on the spot. Every
// update now goes through ONE place, the hosts window, where the build is
// named, a restore point is saved first and the way back is offered after —
// so the verb takes you there, looking at your own domain. The shell's
// `?upgrade=1` door stays for the first hop onto a build that has this.

import { QueenBee, EffectBus } from '@hypercomb/core'

export class UpgradeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'upgrade'
  override description = 'Open the hosts window on your own domain to update'
  override descriptionKey = 'slash.upgrade'
  override examples = [
    { input: '/upgrade', result: 'Opens Hosts on your own domain — Update there saves a restore point, then installs' },
  ]

  protected async execute(): Promise<void> {
    // The dev shell imports modules directly at dev-time — there is no OPFS
    // install to replace, so say so rather than opening a window with nothing
    // to take.
    if (!('upgradeHypercomb' in window)) {
      EffectBus.emit('activity:log', { message: 'This shell loads modules directly — there is nothing to upgrade', icon: '⬡' })
      return
    }
    EffectBus.emit('hosts:open', { source: 'bundled' })
  }
}

const _upgrade = new UpgradeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UpgradeQueenBee', _upgrade)
