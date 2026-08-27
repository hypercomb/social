// diamondcoreprocessor.com/presentation/avatars/resting-bees.ts
//
// WHICH TILES KEEP A BEE WHEN NOTHING IS RUNNING.
//
// A bee used to mean "work is happening here, now", which left the hive blank
// the moment an answer landed — and a tile you have held six conversations on
// looked exactly like one nobody has ever spoken to. So a tile holding
// UNARCHIVED conversations keeps a bee whether or not a question is out.
//
// ONE PER TILE, not one per conversation: six threads over one hexagon is a
// cloud, and the rail's own count already says six. The one bee is branded by
// the model that tile's NEWEST thread was last held in.
//
// THE ID IS THE CHAT WINDOW'S ID. `chat:<convoId>` is exactly what
// chat-window raises on `agent:start` when a question goes out, so the
// resting bee and the working bee are the SAME sprite — sending a question
// wakes this one into the full dance instead of fading it out and flying a
// new one in. That is also why this never goes near the work registry: the
// orchestrator sweeps that for stalls, and a resting bee sitting there as
// `working` would be reported silent after four minutes and rogue after
// forty-five, a watchdog barking at furniture.
//
// Pure, and in its own file, because the drone that uses it imports Pixi at
// module scope — this is the half worth pinning, and it can be pinned without
// a renderer.

import type { Agent } from '../../assistant/agent-registry.service.js'
import { identifyModel } from './agent-model.js'

/** The slice of a conversation this derivation reads. Structural on purpose:
 *  it is satisfied by chat-thread's TileConversation and by a test's literal. */
export type RestingSource = {
  readonly path: string
  readonly convoId: string
  readonly title: string
  readonly lastAt: number
  readonly archived: boolean
}

/** The hive's own address — a conversation about no tile. Spelled here rather
 *  than imported so this stays free of the threads module. */
const HIVE = '/'

/** When a thread has no remembered tier. The composer's own default. */
const FALLBACK_MODEL = 'opus'

/**
 * One resting agent per talked-to tile, keyed by `chat:<convoId>`.
 *
 * ARCHIVED THREADS DO NOT COUNT. Put away is not "talked to", and the rail's
 * count excludes them too — a tile wearing a bee for a conversation that is
 * not in its fold would be pointing at something you cannot get to.
 *
 * A tile whose every thread is archived therefore has NO resting bee, which
 * is the whole way a bee goes away again.
 */
export const restingBees = (
  chats: readonly RestingSource[],
  modelOf: (convoId: string) => string,
): Map<string, Agent> => {
  const newest = new Map<string, RestingSource>()
  for (const chat of chats) {
    if (chat.archived) continue
    const held = newest.get(chat.path)
    if (!held || chat.lastAt > held.lastAt) newest.set(chat.path, chat)
  }

  const out = new Map<string, Agent>()
  for (const [path, chat] of newest) {
    const parts = path.split('/').filter(Boolean)
    const model = modelOf(chat.convoId) || FALLBACK_MODEL
    const { vendor, tier } = identifyModel(model)
    const id = `chat:${chat.convoId}`
    out.set(id, {
      id,
      behavior: model,
      kind: 'model',
      model, vendor, tier,
      request: chat.title,
      // The tile it is about. The hive's OWN conversation has no tile, and no
      // targets is exactly how the bee drone's #anchorFor spells hive-wide.
      targets: path === HIVE || !parts.length ? [] : [parts[parts.length - 1]!],
      segments: parts.slice(0, -1),
      status: 'working',
      activity: [],
      context: [],
      origin: 'local',
      startedAt: chat.lastAt,
      updatedAt: chat.lastAt,
    } as Agent)
  }
  return out
}

/**
 * The conversation behind a resting bee's id, or `''` for an id that is not
 * one. The inverse of the `chat:<convoId>` key minted above, spelled here so
 * the press that opens the talk can never drift from the key that names it.
 */
export const restingConvoId = (id: string): string =>
  id.startsWith('chat:') ? id.slice('chat:'.length) : ''
