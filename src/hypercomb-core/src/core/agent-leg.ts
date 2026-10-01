// core/agent-leg.ts
//
// THE LEG, AS PRIMITIVES (documentation/agent-harness.md, step 3). A request
// runs in legs — one stretch of a model's context window each. What a leg
// needs to know is small and pure: how many tokens a text costs, how to fold
// older rounds into a progress ledger when the window is full, when a leg
// must end, what the model is asked at the end, how a handover said in prose
// is read, and how the next leg opens. None of it touches a store, a model
// or a surface, so it lives here where both the chat window (shared) and the
// step bees (essentials) can reach it without either importing the other.
//
// The SHIPPED STEPS at the bottom are the default `fold`, `handover` and
// `receipt` of the harness: plain objects on the step contract
// (core/agent-steps.ts). Essentials registers them under their words; the
// window runs whatever the registry resolves and falls back to these same
// objects when an older essentials has no registry — one implementation,
// two doors.

import type {
  FoldInput, FoldOutput, FoldStep, HandoverDecideInput, HandoverDecision, HandoverLeftInput,
  HandoverStep, ReceiptInput, ReceiptStep, WorkMessage,
} from './agent-steps.js'

/** CONTINUING. The model ends a leg's handover with this fence, one line:
 *  what is left. Its absence is the goal predicate — the work is done. */
export const CONTINUE_FENCE_LANG = 'hypercomb-continue'

/** Rounds one leg may take before it hands over, whatever the window. */
export const LEG_ROUNDS = 12

/** What one participant request may spend before it must be asked again.
 *  Rounds and tokens both, because a cheap model can loop on rounds while a
 *  frontier one burns the purse in ten. Device-local overrides by key. */
export const WORK_BUDGET = { rounds: 400, tokens: 6_000_000 } as const
export const WORK_BUDGET_ROUNDS_KEY = 'hc:chat:budget:rounds'
export const WORK_BUDGET_TOKENS_KEY = 'hc:chat:budget:tokens'

export type WorkBudget = { readonly rounds: number; readonly tokens: number }

export const workBudget = (read: (key: string) => string | null = key => {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}, base: WorkBudget = WORK_BUDGET): WorkBudget => {
  const of = (key: string, fallback: number): number => {
    const n = Number(read(key))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
  }
  return { rounds: of(WORK_BUDGET_ROUNDS_KEY, base.rounds), tokens: of(WORK_BUDGET_TOKENS_KEY, base.tokens) }
}

/** Tokens a text costs a model, near enough to fit a window by. */
export const estimateTokens = (text: string): number => Math.ceil(String(text ?? '').length / 4) + 4

/** THE PROGRESS LEDGER. Rounds a leg no longer has room for are folded
 *  into one message that says what each asked and what came back, shortest
 *  first, so the model keeps its own trail without the bytes. Pure: the
 *  caller decides when the window is full. `from` is the first work message
 *  (everything before it is the participant's transcript, never folded),
 *  `keep` how many newest messages stay verbatim. */
export const foldWorkLedger = (
  messages: readonly { readonly role: string; readonly content: string }[],
  from: number,
  keep = 4,
): { readonly role: string; readonly content: string }[] => {
  const end = messages.length - keep
  if (end - from < 2) return [...messages]
  const folded = messages.slice(from, end)
  const lines = folded.map((entry, index) => {
    const text = String(entry.content ?? '').replace(/\s+/g, ' ').trim()
    const cut = text.length > 400 ? `${text.slice(0, 400)}…` : text
    return `${index + 1}. ${entry.role === 'assistant' ? 'you asked' : 'the hive said'}: ${cut}`
  })
  const ledger = {
    role: 'user',
    content: `PROGRESS LEDGER. Earlier rounds of this work, folded so the window has room; what a signature names never changes, so anything read can be opened again with read <signature>:\n${lines.join('\n')}`,
  }
  return [...messages.slice(0, from), ledger, ...messages.slice(end)]
}

const REQUEST_ECHO_MAX = 500
const carryRequest = (request: string): string => {
  const text = String(request ?? '').trim()
  const cut = text.length > REQUEST_ECHO_MAX ? `${text.slice(0, REQUEST_ECHO_MAX)}…` : text
  return cut ? `\n\nThe participant's request, for reference: «${cut}»` : ''
}

/** What the model is told when its stretch is full. */
export const lastRoundMessage = (request: string): string =>
  `This stretch of context is full. Answer now in prose: say what you did, what you found, and what is still left. If the request is not finished, end your reply with exactly this block, its one line saying what is left:\n\n\`\`\`${CONTINUE_FENCE_LANG}\nwhat is left, in one line\n\`\`\`\n\nThe work then continues in a fresh stretch with a fresh read budget. If the request is finished, no block.${carryRequest(request)}`

/** THE HANDOVER SAID IN PROSE. A model that ends a full stretch with "what
 *  is still left: …" or "next step: …" and no fence has handed over all the
 *  same; this reads that line so the next leg starts. Conservative: only a
 *  paragraph that opens with one of the handover phrasings counts, and only
 *  at a stretch's end (the caller checks that). */
