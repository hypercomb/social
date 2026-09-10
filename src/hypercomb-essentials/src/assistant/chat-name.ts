// assistant/chat-name.ts
//
// WHAT TO CALL A CONVERSATION — inferred once, at the first reply.
//
// A thread used to be named by its opening line, which is the truest thing
// available for free and the worst possible label: the first thing you say is
// what you did not know yet. "hmm this is weird" names nothing, and a rail of
// forty of them is a list you cannot scan.
//
// So a conversation is named in TWO STAGES, and neither of them is the
// opening line:
//
//   1. SENT, NOTHING BACK. The thread exists, it lists, you can walk into it
//      — and it has no subject yet, only a question in flight. Surfaces say
//      exactly that ("waiting for reply…", from `ConversationSummary.replied`
//      in chat-thread.ts). Nothing is written and no model is called.
//   2. THE FIRST REPLY LANDS. Now there is an exchange, which is the smallest
//      thing that can have a subject — so the name is inferred from it and
//      written to the thread's own bucket (`setConversationName`).
//
// ── WHY THE BUCKET, NOT A DERIVED POOL ───────────────────────────────
//
// The blurb (chat-blurb.ts) is a derived cache: recomputable, wipe-safe, keyed
// by nothing that matters, and every read path must work without it. A NAME is
// not that. It is what the thread is CALLED — it appears in the rail, in the
// window's own bar, in a shared link — and a name that changed every time a
// cache was cleared would be a conversation that keeps being renamed behind
// your back. So it is written beside the archive flag and the goal receipt, as
// a fact about the thread, and every walk that already reads the bucket gets
// it for free: no second pool, no second read, nothing to keep in step.
//
// ── ONCE, NOT CONTINUOUSLY ───────────────────────────────────────────
//
// Named threads are never re-named. A conversation that wandered somewhere
// else over two hours is what the BLURB is for — that is the moving line
// under the row. The name is the handle you learned to recognise it by, and a
// handle that drifts is not a handle. One call per conversation, ever.
//
// Silent on every failure by design: this runs unattended, and a hive with no
// provider configured must not produce a stream of errors about a convenience
// nobody asked for out loud. No provider simply means the thread keeps being
// named by its opening line, which is where it started.

import {
  listConversations, readConversationName, readTurns, setConversationName,
  type ChatTurn, type ConversationSummary,
} from './chat-thread.js'
import { activeProviders, callModel } from './llm-dispatch.js'

/** What a name may be. Long enough to say a subject, short enough that a rail
 *  row shows all of it rather than an ellipsis. */
const MAX_WORDS = 6
const MAX_CHARS = 48

/** How much of the exchange the model reads. The first question and the first
 *  answer ARE the subject; everything after is what the blurb is for. */
const NAME_TURNS = 2
const CHARS_PER_TURN = 700

const SYSTEM = [
  'You are naming a saved conversation so a person can recognise it in a list.',
  '',
  `Reply with the name and nothing else: at most ${MAX_WORDS} words, no quotes,`,
  'no trailing period, no preamble, not a sentence.',
  '',
  'Name the SUBJECT, not the act. "Hexagon shader seams" is a name;',
  '"User asks about a rendering problem" is not.',
].join('\n')

/** One line of model output → a name a row can wear. Lenient: a model that
 *  answered in a sentence should still leave something usable. */
export const cleanName = (text: string): string => {
  const first = String(text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
  const clean = first
    .replace(/^["'`*#\s-]+|["'`*\s]+$/g, '')
    .replace(/[.:;,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return ''
  const words = clean.split(' ').slice(0, MAX_WORDS).join(' ')
  return words.length > MAX_CHARS ? words.slice(0, MAX_CHARS - 1).trimEnd() + '…' : words
}

/** The exchange as the model reads it — the opening question and what came
 *  back, each clipped, so a long first answer costs the same as a short one. */
const exchangeOf = (turns: readonly ChatTurn[]): string =>
  turns.slice(0, NAME_TURNS).map(turn => {
    const body = turn.text.trim().replace(/\s+/g, ' ')
    return `${turn.role}: ${body.length > CHARS_PER_TURN
      ? body.slice(0, CHARS_PER_TURN - 1) + '…'
      : body}`
  }).join('\n')

/**
 * Name one conversation from its first exchange, and write the name down.
 * Returns the name, or '' when there was nothing to name it from, nothing to
 * name it with, or the write failed.
 *
 * Refuses on a thread that has not been answered yet: before the first reply
 * there is no subject to name, only a question in flight — and the surfaces
 * already say so. Refuses on a thread that already HAS a name, whether this
 * page gave it one or a previous one did — the pool is the memory, and
 * without that check merely opening an old thread would rename it.
 */
export const nameConversation = async (convoId: string): Promise<string> => {
  const id = String(convoId ?? '').trim()
  if (!id) return ''

  // NOTHING TO NAME IT WITH. Checked before the dispatch, which throws when no
  // vendor is set up — an expected state, not an error worth raising.
  if (!activeProviders().length) return ''

  // ALREADY NAMED IS DONE. One file read, and the cheapest of the three
  // guards, so it goes first.
  if (await readConversationName(id)) return ''

  const turns = await readTurns(id)
  if (!turns.some(turn => turn.role === 'assistant')) return ''

  try {
    const result = await callModel({
      need: { tier: 'fast' },
      system: SYSTEM,
      cacheSystem: true,
      messages: [{ role: 'user', content: exchangeOf(turns) }],
      maxTokens: 40,
    })
    const name = cleanName(result.text ?? '')
    if (!name) return ''
    // The write announces itself (`chat:threads-changed`) — every surface
    // listing this thread repaints from the pool, not from here.
    return await setConversationName(id, name) ? name : ''
  } catch { return '' }
}

/**
 * CATCH-UP. Name the threads that were answered while nobody was listening —
 * a reply that landed with the page closed, a hive opened on another device,
 * a provider configured after the fact.
 *
 * Bounded per pass for the same reason the blurb drain is: this competes with
 * the hive for one main thread, so it takes a few and comes back. Oldest
 * first, so the thread that has gone longest without a name gets one.
 *
 * A conversation is a candidate when it has been answered and is still wearing
 * its opening line. Both facts come out of the same walk the list already
 * takes (`replied`, `named`), so finding the candidates costs nothing beyond
 * listing — and an archived thread is skipped, because a conversation you have
 * put away is one you have stopped needing to recognise.
 */
export const drainNames = async (limit = 2): Promise<number> => {
  if (!activeProviders().length) return 0

  let conversations: ConversationSummary[] = []
  try { conversations = await listConversations() } catch { return 0 }

  const candidates = conversations
    .filter(convo => !convo.archived && convo.replied && !convo.named)
    .sort((a, b) => a.lastAt - b.lastAt)
    .slice(0, limit)

  let named = 0
  for (const convo of candidates) if (await nameConversation(convo.convoId)) named++
  return named
}
