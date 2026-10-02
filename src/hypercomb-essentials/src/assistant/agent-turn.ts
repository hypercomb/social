// assistant/agent-turn.ts
//
// THE MODEL'S LOOP, WITHOUT A WINDOW. A participant — a person typing, or a
// model acting for them — asks; a model answers in rounds, reading the hive,
// changing it, and writing the build's own source, until the request is done
// (documentation/agent-harness.md). The chat window has run this loop inside
// Angular since the first fence; this is the same loop for the minimal build,
// where there is no Angular, and for any participant that drives the hive
// without a screen.
//
// One dialect. Everything the model is TAUGHT and TOLD comes from core
// (work-words.ts, hive-reads.ts, hive-grammar.ts); the steps it takes come
// from the step registry (core agent-steps.ts), so a harness's own route,
// stretch, fold and handover apply here exactly as in the window. What is
// this module's own is only the wiring: which reader, which queue, which
// router — each found on IoC, each replaceable for a spec.
//
//   read    through the hive tree reader (assistant/hive-tree-reader.ts):
//           tiles by route, anything by signature — including the build's
//           own revisions and drafts, file by file (sharing/version-pools.ts)
//   do      the census vocabulary, run in order through the behaviour drone
//   write   `version <revision> <path>`: a file of the build's own tree,
//           staged into ONE draft per revision per turn
//           (sharing/version-drafts.ts). Nothing runs and nothing leaves the
//           browser; the participant sends a draft to a builder.
//
// Every read and change waits in the Execution column (execution-queue.ts)
// when the participant's policy says so — the same door the window uses.
// Jev's doors (front, table round, verify) are the window's still; a turn
// here is answered by the worker alone.

import {
  AGENT_FOLD, AGENT_HANDOVER, AGENT_ROUND, AGENT_ROUTE, AGENT_STEPS_IOC_KEY, EffectBus, MAX_HANDOFFS, MAX_OBSERVATIONS,
  READ_PAGE_CHARS, WORK_BUDGET,
  HypercombActionExecutionError, HypercombPlanQueue,
  applySectionEdits, blockRefusedMessage, blockUnwrittenMessage, callableBehaviours, doFailedMessage, doRanMessage,
  doSkippedMessage, estimateTokens, executeHypercombObservationPlan, formatHypercombObservationReceipt,
  HELD_DO_NOTE, hypercombPlanReach, hypercombVocabulary, identityInstruction, isWorkRefusal, parseHypercombGrammars,
  parseHypercombObservationGrammars, parseWriteBlock, readResultMessage, readSkippedMessage, shippedFoldStep,
  shippedHandoverStep, shippedRouteStep, shippedStretchStep, transcriptForModel, versionWriteRanMessage,
  workInstruction, WorkRefused, writeFailedMessage, writeSkippedMessage,
  type HypercombBehaviour, type AgentStepRegistry, type HypercombTreeReader, type StretchChunk, type WorkMessage,
} from '@hypercomb/core'

export const AGENT_TURN_IOC_KEY = '@diamondcoreprocessor.com/AgentTurn'

const ROUTER_KEY = '@diamondcoreprocessor.com/LlmRouter'
const QUEUE_KEY = '@hypercomb.social/ExecutionQueue'
const READER_KEY = '@diamondcoreprocessor.com/HypercombHiveTreeReader'
const SLASH_KEY = '@diamondcoreprocessor.com/SlashBehaviourDrone'
const ACCESS_KEY = '@hypercomb.social/LlmHiveAccess'
const VERSIONS_KEY = '@diamondcoreprocessor.com/VersionDrafts'
const PRELOADER_KEY = '@hypercomb.social/ScriptPreloader'

/** Rounds one turn may take before it hands over what is left. */
const TURN_ROUNDS = 12
/** Blocks the hive may turn back in a row before the turn stops asking. */
const MAX_REFUSALS_IN_A_ROW = 3
/** Revisions named in the teaching, newest first. */
const REVISIONS_TAUGHT = 8
const KEEP_VERBATIM = 6
const RESERVE_TOKENS = 8_000

type Need = { readonly tier: string; readonly streaming?: boolean }