export const leftFromProse = (prose: string): string | undefined => {
  const paragraphs = String(prose ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const opener = /^(?:\*\*)?(?:what(?:'s| is) (?:still )?left|still left|left to do|remaining|next steps?|what i haven'?t (?:found|done)(?: yet)?|not (?:yet )?done)(?:\*\*)?\s*[:.—-]?\s*/i
  for (const paragraph of paragraphs) {
    const match = opener.exec(paragraph)
    if (!match) continue
    const rest = paragraph.slice(match[0].length).replace(/\s+/g, ' ').trim()
    if (rest.length >= 12) return rest.slice(0, 300)
  }
  return undefined
}

/** The next leg's opening word, as the participant's turn. Honest in the
 *  transcript: it reads as what it is, the work continuing. */
export const continueMessage = (left: string): string =>
  `Continue. Left: ${String(left ?? '').trim() || 'the rest of the request'}`

/** When the budget is gone the work stops and says so; the participant's
 *  next word starts a fresh budget. */
export const budgetSpentMessage = (spent: { readonly rounds: number; readonly tokens: number }): string =>
  `\n\n*Paused: this request has used ${spent.rounds} rounds and about ${Math.round(spent.tokens / 1000)}k tokens, the budget for one request. Say continue to go on.*`

/** AN OPEN REQUEST IS CARRIED IN WHOLE LINES. A full block is eight reads,
 *  and by signature that is 581 characters; a cut at a character count ends
 *  mid-signature, which names nothing and is refused when the next leg asks
 *  for it. So a line goes over whole or not at all: up to a block's worth,
 *  and no further than the bound, which holds eight by-signature reads with
 *  a path and a position each (a write block's code lines stop at it). */
const CARRY_LINES = 8
const CARRY_CHARS = 1_200
const carryLines = (lines: readonly string[] | undefined): string | undefined => {
  const kept: string[] = []
  let size = 0
  for (const line of (lines ?? []).slice(0, CARRY_LINES)) {
    size += line.length + 3
    if (size > CARRY_CHARS) break
    kept.push(line)
  }
  return kept.length ? `carry on from: ${kept.join(' · ')}` : undefined
}

// ── THE SHIPPED STEPS ────────────────────────────────────────────────────

const tokensOf =(list: readonly WorkMessage[]): number =>
  list.reduce((sum, entry) => sum + estimateTokens(entry.content), 0)

/** `fold`: when the stretch no longer fits, fold the older rounds into the
 *  ledger; say how many folded and whether it fits now. */
export const shippedFoldStep: FoldStep = {
  word: 'fold',
  name: 'shipped',
  run(input: FoldInput): FoldOutput {
    const fits = (list: readonly WorkMessage[]): boolean =>
      input.systemTokens + tokensOf(list) < input.window - input.reserve
    if (fits(input.messages)) return { messages: [...input.messages], folded: 0, fits: true }
    const messages = foldWorkLedger(input.messages, input.workStart, input.keep) as WorkMessage[]
    const folded = messages.length < input.messages.length ? input.messages.length - messages.length + 1 : 0
    return { messages, folded, fits: fits(messages) }
  },
}

/** `handover`: decide when a leg ends and how it asks the model to hand
 *  over; read what is left from the model's reply; open the next leg. */
export const shippedHandoverStep: HandoverStep = {
  word: 'handover',
  name: 'shipped',
  decide(input: HandoverDecideInput): HandoverDecision {
    const end = input.spent || input.lastRound || input.rounds >= input.legRounds || !input.fits
    return { end, reply: end ? `${input.reply}\n\n${lastRoundMessage(input.request)}` : input.reply }
  },
  left(input: HandoverLeftInput): string | undefined {
    return input.left
      ?? carryLines(input.requestLines)
      ?? (input.lastRound && input.proseFallback ? leftFromProse(input.prose) : undefined)
      // No line of the open request could go over whole: the request is
      // still handed over, in words, rather than dropped or cut.
      ?? (input.requestLines?.length ? 'carry on with the request that was still open' : undefined)
  },
  continueWord: continueMessage,
  pausedNote: budgetSpentMessage,
}

/** `receipt`: the turn's facts on the bus, whatever happened. The emitter
 *  is handed in so this stays free of the bus itself. */
export const shippedReceiptStep = (emit: (name: string, payload: Record<string, unknown>) => void): ReceiptStep => ({
  word: 'receipt',
  name: 'shipped',
  run(input: ReceiptInput): void {
    const { answered, ...receipt } = input
    if (answered && receipt.outcome === 'answered') {
      emit('jev:turn', {
        path: receipt.path, ms: receipt.ms, rounds: receipt.rounds, weight: receipt.weight, at: receipt.at,
        ...(receipt.firstMs !== undefined ? { firstMs: receipt.firstMs } : {}),
      })
    }
    emit('agent:receipt', receipt)
  },
})
