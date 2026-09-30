// core/agent-effects.ts
//
// THE AGENT LOOP ANNOUNCES ITS STAGES (documentation/agent-harness.md, step
// 2). Seven effects, one per stage of a turn, each carrying FACTS — never a
// rendering — so a surface (the meter beside the availability line, the bee
// panel, the route, a community's own panel) reads what the loop did and
// paints it, and nothing imports the loop. Late subscribers get the last
// value (EffectBus replay), so a panel opened mid-turn still knows where the
// work stands.
//
// The contract lives in core because both sides need it and neither may
// import the other: the chat window (shared) emits, essentials' surfaces
// listen, and a step bee (step 3) will emit from wherever it runs.

export const AGENT_FRONT = 'agent:front'
export const AGENT_ROUTE = 'agent:route'
export const AGENT_ROUND = 'agent:round'
export const AGENT_FOLD = 'agent:fold'
export const AGENT_HANDOVER = 'agent:handover'
export const AGENT_VERIFY = 'agent:verify'
export const AGENT_RECEIPT = 'agent:receipt'

export const AGENT_STAGES = Object.freeze([
  AGENT_FRONT, AGENT_ROUTE, AGENT_ROUND, AGENT_FOLD, AGENT_HANDOVER, AGENT_VERIFY, AGENT_RECEIPT,
] as const)

export type AgentStageEffect = typeof AGENT_STAGES[number]

/** What one request has spent so far — rounds and tokens, from the
 *  providers' own usage reports where they give them. */
export type AgentSpent = { readonly rounds: number; readonly tokens: number }

/** Every stage event says which bee (the panel's id), which conversation,
 *  which leg of the request, and when. */
export type AgentStageBase = {
  readonly id: string
  readonly convoId: string
  readonly leg: number
  readonly at: number
  /** The harness record the turn ran under, by signature — what makes a
   *  receipt an eval (documentation/agent-harness.md §7). */
  readonly harness?: string
}

/** The front door: Jev read the request and either answered it, weighed the
 *  tier, or stepped aside. */
export type AgentFrontEvent = AgentStageBase & {
  readonly path: 'direct' | 'judged' | 'aside' | 'down' | 'off'
  readonly tier: string
  readonly answered: boolean
}

/** A provider took a round. */
export type AgentRouteEvent = AgentStageBase & {
  readonly round: number
  readonly providerId: string
  readonly model: string
  readonly tier: string
  readonly handoffs: number
}

/** A round of the model came back, and what it asked for. */
export type AgentRoundEvent = AgentStageBase & {
  readonly round: number
  readonly request: 'read' | 'do' | 'write' | 'table' | 'none'
  readonly handoff: boolean
  readonly spent: AgentSpent
}

/** Older rounds folded into the progress ledger to make room. */
export type AgentFoldEvent = AgentStageBase & {
  readonly round: number
  readonly folded: number
  readonly kept: number
}

/** The leg ended with work left; the next leg starts from `left` — now, or
 *  when the participant says continue if the budget is spent. */
export type AgentHandoverEvent = AgentStageBase & {
  readonly round: number
  readonly left: string
  readonly budgetSpent: boolean
  readonly spent: AgentSpent
}

/** Jev checked the answer against what was read. */
export type AgentVerifyEvent = AgentStageBase & {
  readonly verified: boolean
  readonly reason?: string
  readonly model?: string
}

/** The turn's receipt: how it went and what it cost. Always emitted, whether
 *  the turn answered, failed or was stopped. */
export type AgentReceiptEvent = AgentStageBase & {
  readonly path: string
  readonly rounds: number
  readonly weight: string
  readonly ms: number
  readonly firstMs?: number
  readonly outcome: 'answered' | 'failed' | 'stopped'
  readonly spent: AgentSpent
}
