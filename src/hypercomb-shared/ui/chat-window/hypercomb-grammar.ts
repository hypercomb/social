// hypercomb-grammar.ts
//
// THE MODEL SPEAKS HYPERCOMB — and the parser, the plan's reach and the
// executor's lane live in CORE now (core/machine-plan.ts, moved 2026-11-11 so
// a chat that is not Angular runs the same lines). This file is the door the
// chat window and its specs still knock on: it re-exports core's, and keeps
// the two decisions that are the window's own.

export {
  callableBehaviours,
  HypercombPlanQueue, HypercombGrammarError, HypercombActionExecutionError, hypercombVocabulary, hypercombPlanReach, hypercombPlanLeaves, hypercombWriteRefusal, hypercombLinesBeyondPages, parseHypercombGrammars, executeHypercombPlan,
} from '@hypercomb/core'
export type {
  HypercombMachineGrammar, HypercombBehaviour, HypercombToolCall, HypercombFunctionTool, HypercombAction, HypercombActionPlan, HypercombActionReceipt, HypercombBehaviourExecutor,
} from '@hypercomb/core'

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

