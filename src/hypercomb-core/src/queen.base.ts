import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// queen bee — real-time command dispatch, no lifecycle
// -------------------------------------------------

export abstract class QueenBee extends Bee {

  /** The slash command this queen bee responds to (e.g. 'paste', 'export', 'publish') */
  abstract readonly command: string

  /** Optional aliases — additional names that resolve to this queen bee */
  readonly aliases: string[] = []

  /** Real-time execution — called immediately when `/command` is invoked */
  protected abstract execute(args: string): void | Promise<void>

  /**
   * Queen bees don't participate in the processor pulse cycle.
   * Pulse is a no-op — they're invoked directly via `invoke()`.
   */
  public async pulse(_grammar: string): Promise<void> { }

  /**
   * Direct invocation — called by the command line (or any caller)
   * when the user types `/command args`.
   */
  public async invoke(args: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    await this.execute(args)
    if (this._state === BeeState.Created || this._state === BeeState.Registered) {
      this._state = BeeState.Active
    }
  }

  /**
   * Check if this queen bee matches a given command string.
   * Checks canonical `command` first, then `aliases`.
   */
  public matches(input: string): boolean {
    const lower = input.toLowerCase()
    if (this.command.toLowerCase() === lower) return true
    return this.aliases.some(a => a.toLowerCase() === lower)
  }
}
