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
// Three words are on the contract today — fold, handover, receipt — the
// seams that were pure. Stretch (the streaming rounds), front (Jev's door),
// route (the provider pick) and verify (Jev's check) still run inside the
// window; they take the same door as they are lifted.

import type { AgentReceiptEvent } from './agent-effects.js'

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

// ── the registry ────────────────────────────────────────────────────────

export type AgentStepOf = {
  readonly fold: FoldStep
  readonly handover: HandoverStep
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
