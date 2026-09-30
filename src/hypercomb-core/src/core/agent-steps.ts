// core/agent-steps.ts
//
// THE STEPS ARE WORDS (documentation/agent-harness.md, step 3). A turn of
// the agent loop is seven stages — front, route, stretch, fold, handover,
// verify, receipt — and each is a WORD a bee answers to. The harness record
// names the bees it wants by signature; the registry resolves a word to the
// implementation the harness prefers, else the shipped one; the window
// runs what it is handed. This file is only the contract: the words, what
// each step is given and what it answers. The shipped implementations are
// in core/agent-leg.ts; the registry is essentials' (assistant/agent-steps).
//
// All seven words are on the contract. What the window keeps is what only
// it holds: the census and the tree a door is shown, the Execution window
// the fences run through, and the turn's ledger.

import type { AgentReceiptEvent } from './agent-effects.js'
import type { SplitWork } from './work-fence.js'

export const AGENT_STEPS_IOC_KEY = '@hypercomb.social/AgentSteps'

export const AGENT_STEP_WORDS = Object.freeze([
  'front', 'route', 'stretch', 'fold', 'handover', 'verify', 'receipt',
] as const)
export type AgentStepWord = typeof AGENT_STEP_WORDS[number]

export type WorkMessage = { readonly role: 'user' | 'assistant'; readonly content: string }

// ── fold ────────────────────────────────────────────────────────────────

export type FoldInput = {
  readonly messages: readonly WorkMessage[]
  /** Index of the first work message; everything before it is transcript. */
  readonly workStart: number
  /** How many newest messages stay verbatim. */
  readonly keep: number
  readonly systemTokens: number
  /** The model's context window, in tokens. */
  readonly window: number
  /** Tokens kept free for the reply. */
  readonly reserve: number
}
export type FoldOutput = {
  readonly messages: WorkMessage[]
  /** Rounds folded into the ledger; 0 when nothing folded. */
  readonly folded: number
  /** Whether the stretch fits the window after the fold. */
  readonly fits: boolean
}
export interface FoldStep {
  readonly word: 'fold'
  readonly name: string
  run(input: FoldInput): FoldOutput
}

// ── handover ────────────────────────────────────────────────────────────

export type HandoverDecideInput = {
  readonly request: string
  /** The hive's reply to the round, before the leg-end word is added. */
  readonly reply: string
  readonly rounds: number
  readonly legRounds: number
  /** The request's budget is spent. */
  readonly spent: boolean
  /** Something earlier in the round already marked this the last. */
  readonly lastRound: boolean
  readonly fits: boolean
}
export type HandoverDecision = {
  readonly end: boolean
  /** The reply to send: with the leg-end word when the leg ends. */
  readonly reply: string
}
export type HandoverLeftInput = {
  /** What the model's continue fence said, if it wrote one. */
  readonly left?: string
  /** A request still open when the leg ended, to carry over. */
  readonly requestLines?: readonly string[]
  /** The model's prose, read for a handover said in words. */
  readonly prose: string
  readonly lastRound: boolean
  readonly proseFallback: boolean
}
export interface HandoverStep {
  readonly word: 'handover'
  readonly name: string
  decide(input: HandoverDecideInput): HandoverDecision
  left(input: HandoverLeftInput): string | undefined
  /** The next leg's opening turn. */
  continueWord(left: string): string
  /** What the transcript says when the budget is spent. */
  pausedNote(spent: { readonly rounds: number; readonly tokens: number }): string
}

// ── receipt ─────────────────────────────────────────────────────────────

export type ReceiptInput = AgentReceiptEvent & { readonly answered: boolean }
export interface ReceiptStep {
  readonly word: 'receipt'
  readonly name: string
  run(input: ReceiptInput): void
}

// ── the two doors Jev keeps: front and verify ───────────────────────────
//
// Both take the judge as an INPUT — the Jev service, the receipt writer and
// the bus emitter are handed in — so the shipped step is pure with respect
// to where it runs, lives in core like fold and handover, and a bee that
// judges differently registers beside it by signature.

export type JevWeight = 'fast' | 'balanced' | 'deep'
export type JevUsageLike = { readonly inputTokens?: number; readonly outputTokens?: number; readonly cost?: number }
export type JevSource = { readonly providerId: string; readonly system: string; readonly messages: readonly { readonly content: string }[] }

export type FrontDecisionLike = {
  readonly direct?: { readonly sentence?: string; readonly reach?: string; readonly reason: string }
  readonly aside: boolean
  readonly weight?: JevWeight
  readonly carry: boolean
  readonly reason: string
  readonly model: string
  readonly usage?: JevUsageLike
}
export type VerifyDecisionLike = {
  readonly verified: boolean
  readonly reason: string
  readonly model: string
  readonly usage?: JevUsageLike
}
export type JevDoorLike = {
  ready(providerId: string): boolean
  front?(input: unknown, source: JevSource, signal?: AbortSignal): Promise<FrontDecisionLike>
  verify?(input: unknown, source: JevSource, signal?: AbortSignal): Promise<VerifyDecisionLike>
}
export type StageEmit = (name: string, payload: Record<string, unknown>) => void

