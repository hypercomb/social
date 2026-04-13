import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// queen bee — real-time slash behaviour dispatch, no lifecycle
// -------------------------------------------------

export abstract class QueenBee extends Bee {

  /** The slash behaviour this queen bee responds to (e.g. 'paste', 'export', 'publish') */
  abstract readonly command: string

  /** Optional aliases — additional names that resolve to this queen bee */
  readonly aliases: string[] = []

  /**
   * Optional i18n key for a localized description. When set, the slash drone
   * resolves it through the I18n service; otherwise it falls back to `description`.
   * Pattern: `slash.<command>`.
   */
  public descriptionKey?: string

  /**
   * Optional autocomplete hook. Returns the list of completions for the current
   * args string (everything typed after the command name). Implement on the queen
   * itself — the slash drone reads it live, so there is no mirror class to drift.
   */
  public slashComplete?(args: string): readonly string[]

  /** Real-time execution — called immediately when `/behaviour` is invoked */
  protected abstract execute(args: string): void | Promise<void>

  /**
   * Queen bees don't participate in the processor pulse cycle.
   * Pulse is a no-op — they're invoked directly via `invoke()`.
   */
  public async pulse(_grammar: string): Promise<void> { }

  /**
   * Direct invocation — called by the command line (or any caller)
   * when the user types `/behaviour args`.
   */
  public async invoke(args: string): Promise<void> {
    if (this._state === BeeState.Disposed) return
    await this.execute(args)
    if (this._state === BeeState.Created || this._state === BeeState.Registered) {
      this._state = BeeState.Active
    }
  }

  /**
   * Check if this queen bee matches a given behaviour string.
   * Checks canonical `command` first, then `aliases`.
   */
  public matches(input: string): boolean {
    const lower = input.toLowerCase()
    if (this.command.toLowerCase() === lower) return true
    return this.aliases.some(a => a.toLowerCase() === lower)
  }
}