/** The router as this loop uses it (assistant/llm-dispatch.ts). */
export type AgentRouter = {
  stream(call: Record<string, unknown>): AsyncIterable<StretchChunk>
  ready?(call: Record<string, unknown>): boolean
  contextLengthForModel?(model: string): number | undefined
}
/** The Execution column (assistant/execution-queue.ts). */
export type AgentQueue = {
  request(ask: {
    convoId: string; providerId: string; model: string; kind: 'read' | 'additive' | 'editing' | 'destructive'
    lines: readonly string[]; keys?: readonly string[]; needsGrant: boolean; signal?: AbortSignal
  }): { readonly id: string; readonly decision: Promise<'run' | 'skip'> }
  settle(id: string, state: 'ran' | 'skipped' | 'failed', outcome?: string): void
}
/** The behaviour drone's door for canonical grammar (commands/slash-behaviour.drone.ts). */
export type AgentDoer = {
  entries(): readonly HypercombBehaviour[]
  executePublicCanonical(command: string, args: string): Promise<void>
}
/** The build's own history (commands/versions.queen.ts → sharing/version-drafts.ts). */
export type AgentVersions = {
  revisions(): Promise<readonly { readonly sig: string; readonly label: string; readonly version: string }[]>
  read(revision: string, path: string): Promise<string>
  stage(request: { base: string; files: Record<string, string | null> }): Promise<string>
}

export type AgentTurnDeps = {
  readonly router?: AgentRouter
  readonly queue?: AgentQueue
  readonly reader?: HypercombTreeReader
  readonly doer?: AgentDoer
  readonly versions?: AgentVersions
  readonly steps?: AgentStepRegistry
  /** Providers whose reads run without the participant approving each. */
  readonly readsFreely?: (providerId: string) => boolean
  readonly emit?: (name: string, payload: Record<string, unknown>) => void
}

export type AgentTurnRequest = {
  /** What the participant asks. */
  readonly request: string
  /** The conversation before it, oldest first. */
  readonly transcript?: readonly { readonly role: 'user' | 'assistant'; readonly text: string; readonly model?: string }[]
  readonly convoId?: string
  readonly providerId?: string
  readonly model?: string
  readonly need?: Need
  /** What "here" means: the page's segments. */
  readonly page?: readonly string[]
  /** Framing that goes before the loop's own words (the anatomy, a role). */
  readonly system?: string
  /** A harness's step preferences (core agent-steps.ts `resolve`). */
  readonly prefer?: readonly string[]
  readonly signal?: AbortSignal
}

export type AgentTurnResult = {
  /** The model's prose, every round's, as it was shown. */
  readonly answer: string
  readonly rounds: number
  /** What the hive ran, in the hive's own grammar. */
  readonly ran: readonly string[]
  /** What was read, in the hive's own grammar. */
  readonly read: readonly string[]
  /** Drafts staged this turn, the newest per revision. */
  readonly drafts: readonly { readonly draft: string; readonly version: string; readonly paths: readonly string[] }[]
  /** What the model said is left when the turn handed over. */
  readonly left?: string
  /** Why the turn stopped short, when it did. */
  readonly stopped?: string
  readonly providerId?: string
  readonly model?: string
}

const iocGet = <T>(key: string): T | undefined =>
  (globalThis as { ioc?: { get?: (key: string) => unknown } }).ioc?.get?.(key) as T | undefined

/** What this turn can reach, found on IoC. The version door is a queen and
 *  sleeps until its word, so it is woken when it is not there yet. */
export const liveAgentDeps = async (): Promise<AgentTurnDeps> => {
  let versions = iocGet<AgentVersions>(VERSIONS_KEY)
  if (!versions) {
    await iocGet<{ wakeWord?: (word: string) => Promise<unknown> }>(PRELOADER_KEY)?.wakeWord?.('versions')?.catch(() => undefined)
    versions = iocGet<AgentVersions>(VERSIONS_KEY)
  }
  const access = iocGet<{ granted?: () => readonly string[] }>(ACCESS_KEY)
  return {
    router: iocGet<AgentRouter>(ROUTER_KEY),
    queue: iocGet<AgentQueue>(QUEUE_KEY),
    reader: iocGet<HypercombTreeReader>(READER_KEY),
    doer: iocGet<AgentDoer>(SLASH_KEY),
    versions,
    steps: iocGet<AgentStepRegistry>(AGENT_STEPS_IOC_KEY),
    readsFreely: providerId => providerId === 'local' || (access?.granted?.() ?? []).includes(providerId),
    emit: (name, payload) => EffectBus.emit(name, payload),
  }
}

