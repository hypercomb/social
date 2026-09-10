// assistant/bridge-ops.ts
//
// THE VERB SETS THE BRIDGE IS SORTED BY — a leaf module, on purpose.
//
// Three readers need to agree about which bridge ops are which, and they
// cannot import each other: the worker (`claude-bridge.worker.ts`) decides
// which ops open a quiet-landing window and which are not steps of a run at
// all; the route (`chat-route.ts`) decides which recorded steps are drawn as
// work along a conversation. The worker is a bee with module-scope side
// effects (it dials a WebSocket the moment it loads), so nothing that wants
// only its verb sets may import it — that drags a live socket into every
// spec that touches the route. And the route sits inside the import cycle
// chat-thread → chat-route → chat-steps → chat-thread, so a set exported
// from any of those three is read during module evaluation at the mercy of
// whichever file happened to load first.
//
// So the sets live here, with ZERO imports, and both sides read from this
// file. Change a set here and every reader changes together; there is no
// second copy to drift.

/** Ops that WRITE. Each opens a quiet-landing window in the worker so the
 *  participant's surface repaints once per burst rather than once per write
 *  (see the worker's QUIET LANDING comment). */
export const MUTATING_OPS: ReadonlySet<string> = new Set([
  'update', 'note-add', 'note-delete', 'note-split', 'put-resource',
  'optimization-add', 'optimization-remove', 'decoration-add',
  'bag-add', 'bag-remove', 'bag-set', 'build-record', 'stamp',
  'add', 'remove', 'summary-add', 'chat-reply', 'chat-goal-reached', 'submit',
])

/** NOT steps of the loop, even when a run is declared. Reading the log is
 *  how a responder REJOINS the loop rather than a move within it, and
 *  `agent-progress` is the announcement half of the pair — recording it
 *  would fill the ledger with the chatter the record exists to replace. */
export const STEP_SILENT_OPS: ReadonlySet<string> = new Set(['thread-read', 'agent-progress'])

/** Mutating ops the ROUTE does not draw as work. The reply is the row the
 *  run lands on, not a thing the run did to the hive; the goals receipt is
 *  bookkeeping; and every `optimization-remove` is a retire — of the ask, or
 *  of a context record beside it — which is the loop closing, not work the
 *  participant asked for. (The retire cannot be told apart from another
 *  removal by the reader: the ask sig is hashed into the run id, so the rule
 *  is the verb, not the target.) A step is a piece's attempt iff its verb is
 *  in `MUTATING_OPS` and NOT here. Reads are recorded and never drawn;
 *  `effect-emit` is a UI intent, not hive work, and is in neither set. */
export const ROUTE_HIDDEN_OPS: ReadonlySet<string> = new Set([
  'chat-reply', 'chat-goal-reached', 'optimization-remove',
])

/** Is this recorded verb drawn as work on a conversation's route? */
export const isRouteWork = (verb: string): boolean =>
  MUTATING_OPS.has(verb) && !ROUTE_HIDDEN_OPS.has(verb)
