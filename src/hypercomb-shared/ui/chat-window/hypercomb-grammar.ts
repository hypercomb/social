// hypercomb-grammar.ts
//
// THE MODEL SPEAKS HYPERCOMB. Function calling is only the transport envelope:
// its one payload is an ordered sequence of native slash-beehavior grammars.
// The envelope is deliberately tiny so it can be shed later without changing
// the language or the executor underneath it.

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
const ACCENT_PRESETS = new Set(['glacier', 'bloom', 'aurora', 'ember', 'nebula'])
const HEX_COLOUR = /^#[0-9a-f]{3}(?:[0-9a-f]{1}|[0-9a-f]{3}|[0-9a-f]{5})?$/i

/**
 * Machine authority is default-deny. These are bounded hive edits whose
 * arguments are validated below; discovery flags such as `hidden` are not an
 * authorization boundary and are checked independently.
 */
/** Forms are an authorization surface, not a second command reference. */
const CALLABLE_FORMS: Readonly<Record<string, { forms: string; example: string }>> = {
  create: { forms: '<name> | <parent>/<child>', example: '/create roadmap' },
  keyword: { forms: '<tag> | <tag>(#hexcolor) | [<tag>, <tag>, ...]', example: '/keyword urgent' },
  accent: { forms: '<preset> | <tag> <preset> | [<tag>, <tag>] <preset>', example: '/accent ember' },
  postit: { forms: 'here <text>', example: '/postit here First draft' },
  title: { forms: '<text> | <cell> = <text>', example: '/title roadmap = Road map' },
}

export type HypercombBehaviour = {
  readonly name: string
  readonly description?: string
  readonly aliases?: readonly string[]
  readonly hidden?: boolean
  readonly prototype?: boolean
  readonly options?: readonly string[]
  readonly examples?: readonly { readonly input: string; readonly result: string }[]
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

/** The live public census intersected with the explicit machine policy. */
export const callableBehaviours = (
  entries: readonly HypercombBehaviour[],
): readonly HypercombBehaviour[] => {
  const seen = new Set<string>()
  const result: HypercombBehaviour[] = []
  for (const entry of entries) {
    const name = String(entry?.name ?? '').trim().toLowerCase()
    if (!name || seen.has(name) || !Object.hasOwn(CALLABLE_FORMS, name)) continue
    if (entry.hidden === true || entry.prototype === true) continue
    seen.add(name)
    result.push({ ...entry, name })
  }
  return result
}

const catalogue = (entries: readonly HypercombBehaviour[]): string =>
  callableBehaviours(entries).map(entry => {
    const policy = CALLABLE_FORMS[entry.name]
    return `/${entry.name} ${policy.forms} - ${entry.description ?? entry.name}. Example: ${policy.example}`
  }).join('\n')

/** One transport tool; Hypercomb grammar remains the actual action language. */
export const hypercombGrammarTool = (
  entries: readonly HypercombBehaviour[],
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
          description: `Complete grammar lines, run in order. Available forms:\n${catalogue(entries)}`,
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
): string => `
Hypercomb's native action language is its slash-behavior grammar. If the participant asks only for information, answer normally in prose. If they ask you to change the current Hypercomb hive, call ${HYPERCOMB_GRAMMAR_TOOL_NAME} exactly once with one or more complete grammar lines in execution order. Do not print the tool payload as prose. Never invent behavior names. This capability changes only the current Hypercomb hive; it cannot use a shell, edit repository files, control the computer, or use a bridge.

Available machine-callable grammar:
${catalogue(entries) || '(none currently available)'}
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

const validKeywordItem = (raw: string): boolean => {
  const match = raw.trim().match(/^([^()[\],~]+?)(?:\(([^)]+)\))?$/)
  return !!match?.[1].trim() && (match[2] === undefined || HEX_COLOUR.test(match[2].trim()))
}

const validateCommandArgs = (command: string, args: string): void => {
  if (command === 'create') {
    const parts = args.split('/').map(part => part.trim())
    if (args.includes('\\') || parts.some(part => !part || part === '.' || part === '..')) {
      throw new HypercombGrammarError('/create needs one or more explicit tile names separated by /')
    }
    return
  }

  if (command === 'keyword') {
    if (args.includes('~')) {
      throw new HypercombGrammarError('/keyword model actions cannot remove tags')
    }
    const bracket = args.match(/^\[(.*)\]$/)
    const items = bracket ? bracket[1].split(',') : [args]
    if (!items.length || items.some(item => !validKeywordItem(item))) {
      throw new HypercombGrammarError('/keyword needs additive tags, optionally with a hexadecimal colour')
    }
    return
  }

  if (command === 'accent') {
    if (args.includes('~')) {
      throw new HypercombGrammarError('/accent model actions cannot remove tag accents')
    }
    const normalized = args.toLowerCase()
    const bracket = normalized.match(/^\[([^\]]+)\]\s+(\S+)$/)
    if (bracket) {
      const tags = bracket[1].split(',').map(tag => tag.trim()).filter(Boolean)
      if (tags.length && ACCENT_PRESETS.has(bracket[2])) return
    } else {
      const parts = normalized.split(/\s+/)
      if ((parts.length === 1 && ACCENT_PRESETS.has(parts[0]))
        || (parts.length === 2 && !!parts[0] && ACCENT_PRESETS.has(parts[1]))) return
    }
    throw new HypercombGrammarError('/accent needs a known preset: glacier, bloom, aurora, ember, or nebula')
  }

  if (command === 'postit') {
    if (!/^here\s+\S/i.test(args)) {
      throw new HypercombGrammarError('/postit model actions must use: /postit here <text>')
    }
    return
  }

  if (command === 'title') {
    const equals = args.indexOf('=')
    if (equals === -1) return
    const target = args.slice(0, equals).trim()
    const title = args.slice(equals + 1).trim()
    if (!target || target.includes('/') || target.includes('\\')) {
      throw new HypercombGrammarError('/title needs one child tile name before =')
    }
    if (!title) throw new HypercombGrammarError('/title model actions cannot clear titles')
  }
}

const parseLine = (
  raw: unknown,
  allowed: ReadonlySet<string>,
  index: number,
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
  if (!allowed.has(command)) {
    throw new HypercombGrammarError(`/${command} is not available for model actions`)
  }
  if (!args) throw new HypercombGrammarError(`/${command} needs an explicit argument`)
  // Validate the exact additive/editing sub-language each Queen can perform;
  // native parsers that normalize bad input into a no-op must not earn a
  // misleading model receipt.
  validateCommandArgs(command, args)
  return { grammar, command, args }
}

/**
 * Validate the entire sequence before returning any executable action. No
 * mutation occurs here, so one invalid tail cannot leave a half-run prefix.
 */
export const parseHypercombToolCalls = (
  calls: readonly HypercombToolCall[],
  entries: readonly HypercombBehaviour[],
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

  return parseHypercombGrammars(grammars, entries)
}

/**
 * The durable contract beneath today's function-call scaffold: an ordered
 * sequence of raw Hypercomb grammars. Another transport can call this directly
 * without carrying forward any OpenAI-specific envelope.
 */
export const parseHypercombGrammars = (
  grammars: readonly unknown[],
  entries: readonly HypercombBehaviour[],
): HypercombActionPlan => {
  if (grammars.length < 1 || grammars.length > MAX_GRAMMARS) {
    throw new HypercombGrammarError(`grammars must contain between 1 and ${MAX_GRAMMARS} lines`)
  }
  const allowed = new Set(callableBehaviours(entries).map(entry => entry.name))
  const actions = grammars.map((line, index) => parseLine(line, allowed, index))
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
