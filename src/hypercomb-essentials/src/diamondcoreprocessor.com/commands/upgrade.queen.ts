// diamondcoreprocessor.com/commands/upgrade.queen.ts
//
// `/upgrade` — take the newest build the shell is serving.
//
// ── Why this exists ───────────────────────────────────────────────────
//
// An installed hive had no participant-reachable way to move to a newer
// build. The header's upgrade indicator only lights when checkForUpdate
// decides an update is available, and for a DCP-sourced install its
// provenance gate returns `available: false` unconditionally — DCP is
// supposed to surface those updates itself, so when it doesn't, there is
// no second door. The install prompt's "Upgrade Hypercomb" button renders
// only while nothing is installed. `window.upgradeHypercomb()` needs a
// console, which a phone does not have.
//
// So: a behaviour, typed where every other verb is typed.
//
// ── What it does NOT replace ──────────────────────────────────────────
//
// The shell's `?upgrade=1` door stays the primary one, because THIS is a
// bee — it can only run once the build carrying it is already installed,
// which is exactly the situation an upgrade is needed to escape. Use the
// URL for the first hop onto a build that has this; use `/upgrade` after.
//
// The work itself is the shell's: `hypercomb:apply-update` is the event
// the header indicator's Adopt already dispatches, and the web shell binds
// it to upgradeFromBundled() + reload. Nothing about the install path is
// duplicated here — this is a door, not a mechanism.

import { QueenBee, EffectBus } from '@hypercomb/core'

const APPLY_UPDATE_EVENT = 'hypercomb:apply-update'

export class UpgradeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'upgrade'
  override readonly aliases = []
  override description = 'Install the newest build this shell is serving, then reload'
  override descriptionKey = 'slash.upgrade'
  override examples = [
    { input: '/upgrade', result: 'Fetches the shell’s current package, replaces the installed modules and reloads' },
  ]

  protected async execute(): Promise<void> {
    // The dev shell imports modules directly at dev-time — there is no OPFS
    // install to replace, so say so rather than firing an event nothing binds.
    if (!('upgradeHypercomb' in window)) {
      this.#log('This shell loads modules directly — there is nothing to upgrade')
      return
    }
    this.#log('Taking the newest build — the hive will reload', '⬡')
    window.dispatchEvent(new CustomEvent(APPLY_UPDATE_EVENT))
  }

  #log(message: string, icon = '⬡'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _upgrade = new UpgradeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UpgradeQueenBee', _upgrade)
