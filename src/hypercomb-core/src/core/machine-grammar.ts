// core/machine-grammar.ts
//
// THE BEHAVIOUR DECLARES ITS OWN MACHINE REACH.
//
// Hypercomb's native action language is its behaviour grammar. A model that
// cannot hold a bridge — a local Qwen, a visiting assistant, anything speaking
// only through the communication layer — has exactly one way to do anything
// here: say a grammar line. So the set of lines a machine may say IS the set
// of things such a model can do, and for a while that set was a five-entry
// table written by hand in the shell (`CALLABLE_FORMS`). A participant asked a
// local model to delete a tile and was told, correctly and uselessly, that
// Hypercomb has no delete behaviour — `/remove` had shipped for months. The
// table was the whole answer, and the table was not the census.
//
// A hand-kept allowlist of behaviour names in a shell file is the same mistake
// as a hand-kept list of pool meanings: it is a second place that must be
// remembered, and it drifts silently in the direction of "less than exists".
// So the allowlist is gone. A behaviour that wants to be machine-callable
// says so ON ITSELF, next to its description and its examples, and the model's
// vocabulary is DERIVED from the live census the way the participant's already
// is. Authoring a behaviour and offering it to a machine become one act.
//
// DEFAULT-DENY SURVIVES THE MOVE. A behaviour with no `machine` block is not
// callable by a model, and that is the majority. What changes is who decides:
// the author of the behaviour, who knows its argument language, rather than a
// distant table that knows only its name.

/**
 * How far a machine-called grammar reaches. This is honest labelling for the
 * participant's receipt, not an authorization tier — a declared behaviour is
 * callable at every reach.
 *
 * NOTE ON 'destructive'. Nothing in Hypercomb's committed half deletes: the
 * write primitive is `LayerCommitter.update`, whose own docstring says "add
 * and remove are special cases of 'the new children list is X'", and
 * `/remove` is exactly one such update. The reach value orders the verbs
 * honestly — `/remove` IS the far end of what a machine can say — but it must
 * not be read as "this erases something". What actually happens is the
 * behaviour's to state, in `consequence`.
 */
export type MachineReach =
  /** Mints or sets something that was not there. */
  | 'additive'
  /** Changes something that exists, in place. */
  | 'editing'
  /** Moves, hides, or takes something away. */
  | 'destructive'

/**
 * WHERE the change lands. `reach` says how MUCH a verb changes; `scope` says how
 * FAR the change travels. Neither can be inferred from the other, and a gate
 * that reads only one is gated on the wrong thing.
 *
 * The audit that added this axis (documentation/natural-language-surface-audit.md)
 * found the two axes crossing in both directions:
 *
 *   `/keyword <cell> = <tag>` is EDITING at the tile — one slot on its own
 *   layer, undoable through history — and ADDITIVE at the hive in the same
 *   call, minting a row in a registry document that no undo unwrites.
 *
 *   `/hide` was declared 'editing' on its author's stated premise that
 *   "nothing is published, and no peer sees a change". It emits a SIGNED MESH
 *   EVENT under the participant's own pubkey. The value was honest about the
 *   intent and wrong about the code.
 *
 * ORDERED OUTWARD, and DECLARED AS A CEILING. A verb that touches two rings
 * declares the wider one, because a gate must bound the worst case rather than
 * describe the common one. `/keyword` is therefore 'hive', not 'tile'.
 *
 * REVERSIBILITY IS NOT ON EITHER AXIS, and does not track them. `/remove` is
 * 'destructive' and fully undoable; `/keyword`'s registry write is 'editing' at
 * the tile and lands in no layer and no bag, so no undo unwrites it. If a grant
 * ever wants "only what I can take back", that is a third thing to declare.
 */
export type MachineScope =
  /** This browser only — a lens or a preference. Nothing enters the hive. */
  | 'local'
  /** The named tile's own slots: its decorations, properties, title. */
  | 'tile'
  /** Which tiles a parent holds — the page's membership changes. */
  | 'page'
  /** A hive-wide document no single tile owns: a registry, a pool, an index. */
  | 'hive'
  /** Leaves the machine: a signed publish, a peer, a host. */
  | 'network'

/**
 * A behaviour's machine-facing declaration — what a model may say to it, and
 * what it refuses. Held beside `description` / `options` / `examples` so the
 * one authoring surface answers every reader: participant, reference sheet,
 * and model.
 */
export interface MachineGrammar {
  /**
   * The argument shape offered to a model, in the same notation `options`
   * uses: `'<tile> | [<tile>, <tile>, ...]'`. This is the argument only —
   * the behaviour's own name is prepended by the census.
   */
  readonly forms: string

  /** One complete, canonical line: `'/remove drafts'`. */
  readonly example: string

  /**
   * True when a bare verb is a real call. Most behaviours need an explicit
   * argument — a model that guesses a target is worse than a model that is
   * refused — but some (`/undo`, `/tree`) mean something entire on their own.
   */
  readonly bare?: boolean

  /** How MUCH a call changes. Defaults to `'editing'` when unstated. */
  readonly reach?: MachineReach

  /**
   * How FAR the change travels — see {@link MachineScope}. Declared as a
   * CEILING: a verb touching two rings states the wider one, because a gate
   * must bound the worst case, not describe the common one.
   *
   * Unstated defaults to `'hive'` in meaning, but a gate should treat a MISSING
   * scope as unknown rather than as `'hive'`: the twelve values that exist were
   * each traced to their commit, and a thirteenth that declares none has not
   * been. Refusing what has not been judged is the safe direction.
   */
  readonly scope?: MachineScope

  /**
   * ONE CLAUSE THE CATALOGUE APPENDS, in the behaviour's own words: what
   * really happens, and what it costs to undo.
   *
   * This field exists because the shell got it wrong. The catalogue used to
   * print a fixed sentence for every destructive verb — "removes; asks the
   * participant to confirm" — and both halves were false for `/remove`:
   * nothing is removed from disk, and `confirmRemoval` returns true with no
   * dialog whenever nothing is nested beneath the target. A model read that
   * line and relayed a confirmation that never happened.
   *
   * A distant module cannot know whether a behaviour confirms, so it must not
   * claim one. Only the behaviour knows. Same reason `refuse` lives here.
   */
  readonly consequence?: string

  /**
   * The behaviour's OWN argument rule, run before anything executes. Return a
   * reason to refuse; return `undefined` to admit.
   *
   * This exists because native parsers are forgiving: they normalize bad input
   * into a no-op, and a no-op that returns cleanly earns the model a receipt
   * claiming work that never happened. A receipt must never lie, so the
   * behaviour states here what it genuinely cannot do with.
   */
  readonly refuse?: (args: string) => string | undefined
}

/** Anything carrying a machine declaration — a queen, or a raw behaviour. */
export interface MachineCallable {
  readonly machine?: MachineGrammar
}
