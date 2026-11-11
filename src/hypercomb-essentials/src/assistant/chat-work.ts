// assistant/chat-work.ts
//
// ONE QUESTION, WORKED IN ROUNDS — the part of the chat that lets a model
// change the hive, with no framework in it (jwize, 2026-11-11: "the chat
// needs to phase out angular"). The Angular window holds this loop inside one
// method; here it is on its own so a chat that is an element can run it.
//
// A round is one reply. A reply that ends in a `hypercomb-do` block is not
// the answer yet: every line is parsed against the live census and the
// participant's grant (core/machine-plan.ts) before anything is queued, the
// block waits in the execution queue for the participant's policy or hand,
// and what happened goes back to the model as the next message. A reply with
// no block is the answer.
//
// WHAT IT DOES NOT DO YET. It cannot read the hive, write code, doctrine or
// files, or put a failed block's pages back (the shell's plan transaction).
// The lesson it teaches says so, and a block of any other kind is sent back
// unused rather than half-honoured.

import {
  LEG_ROUNDS, HypercombActionExecutionError, HypercombPlanQueue,
  blockRefusedMessage, callableBehaviours, doFailedMessage, doRanMessage, doSkippedMessage,
  hypercombPlanLeaves, hypercombPlanReach, hypercombVocabulary, parseHypercombGrammars, splitWork, workInstruction,
  type HypercombBehaviour, type MachineReach,
} from '@hypercomb/core'
import type { LlmCall } from './llm-dispatch.js'

export type ChatWorkChunk = { readonly text: string; readonly providerId?: string; readonly model?: string }

/** The waiting place a block is put in — the execution queue's two calls. */
export type ChatWorkQueue = {
  request(ask: {
    convoId: string; providerId: string; model: string; kind: MachineReach
    lines: readonly string[]; needsGrant: boolean; leaves?: boolean; signal?: AbortSignal
  }): { readonly id: string; readonly decision: Promise<'run' | 'skip'> }
  settle(id: string, state: 'ran' | 'skipped' | 'failed', outcome?: string): void
}

export type ChatWorkDeps = {
  stream(call: LlmCall): AsyncIterable<ChatWorkChunk>
  /** The live census — what a model may be taught and may say. */
  behaviours(): readonly HypercombBehaviour[]
  /** The public canonical door a behaviour sentence runs through. */
  execute?: (command: string, args: string) => Promise<void> | void
  queue?: ChatWorkQueue
  /** Where the participant stands. A block written for one page is not run
   *  on another. */
  place?: () => string
}

export type ChatWorkEvent =
  /** The reply being written this round, whole so far. */
  | { readonly kind: 'live'; readonly text: string }
  /** A round ended: its words, with any work block taken out. */
  | { readonly kind: 'said'; readonly text: string }
  | { readonly kind: 'waiting'; readonly lines: readonly string[] }
  | { readonly kind: 'ran'; readonly lines: readonly string[] }
  | { readonly kind: 'skipped'; readonly lines: readonly string[] }
  | { readonly kind: 'failed'; readonly lines: readonly string[]; readonly reason: string }
  | { readonly kind: 'refused'; readonly reason: string }

export type ChatWorkAsk = {
  readonly convoId: string
  /** The conversation so far, the new question last. */
  readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]
  readonly question: string
  readonly signal?: AbortSignal
}

/** One lane for every conversation on the page: two plans never interleave. */
const lane = new HypercombPlanQueue()

/** True when this page can run a behaviour for a model at all. */
export const chatCanChange = (deps: ChatWorkDeps): boolean =>
  !!deps.queue && !!deps.execute && callableBehaviours(deps.behaviours()).length > 0

const reasonOf = (error: unknown): string => {
  const cause = error instanceof HypercombActionExecutionError && error.cause ? error.cause : error
  return cause instanceof Error ? cause.message : String(cause)
}

