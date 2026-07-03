import { Bee, BeeState } from './bee.base.js'

// -------------------------------------------------
// queen bee — real-time slash behaviour dispatch, no lifecycle
// -------------------------------------------------

/** One worked usage example a queen supplies for the reference surfaces. */
export interface QueenUsageExample {
  /** What the participant types, e.g. '/screensaver circle'. */
  readonly input: string
  /** What happens, e.g. 'Screensaver starts with the circle look'. */
  readonly result: string
}

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
   * STRUCTURED USAGE DOCS — the standard way a queen documents its own
   * parameters, supplied at authoring time next to `description`. Every
   * reference surface (the help page's study cards, the /help sheet, future
   * autocomplete detail panes) reads these fields directly; nothing is ever
   * parsed out of the description string. Entries are the accepted values
   * or forms — literals like 'on' / 'off', or placeholders like '<color>'.
   */
  public options?: readonly string[]

  /**
   * Worked examples for the reference surfaces — what to type and what
   * happens. One or two well-chosen examples beat an exhaustive list.
   */
  public examples?: readonly QueenUsageExample[]

  /**
   * Optional autocomplete hook. Returns the list of completions for the current
   * args string (everything typed after the command name). Implement on the queen
   * itself — the slash drone reads it live, so there is no mirror class to drift.
   */
  public slashComplete?(args: string): readonly string[]

  /**
   * When true, the slash drone still invokes this queen normally but
   * omits it from autocomplete suggestions. Use for destructive / dev-
   * only commands (e.g. /compact, /collapse-history) the user must
   * type in full so they can't be triggered by accidental tab-complete.
   */
  public slashHidden: boolean = false

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
