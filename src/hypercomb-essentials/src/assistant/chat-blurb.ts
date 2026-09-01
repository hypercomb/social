// assistant/chat-blurb.ts
//
// WHAT THE CONVERSATION WAS ABOUT — one quick line and a few points, held per
// thread, so a rail of forty rows can be READ instead of guessed at.
//
// A thread names itself by its first message (`titleOfRaw`, chat-thread.ts),
// which is the truest thing available for free and often the worst possible
// label: the opening line of a conversation is what you did not know yet. A
// row reading "hmm this is weird" says nothing about the two hours after it.
// The blurb is the OTHER end of the thread, said briefly.
//
// ── STICKY, NOT ON THE FLY ────────────────────────────────────────────
//
// Deriving on open would be a model call per row per open, for threads that
// are FINISHED and can never say anything new — and it would be missing
// exactly when it matters most: cold, offline, or with no provider set up. A
// summary you can only see while a model is reachable is a tooltip, not a
// summary. So it is written down.
//
// ── ONE SLOT PER CONVERSATION, RECYCLED ───────────────────────────────
//
// The instinct from signature doctrine is to key the record by the hash of
// what it summarises. That is right for a BRANCH (context-summary-gen.ts does
// exactly that) and wrong for a CONVERSATION, because a conversation GROWS:
// every new turn is a new key, so a forty-turn thread leaves thirty-nine
// orphaned blurbs behind it and the pool fills with superseded guesses about
// the same chat. That — not the byte count — is how this gets messy.
//
// So the slot is keyed by the CONVERSATION and recycled in place:
// `putPoolDoc(pool, bytes, convoId)` writes the new member and drops every
// other one, so a thread holds exactly ONE blurb however many times it is
// re-derived. Nothing accumulates. The record carries how far it read
// (`upToTurnCount`), which is what makes "is this behind?" answerable without
// re-reading the thread.
//
// ── VERSIONED, BECAUSE KEYED-BY-INPUT IS NOT SELF-INVALIDATING ────────
//
// The turns do not change; the function reading them does. Change the prompt,
// the tier, or what a good blurb looks like, and every stored blurb is the OLD
// answer with nothing to say so. `BLURB_VERSION` is the second half of the
// key: a record stamped with a different one reads as ABSENT, so the drain
// re-derives it. Bump it whenever this file changes what it would produce.
//
// ── NEVER LOAD-BEARING ────────────────────────────────────────────────
//
// No read path may require a blurb. The rail renders a row from its title
// alone today and must keep doing so; a blurb missing, stale, or wiped costs
// one line of legibility and nothing else. That is what makes the pool
// disposable — every byte of it can be deleted at any moment and no truth is
// lost — which is the only honest answer to "won't this pile up?".

import { EffectBus } from '@hypercomb/core'
import { listConversations, readTurns, type ChatTurn, type ConversationSummary } from './chat-thread.js'
import { activeProviders, callModel } from './llm-dispatch.js'

/** Pool of meaning holding blurbs. The colon is MANDATORY, not decoration:
 *  pools and lineage sigbags share one flat OPFS root namespace, and a
 *  bare-word meaning hashes to the same address as a same-named root tile.
 *  `lineageKey` folds every non-letter/number to `-`, so a location can never
 *  produce this string. */
export const CHAT_BLURB_POOL = 'chat:blurbs'

/** THE SECOND HALF OF THE KEY — see the header. Bump on any change to the
 *  prompt, the parse, or the tier this file asks for. */
export const BLURB_VERSION = 1

/** How far a blurb may fall behind its thread before it is worth re-deriving.
 *  Every turn would mean a model call per message, which is a chat window that
 *  bills you for scrolling; a few turns is where a conversation has usually
 *  actually moved. */
const RESUMMARIZE_AFTER = 6

/** A thread with a turn newer than this is still in flight. Summarising
 *  mid-conversation buys a blurb that is stale before it lands. */
const IDLE_MS = 90_000

/** Turns are sent lead-first and tail-last: the opening says what was ASKED,
 *  the end says where it GOT TO, and the middle is the part a blurb is meant
 *  to spare you. Bounded on purpose — a long thread must not cost more than a
 *  short one. */
const LEAD_TURNS = 2
const TAIL_TURNS = 8
const CHARS_PER_TURN = 600

/** What the list shows, so what the model is asked for. */
const MAX_LINE = 90
const MAX_POINTS = 4

