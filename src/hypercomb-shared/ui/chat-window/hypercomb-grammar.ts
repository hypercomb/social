// hypercomb-grammar.ts
//
// THE MODEL SPEAKS HYPERCOMB. What a model asks to change is an ordered
// sequence of native slash-beehavior grammars. The transport is the work
// fence (hypercomb-work-fence.ts, documentation/hive-read-fence.md) — plain
// text any model can write. The vendor function-calling envelope that carried
// the same lines once was shed exactly as it was built to be: the language
// and the executor underneath it did not change.
//
// THE VOCABULARY IS THE CENSUS, NOT A TABLE HERE. This file used to hold
// `CALLABLE_FORMS` — five behaviour names and their argument shapes, written
// by hand, in the shell, beside the parser. It was wrong the way a second copy
// of a list is always wrong: it drifted toward less than exists. A participant
// asked a local model to delete a tile and was told, correctly and uselessly,
// that Hypercomb has no delete behaviour — because `/remove` was not one of the
// five, though it has shipped for months and any participant can type it.
//
// So authority moved TO each behaviour (`QueenBee.machine`, contract in core's
// `MachineGrammar`) and this file derives from the live census. It knows how to
// read a declaration; it knows no behaviour names. Default-deny is unchanged —
// no declaration, no call — but the decision now belongs to the author who
// wrote the argument parser, not to a distant list that knew only a name.
//
// AND THE DECISION IS NO LONGER MADE HERE EITHER. Default-deny was this door's
// private virtue: three other surfaces turn language into execution and none of
// them had it, so a grant bolted on here would have tightened the tightest door
// and left the rest open. The rule moved to core's `machine-admission`, which
// every machine door now consults — this one saying `'model'`, the bridge
// saying `'operator'`. What this file kept is what only it knows: the
// canonical-line parser, the plan's reach, and the executor's lane.
//
// ONE CONSEQUENCE WORTH STATING. The catalogue and the admission gate read the
// same function, so a verb the grant refuses is never TAUGHT. A model is not
// offered `/remove` and then told no; under the default ceiling it simply does
// not appear in the vocabulary, which is the difference between a boundary and
// a trap.

import {
  admitMachineCall, callableBehaviours, currentMachineGrant, machineCatalogue, primaryEntry,
  type MachineGrant, type MachineReach, type MachineScope,
} from '@hypercomb/core'

// THE CATALOGUE MOVED DOWN TO CORE. It is not shell knowledge: the bridge tier
// has to teach the same vocabulary to a CLI that cannot see this file, and a
// second renderer is how `CALLABLE_FORMS` went wrong. Re-exported here because
// this module is still the door the chat window knocks on.
export { callableBehaviours }

/** Who may read the hive without asking this turn. The participant's own
 *  local model may, when it is the one answering. A keyed provider may only if the participant GRANTED it
 *  in the console (documentation/anatomy-context-need.md §4) — and naming a
 *  model in the chat never grants: naming picks who answers, the grant
 *  decides what they may see. With no model named, it follows the provider
 *  the mediator would designate anyway, if that one is granted.
 *
 *  LOCAL ONLY WHEN IT IS THE CHOICE (Jaime, 2026-09-13: "I don't really like
 *  Qwen, the local one"). A running local model used to take EVERY message
 *  that could read or act, ahead of the mediator — so the OpenRouter models
 *  the participant added were never asked. Now it answers only when named,
 *  or when the mediator itself designates it (a pin, the economy plan, or
 *  nothing else ready). */
export const hypercombActionProviderId = (
  canAct: boolean,
  namedModel: string | undefined,
  namedProvider: string | undefined,
  localReadyAndTrusted: boolean,
  hiveAccess: { readonly granted?: readonly string[]; readonly designated?: string } = {},
): string | undefined => {
  if (!canAct) return undefined
  const granted = new Set((hiveAccess.granted ?? []).map(id => id.toLowerCase()))
  if (namedModel) {
    if (namedProvider === 'local') return localReadyAndTrusted ? 'local' : undefined
    return namedProvider && granted.has(namedProvider.toLowerCase()) ? namedProvider : undefined
  }
  const designated = hiveAccess.designated?.toLowerCase()
  if (designated === 'local') return localReadyAndTrusted ? 'local' : undefined
  return designated && granted.has(designated) ? designated : undefined
}

/** Relative grammar is safe only while its page/selection context is stable. */
export const hypercombContextKey = (
  page: readonly string[],
  selected: readonly string[],
): string => JSON.stringify([
  page.map(String).filter(Boolean),
  selected.map(String).filter(Boolean).sort(),
])

const MAX_GRAMMARS = 12
const MAX_GRAMMAR_LENGTH = 1_000
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
/**
 * What a behaviour tells a machine about itself — structurally core's
 * `MachineGrammar`, restated here so this module's own shape checks stay
 * readable beside the parser that needs them.
 */
