import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// worker — reactive bee, heartbeats every pulse
// -------------------------------------------------

export abstract class Worker extends Bee {

  /** Workers pulse every time — heartbeat runs on each act() cycle */
  public async pulse(grammar: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    if (!(await this.sensed(grammar))) return
    await this.heartbeat(grammar)
    if (this._state === BeeState.Created || this._state === BeeState.Registered) {
      this._state = BeeState.Active
    }
  }
}