const stopped = (): DOMException => new DOMException('The model request was aborted', 'AbortError')

/**
 * ONE TURN: the request answered in rounds. Yields the model's prose as it
 * streams (work blocks held back) and returns what happened. A model that
 * says work is left hands it over in `left`; the caller decides whether to
 * continue (core agent-leg.ts `continueMessage`).
 */
export async function* agentTurn(turn: AgentTurnRequest, deps: AgentTurnDeps): AsyncGenerator<string, AgentTurnResult, void> {
  const { router, queue, reader, doer, versions, signal } = { ...deps, signal: turn.signal }
  if (!router?.stream) throw new Error('no model router here')
  const emit = deps.emit ?? (() => undefined)
  const convoId = turn.convoId ?? `agent:${Date.now().toString(36)}`
  const need: Need = turn.need ?? { tier: 'balanced', streaming: true }
  const prefer = turn.prefer
  const routeStep = deps.steps?.resolve('route', prefer) ?? shippedRouteStep
  const stretchStep = deps.steps?.resolve('stretch', prefer) ?? shippedStretchStep
  const foldStep = deps.steps?.resolve('fold', prefer) ?? shippedFoldStep
  const handoverStep = deps.steps?.resolve('handover', prefer) ?? shippedHandoverStep
  const readsFreely = (providerId: string): boolean => deps.readsFreely?.(providerId) === true

  // WHAT THIS TURN CAN DO, said once so the system text stays byte-stable
  // across its rounds (a vendor's prompt cache keys on the prefix).
  const entries = doer?.entries?.() ?? []
  const canRead = !!reader?.readTree
  const canChange = !!queue && !!doer?.executePublicCanonical && callableBehaviours(entries).length > 0
  const held = versions ? await versions.revisions().catch(() => []) : []
  const canWriteVersion = !!versions && held.length > 0
  const revisions = held.slice(0, REVISIONS_TAUGHT).map(r => `${r.sig} ${r.label} ${r.version}`).join('\n')
  const readsPerBlock = MAX_OBSERVATIONS
  const page = [...(turn.page ?? [])]
  const systemFor = (model: string | undefined, label: string | undefined, providerId: string | undefined): string => [
    turn.system ?? '',
    identityInstruction(model, label),
    'You are helping inside Hypercomb. Be accurate and concise. Do not claim to have read hive contents unless they are present in the messages.',
    workInstruction({
      canRead, readsRunFreely: !!providerId && readsFreely(providerId), readsPerBlock, canChange,
      vocabulary: canChange ? hypercombVocabulary(entries) : '', canWriteVersion, revisions,
    }),
    canRead ? `"here" is the page /${page.join('/')}.` : '',
  ].filter(Boolean).join('\n\n')

  const messages: WorkMessage[] = transcriptForModel(turn.transcript ?? [], turn.model)
  if (messages.at(-1)?.role !== 'user' || messages.at(-1)?.content !== turn.request) messages.push({ role: 'user', content: turn.request })
  const workStart = messages.length

  let pinned = turn.providerId
  let continuationModel = turn.model
  let system = systemFor(turn.model, undefined, pinned)
  const avoid: string[] = []
  let routeNeed = need
  let rounds = 0
  let tokens = 0
  let lastRound = false
  let unwrittenSaid = false
  let refusedInARow = 0
  let answer = ''
  let wrote = false
  let snapshots: string[] = []
  const ran: string[] = []
  const observed: string[] = []
  // One draft per revision this turn: every file written over it so far.
  const drafts = new Map<string, { files: Record<string, string | null>; draft: string }>()
  const stage = (name: string, facts: Record<string, unknown>): void => emit(name, { id: convoId, convoId, leg: 1, at: Date.now(), ...facts })
  const result = (extra: Partial<AgentTurnResult> = {}): AgentTurnResult => ({
    answer, rounds, ran: [...ran], read: [...observed],
    drafts: [...drafts].map(([version, d]) => ({ draft: d.draft, version, paths: Object.keys(d.files).sort() })),
    ...(pinned ? { providerId: pinned } : {}), ...(continuationModel ? { model: continuationModel } : {}), ...extra,
  })
  const say = (text: string): string => { answer += text; wrote = true; return text }
  /** Wait for the participant's hand (or their policy) in Execution. */
  const ask = async (kind: 'read' | 'additive' | 'editing', lines: readonly string[], providerId: string, model: string, keys?: readonly string[]) => {
    if (!queue) return { id: '', run: true }
    const entry = queue.request({ convoId, providerId, model, kind, lines, ...(keys ? { keys } : {}), needsGrant: kind === 'read' && !readsFreely(providerId), signal })
    const run = await entry.decision === 'run'
    if (!run && signal?.aborted) throw stopped()
    return { id: entry.id, run }
  }
  const settle = (id: string, state: 'ran' | 'skipped' | 'failed', outcome?: string): void => { if (id) queue?.settle(id, state, outcome) }

  const runRead = async (lines: readonly string[], providerId: string, model: string): Promise<string> => {
    if (!reader) throw new WorkRefused('reading the hive is not available here')
    if (!queue && !readsFreely(providerId)) throw new WorkRefused('reading the hive needs the participant\'s approval, and there is nowhere to ask for it here')
    const plan = parseHypercombObservationGrammars(lines, page, readsPerBlock)
    const grammars = plan.observations.map(o => o.grammar)
    const keys = plan.observations.map(o => o.verb === 'code' ? `code ${o.query ?? ''}`.trim()
      : o.sig ? `${o.verb} ${o.sig}${o.section ? ` ${o.section}` : ''}${o.from ? ` ${o.from}` : ''}`
        : o.query !== undefined ? `find ${o.query} /${o.segments.join('/')}` : `${o.verb} /${o.segments.join('/')}`)
    const gate = await ask('read', grammars, providerId, model, keys)
    if (!gate.run) return readSkippedMessage(grammars, turn.request)
    try {
      // Each read may take up to half of what is left of the window, shared
      // by the block's reads, and never past a page.
      const window = (model && router.contextLengthForModel?.(model)) || 128_000
      const room = Math.max(0, window - RESERVE_TOKENS - estimateTokens(system) - messages.reduce((n, m) => n + estimateTokens(m.content), 0)) * 3 / 2
      const maxBytes = Math.max(1_024, Math.min(READ_PAGE_CHARS, Math.floor(room / plan.observations.length)))
      const receipt = await executeHypercombObservationPlan(plan, reader, { maxDepth: 2, maxNodes: 48, maxBytes, signal })
      const all = [...snapshots, ...receipt.snapshots]
      if (all.length && !await reader.validateSnapshots(all, signal)) {
        snapshots = []
        throw new WorkRefused('the tree changed while it was being read; read it again')
      }
      snapshots = all.slice(-64)
      observed.push(...grammars)
      const content = formatHypercombObservationReceipt(receipt)
      settle(gate.id, 'ran', `${content.length} characters`)
      return readResultMessage(content, turn.request)
    } catch (error) {
      settle(gate.id, signal?.aborted ? 'skipped' : 'failed', error instanceof Error ? error.message : undefined)
      throw error
    }
  }

  const runDo = async (lines: readonly string[], providerId: string, model: string): Promise<string> => {
    if (!canChange || !queue || !doer) throw new WorkRefused('changing the hive is not available here')
    const plan = parseHypercombGrammars(lines, entries)
    const grammars = plan.actions.map(action => action.grammar)
    const gate = await ask(hypercombPlanReach(plan, entries) as 'additive' | 'editing', grammars, providerId, model)
    if (!gate.run) return doSkippedMessage(grammars, turn.request)
    let admitted = snapshots.length === 0
    try {
      const receipt = await new HypercombPlanQueue().run(plan, {
        execute: async (command, args) => {
          if (!admitted) {
            if (!reader || !await reader.validateSnapshots(snapshots, signal)) {
              snapshots = []
              throw new WorkRefused('the tree changed since you read it; read it again before changing it')
            }
            admitted = true
          }
          return doer.executePublicCanonical(command, args)
        },
      }, signal)
      ran.push(...receipt.grammars)
      snapshots = []
      settle(gate.id, 'ran')
      return doRanMessage(receipt.grammars, turn.request)
    } catch (error) {
      if (!signal?.aborted && error instanceof HypercombActionExecutionError) {
        ran.push(...error.completed)
        if (error.completed.length) snapshots = []
        const reason = error.cause instanceof Error ? error.cause.message : 'it could not run'
        settle(gate.id, 'failed', `${error.grammar}: ${reason}`)
        return doFailedMessage(error.completed, error.grammar, reason, turn.request)
      }
      settle(gate.id, signal?.aborted ? 'skipped' : 'failed', error instanceof Error ? error.message : undefined)
      throw error
    }
  }

  const runWrite = async (lines: readonly string[], providerId: string, model: string): Promise<string> => {
    const parsed = parseWriteBlock(lines)
    if ('error' in parsed) throw new WorkRefused(parsed.error)
    if (!('version' in parsed)) throw new WorkRefused('only the build\'s own source is written here: version <revision signature> <path>')
    if (!canWriteVersion || !versions) throw new WorkRefused('no revision is held here to draft over')
    const grammar = `write version ${parsed.version.slice(0, 12)}… ${parsed.path}`
    const gate = await ask('additive', [grammar], providerId, model)
    if (!gate.run) return writeSkippedMessage(parsed.path, turn.request)
    const open = drafts.get(parsed.version) ?? { files: {}, draft: '' }
    try {
      let body = parsed.body
      if (parsed.edits) {
        const current = open.files[parsed.path] ?? await versions.read(parsed.version, parsed.path)
        const made = applySectionEdits(current, parsed.edits)
        if ('error' in made) throw new Error(made.error)
        body = made.body
      }
      const files = { ...open.files, [parsed.path]: body.endsWith('\n') ? body : `${body}\n` }
      const draft = await versions.stage({ base: parsed.version, files })
      drafts.set(parsed.version, { files, draft })
      ran.push(grammar)
      settle(gate.id, 'ran', draft)
      return versionWriteRanMessage({ draft, version: parsed.version, paths: Object.keys(files).sort() }, turn.request)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'it could not be staged'
      settle(gate.id, 'failed', reason)
      return writeFailedMessage(reason, turn.request)
    }
  }

  while (true) {
    if (signal?.aborted) throw stopped()
    let lead = wrote ? '\n\n' : ''
    const call = routeStep.call({ round: rounds, need: routeNeed, pinned, continuationModel, avoid })
    const round = yield* stretchStep.run({
      stream: router.stream({ ...call, need: routeNeed, cacheSystem: true, messages, system, signal }),
      pinned, model: continuationModel, lead, silent: false, signal,
      onProvider: (chunk, first) => { if (first) stage(AGENT_ROUTE, { round: rounds + 1, providerId: chunk.providerId, model: chunk.model, tier: routeNeed.tier }) },
    })
    // The prose that streamed is the answer as shown; the block is held back.
    if (round.wrote) { wrote = true; lead = '' }
    answer = joinProse(answer, round.work.prose)
    rounds++
    tokens += estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.content), 0) + estimateTokens(round.roundText)
    const work = round.work
    stage(AGENT_ROUND, { round: rounds, request: work.request?.kind ?? 'none', handoff: !!work.handoff, spent: { rounds, tokens } })

    if (work.handoff) {
      const moved = routeStep.handoff({
        avoid, providerId: round.providerId, need: routeNeed, maxHandoffs: MAX_HANDOFFS,
        ready: (n, tried) => router.ready?.({ need: n, avoid: tried }) === true,
      })
      avoid.splice(0, avoid.length, ...moved.avoid)
      routeNeed = moved.need
      yield say(`${lead}*${round.label || round.model || round.providerId} handed this off: ${work.handoff}*`)
      if (!moved.another) return result({ stopped: `no model switched on can take it: ${work.handoff}` })
      pinned = undefined
      continuationModel = undefined
      system = systemFor(undefined, undefined, undefined)
      continue
    }
    if (work.unwritten && !work.request && !lastRound && !unwrittenSaid) {
      unwrittenSaid = true
      messages.push({ role: 'assistant', content: round.roundText }, { role: 'user', content: blockUnwrittenMessage(work.unwritten, turn.request) })
      continue
    }
    const pin = routeStep.pin({ pinned, providerId: round.providerId, model: round.model })
    pinned = pinned ?? pin.pinned
    continuationModel = pin.continuationModel
    if (!work.request || lastRound) {
      const left = handoverStep.left({
        ...(work.left ? { left: work.left } : {}),
        ...(work.request ? { requestLines: work.request.lines } : {}),
        prose: work.prose, lastRound, proseFallback: true,
      })
      if (left) stage(AGENT_HANDOVER, { round: rounds, left, spent: { rounds, tokens } })
      return result(left ? { left } : {})
    }
    system = systemFor(round.model, round.label, pinned)
    messages.push({ role: 'assistant', content: round.roundText })

    let reply: string
    try {
      const kind = work.request.kind
      reply = kind === 'read' ? await runRead(work.request.lines, pinned!, round.model)
        : kind === 'write' ? await runWrite(work.request.lines, pinned!, round.model)
          : kind === 'do' ? await runDo(work.request.lines, pinned!, round.model)
            : (() => { throw new WorkRefused('no table is run here: send one read, do or write block') })()
      refusedInARow = 0
    } catch (error) {
      if (signal?.aborted) throw error
      if (!isWorkRefusal(error)) {
        const detail = error instanceof Error ? error.message : 'the work could not continue'
        yield say(`\n\nHypercomb stopped the work: ${detail}.`)
        return result({ stopped: detail })
      }
      const reason = (error as Error).message
      reply = blockRefusedMessage(work.request.kind, reason, turn.request)
      if (++refusedInARow >= MAX_REFUSALS_IN_A_ROW) {
        yield say(`\n\nThe hive turned back ${refusedInARow} blocks in a row and stopped asking. The last reason: ${reason}`)
        return result({ stopped: reason })
      }
    }
    if (work.heldDo) reply = `${HELD_DO_NOTE}\n\n${reply}`
    messages.push({ role: 'user', content: reply })
    const window = (round.model && router.contextLengthForModel?.(round.model)) || 128_000
    const folded = foldStep.run({ messages, workStart, keep: KEEP_VERBATIM, systemTokens: estimateTokens(system), window, reserve: RESERVE_TOKENS })
    if (folded.folded) {
      messages.splice(0, messages.length, ...folded.messages)
      stage(AGENT_FOLD, { round: rounds, folded: folded.folded, kept: KEEP_VERBATIM })
    }
    const spent = rounds >= WORK_BUDGET.rounds || tokens >= WORK_BUDGET.tokens
    const decided = handoverStep.decide({ request: turn.request, reply, rounds, legRounds: TURN_ROUNDS, spent, lastRound, fits: folded.fits })
    if (decided.end) {
      messages[messages.length - 1] = { role: 'user', content: decided.reply }
      lastRound = true
    }
  }
}

/** The answer as the participant read it: each round's prose, a paragraph apart. */
const joinProse = (answer: string, prose: string): string => {
  const text = prose.trim()
  if (!text) return answer
  return answer.trim() ? `${answer.trimEnd()}\n\n${text}` : text
}

/** The whole turn at once, for a caller that does not stream. */
export const runAgentTurn = async (turn: AgentTurnRequest, deps?: AgentTurnDeps): Promise<AgentTurnResult> => {
  const loop = agentTurn(turn, deps ?? await liveAgentDeps())
  for (;;) {
    const step = await loop.next()
    if (step.done) return step.value
  }
}
