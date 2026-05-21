import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// worker — bootstrap-once bee, acts once then goes dormant
// -------------------------------------------------

export abstract class Worker extends Bee {

  #acted = false
  public get acted(): boolean { return this.#acted }

  // Belt-and-braces guard for concurrent pulse() calls. The #acted re-check
  // after `await ready()` closes the async-ready race, but the moment between
  // resolving `ready()` and writing `#acted = true` still spans a microtask
  // boundary. #actInFlight is set BEFORE the await, so a second pulse() that
  // arrives during the await returns immediately instead of also entering
  // the critical section. JS is single-threaded so the only race surface is
  // microtask interleaving — but that's exactly where the bug lives.
  #actInFlight = false

  /** Is this worker ready to act? (gate — checked each pulse until true) */
  protected ready: (grammar: string) => boolean | Promise<boolean> = () => true

  /** Developer-defined one-time action — runs once when ready() returns true */
  protected act: (grammar: string) => Promise<void> = async () => { }

  /** Workers pulse until act completes — then go dormant */
  public async pulse(grammar: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    if (this.#acted) return
    if (this.#actInFlight) return
    this.#actInFlight = true
    try {
      if (!(await this.ready(grammar))) return
      if (this.#acted) return  // re-check after async ready()
      this.#acted = true
      await this.act(grammar)
      if (this._state === BeeState.Created || this._state === BeeState.Registered) {
        this._state = BeeState.Active
      }
    } finally {
      this.#actInFlight = false
    }
  }
}
