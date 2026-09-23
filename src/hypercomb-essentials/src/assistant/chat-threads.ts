// assistant/chat-threads.ts
//
// THE CHAT'S SEAM TO THE SHELL — what the chat window resolves by key
// (`@diamondcoreprocessor.com/ChatThreads`) and the standings every list
// reads. It lived at the foot of chat-thread.ts, which made chat-thread import
// the route and the route import chat-thread: an import cycle that one
// bundle forgave and separately loaded atoms cannot (atomic-modules-plan.md).
// Here it sits above all three and closes no circle. The chat bee
// (chat.drone.ts) registers it.

import {
  appendTurn, listTileConversations, foldTileConversations, newTileConvoId,
  markConversationSeen, tileConvoId, tilePath, tilePathOf, listTileDrafts,
  readTileDraft, saveTileDraft, saveStreamCheckpoint, listStreamCheckpoints,
  recoverStreamCheckpoints, readTurns, deliverTurn, listConversations,
  listConversationsWithLatest, deleteConversation, setConversationArchived,
  setConversationGoalReached, newConvoId, isHumanConversation,
} from './chat-thread.js'
import {
  assimilateRouteSelection, flowOpenSteps, organizeRoute, readRoute, readRouteFlow,
  type Route, type RouteSelectionAssimilationResult,
} from './chat-route.js'
import { runIdForAsk } from './chat-steps.js'

// ── IoC surface ─────────────────────────────────────────
//
// The chat window is shell UI (hypercomb-shared), which may never import a
// module — the dependency runs the other way. So the module publishes these
// functions and the window resolves them at call time, which is the sanctioned
// way for a shell to consume a module.

/** What a conversation's organized workflow says, as a list reads it. */
export interface ConversationStanding {
  readonly name: string
  readonly stands: string
  /** Steps still open once rolled up (flowOpenSteps). */
  readonly open: number
  readonly total: number
  /** How far the flow read — fewer than the conversation's turns means newer talk. */
  readonly upTo: number
}

/** Who a conversation waits on, as every list groups it. */
export type ConversationGroup = 'waiting' | 'open' | 'done'

/** Each conversation's standing, read from its stored flow: a pool read each
 *  and no model call. A conversation nothing has organized is simply absent. */
export const readConversationStandings = async (convoIds: readonly string[]): Promise<Map<string, ConversationStanding>> => {
  const records = await Promise.all(convoIds.map(async id => [id, await readRouteFlow(id)] as const))
  const out = new Map<string, ConversationStanding>()
  for (const [id, record] of records) {
    if (!record?.nodes.length) continue
    out.set(id, {
      name: record.session?.name ?? '',
      stands: record.session?.stands ?? '',
      open: flowOpenSteps(record),
      total: record.nodes.length,
      upTo: record.upToTurnCount,
    })
  }
  return out
}

/** WHO IT WAITS ON: you, when its newest reply asked a question; nobody, when
 *  every organized step is settled and nothing newer came in; otherwise open. */
export const conversationGroup = (
  chat: { readonly asking?: boolean; readonly replied: boolean; readonly turns: number },
  standing: ConversationStanding | undefined,
): ConversationGroup => {
  if (chat.asking) return 'waiting'
  if (chat.replied && standing && standing.total > 0 && standing.open === 0 && standing.upTo >= chat.turns) return 'done'
  return 'open'
}

