// diamondcoreprocessor.com/sharing/follow.drone.ts
//
// Navigation sync. When the user is following a participant
// (swarm.follow(pubkey) was called), this drone watches for
// swarm:leader-moved events and navigates to the leader's location.
// "You literally go where they go."
//
// Distinct from subscribe: subscribe is data flow (their tiles
// appear in your view); follow is navigation sync (you GO TO their
// location). The two are orthogonal — either, both, or neither.
//
// Why a separate drone (vs inlining in swarm.drone): keeps the swarm
// drone focused on mesh primitives. The decision "should I navigate
// right now" belongs with Navigation, and bridging an effect to a
// service call is exactly what a small drone does. Easy to swap the
// policy later (rate-limit, debounce, confirmation prompt) without
// touching the swarm.

import { Drone } from '@hypercomb/core'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const NAVIGATION_KEY = '@hypercomb.social/Navigation'

interface SwarmDroneLike {
  following: () => string
}

interface NavigationLike {
  go: (segments: readonly string[]) => void
  segmentsRaw: () => readonly string[]
}

export class FollowDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Bridges swarm:leader-moved events to Navigation.go — when the user is following someone, their view navigates with them.'

  protected override listens: string[] = ['swarm:leader-moved']
  protected override emits: string[] = []

  #initialized = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true

    this.onEffect<{ pubkey: string; segments: readonly string[] }>('swarm:leader-moved', (payload) => {
      const swarm = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(SWARM_DRONE_KEY) as SwarmDroneLike | undefined
      const followingPk = swarm?.following?.() ?? ''
      if (!followingPk) return
      if (payload?.pubkey !== followingPk) return  // not the leader we follow

      const nav = (window as { ioc?: { get: (k: string) => unknown } }).ioc?.get?.(NAVIGATION_KEY) as NavigationLike | undefined
      if (!nav?.go) return

      // Skip when already there. Lets the user's own micro-moves
      // coexist with follow when the leader is idle.
      const here = nav.segmentsRaw?.() ?? []
      const target = Array.isArray(payload?.segments) ? payload.segments : []
      if (here.length === target.length && here.every((s, i) => s === target[i])) return

      nav.go(target)
    })
  }
}

const _follow = new FollowDrone()
window.ioc.register('@diamondcoreprocessor.com/FollowDrone', _follow)
