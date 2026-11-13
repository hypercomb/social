// hypercomb-grammar.ts
//
// THE MODEL SPEAKS HYPERCOMB — and the parser, the plan's reach and the
// executor's lane live in CORE now (core/machine-plan.ts, moved 2026-11-11 so
// a chat that is not Angular runs the same lines). This file is the door the
// chat window and its specs still knock on: it re-exports core's, and keeps
// the two decisions that are the window's own.

import {
  callableBehaviours as coreCallableBehaviours,
  currentMachineGrant,
  hypercombLinesBeyondPages as coreLinesBeyondPages,
  hypercombPlanLeaves as corePlanLeaves,
  hypercombPlanReach as corePlanReach,
  hypercombVocabulary as coreVocabulary,
  hypercombWriteRefusal as coreWriteRefusal,
  parseHypercombGrammars as coreParseGrammars,
  type CensusEntry,
  type HypercombActionPlan,
  type HypercombBehaviour,
  type MachineGrant,
  type MachineReach,
} from '@hypercomb/core'
import { chatMachineGrant } from '../../core/managed-page'

export {
  HypercombPlanQueue, HypercombGrammarError, HypercombActionExecutionError, executeHypercombPlan,
} from '@hypercomb/core'
export type {
  HypercombMachineGrammar, HypercombBehaviour, HypercombToolCall, HypercombFunctionTool, HypercombAction, HypercombActionPlan, HypercombActionReceipt, HypercombBehaviourExecutor,
} from '@hypercomb/core'

// THE GRANT THIS CHAT WORKS UNDER (core/managed-page.ts). Core's gate reads
// the participant's grant when no grant is handed in; the chat hands in the
// page's — on a managed site door the owner's full grant, everywhere else the
// participant's own, read live at every call exactly as core's default does.
// One switch, at the door every line, write and lesson passes through.
const grant = (): MachineGrant => chatMachineGrant(currentMachineGrant)

export const callableBehaviours = <T extends CensusEntry>(entries: readonly T[], given: MachineGrant = grant()): readonly T[] =>
  coreCallableBehaviours(entries, given)
export const hypercombVocabulary = (entries: readonly HypercombBehaviour[], given: MachineGrant = grant()): string =>
  coreVocabulary(entries, given)
export const hypercombPlanReach = (plan: HypercombActionPlan, entries: readonly HypercombBehaviour[], given: MachineGrant = grant()): MachineReach =>
  corePlanReach(plan, entries, given)
export const hypercombPlanLeaves = (plan: HypercombActionPlan, entries: readonly HypercombBehaviour[], given: MachineGrant = grant()): readonly string[] =>
  corePlanLeaves(plan, entries, given)
export const hypercombWriteRefusal = (given: MachineGrant = grant()): string | undefined =>
  coreWriteRefusal(given)
export const hypercombLinesBeyondPages = (plan: HypercombActionPlan, entries: readonly HypercombBehaviour[], lines: readonly string[], given: MachineGrant = grant()): readonly string[] =>
  coreLinesBeyondPages(plan, entries, lines, given)
export const parseHypercombGrammars = (grammars: readonly unknown[], entries: readonly HypercombBehaviour[], given: MachineGrant = grant()): HypercombActionPlan =>
  coreParseGrammars(grammars, entries, given)

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

