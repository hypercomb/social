// hypercomb-shared/core/launch-group-base.ts
//
// LaunchGroupBase — the standard behavior every launch group shares. One
// contract, one owner: opening a member through the launcher ARMS a one-shot
// watch on that member's surface; when the surface returns to the hexagon
// canvas (exit affordance, Escape, toggle-off), the launcher resets to its
// default via GroupRegistry.surfaceClosed() — the header icons go dark and
// the participant lands back on the hive. Websites got this first; the base
// makes it uniform for EVERY aggregate group (games, dashboard, help, and any
// future group) instead of each provider wiring its own reset.
//
// A subclass declares only what is genuinely its own:
//   activate(m)             — how a member opens (navigate + view mode flip,
//                             effect toggle, overlay mount, …)
//   watchSurface(m, report) — how its surface signals on-screen state: call
//                             report(open) with the CURRENT state on subscribe
//                             when it is knowable (EffectBus last-value replay
//                             gives this for free; ViewMode listeners prime by
//                             hand) and on every change; return the
//                             unsubscribe.
//
// The base runs a two-phase machine over those reports: the surface must be
// SEEN OPEN once before a closed report counts, so an EffectBus replay of a
// stale close (a game closed earlier this session) can never fire the reset
// at arm time. Group SWITCHES are filtered inside GroupRegistry.surfaceClosed
// (the mixed bag dismisses the old surface itself and must not wipe the fresh
// pick); the watch still disarms on the close — that surface's launcher
// session is over either way.
//
// Surfaces entered WITHOUT group.open() (a typed /website, the `/` key, a
// queen command) are deliberately never armed — they are not launcher
// sessions, so closing them must not touch the toggles.

import { groupRegistry, type GroupMember, type LaunchGroup } from './group-registry'

export abstract class LaunchGroupBase implements LaunchGroup {
  abstract readonly id: string
  abstract readonly icon: string
  abstract readonly label: string

  abstract members(): GroupMember[]

  /** Group-specific member activation — called by open() after arming. */
  protected abstract activate(m: GroupMember): void

  /** Group-specific surface signal — see the header. */
  protected abstract watchSurface(m: GroupMember, report: (open: boolean) => void): () => void

  /** Tear-down for the armed close-watch. Null when nothing is armed. A fresh
   *  open supersedes any prior arm. */
  #disarm: (() => void) | null = null

  open(m: GroupMember): void {
    this.#arm(m)
    this.activate(m)
  }

  #arm(m: GroupMember): void {
    this.#disarm?.()
    let sawOpen = false
    const un = this.watchSurface(m, (open) => {
      if (open) { sawOpen = true; return }
      if (!sawOpen) return               // stale replay / surface not up yet
      this.#disarm?.()
      groupRegistry.surfaceClosed(m)
    })
    this.#disarm = (): void => { un(); this.#disarm = null }
  }
}