/** One conversation, said briefly. Derived, recyclable, never truth. */
export interface ChatBlurb {
  readonly kind: 'chat:blurb'
  readonly convoId: string
  /** The quick line — what this conversation was about. */
  readonly line: string
  /** Concrete things decided, asked, built, or left open. May be empty. */
  readonly points: readonly string[]
  /** The derivation this was produced by. Mismatch reads as absent. */
  readonly v: number
  /** How many turns the blurb has read — how "behind" is measured. */
  readonly upToTurnCount: number
  /** The newest turn it read, so a blurb can be placed in the thread's time. */
  readonly upToAt: number
  readonly at: number
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
}

const blurbPool = async (): Promise<{ store: StoreLike; pool: FileSystemDirectoryHandle } | null> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(CHAT_BLURB_POOL)
  return pool && store ? { store, pool } : null
}

/** The blurb held for one conversation, or null when there is none — which a
 *  WRONG-VERSION record also counts as, so a changed derivation reads as
 *  missing rather than as an answer nobody would produce today. */
export const readBlurb = async (convoId: string): Promise<ChatBlurb | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null
  try {
    const held = await blurbPool()
    const bytes = await held?.store.getPoolDoc?.(held.pool, id)
    if (!bytes) return null
    const record = JSON.parse(new TextDecoder().decode(bytes)) as ChatBlurb
    if (record?.kind !== 'chat:blurb' || record.v !== BLURB_VERSION) return null
    return record
  } catch { return null }
}

/** Blurbs for a set of conversations, by convoId. Absent ones are simply not
 *  in the map — the caller renders those rows exactly as it did before. */
export const readBlurbs = async (
  convoIds: readonly string[],
): Promise<Map<string, ChatBlurb>> => {
  const out = new Map<string, ChatBlurb>()
  await Promise.all(convoIds.map(async id => {
    const blurb = await readBlurb(id)
    if (blurb) out.set(id, blurb)
  }))
  return out
}

/** Recycle the slot: write this blurb as the conversation's ONE member and
 *  drop whatever was there. Returns true once the bytes are on disk. */
const putBlurb = async (blurb: ChatBlurb): Promise<boolean> => {
  try {
    const held = await blurbPool()
    if (!held?.store.putPoolDoc) return false
    const bytes = new TextEncoder().encode(JSON.stringify(blurb)).buffer as ArrayBuffer
    // subKey = the conversation, so putPoolDoc's own "exactly one current
    // member" rule IS the recycling. No sweep, no GC pass, nothing to forget.
    return !!(await held.store.putPoolDoc(held.pool, bytes, blurb.convoId))
  } catch { return false }
}

/** Is this thread's blurb missing or far enough behind to be worth a call?
 *  Exported because the drain is not the only thing that may want to ask. */
export const blurbIsBehind = (blurb: ChatBlurb | null, turnCount: number): boolean =>
  !blurb || turnCount - blurb.upToTurnCount >= RESUMMARIZE_AFTER

const SYSTEM = [
  'You are labelling a saved conversation so a person can find it again in a list.',
  '',
  'Reply with a single line of at most twelve words saying what the conversation',
  'was about. No preamble, no quotes, no trailing period.',
  '',
  'Then up to four lines, each beginning "- ", naming one CONCRETE thing that was',
  'decided, asked, built, or left open.',
  '',
  'Name specifics. "Discussed various topics" is a failure. If the conversation is',
  'too short to have a subject, reply with the line only.',
].join('\n')

/** The thread as the model reads it: the opening, the end, and a marker where
 *  the middle was cut, so it never mistakes a truncation for a short chat. */
const transcriptOf = (turns: readonly ChatTurn[]): string => {
  const clip = (turn: ChatTurn): string => {
    const body = turn.text.trim().replace(/\s+/g, ' ')
    const text = body.length > CHARS_PER_TURN ? body.slice(0, CHARS_PER_TURN - 1) + '…' : body
    return `${turn.role}: ${text}`
  }
  if (turns.length <= LEAD_TURNS + TAIL_TURNS) return turns.map(clip).join('\n')
  const cut = turns.length - LEAD_TURNS - TAIL_TURNS
  return [
    ...turns.slice(0, LEAD_TURNS).map(clip),
    `… ${cut} turn${cut === 1 ? '' : 's'} omitted …`,
    ...turns.slice(-TAIL_TURNS).map(clip),
  ].join('\n')
}