export async function* runChatWork(ask: ChatWorkAsk, deps: ChatWorkDeps): AsyncGenerator<ChatWorkEvent> {
  const { signal, question, convoId } = ask
  const canChange = chatCanChange(deps)
  const system = workInstruction({
    canRead: false, readsRunFreely: false, readsPerBlock: 0,
    canChange, vocabulary: canChange ? hypercombVocabulary(deps.behaviours()) : '',
  })
  const messages = ask.messages.map(message => ({ role: message.role, content: message.content }))

  for (let round = 0; round < LEG_ROUNDS; round++) {
    let reply = ''
    let providerId = ''
    let model = ''
    for await (const chunk of deps.stream({ messages, system, signal })) {
      if (signal?.aborted) break
      if (chunk.providerId) providerId = chunk.providerId
      if (chunk.model) model = chunk.model
      if (!chunk.text) continue
      reply += chunk.text
      yield { kind: 'live', text: reply }
    }
    const split = splitWork(reply)
    if (split.prose.trim()) yield { kind: 'said', text: split.prose.trim() }
    const request = split.request
    if (signal?.aborted || !request) return

    // The hive's answer to this block is the next message, whatever it is.
    const back = (text: string): void => { messages.push({ role: 'assistant', content: reply }, { role: 'user', content: text }) }

    if (request.kind !== 'do') {
      const reason = request.kind === 'read' ? 'this chat cannot read the hive yet' : 'this chat cannot write that yet'
      yield { kind: 'refused', reason }
      back(blockRefusedMessage(request.kind, reason, question))
      continue
    }
    if (!canChange || !deps.queue || !deps.execute) {
      const reason = 'changing the hive is not available here'
      yield { kind: 'refused', reason }
      back(blockRefusedMessage('do', reason, question))
      continue
    }

    // EVERY line is parsed before anything is queued, let alone run: one bad
    // tail can never leave a half-run prefix.
    const entries = deps.behaviours()
    let plan: ReturnType<typeof parseHypercombGrammars>
    try { plan = parseHypercombGrammars(request.lines, entries) } catch (error) {
      const reason = reasonOf(error)
      yield { kind: 'refused', reason }
      back(blockRefusedMessage('do', reason, question))
      continue
    }
    const lines = plan.actions.map(action => action.grammar)
    const stood = deps.place?.() ?? ''
    const entry = deps.queue.request({
      convoId, providerId, model, kind: hypercombPlanReach(plan, entries), lines, needsGrant: false, signal,
      // A line that leaves the machine waits for a hand whatever the policy.
      leaves: hypercombPlanLeaves(plan, entries).length > 0,
    })
    yield { kind: 'waiting', lines }
    if (await entry.decision === 'skip') {
      if (signal?.aborted) return
      yield { kind: 'skipped', lines }
      back(doSkippedMessage(lines, question))
      continue
    }
    const execute = deps.execute
    try {
      const receipt = await lane.run(plan, {
        execute: (command, args) => {
          if ((deps.place?.() ?? '') !== stood) throw new Error('the participant moved to another page while this waited; ask again from where they are')
          const live = new Set(callableBehaviours(deps.behaviours()).map(behaviour => behaviour.name))
          if (!live.has(command)) throw new Error(`/${command} is no longer available`)
          return execute(command, args)
        },
      }, signal)
      deps.queue.settle(entry.id, 'ran')
      yield { kind: 'ran', lines: receipt.grammars }
      back(doRanMessage(receipt.grammars, question))
    } catch (error) {
      const completed = error instanceof HypercombActionExecutionError ? error.completed : []
      const stoppedAt = error instanceof HypercombActionExecutionError ? error.grammar : lines[0] ?? ''
      const reason = reasonOf(error)
      deps.queue.settle(entry.id, 'failed', reason)
      // Stop is the participant's hand: what ran before it stays, and the
      // model is not asked to carry on.
      if (signal?.aborted) { if (completed.length) yield { kind: 'ran', lines: completed }; return }
      if (completed.length) yield { kind: 'ran', lines: completed }
      yield { kind: 'failed', lines: [stoppedAt], reason }
      back(doFailedMessage(completed, stoppedAt, reason, question))
    }
  }
}