export type HypercombMachineGrammar = {
  /** Argument shape, in the notation `options` uses. Empty when there is none. */
  readonly forms: string
  /** One complete canonical line. */
  readonly example: string
  /** True when a bare verb, with no argument, is a real call. */
  readonly bare?: boolean
  /** How MUCH a call changes. Weighed by the admission gate, not by this file. */
  readonly reach?: MachineReach
  /** How FAR the change travels. Weighed by the admission gate, not here. */
  readonly scope?: MachineScope
  /** One clause the catalogue appends verbatim: what really happens. */
  readonly consequence?: string
  /** The behaviour's own argument rule: a reason to refuse, or undefined. */
  readonly refuse?: (args: string) => string | undefined
}

export type HypercombBehaviour = {
  readonly name: string
  readonly description?: string
  readonly aliases?: readonly string[]
  readonly hidden?: boolean
  readonly prototype?: boolean
  readonly options?: readonly string[]
  readonly examples?: readonly { readonly input: string; readonly result: string }[]
  /** Present exactly when this behaviour's author offered it to machines. */
  readonly machine?: HypercombMachineGrammar
}

export type HypercombToolCall = {
  readonly id?: string
  /** Compact app shape, accepted for tests/alternate adapters. */
  readonly name?: string
  readonly arguments?: unknown
  /** Normalized OpenAI-compatible shape emitted by the provider router. */
  readonly type?: 'function'
  readonly function?: {
    readonly name: string
    readonly arguments: unknown
  }
}

export type HypercombFunctionTool = {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: Record<string, unknown>
    readonly strict?: boolean
  }
}

export type HypercombAction = {
  readonly grammar: string
  readonly command: string
  readonly args: string
}

export type HypercombActionPlan = {
  readonly actions: readonly HypercombAction[]
}

export type HypercombActionReceipt = {
  readonly grammars: readonly string[]
  readonly executed: number
}

export type HypercombBehaviourExecutor = {
  execute(command: string, args: string): Promise<void> | void
}

/** One app-wide lane prevents two conversations from interleaving grammars. */
export class HypercombPlanQueue {
  #tail: Promise<void> = Promise.resolve()

  async run(
    plan: HypercombActionPlan,
    executor: HypercombBehaviourExecutor,
    signal?: AbortSignal,
  ): Promise<HypercombActionReceipt> {
    const operation = this.#tail
      .catch(() => { /* a failed plan never poisons the lane */ })
      .then(() => executeHypercombPlan(plan, executor, signal))
    // Keep the private lane tied to the real native operation. The caller may
    // stop waiting immediately, but a Queen that cannot be cancelled must
    // settle before another model plan is allowed to begin.
    this.#tail = operation.then(() => undefined, () => undefined)
    return abortablePlanResult(operation, signal)
  }
}

const stopped = (): DOMException =>
  new DOMException('The Hypercomb action was stopped', 'AbortError')

const abortablePlanResult = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  if (!signal) return operation
  if (signal.aborted) throw stopped()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(stopped())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class HypercombGrammarError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HypercombGrammarError'
  }
}

export class HypercombActionExecutionError extends Error {
  constructor(
    message: string,
    readonly completed: readonly string[],
    readonly grammar: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'HypercombActionExecutionError'
  }
}

/**
 * The live public census, narrowed to what a model may say in this hive right
 * now: a usable declaration, admitted by the one gate every machine door
 * consults.
 *
 * TWO CHECKS, AND THEY BELONG IN DIFFERENT PLACES. Whether a declaration is
 * USABLE is this file's business — the parser needs `forms` and `example` to be
 * strings, and a malformed block is a bug in the behaviour, not a refusal to
 * report to anyone. Whether a behaviour may be SAID is nobody's business here;
 * that is `admitMachineCall`, which also answers the bridge, so the two doors
 * cannot drift apart again.
 *
 * The grant is read live rather than captured, so tightening it takes effect on
 * the next turn without a reload. Tests pass one explicitly.
 */
/**
 * WHY A LINE WAS NOT ACCEPTED, in the gate's own words rather than a flat
 * "not available". A model that is told `/remove is destructive, and this hive
 * grants a machine no further than editing` can choose a gentler verb; one told
 * only that a word is unavailable will try a synonym, and there are none.
 */
const refusalFor = (
  verb: string,
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant,
): string => {
  const verdict = admitMachineCall(verb, primaryEntry(verb, entries), 'model', grant)
  // Admitted but absent from the callable set means the declaration itself is
  // unusable — a malformed `machine` block, which is a defect rather than a
  // boundary, and must not be described to a model as one.
  return verdict.admit ? `/${verb} is not available for model actions` : verdict.reason
}

