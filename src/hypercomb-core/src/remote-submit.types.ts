// hypercomb-core/src/remote-submit.types.ts
//
// THE REMOTE-SUBMIT CONTRACT — how a machine says a line to the command line,
// and what it is told back.
//
// The command line is a shell component (hypercomb-shared/ui/command-line) but
// the protocol lives in core, for the same reason the icon-pick contract does:
// a drone module may not import from shared, and the Claude bridge worker —
// which is the caller that needed this — lives in essentials.
//
// WHY IT EXISTS. `#submit` used to emit and return `{ok:true}` on the next
// line. Measured over the live bridge 2026-09-04: `ok` meant "the effect was
// emitted", never "the command ran", and it was wrong twice in six calls —
// bare prose did nothing, `/remove` did nothing, both answered ok. An agent
// cannot tell success from silence, so it cannot correct itself, and it will
// report a success to a participant for a sentence that did nothing.
//
// WHAT AN OUTCOME MAY CLAIM. Every behaviour executor in the tree is
// `Promise<void> | void`, so DID-NOT-THROW is the only success signal that
// exists. A receipt therefore says a line was dispatched and did not throw —
// never that the hive changed. Overclaiming here would be the original defect
// with better wording.
//
// UNKNOWN IS NOT FAILURE, AND NOT SUCCESS. Only the Common Tongue path can
// report per-action outcomes: `#executeReading` awaits each action and knows
// its name. The legacy tag/slash pipeline resolves through fire-and-forget
// branches, so awaiting it proves delivery, not completion — it answers
// `unknown` rather than minting a fake `ran`. This is the same law the pool
// reader is owed (documentation/hypercomb-communication-layer.md): refuse to
// mint an answer from anything but a positive, complete one.
//
// ALWAYS SETTLE. A request that is never completed hangs the caller, and a
// hang is worse than a lie because it is invisible. Every early return in a
// listener must settle, exactly once — hence `complete` is called through a
// settle-once guard on the listener side, and callers still apply a deadline.
//
// SHAPE: callbacks in the payload, not id correlation. This copies
// `command:create-cells` (hypercomb-essentials/src/commands/create.queen.ts)
// rather than the token-correlated icon-pick contract, because it needs no
// correlation at all: EffectBus dispatches synchronously, so an emitter knows
// whether a listener existed the moment `emitTransient` returns. Correlation
// tokens exist to survive a supersede; a submit has nothing to supersede.
//
// DO NOT use `EffectBus.once` to await one of these. `once` unsubscribes
// BEFORE the handler inspects the payload, so a listener that filters would
// consume its own subscription on a non-match and wait forever.
//
// EMIT IT TRANSIENTLY. `emit` stores a last value that replays to late
// subscribers; a replayed submit would re-run the previous line on any
// re-subscribe.

export const REMOTE_SUBMIT = 'command-line:remote-submit'

/** One action the Common Tongue reader matched, and how dispatching it went.
 *  `ok` is DID-NOT-THROW — never proof the hive changed. */
export type RemoteSubmitAction = {
  readonly command: string
  readonly args: string
  readonly ok: boolean
  /** Present only when the action threw. */
  readonly error?: string
}

/** What the command line can honestly say about a remote line.
 *
 *  `ran`       the reader matched; each action was dispatched in word order
 *  `ambiguous` a word more than one behaviour claims — NOTHING ran, and the
 *              claimants are named so a caller can choose and say it again
 *  `refused`   understood and declined (a destructive verb needs a person)
 *  `unknown`   the line left the Tongue for the legacy pipeline, whose
 *              completion is not observable — it may have done anything
 */
export type RemoteSubmitOutcome =
  | { readonly kind: 'ran'; readonly actions: readonly RemoteSubmitAction[] }
  | { readonly kind: 'ambiguous'; readonly word: string; readonly candidates: readonly string[] }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly reason: string }

export type RemoteSubmitRequest = {
  readonly text: string
  /** Called synchronously by the listener so an emitter can tell, the moment
   *  `emitTransient` returns, whether a command line was there at all. */
  readonly accept?: () => void
  /** Settled exactly once. Optional: older emitters send neither callback and
   *  keep working unchanged. */
  readonly complete?: (outcome: RemoteSubmitOutcome) => void
}

/** The behaviour a CANONICAL SLASH line names, or `''` when the line is not
 *  canonical slash grammar.
 *
 *  This exists because a guard that read only prose let `/remove drafts` walk
 *  past it. A machine emits canonical slash — the model channel's parser
 *  accepts nothing else — so any rule about WHICH VERB a remote line says has
 *  to read both forms or it reads the wrong half of its traffic. Kept here,
 *  beside the outcome it feeds, so the parser and the listener cannot drift.
 *
 *  Deliberately narrow: it identifies the head verb only, never arguments, and
 *  matches the same shape the model channel's `parseLine` admits. */
export const canonicalVerbOf = (text: string): string =>
  text.trimStart().match(/^\/([a-z][a-z0-9-]*)/)?.[1] ?? ''

/** One line for a person or a log. Never claims more than the outcome does. */
export const formatRemoteSubmitOutcome = (outcome: RemoteSubmitOutcome): string => {
  switch (outcome.kind) {
    case 'ran': {
      const ran = outcome.actions.filter(a => a.ok).map(a => `/${a.command}`)
      const failed = outcome.actions.filter(a => !a.ok)
      const head = ran.length ? `ran ${ran.join(' ')}` : 'ran nothing'
      return failed.length
        ? `${head}; ${failed.map(a => `/${a.command} threw: ${a.error ?? 'unknown error'}`).join('; ')}`
        : head
    }
    case 'ambiguous':
      return `"${outcome.word}" is claimed by ${outcome.candidates.join(', ')} — nothing ran; say which`
    case 'refused':
      return `refused: ${outcome.reason}`
    case 'unknown':
      return `unknown: ${outcome.reason}`
  }
}
