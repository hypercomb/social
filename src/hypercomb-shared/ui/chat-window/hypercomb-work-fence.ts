// hypercomb-work-fence.ts
//
// THE LOOP'S WORDS LIVE IN CORE (core/work-words.ts, with the fence
// primitives in core/work-fence.ts and the leg's in core/agent-leg.ts) —
// re-exported here for the window and the specs that grew up on this module.

export {
  READ_FENCE_LANG, DO_FENCE_LANG, TABLE_FENCE_LANG, WRITE_FENCE_LANG, HANDOFF_FENCE_LANG, MAX_HANDOFFS,
  workLineGrammar, splitWork, WorkStreamGuard,
  CONTINUE_FENCE_LANG, LEG_ROUNDS, WORK_BUDGET, WORK_BUDGET_ROUNDS_KEY, WORK_BUDGET_TOKENS_KEY,
  workBudget, estimateTokens, foldWorkLedger, lastRoundMessage, leftFromProse, continueMessage, budgetSpentMessage,
} from '@hypercomb/core'
export type { WorkKind, WorkRequest, SplitWork, WorkBudget } from '@hypercomb/core'
export {
  MAX_WORK_ROUNDS,
  writeHeaderOf,
  parseWriteBlock,
  WorkRefused,
  isWorkRefusal,
  identityInstruction,
  workInstruction,
  CONTINUE_INSTRUCTION,
  HANDOFF_INSTRUCTION,
  readResultMessage,
  readSkippedMessage,
  doRanMessage,
  doSkippedMessage,
  doFailedMessage,
  blockRefusedMessage,
  blockUnwrittenMessage,
  writeRanMessage,
  writeSkippedMessage,
  doctrineRanMessage,
  doctrineFailedMessage,
  writeFailedMessage,
  JevGone,
  HELD_DO_NOTE,
  transcriptForModel,
} from '@hypercomb/core'
export type {
  WriteRequest,
  DoctrineWriteRequest,
  WorkPowers,
} from '@hypercomb/core'
