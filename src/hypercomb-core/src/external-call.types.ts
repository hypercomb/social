// hypercomb-core/src/external-call.types.ts
//
// THE EXTERNAL-CALL CONTRACT — how lines from outside the participant's own
// hands (an agent, a script, another machine) reach the hive, wait for the
// participant, and are answered.
//
// The participant's own typing never comes this way and never changes. A
// line from outside is MARKED AS EXTERNAL BEFORE IT RUNS: the command line
// shows it in its fourth stance, `$`, with who sent it, and nothing runs until
// the participant presses Enter. Escape declines it. Either way the exchange
// is written into a new conversation on the layer the participant stands in,
// and on Enter that conversation opens and the run is shown there.
//
// When it runs, every line goes through the machine door (`REMOTE_SUBMIT`),
// so each word is judged against the participant's grants exactly as any
// machine's is, and the caller hears the hive's own verdict for each line.
//
// Three effects, because three parties: the caller, the module that owns the
// queue and the record (essentials `external-call.drone.ts`), and the command
// line that shows the ask and takes the answer. The protocol lives in core so
// the shell and the module can both speak it without importing each other.

/** A batch from outside, asking to be said. Emit it TRANSIENTLY: a replayed
 *  call would ask again for something already answered. */
export const EXTERNAL_CALL = 'external:call'

/** The ask in front of the participant, or null when nothing waits. Emitted
 *  with the last-value replay on purpose, so a command line that mounts late
 *  still shows what is waiting. */
export const EXTERNAL_ASK = 'command-line:external-ask'

/** The participant's answer to the ask with this id. Emit it transiently. */
export const EXTERNAL_ANSWER = 'command-line:external-answer'

export type ExternalCallRequest = {
  /** Who is asking, as the caller names itself: shown before anything runs. */
  readonly from: string
  /** The lines, exactly as they would be said. */
  readonly lines: readonly string[]
  /** Called synchronously when the call is taken into the queue, so a
   *  caller can tell at once whether anything in this hive takes calls. */
  readonly accept?: () => void
  /** Settled exactly once, when the participant has answered and, on Enter,
   *  every line has been said. Optional: a caller may not wait. */
  readonly complete?: (outcome: ExternalCallOutcome) => void
}

export type ExternalAsk = {
  readonly id: string
  readonly from: string
  readonly lines: readonly string[]
  /** How many more are queued behind this one. */
  readonly waiting: number
}

export type ExternalAnswer = {
  readonly id: string
  readonly decision: 'run' | 'decline'
}

/** One line, and the hive's verdict on it, in the remote door's own words
 *  (`formatRemoteSubmitOutcome`): ran, refused, ambiguous, or unknown. */
export type ExternalLineResult = {
  readonly text: string
  readonly verdict: string
  /** What the hive said while the line ran (activity lines and toasts), as a
   *  participant reads it. A tile withheld from outside models is masked.
   *  Absent when the line said nothing. */
  readonly heard?: readonly string[]
}

export type ExternalCallOutcome =
  | { readonly kind: 'ran'; readonly convoId: string; readonly results: readonly ExternalLineResult[] }
  | { readonly kind: 'declined'; readonly convoId: string }
  | { readonly kind: 'refused'; readonly reason: string }
