// sharing/spotlight.service.ts
//
// SpotlightService — global "whose layer is on top" state for the swarm
// canvas.
//
// Model: at the current swarm location there may be N peers actively
// publishing visuals, each one a layer over the same tiles. Yours is on
// top until you pick another (jwize, 2026-10-15: "it needs to be layers
// you can switch the top layer by clicking the member"). Spotlight cycles
// through `[you, peerA, peerB, …, peerN]`: when `activePeer` is set, their
// versions of shared tiles show and every tile they do not hold sits below
// (show-cell + hex-sdf vPresence). When `activePeer` is null, yours is on
// top. No layer wears a colour.
//
// State is global per the current swarm sig. Switching locations
// resets to `off` (the participant set changes; carrying a peer key
// across locations would be meaningless).
//
// Drives:
//   - the presence badges (shared presence-banner) — a member's badge
//     sets them on top, theirs or yours again dismisses
//   - show-cell render hook — paints spotlit tiles
//   - spotlight-scroll input — alt+wheel cycles through participants
//
// Read participants through SwarmDrone.participantsAtCurrentSig()
// which returns the ordered (freshness-first, self-excluded, stale-
// filtered) pubkey list for the live sig.

import { EffectBus } from '@hypercomb/core'

const SWARM_DRONE_KEY = '@diamondcoreprocessor.com/SwarmDrone'

/** Fired on every spotlight change (set / cycle / dismiss / auto-clear). */
export const SPOTLIGHT_CHANGED = 'spotlight:changed'

interface SwarmDroneLike {
  participantsAtCurrentSig?: () => readonly string[]
}

export class SpotlightService extends EventTarget {

  /** The pubkey currently spotlit, or null for default merged render. */
  #activePeer: string | null = null

  /** Live participant list snapshot — refreshed on each cycle call so
   *  the cycle index stays meaningful even as peers arrive / leave. */
  #lastParticipants: readonly string[] = []

  get activePeer(): string | null { return this.#activePeer }

  /** Read the SwarmDrone's live participant list for the current sig.
   *  Returns [] when the drone isn't registered (no swarm joined). */
  participants(): readonly string[] {
    const swarm = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.(
      SWARM_DRONE_KEY,
    ) as SwarmDroneLike | undefined
    const list = swarm?.participantsAtCurrentSig?.() ?? []
    this.#lastParticipants = list
    return list
  }

  /** Set the spotlight to a specific peer. No-op if pubkey isn't in
   *  the current participant set (defensive — caller may pass a stale
   *  key after the peer expired). Emits change. */
  set(pubkey: string | null): void {
    if (pubkey === null) { this.dismiss(); return }
    const list = this.participants()
    if (!list.includes(pubkey)) return
    if (this.#activePeer === pubkey) return
    this.#activePeer = pubkey
    this.#emit()
  }

  /** Drop the spotlight back to default merged render. */
  dismiss(): void {
    if (this.#activePeer === null) return
    this.#activePeer = null
    this.#emit()
  }

  /** Advance to the next participant in the freshness-ordered list.
   *  Cycle is `[off, peerA, peerB, …, peerN, off, …]` — `off` is
   *  position 0, peers fill positions 1..N. */
  cycleNext(): void { this.#step(+1) }

  /** Step back through the cycle. */
  cycleBack(): void { this.#step(-1) }

  #step(delta: number): void {
    const list = this.participants()
    if (list.length === 0) {
      // No peers to cycle through; ensure we're in `off` state.
      if (this.#activePeer !== null) this.dismiss()
      return
    }
    // Current position: 0 = off, 1..N = list[0..N-1].
    const currentIdx = this.#activePeer === null
      ? 0
      : Math.max(0, list.indexOf(this.#activePeer)) + 1
    const total = list.length + 1  // +1 for the off slot
    const nextIdx = ((currentIdx + delta) % total + total) % total
    const nextPeer = nextIdx === 0 ? null : list[nextIdx - 1] ?? null
    if (nextPeer === this.#activePeer) return
    this.#activePeer = nextPeer
    this.#emit()
  }

  /** Called by the swarm when the participant list changes — drops the
   *  spotlight if the active peer is no longer present. */
  reconcile(): void {
    if (!this.#activePeer) return
    const list = this.participants()
    if (!list.includes(this.#activePeer)) this.dismiss()
  }

  #emit(): void {
    const payload = { activePeer: this.#activePeer, participants: this.#lastParticipants }
    this.dispatchEvent(new CustomEvent(SPOTLIGHT_CHANGED, { detail: payload }))
    EffectBus.emit(SPOTLIGHT_CHANGED, payload)
  }
}

const _spotlight = new SpotlightService()
// presentation/tiles/spotlight.drone.ts registers this (atomic-modules-plan.md).
export { _spotlight as spotlightService }

// Reconcile when the swarm's peer set changes — covers peers going
// stale, leaving, or joining. If our active peer evaporates, drop the
// spotlight cleanly.
EffectBus.on('swarm:peers-changed', () => _spotlight.reconcile())