/** One line of model output → one line the list can paint. */
const trim = (text: string): string => {
  const clean = text.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '').trim()
  return clean.length > MAX_LINE ? clean.slice(0, MAX_LINE - 1).trimEnd() + '…' : clean
}

/** Whatever the model said → the shape the list paints. Deliberately lenient:
 *  a blurb is not truth, so a model that ignored the format should still leave
 *  a usable line rather than nothing at all. */
const parseBlurb = (text: string): { line: string; points: string[] } => {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const bullet = /^[-•*]\s+/
  const line = trim(lines.find(l => !bullet.test(l)) ?? '')
  const points = lines
    .filter(l => bullet.test(l))
    .map(l => trim(l.replace(bullet, '')))
    .filter(Boolean)
    .slice(0, MAX_POINTS)
  return { line, points }
}

/**
 * Derive and store the blurb for one conversation. Returns it, or null when
 * there was nothing to say, nothing to say it with, or the write failed.
 *
 * Silent on every failure by design: this runs unattended on a timer, and a
 * hive with no provider configured must not produce a stream of errors about
 * a convenience nobody asked for out loud.
 */
export const mintBlurb = async (convoId: string): Promise<ChatBlurb | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null

  // NOTHING TO SAY IT WITH. Checked before resolveProvider, which throws when
  // no vendor is set up — an expected state, not an error worth raising.
  if (!activeProviders().length) return null

  const turns = await readTurns(id)
  // A single turn is already fully shown by its own title; there is nothing a
  // blurb could add and a model call would be spent saying so.
  if (turns.length < 2) return null

  try {
    const result = await callModel({
      need: { tier: 'fast' },
      system: SYSTEM,
      cacheSystem: true,
      messages: [{ role: 'user', content: transcriptOf(turns) }],
      maxTokens: 300,
    })
    const { line, points } = parseBlurb(result.text ?? '')
    if (!line) return null

    const blurb: ChatBlurb = {
      kind: 'chat:blurb',
      convoId: id,
      line,
      points,
      v: BLURB_VERSION,
      upToTurnCount: turns.length,
      upToAt: turns[turns.length - 1]?.at ?? 0,
      at: Date.now(),
    }
    if (!await putBlurb(blurb)) return null
    // WRITE THE RECORD, THEN ANNOUNCE IT — chat-thread.ts's rule, and the
    // reason a surface that missed this event loses nothing but latency.
    EffectBus.emit('chat:blurbs-changed', { convoId: id })
    return blurb
  } catch { return null }
}

/** What one drain pass found and did — returned so the orchestrator can say
 *  what it did rather than only that it ran. */
export interface BlurbDrain {
  /** Threads whose blurb was missing or behind when the drain looked. */
  readonly behind: number
  /** Blurbs actually written this pass. */
  readonly minted: number
}

/**
 * THE ORCHESTRATOR'S PASS. Find conversations with no blurb (or one far enough
 * behind to be wrong) and derive the oldest few.
 *
 * Three bounds, all deliberate:
 *
 *   • ARCHIVED THREADS ARE SKIPPED. A conversation put away is one you have
 *     stopped needing; spending a call to label it is spending it on the rows
 *     nobody is reading.
 *   • IN-FLIGHT THREADS ARE SKIPPED. A blurb minted between two turns is
 *     stale before it is written.
 *   • `limit` PER PASS. The drain is a background convenience competing with
 *     the hive for the same main thread; it takes a few and comes back.
 *
 * Oldest-first, so the thread that has been unlabelled longest is the one that
 * gets labelled — the list fills in from the part you have not looked at.
 */
export const drainBlurbs = async (limit = 2): Promise<BlurbDrain> => {
  if (!activeProviders().length) return { behind: 0, minted: 0 }

  let conversations: ConversationSummary[] = []
  try { conversations = await listConversations() } catch { return { behind: 0, minted: 0 } }

  const now = Date.now()
  const candidates = conversations.filter(convo =>
    !convo.archived && convo.turnCount >= 2 && now - convo.lastAt >= IDLE_MS)

  const behind: ConversationSummary[] = []
  for (const convo of candidates) {
    if (blurbIsBehind(await readBlurb(convo.convoId), convo.turnCount)) behind.push(convo)
  }

  let minted = 0
  for (const convo of [...behind].sort((a, b) => a.lastAt - b.lastAt).slice(0, limit)) {
    if (await mintBlurb(convo.convoId)) minted++
  }
  return { behind: behind.length, minted }
}
