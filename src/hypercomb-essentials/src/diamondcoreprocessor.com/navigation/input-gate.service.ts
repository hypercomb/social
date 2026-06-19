// diamondcoreprocessor.com/navigation/input-gate.service.ts
//
// InputGate — shared input exclusivity. One source at a time. Context
// menu auto-suppressed while claimed.
//
// Defined here (not inside zoom.drone.ts) so consumers can re-export
// without dragging the entire ZoomDrone module — including its
// auto-registration side-effects — into namespace dependency bundles.
// The previous layout caused esbuild to inline the whole zoom.drone.ts
// (and a stale snapshot of ZoomDrone with its `register(...)` call) into
// the @diamondcoreprocessor.com/navigation namespace dep, and the
// build cache only tracks direct members so changes to zoom.drone.ts
// were invisible to the namespace dep's input signature.

import { EffectBus } from '@hypercomb/core'

/** Min gap between consecutive `input:locked-attempt` emits. A wheel spin
 *  or drag fires a burst of events; the command line only needs to flash
 *  its lock indicator once per attempt, not per event. */
const LOCKED_NOTIFY_THROTTLE_MS = 500

export class InputGate extends EventTarget {
  #owner: string | null = null
  // Persistent locks are reference-counted by named owner so independent
  // overlays/modals (editor, notes strip, manual lock button, …) can each
  // hold a lock without stomping one another. `locked` is true while ANY
  // owner holds — closing one modal must NOT unlock the tiles behind another
  // modal that's still open. A single boolean here was a latent bug: the
  // last unlock() always won regardless of who else was still locking.
  #lockOwners = new Set<string>()
  #lastLockedNotifyAt = 0

  get active(): boolean { return this.locked || this.#owner !== null }
  get locked(): boolean { return this.#lockOwners.size > 0 }
  get owner(): string | null { return this.#owner }

  /** Is a specific owner currently holding a lock? Lets a UI control (e.g.
   *  the manual lock button) track and toggle its OWN lock independently of
   *  locks held by other overlays. */
  lockedBy = (owner: string): boolean => this.#lockOwners.has(owner)

  /** Acquire a tile-input lock under `owner`. Idempotent per owner. While
   *  any lock is held, claim() is rejected and wheel zoom bails — tiles
   *  can't pan/zoom/select. Default owner keeps legacy no-arg callers
   *  working, but distinct overlays should pass distinct owners so their
   *  locks compose (see the reference-counting note above). */
  lock = (owner: string = 'default'): void => {
    if (this.#lockOwners.has(owner)) return
    this.#lockOwners.add(owner)
    this.dispatchEvent(new CustomEvent('change'))
  }
  /** Release `owner`'s lock. Locks held by other owners stay in effect. */
  unlock = (owner: string = 'default'): void => {
    if (!this.#lockOwners.delete(owner)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  claim = (source: string): boolean => {
    if (this.locked) {
      // A pan/pinch gesture tried to take the gate while it's locked
      // (e.g. behind the open editor overlay). Surface it so the UI can
      // tell the user why nothing moved.
      this.notifyLockedAttempt()
      return false
    }
    if (this.#owner && this.#owner !== source) return false
    if (this.#owner === source) return true
    this.#owner = source
    this.dispatchEvent(new CustomEvent('change'))
    return true
  }

  /** Throttled signal that a navigation gesture (pan/zoom) was just
   *  suppressed because the gate is locked. The command line listens for
   *  `input:locked-attempt` and flashes a lock indicator. claim() calls
   *  this on lock-rejection (covers touch pinch/pan and spacebar pan); the
   *  wheel-zoom path calls it directly since it reads `.locked` without
   *  claiming. No-op when unlocked. */
  notifyLockedAttempt = (): void => {
    if (!this.locked) return
    const now = performance.now()
    if (now - this.#lastLockedNotifyAt < LOCKED_NOTIFY_THROTTLE_MS) return
    this.#lastLockedNotifyAt = now
    EffectBus.emitTransient('input:locked-attempt', {})
  }

  release = (source: string): void => {
    if (this.#owner !== source) return
    this.#owner = null
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Emergency reset — drops all locks and ownership.
   *  Wired to the Escape cascade as a last-resort recovery so a leaked
   *  claim or unmatched lock can never permanently block input. */
  clear = (): void => {
    if (this.#lockOwners.size === 0 && this.#owner === null) return
    this.#lockOwners.clear()
    this.#owner = null
    this.dispatchEvent(new CustomEvent('change'))
  }

  constructor() {
    super()
    document.addEventListener('contextmenu', (e) => {
      if (this.#owner || e.ctrlKey || e.metaKey) e.preventDefault()
    }, true)
  }
}

const _inputGate = new InputGate()
window.ioc.register('@diamondcoreprocessor.com/InputGate', _inputGate)
