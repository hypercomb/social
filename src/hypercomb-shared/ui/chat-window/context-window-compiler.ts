// chat-window/context-window-compiler.ts
//
// A CHAT THREAD IS DURABLE; a model prompt is a bounded, disposable VIEW of
// it. Keeping that distinction here prevents a context limit from becoming a
// history deletion policy. This module is deliberately pure: no store, clock,
// model call, or summary is involved, so the same thread and options always
// produce the same prompt view and manifest.

export type ContextTurnRole = 'user' | 'assistant'

/** Changes when selection semantics change, making old prompt receipts exact historical views. */
export const CHAT_CONTEXT_COMPILER = 'chat-context-v1'

/** The small common shape of a durable chat turn and the in-memory turn that
 * has just been appended. `sourceId` should be a durable turn signature when
 * one exists; a source position identifies a new turn. */
export type ContextWindowTurn = {
  readonly role: ContextTurnRole
  readonly text: string
  readonly model?: string
  readonly sourceId?: string
}

export type ContextInclusionReason = 'latest-user' | 'recent' | 'correction' | 'constraint'
export type ContextOmissionReason = 'budget' | 'not-selected'

export type ContextManifestItem = {
  readonly sourceId: string
  readonly estimatedTokens: number
  readonly reason: ContextInclusionReason | ContextOmissionReason
}

/** A receipt for the prompt view. It names source turns, never copies them. */
export type ContextWindowManifest = {
  readonly model: string
  readonly contextWindowTokens: number
  readonly reserveTokens: number
  readonly inputBudgetTokens: number
  readonly estimatedTokens: number
  readonly sourceTurnCount: number
  readonly includedTurnCount: number
  readonly omittedTurnCount: number
  readonly included: readonly ContextManifestItem[]
  readonly omitted: readonly ContextManifestItem[]
  /** Present only when the latest user request itself cannot fit. It remains
   * included rather than silently changing what the participant asked. */
  readonly overBudgetByTokens?: number
}

export type CompiledChatContext = {
  /** Source turns, in their original chronological order. No turn text is
   * changed or summarized. */
  readonly turns: readonly ContextWindowTurn[]
  readonly manifest: ContextWindowManifest
}