export type FrontBehaviour = {
  readonly name: string
  readonly description: string
  readonly forms: unknown
  readonly bare: boolean
  readonly reach: string
}
export type FrontInput = {
  readonly request: string
  readonly providerId: string
  /** The thread already carries a weight from an earlier turn. */
  readonly carrying: boolean
  readonly behaviours: readonly FrontBehaviour[]
  readonly tiles: readonly string[]
  /** The vocabulary Jev reads the request against. */
  readonly vocabulary: string
  readonly jev?: JevDoorLike
  readonly signal?: AbortSignal
  readonly persist?: (decision: FrontDecisionLike) => Promise<string | undefined>
  readonly emit: StageEmit
}
export type FrontOutput = {
  /** stay: no door (no Jev); without: Jev not ready or did not answer; asked: Jev answered. */
  readonly door: 'stay' | 'without' | 'asked'
  readonly aside: boolean
  readonly down: boolean
  readonly carry: boolean
  readonly weight?: JevWeight
  readonly decision?: FrontDecisionLike
  readonly receipt?: string
  readonly ms: number
  /** Say how the door's outcome went (aside, passed, ran, skipped, failed). */
  report(outcome: string): void
}
export interface FrontStep {
  readonly word: 'front'
  readonly name: string
  run(input: FrontInput): Promise<FrontOutput>
}

export type VerifyInput = {
  readonly request: string
  readonly answer: string
  /** What the hive read this turn, already fitted to the judge's room. */
  readonly evidence: readonly string[]
  readonly providerId: string
  readonly system: string
  readonly messages: readonly { readonly content: string }[]
  readonly jev?: JevDoorLike
  readonly signal?: AbortSignal
  readonly persist?: (decision: VerifyDecisionLike) => Promise<string | undefined>
  readonly emit: StageEmit
}
export type VerifyOutput = {
  readonly verified: boolean
  readonly reason: string
  readonly model: string
  readonly decision: VerifyDecisionLike
  readonly receipt?: string
  readonly ms: number
  /** What the transcript says when the answer could not be confirmed. */
  readonly note?: string
}
export interface VerifyStep {
  readonly word: 'verify'
  readonly name: string
  /** Undefined when there is nothing to check against or no judge ready. */
  run(input: VerifyInput): Promise<VerifyOutput | undefined>
}

// ── route: how the loop asks the router each round ──────────────────────

/** The shape handed to the router for one round; the router owns the pick. */
export type RouteCall = {
  readonly providerId?: string
  readonly model?: string
  readonly preferModel?: string
  readonly need: unknown
  readonly fallbackWithin?: string
  readonly avoid?: readonly string[]
  readonly effort?: string
}
export type RouteInput<N extends { readonly tier: string }> = {
  readonly round: number
  readonly need: N
  readonly pinned?: string
  readonly continuationModel?: string
  readonly namedModel?: string
  readonly preferModel?: string
  readonly fallbackWithin?: string
  readonly avoid: readonly string[]
}
export type HandoffInput<N extends { readonly tier: string }> = {
  readonly avoid: readonly string[]
  /** The provider that gave the work up. */
  readonly providerId: string
  readonly need: N
  readonly maxHandoffs: number
  readonly ready: (need: N, avoid: readonly string[]) => boolean
}
export type HandoffOutput<N> = {
  readonly avoid: string[]
  readonly need: N
  /** Another model can take it; false ends the turn with a word. */
  readonly another: boolean
}
export interface RouteStep {
  readonly word: 'route'
  readonly name: string
  call<N extends { readonly tier: string }>(input: RouteInput<N>): RouteCall
  handoff<N extends { readonly tier: string }>(input: HandoffInput<N>): HandoffOutput<N>
  /** After a round: the provider that answered is the one that continues. */
  pin(input: { readonly pinned?: string; readonly providerId: string; readonly model: string }): { readonly pinned: string; readonly continuationModel: string }
}

// ── stretch: one streamed round ─────────────────────────────────────────

export type StretchChunk = {
  readonly providerId: string
  readonly model: string
  readonly providerLabel?: string
  readonly vendor?: string
  readonly text?: string
}
export type StretchInput = {
  readonly stream: AsyncIterable<StretchChunk>
  /** The provider the work is pinned to; another answering is an error. */
  readonly pinned?: string
  /** The model the round is expected to continue on. */
  readonly model?: string
  /** What goes before the first visible text ('' or a paragraph break). */
  readonly lead: string
  /** Hold the prose back (a judge sees it first); the text still accrues. */
  readonly silent: boolean
  readonly onProvider?: (chunk: StretchChunk, first: boolean) => void
  readonly signal?: AbortSignal
}
export type StretchOutput = {
  readonly providerId: string
  readonly model: string
  readonly label: string
  readonly vendor?: string
  readonly roundText: string
  /** Visible text was yielded this round. */
  readonly wrote: boolean
  readonly work: SplitWork
}
export interface StretchStep {
  readonly word: 'stretch'
  readonly name: string
  /** Yields the visible text as it streams; returns the round. */
  run(input: StretchInput): AsyncGenerator<string, StretchOutput, void>
}

// ── the registry ────────────────────────────────────────────────────────

export type AgentStepOf = {
  readonly front: FrontStep
  readonly route: RouteStep
  readonly stretch: StretchStep
  readonly fold: FoldStep
  readonly handover: HandoverStep
  readonly verify: VerifyStep
  readonly receipt: ReceiptStep
}
export type ImplementedStepWord = keyof AgentStepOf

export type AgentStepListing = {
  readonly word: ImplementedStepWord
  readonly name: string
  /** The bee's signature, when it arrived as content; absent = shipped. */
  readonly sig?: string
}

export interface AgentStepRegistry {
  /** Offer an implementation of a word; a signature names the bee it came
   *  from so a harness can pick it. Shipped ones carry no signature. */
  register<W extends ImplementedStepWord>(step: AgentStepOf[W], sig?: string): void
  /** The implementation for a word: the first of `prefer` (a harness's
   *  `steps`) that is registered under this word, else the shipped one. */
  resolve<W extends ImplementedStepWord>(word: W, prefer?: readonly string[]): AgentStepOf[W] | undefined
  list(): AgentStepListing[]
}
