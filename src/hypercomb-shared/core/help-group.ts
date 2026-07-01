// hypercomb-shared/core/help-group.ts
//
// The "help" launch group — surfaces the reference sheet as a single
// meaning-icon in the command line, beside the dashboard / websites / games
// icons. Help is universal: the icon is ALWAYS present (one member, never
// gated on discovery) so the participant always has a way in.
//
// Help has no hive location — its member opens an OVERLAY, not a navigation
// target. open() emits the same `keymap:invoke { cmd: 'ui.shortcutSheet' }`
// effect that `/help` and the `/` key already use, so ShortcutSheetDrone
// toggles the sheet (open if closed, close if open) — one entry point, one
// owner of the open/close state. The reference sheet itself is where the
// slash behaviours, command-line operations, and keyboard shortcuts are
// aggregated.
//
// Shell-level: nothing essentials is imported — the toggle rides EffectBus and
// the sheet drone listens. Same self-registration pattern as DashboardGroup.

import { EffectBus } from '@hypercomb/core'
import { groupRegistry, type GroupMember, type LaunchGroup } from './group-registry'

const MEMBER: GroupMember = { key: 'help', label: 'Help', segments: [] }

class HelpGroup implements LaunchGroup {
  readonly id = 'help'
  readonly icon = 'help'
  readonly label = 'Help'

  // Help is always available, so the member set never changes — no member-set
  // subscription / notifyChanged() is needed (unlike dashboard / websites,
  // which appear only once content is discovered).
  members(): GroupMember[] {
    return [MEMBER]
  }

  // No hive location → opens an overlay above the current surface (the mixed
  // bag stays put, mirroring games). Toggling the sheet reuses the keymap
  // command so the sheet's own open/close logic and input-gate locking apply.
  open(_m: GroupMember): void {
    EffectBus.emit('keymap:invoke', { cmd: 'ui.shortcutSheet', binding: null, event: null })
  }
}

groupRegistry.register(new HelpGroup())
