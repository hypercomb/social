import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// drone — reactive bee, heartbeats every pulse
// -------------------------------------------------

export abstract class Drone extends Bee {

  /** Does this drone sense relevance in the current grammar? (biofidelic gate) */
  protected sense: (grammar: string) => boolean | Promise<boolean> = () => true

  /** Developer-defined behavior — runs every pulse cycle */
  protected heartbeat: (grammar: string) => Promise<void> = async () => { }

  /** Drones pulse every time — heartbeat runs on each act() cycle */
  public async pulse(grammar: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    if (!(await this.sense(grammar))) return
    await this.heartbeat(grammar)
    if (this._state === BeeState.Created || this._state === BeeState.Registered) {
      this._state = BeeState.Active
    }
  }
}
