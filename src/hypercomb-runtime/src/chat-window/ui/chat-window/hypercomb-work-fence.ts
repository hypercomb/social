// hypercomb-work-fence.ts
//
// THE MODEL ASKS IN WORDS (documentation/hive-read-fence.md). A model that
// needs to read the hive or change it ends its reply with ONE fenced block —
// `hypercomb-read` or `hypercomb-do` — and stops. The chat runs the block
// through the Execution window, and the result comes back to the model as the
// next message, so it can take the next step and keep working until the
// request is done.
//
// Plain text on purpose. It works for every model whatever its tool support,
// it rides through every provider unchanged, and the participant can read a
// request before anything runs. The existing parsers stay the authority: this
// module only finds the block, turns its lines into the canonical grammar
// those parsers read, and spells the messages sent back — once, here.
//
// Framework-free and pure. It names no behaviour: the vocabulary a model is
// taught is the census the caller passes in.

import { parseWriteBlock as coreParseWriteBlock, type WriteBlockOptions } from '@hypercomb/core'
import { managedPage } from '../../core/managed-page'

// THE FENCE PRIMITIVES LIVE IN CORE (core/work-fence.ts) — the langs, the
// split, the line grammar and the stream guard — re-exported here for the
// window and the specs that grew up on this module.
export {
  READ_FENCE_LANG, DO_FENCE_LANG, TABLE_FENCE_LANG, WRITE_FENCE_LANG, HANDOFF_FENCE_LANG, MAX_HANDOFFS,
  workLineGrammar, splitWork, WorkStreamGuard,
} from '@hypercomb/core'
export type { WorkKind, WorkRequest, SplitWork } from '@hypercomb/core'


// THE LEG'S PRIMITIVES LIVE IN CORE (core/agent-leg.ts): the stretch length,
// the budget, the fold, the leg-end word, the handover read from prose and
// the next leg's opening are shared with the step bees, so they are
// re-exported here for the window and the specs that grew up on this module.
export {
  CONTINUE_FENCE_LANG, LEG_ROUNDS, WORK_BUDGET, WORK_BUDGET_ROUNDS_KEY, WORK_BUDGET_TOKENS_KEY,
  workBudget, estimateTokens, foldWorkLedger, lastRoundMessage, leftFromProse, continueMessage, budgetSpentMessage,
} from '@hypercomb/core'
export type { WorkBudget } from '@hypercomb/core'

// THE LESSON AND THE MESSAGES LIVE IN CORE TOO (core/work-instruction.ts,
// moved 2026-11-11 so a chat that is not Angular teaches the same lesson) —
// re-exported here for the window and the specs that grew up on this module.
export {
  MAX_WORK_ROUNDS, tileFileLabel, writeHeaderOf, WorkRefused, isWorkRefusal, identityInstruction, workInstruction, CONTINUE_INSTRUCTION, HANDOFF_INSTRUCTION, readResultMessage, readSkippedMessage, doRanMessage, doSkippedMessage, doFailedMessage, pageChangeUnready, blockRefusedMessage, routesNamedIn, readsAskedIn, unreadClaimMessage, unreadAskedMessage, claimsUnranChange, unranChangeMessage, blockUnwrittenMessage, writeRanMessage, writeSkippedMessage, doctrineRanMessage, doctrineFailedMessage, writeFailedMessage, sandboxRule, managedRule, fileRanMessage, fileFailedMessage, JevGone, HELD_DO_NOTE, transcriptForModel,
} from '@hypercomb/core'
export type {
  WriteRequest, DoctrineWriteRequest, TileFileWriteRequest, WorkPowers, DoRollback, CardPart, ManagedSite, WriteBlockOptions,
} from '@hypercomb/core'

// WHAT A WRITE BLOCK MAY NAME ON THIS PAGE (core/managed-page.ts). A managed
// site door holds a replica of its owner's card, so there the block may also
// name the card itself — `card /<tile>` and `card /<tile> theme`. Everywhere
// else it reads exactly as core reads it. The window and the Jev round both
// knock here, so the two never disagree about what a block is.
export const parseWriteBlock = (lines: readonly string[], options: WriteBlockOptions = { card: managedPage() !== null }): ReturnType<typeof coreParseWriteBlock> =>
  coreParseWriteBlock(lines, options)
