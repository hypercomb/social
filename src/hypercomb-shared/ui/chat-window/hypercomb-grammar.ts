// hypercomb-grammar.ts
//
// THE MODEL SPEAKS HYPERCOMB. Function calling is only the transport envelope:
// its one payload is an ordered sequence of native slash-beehavior grammars.
// The envelope is deliberately tiny so it can be shed later without changing
// the language or the executor underneath it.
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
// saying `'operator'`. What this file kept is what only it knows: the transport
// envelope, the canonical-line parser, and the catalogue's wording.
//
// ONE CONSEQUENCE WORTH STATING. The catalogue and the admission gate read the
// same function, so a verb the grant refuses is never TAUGHT. A model is not
// offered `/remove` and then told no; under the default ceiling it simply does
// not appear in the vocabulary, which is the difference between a boundary and
// a trap.

import {
  admitMachineCall, currentMachineGrant, primaryEntry,
  type MachineGrant, type MachineReach, type MachineScope,
} from '@hypercomb/core'

export const HYPERCOMB_GRAMMAR_TOOL_NAME = 'hypercomb_act'

/** Only the participant's own local provider may receive execution tools. */
export const hypercombActionProviderId = (
  canAct: boolean,
  namedModel: string | undefined,
  namedProvider: string | undefined,
  localReadyAndTrusted: boolean,
): 'local' | undefined =>
  canAct && localReadyAndTrusted && (!namedModel || namedProvider === 'local') ? 'local' : undefined

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
export const callableBehaviours = (
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): readonly HypercombBehaviour[] => {
  const seen = new Set<string>()
  const result: HypercombBehaviour[] = []
  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim().toLowerCase()
    if (!name || seen.has(name)) continue
    const machine = entry.machine
    if (!machine || typeof machine.forms !== 'string' || typeof machine.example !== 'string') continue
    if (!admitMachineCall(name, entry, 'model', grant).admit) continue
    seen.add(name)
    result.push({ ...entry, name })
  }
  return result
}

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

const catalogue = (
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant,
): string =>
  callableBehaviours(entries, grant).map(entry => {
    const machine = entry.machine!
    const forms = machine.forms.trim()
    // The consequence is QUOTED, never composed. This module knows how far a
    // verb reaches but not what reaching there does, and a fixed sentence per
    // reach value was how the catalogue came to promise a confirmation
    // `/remove` does not perform for a leaf tile. If a behaviour says nothing
    // here, the catalogue says nothing.
    const note = machine.consequence?.trim() ? ` ${machine.consequence.trim()}` : ''
    return `/${entry.name}${forms ? ` ${forms}` : ''} - ${entry.description ?? entry.name}.${note} Example: ${machine.example}`
  }).join('\n')

/** One transport tool; Hypercomb grammar remains the actual action language. */
export const hypercombGrammarTool = (
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): HypercombFunctionTool => ({
  type: 'function',
  function: {
    name: HYPERCOMB_GRAMMAR_TOOL_NAME,
    description: 'Apply an ordered sequence of validated, native Hypercomb slash-beehavior grammars to the current hive. This cannot run shell commands or edit computer files.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        grammars: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_GRAMMARS,
          description: `Complete grammar lines, run in order. Available forms:\n${catalogue(entries, grant)}`,
          items: { type: 'string', maxLength: MAX_GRAMMAR_LENGTH },
        },
      },
      required: ['grammars'],
    },
  },
})

/** Stable instructions plus a live census, so prompt and validation cannot drift. */
export const hypercombGrammarInstruction = (
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): string => `
Hypercomb's native action language is its slash-behavior grammar. If the participant asks only for information, answer normally in prose. If they ask you to change the current Hypercomb hive, call ${HYPERCOMB_GRAMMAR_TOOL_NAME} exactly once with one or more complete grammar lines in execution order. Do not print the tool payload as prose. Never invent behavior names. This capability changes only the current Hypercomb hive; it cannot use a shell, edit repository files, control the computer, or use a bridge.

Available machine-callable grammar:
${catalogue(entries, grant) || '(none currently available)'}
`.trim()

const parseArguments = (raw: unknown): Record<string, unknown> => {
  let value = raw
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw) }
    catch { throw new HypercombGrammarError('the action arguments are not valid JSON') }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HypercombGrammarError('the action arguments must be an object')
  }
  return value as Record<string, unknown>
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
 * Validate the entire sequence before returning any executable action. No
 * mutation occurs here, so one invalid tail cannot leave a half-run prefix.
 */
export const parseHypercombToolCalls = (
  calls: readonly HypercombToolCall[],
  entries: readonly HypercombBehaviour[],
  grant: MachineGrant = currentMachineGrant(),
): HypercombActionPlan => {
  const call = calls[0]
  const name = call?.function?.name ?? call?.name
  if (calls.length !== 1 || name !== HYPERCOMB_GRAMMAR_TOOL_NAME) {
    throw new HypercombGrammarError(`expected exactly one ${HYPERCOMB_GRAMMAR_TOOL_NAME} call`)
  }
  const input = parseArguments(call.function?.arguments ?? call.arguments)
  const keys = Object.keys(input)
  if (keys.length !== 1 || keys[0] !== 'grammars') {
    throw new HypercombGrammarError('the action accepts only the grammars property')
  }
  const grammars = input['grammars']
  if (!Array.isArray(grammars)) {
    throw new HypercombGrammarError('grammars must be an array')
  }
  if (grammars.length < 1 || grammars.length > MAX_GRAMMARS) {
    throw new HypercombGrammarError(`grammars must contain between 1 and ${MAX_GRAMMARS} lines`)
  }

  return parseHypercombGrammars(grammars, entries, grant)
}

/**
 * The durable contract beneath today's function-call scaffold: an ordered
 * sequence of raw Hypercomb grammars. Another transport can call this directly
 * without carrying forward any OpenAI-specific envelope.
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

export const formatHypercombReceipt = (receipt: HypercombActionReceipt): string => {
  const noun = receipt.executed === 1 ? 'grammar' : 'grammars'
  return `Ran ${receipt.executed} Hypercomb ${noun}:\n${receipt.grammars.map(line => `- ${line}`).join('\n')}`
}
