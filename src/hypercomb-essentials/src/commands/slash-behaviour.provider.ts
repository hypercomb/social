// ui/slash-behaviour/slash-behaviour.provider.ts

import type { MachineGrammar } from '@hypercomb/core'

export interface SlashBehaviour {
  readonly name: string
  readonly description: string
  readonly descriptionKey?: string
  readonly aliases?: readonly string[]
  /**
   * PROTOTYPE STAGE — still in the workshop. Registered and invokable,
   * but concealed from the palette until the participant opens the
   * `/prototypes` filter; then it lists at the bottom, dimmed, wearing
   * the stage chip. The drone presents a concealed prototype as
   * `hidden`, so every downstream surface (utterance census, reference
   * sheets, action cards) inherits the concealment from one seam.
   */
  readonly prototype?: boolean
  /**
   * When true, this behaviour is invokable but does not appear in
   * autocomplete suggestions. Use for destructive / dev-only commands
   * the user must type in full (e.g. /flatten, /collapse-history).
   */
  readonly hidden?: boolean
  /**
   * LISTED BECAUSE OF THIS MACHINE — a word that exists only because of what
   * is installed or announced here (an agent-bridge CLI's model names), not
   * because of the build. It works here and is shown here, but it is not part
   * of the language the build ships, so the how-to site makes no page for it.
   */
  readonly local?: boolean
  /**
   * LINE START ONLY (jwize, 2026-10-16: "I don't see save as" / "I don't see
   * use either"). Listed in autocomplete like any word, but never lit from
   * prose — it runs only as the first word of a line. For a word that is also
   * a sub-word of another behaviour (`save` in `layout save`, `use` in
   * `harness use`): the command line runs every behaviour word on a line, so
   * without this the sub-word would run as its own action.
   */
  readonly lineStart?: boolean
  /**
   * STRUCTURED USAGE DOCS — supplied by the author at creation (QueenBee's
   * `options` / `examples` flow straight through the auto-wrap). Reference
   * surfaces read these fields; they never parse the description string.
   * Options are accepted values or forms ('on', 'off', '<color>').
   */
  readonly options?: readonly string[]
  /** Worked examples: what to type and what happens. */
  readonly examples?: readonly { readonly input: string; readonly result: string }[]
  /**
   * MACHINE REACH — present when a model speaking only the communication
   * layer may say this behaviour. Absent is the default and means no model
   * can call it. Queens declare it on themselves (`QueenBee.machine`) and the
   * auto-wrap carries it here, so the census a model reads and the census a
   * participant reads are the same census.
   */
  readonly machine?: MachineGrammar
}

export interface SlashBehaviourMatch {
  readonly behaviour: SlashBehaviour
  readonly provider: SlashBehaviourProvider
}

export interface SlashBehaviourProvider {
  readonly name: string
  readonly priority: number
  readonly behaviours: readonly SlashBehaviour[]
  execute(behaviourName: string, args: string): Promise<void> | void
  complete?(behaviourName: string, args: string): readonly string[]
}
