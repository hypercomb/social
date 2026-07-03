// hypercomb-shared/core/launch-group-base.ts
//
// LaunchGroupBase — the shared shape of a launch group. ONE-STATE
// (2026-07-03): opening a member just activates it. The old close-watch /
// surfaceClosed reset machinery is gone — there is no launcher toggle state
// left to reset, so closing a member surface is that surface's own business
// and the participant simply stays (or lands) wherever navigation puts them.
//
// A subclass declares only what is genuinely its own:
//   activate(m) — how a member opens (navigate + view mode flip, effect
//                 toggle, overlay mount, …)

import type { GroupMember, LaunchGroup } from './group-registry'

export abstract class LaunchGroupBase implements LaunchGroup {
  abstract readonly id: string
  abstract readonly icon: string
  abstract readonly label: string

  abstract members(): GroupMember[]

  /** Group-specific member activation — called by open(). */
  protected abstract activate(m: GroupMember): void

  open(m: GroupMember): void {
    this.activate(m)
  }
}