export type CompileChatContextOptions = {
  /** A provider's wire model name. The built-in table is conservative and can
   * be superseded by `contextWindowTokens` when the provider exposes a fact. */
  readonly model?: string
  /** Full model context window, including system prompt and reply. */
  readonly contextWindowTokens?: number
  /** Tokens kept for the system prompt, tools, and the reply. */
  readonly reserveTokens?: number
  /** Recent chronological turns to retain after the latest user request. */
  readonly recentTurns?: number
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768
const DEFAULT_RESERVE_TOKENS = 8_192
const DEFAULT_RECENT_TURNS = 6

/** Conservative policy defaults for common wire names. A provider capability
 * should pass `contextWindowTokens` rather than rely on this fallback. */
export const contextBudgetForModel = (model: string | undefined): number => {
  const name = String(model ?? '').trim().toLowerCase()
  if (/gemini/.test(name)) return 1_000_000
  if (/claude/.test(name)) return 200_000
  if (/(?:gpt-4\.1|gpt-4o|gpt-5|\bo[134]\b)/.test(name)) return 128_000
  if (/(?:llama|qwen|mistral|deepseek)/.test(name)) return 32_768
  return DEFAULT_CONTEXT_WINDOW_TOKENS
}

/** A deterministic, tokenizer-independent estimate. The fixed message
 * overhead prevents many tiny turns from looking free. */
export const estimateContextTokens = (text: string): number =>
  Math.max(1, Math.ceil(String(text ?? '').length / 4)) + 4

const CORRECTION = /\b(?:correction|actually|instead|i meant|that(?:'s| is) wrong|no,|wait,|rather than)\b/i
const CONSTRAINT = /\b(?:must(?: not)?|do not|don't|never|always|only|avoid|require(?:d)?|constraint|prefer|keep|use|without|no longer)\b/i

type Candidate = {
  readonly index: number
  readonly sourceId: string
  readonly tokens: number
  readonly reason: ContextInclusionReason | null
  readonly score: number
}

const sourceIdFor = (turn: ContextWindowTurn, index: number): string =>
  String(turn.sourceId ?? '').trim() || `turn:${index}`

/** Explicit participant corrections outrank ordinary constraints. Recency is
 * a tie breaker only; it cannot erase that difference. */
const candidateFor = (turn: ContextWindowTurn, index: number): Candidate => {
  const text = String(turn.text ?? '')
  // Only participant words become durable constraints. Treating an older
  // model's "must" as authority would turn its own prose into prompt policy.
  const correction = turn.role === 'user' && CORRECTION.test(text)
  const constraint = turn.role === 'user' && CONSTRAINT.test(text)
  const reason = correction ? 'correction' : constraint ? 'constraint' : null
  const cueCount = (text.match(CORRECTION) ?? []).length + (text.match(CONSTRAINT) ?? []).length
  return {
    index,
    sourceId: sourceIdFor(turn, index),
    tokens: estimateContextTokens(text),
    reason,
    score: (correction ? 10_000 : constraint ? 5_000 : 0) + (turn.role === 'user' ? 100 : 0) + Math.min(cueCount, 20) + index,
  }
}

/**
 * Compile the model-sized view of an append-only chat thread.
 *
 * Selection order is intentional: latest user request, recent chronology,
 * then older explicit corrections and constraints ranked deterministically.
 * The returned turns are put back into chronological order before they are
 * handed to a model. Nothing mutates the source list or its turns.
 */
export const compileChatContext = (
  sourceTurns: readonly ContextWindowTurn[],
  options: CompileChatContextOptions = {},
): CompiledChatContext => {
  const model = String(options.model ?? '')
  const contextWindowTokens = Math.max(0, Math.floor(options.contextWindowTokens ?? contextBudgetForModel(model)))
  const reserveTokens = Math.max(0, Math.floor(options.reserveTokens ?? DEFAULT_RESERVE_TOKENS))
  const inputBudgetTokens = Math.max(0, contextWindowTokens - reserveTokens)
  const recentTurns = Math.max(0, Math.floor(options.recentTurns ?? DEFAULT_RECENT_TURNS))
  const candidates = sourceTurns.map(candidateFor)
  const included = new Map<number, ContextInclusionReason>()
  const budgetOmitted = new Set<number>()
  let used = 0

  const include = (candidate: Candidate, reason: ContextInclusionReason, required = false): boolean => {
    if (included.has(candidate.index)) return true
    if (!required && used + candidate.tokens > inputBudgetTokens) {
      budgetOmitted.add(candidate.index)
      return false
    }
    included.set(candidate.index, reason)
    used += candidate.tokens
    return true
  }

  const latestUser = [...candidates].reverse().find(candidate => sourceTurns[candidate.index]?.role === 'user')
  if (latestUser) include(latestUser, 'latest-user', true)

  // Walk backwards so a tight context keeps the newest recent material first.
  // An assistant turn travels with the participant turn it answered; sending
  // an orphaned assistant message first is invalid for some provider APIs and
  // loses the question that gives the reply its meaning.
  let recentTaken = 0
  for (let index = candidates.length - 1; index >= 0 && recentTaken < recentTurns; index--) {
    const candidate = candidates[index]!
    if (included.has(candidate.index)) continue
    if (sourceTurns[candidate.index]?.role === 'assistant') {
      let userIndex = candidate.index - 1
      while (userIndex >= 0 && sourceTurns[userIndex]?.role !== 'user') userIndex--
      const companion = userIndex >= 0 ? candidates[userIndex] : undefined
      const needed = companion && !included.has(companion.index) ? [companion, candidate] : [candidate]
      if (!companion || recentTaken + needed.length > recentTurns) continue
      const extraTokens = needed.reduce((sum, item) => sum + (included.has(item.index) ? 0 : item.tokens), 0)
      if (used + extraTokens > inputBudgetTokens) {
        needed.forEach(item => budgetOmitted.add(item.index))
        continue
      }
      needed.forEach(item => include(item, item.reason ?? 'recent'))
      recentTaken += needed.length
      continue
    }
    if (include(candidate, 'recent')) recentTaken++
  }

  const olderExplicit = candidates
    .filter(candidate => !included.has(candidate.index) && candidate.reason !== null)
    .sort((a, b) => b.score - a.score || b.index - a.index || a.sourceId.localeCompare(b.sourceId))
  for (const candidate of olderExplicit) include(candidate, candidate.reason!)

  const selected = candidates.filter(candidate => included.has(candidate.index))
  const omitted = candidates.filter(candidate => !included.has(candidate.index))
  const item = (candidate: Candidate): ContextManifestItem => ({
    sourceId: candidate.sourceId,
    estimatedTokens: candidate.tokens,
    reason: included.get(candidate.index) ?? 'not-selected',
  })
  const overBudgetByTokens = Math.max(0, used - inputBudgetTokens)
  return {
    turns: selected.map(candidate => sourceTurns[candidate.index]!),
    manifest: {
      model,
      contextWindowTokens,
      reserveTokens,
      inputBudgetTokens,
      estimatedTokens: used,
      sourceTurnCount: sourceTurns.length,
      includedTurnCount: selected.length,
      omittedTurnCount: omitted.length,
      included: selected.map(item),
      omitted: omitted.map(candidate => ({
        ...item(candidate),
        reason: budgetOmitted.has(candidate.index) ? 'budget' : 'not-selected',
      })),
      ...(overBudgetByTokens ? { overBudgetByTokens } : {}),
    },
  }
}
