import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// worker — bootstrap-once bee, acts once then goes dormant
// -------------------------------------------------

export abstract class Worker extends Bee {

  #acted = false
  public get acted(): boolean { return this.#acted }

  /** Is this worker ready to act? (gate — checked each pulse until true) */
  protected ready: (grammar: string) => boolean | Promise<boolean> = () => true

  /** Developer-defined one-time action — runs once when ready() returns true */
  protected act: (grammar: string) => Promise<void> = async () => { }

  /** Workers pulse until act completes — then go dormant */
  public async pulse(grammar: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    if (this.#acted) return
    if (!(await this.ready(grammar))) return
    await this.act(grammar)
    this.#acted = true
    if (this._state === BeeState.Created || this._state === BeeState.Registered) {
      this._state = BeeState.Active
    }
  }
}