const catalogue = machineCatalogue

/** The live vocabulary a model may change the hive with — the census
 *  catalogue, grant-filtered, for the work fence's lesson. */
export const hypercombVocabulary = (
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): string => catalogue(entries, grant)

/** How far a validated plan reaches: its farthest line. A behaviour that
 *  never said is read as editing — never quieter than it might be. */
export const hypercombPlanReach = (
  plan: HypercombActionPlan,
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): MachineReach => {
  const order: readonly MachineReach[] = ['additive', 'editing', 'destructive']
  const reachOf = new Map(callableBehaviours(entries, grant).map(entry => [entry.name, entry.machine?.reach ?? 'editing'] as const))
  return plan.actions.reduce<MachineReach>((far, action) => {
    const reach = reachOf.get(action.command) ?? 'editing'
    return order.indexOf(reach) > order.indexOf(far) ? reach : far
  }, 'additive')
}

const parseLine = (
  raw: unknown,
  allowed: ReadonlyMap<string, HypercombMachineGrammar>,
  index: number,
  refused: (verb: string) => string,
): HypercombAction => {
  if (typeof raw !== 'string') {
    throw new HypercombGrammarError(`grammar ${index + 1} must be a string`)
  }
  if (raw.length > MAX_GRAMMAR_LENGTH) {
    throw new HypercombGrammarError(`grammar ${index + 1} is longer than ${MAX_GRAMMAR_LENGTH} characters`)
  }
  if (CONTROL_CHARACTER.test(raw)) {
    throw new HypercombGrammarError(`grammar ${index + 1} must be exactly one printable line`)
  }
  const grammar = raw.trim()
  if (!grammar) throw new HypercombGrammarError(`grammar ${index + 1} is empty`)

  // V1 intentionally admits canonical slash grammar only. Broader command-line
  // forms are stateful UI input, not yet a stance-independent machine seam.
  const match = grammar.match(/^\/([a-z][a-z0-9-]*)(?:\s+(.+))?$/)
  if (!match) {
    throw new HypercombGrammarError(`grammar ${index + 1} is not canonical slash-behavior grammar`)
  }
  const command = match[1]
  const args = (match[2] ?? '').trim()
  const machine = allowed.get(command)
  if (!machine) throw new HypercombGrammarError(refused(command))
  // An argument is required unless the behaviour said a bare verb means
  // something entire on its own. A model that guesses a target is worse than
  // a model that is refused.
  if (!args && machine.bare !== true) {
    throw new HypercombGrammarError(`/${command} needs an explicit argument`)
  }
  // The behaviour's OWN rule, stated by the author who wrote its parser.
  // Native parsers normalize bad input into a no-op, and a clean no-op earns
  // the model a receipt claiming work that never happened; a receipt must
  // never lie, so a behaviour states here what it cannot act on.
  const refusal = machine.refuse?.(args)
  if (refusal) throw new HypercombGrammarError(refusal)
  return { grammar, command, args }
}

/**
 * The durable contract every transport speaks: an ordered sequence of raw
 * Hypercomb grammars. The entire sequence is validated before any executable
 * action is returned — no mutation occurs here, so one invalid tail cannot
 * leave a half-run prefix.
 */
export const parseHypercombGrammars = (
  grammars: readonly unknown[],
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): HypercombActionPlan => {
  if (grammars.length < 1 || grammars.length > MAX_GRAMMARS) {
    throw new HypercombGrammarError(`grammars must contain between 1 and ${MAX_GRAMMARS} lines`)
  }
  // ONE READING OF THE GRANT for the whole plan. Re-reading it per line would
  // let a ceiling that changed mid-parse admit a prefix and refuse a tail,
  // which is the half-run state this function exists to make impossible.
  const allowed = new Map(
    callableBehaviours(entries, grant).map(entry => [entry.name, entry.machine!] as const))
  const actions = grammars.map((line, index) =>
    parseLine(line, allowed, index, verb => refusalFor(verb, entries, grant)))
  return { actions }
}

/** Execute the already-validated native sequence, strictly one line at a time. */
export const executeHypercombPlan = async (
  plan: HypercombActionPlan,
  executor: HypercombBehaviourExecutor,
  signal?: AbortSignal,
): Promise<HypercombActionReceipt> => {
  const completed: string[] = []
  for (const action of plan.actions) {
    if (signal?.aborted) throw stopped()
    try {
      await executor.execute(action.command, action.args)
    } catch (cause) {
      throw new HypercombActionExecutionError(
        `Hypercomb stopped at ${action.grammar}`,
        completed,
        action.grammar,
        { cause },
      )
    }
    completed.push(action.grammar)
    if (signal?.aborted) throw stopped()
  }
  return { grammars: completed, executed: completed.length }
}
