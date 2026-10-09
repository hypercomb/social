// hypercomb-grammar.ts
//
// THE CANONICAL GRAMMAR LIVES IN CORE (core/hive-grammar.ts, its catalogue in
// core/machine-census.ts) — re-exported here for the window and the specs
// that grew up on this module.

export {
  callableBehaviours,
  hypercombActionProviderId,
  hypercombContextKey,
  HypercombPlanQueue,
  HypercombGrammarError,
  HypercombActionExecutionError,
  hypercombVocabulary,
  hypercombPlanReach,
  hypercombPlanLeaves,
  hypercombWriteRefusal,
  hypercombLinesBeyondPages,
  parseHypercombGrammars,
  executeHypercombPlan,
} from '@hypercomb/core'
export type {
  HypercombMachineGrammar,
  HypercombBehaviour,
  HypercombToolCall,
  HypercombFunctionTool,
  HypercombAction,
  HypercombActionPlan,
  HypercombActionReceipt,
  HypercombBehaviourExecutor,
} from '@hypercomb/core'