export class ChatThreads {
  readonly appendTurn = appendTurn
  readonly listTileConversations = listTileConversations
  readonly foldTileConversations = foldTileConversations
  readonly newTileConvoId = newTileConvoId
  readonly markConversationSeen = markConversationSeen
  readonly tileConvoId = tileConvoId
  readonly tilePath = tilePath
  readonly tilePathOf = tilePathOf
  readonly listTileDrafts = listTileDrafts
  readonly readTileDraft = readTileDraft
  readonly saveTileDraft = saveTileDraft
  readonly saveStreamCheckpoint = saveStreamCheckpoint
  readonly listStreamCheckpoints = listStreamCheckpoints
  readonly recoverStreamCheckpoints = recoverStreamCheckpoints
  readonly readTurns = readTurns
  readonly deliverTurn = deliverTurn
  readonly listConversations = listConversations
  readonly listConversationsWithLatest = listConversationsWithLatest
  readonly deleteConversation = deleteConversation
  readonly setConversationArchived = setConversationArchived
  readonly setConversationGoalReached = setConversationGoalReached
  readonly newConvoId = newConvoId
  readonly isHumanConversation = isHumanConversation

  /** The conversation's ROUTE — its runs laid along its turns, read from the
   *  records (chat-route.ts). A METHOD, not a field like its siblings: this
   *  surface once lived in chat-thread.ts, inside the import cycle
   *  chat-thread → chat-route → chat-steps → chat-thread, where a field
   *  initialiser could dereference a binding still in its temporal dead
   *  zone. The surface is its own atom now and the cycle is gone; a method
   *  still reads the binding at call time, which costs nothing. The shell
   *  feature-detects it (`readRoute?.`): a web build whose essentials lag
   *  the shell simply has no route. */
  readRoute(convoId: string, liveRunId?: string): Promise<Route> {
    return readRoute(convoId, liveRunId)
  }

  /** The run an outstanding ask is making — the `liveRunId` `readRoute`
   *  takes. Without it the shell has the ask sig in hand and no way to name
   *  the live run, so the route could only ever place it by time. Derived by
   *  chat-steps (`runIdForAsk`), the same rule the renderer files the run
   *  under, never re-spelled here. A METHOD for the same reason `readRoute`
   *  is one: a field would dereference the chat-steps binding while the
   *  import cycle is still evaluating. Feature-detected by the shell
   *  (`runIdForAsk?.`). */
  runIdForAsk(askSig: string): Promise<string> {
    return runIdForAsk(askSig)
  }

  /** Organize the conversation's WORKFLOW with the participant's own
   *  machine-local model — its structure when a closed exchange lies beyond
   *  the flow, then a card per node — only when that model is already known
   *  awake, never a probe (chat-route.ts, `organizeRoute`). `liveRunId` and
   *  `waiting` are the shell's own knowledge of what is outstanding; `prefer`
   *  names the node the participant is looking at, whose card is written
   *  first. REFUSED — resolving 0 with nothing read, called or emitted — while
   *  `waiting`, or for 30 s after the participant's own local chat, so it can
   *  never re-trigger itself through a refresh hint. Resolves 1 when a flow
   *  was written and announced as `chat:route-flow-changed { convoId }`, else
   *  0. Shares one pinned lane and guard with the orchestrator's passive
   *  drain, whichever module copy holds this class. A METHOD for the same
   *  import-cycle reason as `readRoute`; feature-detected by the shell
   *  (`organizeRoute?.`). */
  readConversationStandings(convoIds: readonly string[]): Promise<Map<string, ConversationStanding>> {
    return readConversationStandings(convoIds)
  }

  conversationGroup(
    chat: { readonly asking?: boolean; readonly replied: boolean; readonly turns: number },
    standing?: ConversationStanding,
  ): ConversationGroup {
    return conversationGroup(chat, standing)
  }

  organizeRoute(convoId: string, liveRunId?: string, waiting?: boolean, prefer?: string): Promise<number> {
    return organizeRoute(convoId, liveRunId, waiting, prefer)
  }

  /** Summarize a selected transcript range, then merge it into the workflow's
   *  participant-curated comments without duplicating what is already there. */
  assimilateRouteSelection(
    convoId: string,
    selectedText: string,
    focusNodeId?: string,
  ): Promise<RouteSelectionAssimilationResult> {
    return assimilateRouteSelection(convoId, selectedText, focusNodeId)
  }
}

export const CHAT_THREADS_IOC_KEY = '@diamondcoreprocessor.com/ChatThreads'
