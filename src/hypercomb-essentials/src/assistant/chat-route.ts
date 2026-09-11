// assistant/chat-route.ts
//
// THE ROUTE — a conversation's runs, laid along its turns.
//
// The chat window draws a vertical pipe beside the thread, one row per
// turn, and on it the WORK a responder did for each reply: one piece per
// run, carrying its attempts, broken where an attempt failed. This file
// derives that from the two records that already exist — the turns and the
// run ledger (chat-steps.ts) — and writes nothing of its own. Rebuild the
// window, reload the hive, open the thread on another day: the route is
// exactly what the records say. (Design: documentation/chat-route.md §3.)
//
// Junctions — the questions a responder asked and which outlet the answer
// took — are NOT here. The shell derives those from the turns it already
// holds with core's `settleQuestions` and zips both onto its rows; this
// file returns work only, keyed by the sig of the turn it belongs to.
//
// ── Which turn a run belongs to ─────────────────────────────────────────
//
// 1. A run whose settled `chat-reply` step names a turn in the thread
//    belongs to THAT reply's row. `chat-reply` answers with the turn's own
//    sig, so the step's `sigs` carry it; the match is on the turn's sig ONLY
//    — the bag also holds the content sig, which dedups across identical
//    replies and would misattribute a repeated "Done.".
// 2. The run whose id is `liveRunId` — the ask the shell is waiting on — is
//    the LIVE run: its piece sits in the wait row, growing as steps land.
//    Identified by id, never by absence, so a run whose responder died is
//    not mistaken for the one in flight.
// 3. Any other run is placed BY TIME: the first assistant turn whose `at`
//    follows the run's last step, before the next user turn, takes it and
//    the card says so. Only when no assistant turn follows the run before
//    the next user turn (or the end of the thread) is it UNFINISHED — and
//    while its newest step is younger than `IN_PROGRESS_MS` it is drawn as
//    "in progress", not unfinished, because the `chat-reply` step is written
//    AFTER the reply's effect fires: every normal reply passes through the
//    state "turn exists, step not yet" for one refresh. A missing step is
//    unknown, never "did not happen".
//
// Attempts within a run are ordered by `seq`; runs are ordered by the row
// they belong to, never by run id (a hash).
//
// ── Reading it ──────────────────────────────────────────────────────────
//
// `readRoute` resolves the bucket ONCE and reads turns and ledger from that
// handle, strictly: a null bucket is an empty route, and any read fault
// THROWS. `readTurns` and `readSteps` swallow faults into `[]`, which is
// right for a window about to be spoken into and wrong here — an unreadable
// store drawn as an empty pipe says "nothing happened" about a run that may
// have done everything. The shell turns the throw into one quiet line.
//
// ── The FLOW: the whole conversation, organized (v2) ────────────────────
//
// Jaime, 2026-09-10: "We're not talking about like just telling what it did
// we're just giving like a general overview in about the rational order …
// have a workflow of what's been going on through the session you can branch
// … and it'll be able to be navigable." And: "make sure that ollama visits as
// many chats as possible and updates the workflow for each chat." And for v2:
// "a full summary at every state … correct naming by the local AI obviously
// the one I use so that we don't waste our paid compute … create a tree when
// this deviation happens."
//
// So a conversation's sidebar is ONE organized workflow — a tree of the tasks
// it worked on, each with a name and a three-part card — minted ONLY by the
// participant's own machine-local model and re-derived as the conversation
// grows. With no local model awake nothing is read, called, fetched or logged;
// whatever flow was minted earlier keeps showing, and the exchanges it does
// not cover are dormant stages.
//
// Two measured stages (documentation/chat-route.md §4.1.3). One call could not
// do it: it copied its example, misplaced branches, lost reversals and had no
// room for summaries in Ollama's 4096-token context.
//
//   1. STRUCTURE — the model tags each exchange with a task id, a window of at
//      most ten at a time, and CODE builds the tree (`buildFlowTree`). The
//      newest five assignments stay provisional and are mapped again with
//      more context, because the same input produced two different trees in
//      five identical runs; freezing the first answer made whichever tree
//      landed first permanent.
//   2. CARDS — one call per node, post-order, each reading the node's full
//      covered text, validated by code (`checkFlowTitle`, `checkFlowSummary`),
//      keyed by its inputs so an unchanged node is never re-summarized.
//
// A flow is a DERIVED CACHE (CLAUDE.md, optimize-phase.md): never load-bearing,
// complete-or-absent, wipe-safe. It lives in ONE RECYCLED SLOT PER
// CONVERSATION (`putPoolDoc(pool, bytes, convoId)`, the blurb pattern), so a
// growing conversation holds exactly one record however often it is
// re-derived. `ROUTE_FLOW_VERSION` is the second half of the key: a record at
// another version reads as absent. Writes are silent — no resource is minted,
// so there is no `content:wrote` and nothing reaches a host.
//
// Two ways in, one body (`organizeOne`): the shell's ATTENDED call for the
// open conversation (`organizeRoute`), and the PASSIVE DRAIN over every
// conversation (`drainRouteFlows`) the orchestrator schedules. They share ONE
// coordination state pinned on globalThis — see `flowState` for why a module
// map is not one state in the web build — and one lane, in which the
// participant's own chat always wins.

import { EffectBus, SignatureService, plainQuestionText, settleQuestions } from '@hypercomb/core'
import { isRouteWork } from './bridge-ops.js'
import {
  STEP_LEDGER_NAME, conversationBucket, conversationModel, listConversations, readTurnsStrict,
  type ChatTurn, type ConversationSummary, type TurnRole,
} from './chat-thread.js'
import { settle, stepRequest, type ChatStep, type StepOutcome } from './chat-steps.js'
import type { LlmCall, LlmCallResult, LlmProviderDescriptor } from './llm-dispatch.js'
import type { LlmProviderRegistry } from './llm-provider-registry.js'

/** The least a turn must carry to be a row: its role, its time, and — for a
 *  turn that can hold work — its sig. `ChatTurn` satisfies it structurally. */
export interface RouteTurn {
  readonly role: TurnRole
  readonly at: number
  readonly sig?: string
}

/** One settled attempt, as the card lists it. */
export interface RouteAttempt {
  readonly seq: number
  readonly verb: string
  readonly outcome: StepOutcome
  /** The target the request named, when it named one. */
  readonly cell?: string
  /** The failure, in words. Present only when the attempt failed and its
   *  error resource could be read. */
  readonly error?: string
  readonly at: number
}

/** One RUN on the pipe. */
export interface RoutePiece {
  readonly runId: string
  /** The run's work, in `seq` order — only verbs that are work
   *  (`bridge-ops.ts`: mutating and not hidden). */
  readonly attempts: readonly RouteAttempt[]
  /** A failed attempt anywhere in the run: the piece is drawn broken. */
  readonly leak: boolean
  /** Rule 3 placed it: no `chat-reply` step named the row it sits on. */
  readonly placedByTime?: boolean
  /** Unfinished, but its newest step is young enough that the reply's step
   *  may simply not have landed yet. */
  readonly inProgress?: boolean
}

export interface RouteRow {
  readonly turnSig: string
  /** Index into the on-disk turn list — how the shell lines it up. */
  readonly index: number
  readonly pieces: readonly RoutePiece[]
}

export type RouteFlowState = 'done' | 'open' | 'decided' | 'dropped'

/** What a step WAS, as the card model reads it — one word from a closed list,
 *  drawn as an icon. Never load-bearing: a card without one is still a card. */
export type RouteFlowKind = 'fix' | 'idea' | 'choice' | 'build' | 'look'
export const ROUTE_FLOW_KINDS: readonly RouteFlowKind[] = ['fix', 'idea', 'choice', 'build', 'look']

/** A node's card: its summary in three parts, keyed by what it was derived
 *  from. The name the card gave lives on the node (`title`, `named`). */
export interface RouteFlowCard {
  /** 64 hex — `cardKey` over the node's inputs. */
  readonly key: string
  /** `ROUTE_FLOW_CARD_VERSION` when it was written. */
  readonly cv: number
  readonly goal: string
  readonly done: string
  readonly outcome: string
  /** The step's kind, when the model named one it was allowed to. */
  readonly kind?: RouteFlowKind
  /** How many exchanges the node covered when this card was written. */
  readonly exchanges: number
  /** The wire model that wrote it. */
  readonly model: string
  readonly at: number
  /** Set on read when `cv` is old; set at a structure or advance write when
   *  its key no longer matches the node's inputs. */
  readonly stale?: true
}

/** One node of a conversation's workflow, as stored. */
export interface RouteFlowNode {
  /** `/^t\d{1,3}$/`, never renumbered while referenced. */
  readonly id: string
  /** At most 8 words / 80 characters; '' only for an untitled node on exchange 1. */
  readonly title: string
  /** The title was given by a card. */
  readonly named?: true
  readonly state: RouteFlowState
  /** An EARLIER node this one branches from. */
  readonly parent?: string
  readonly card?: RouteFlowCard
}

/** THE SESSION CARD — the conversation's name and where it stands, written by
 *  the local model from its steps' cards once every card is current. Keyed by
 *  `sessionKey`: the nodes' states and card keys, so any step's change makes
 *  it due again. What the masthead, the list row and the sidebar head show. */
export interface RouteFlowSession {
  /** 64 hex — `sessionKey` over the nodes when it was written. */
  readonly key: string
  /** `ROUTE_FLOW_SESSION_VERSION` when it was written. */
  readonly sv: number
  /** 3–8 words naming the goal the whole conversation serves. */
  readonly name: string
  /** One or two sentences: where it stands now. */
  readonly stands: string
  readonly model: string
  readonly at: number
  /** Set on read when `sv` is old or its key no longer matches the nodes. */
  readonly stale?: true
}

/** The one record a conversation's slot holds. */
export interface RouteFlowRecord {
  readonly kind: 'chat:route-flow'
  readonly v: 2
  readonly convoId: string
  /** One past the last turn of the last mapped exchange. */
  readonly upToTurnCount: number
  /** The sig of turn `upToTurnCount - 1`: the flow is about THIS history. */
  readonly upToTurnSig: string
  readonly at: number
  /** The wire model of the last structure pass. */
  readonly model: string
  /** A node id per mapped exchange, in thread order. */
  readonly exchanges: readonly string[]
  /** `exchanges[0..settled)` are FROZEN; the rest (at most 5) are provisional. */
  readonly settled: number
  /** Rational order: preorder, parents first. */
  readonly nodes: readonly RouteFlowNode[]
  /** Nodes with no card or a stale card — recomputed on every read. */
  readonly pending: number
  readonly session?: RouteFlowSession
}

/** One node as the shell draws it. */
export interface RouteFlowViewNode {
  readonly id: string
  readonly title: string
  readonly named?: true
  /** The ROLLED-UP display state (see `flowView`). */
  readonly state: RouteFlowState
  readonly parent?: string
  /** 1-based exchange numbers the node owns. */
  readonly exchanges: readonly number[]
  /** Derived: the union of those exchanges' turn ranges, each below `upToTurnCount`. */
  readonly turns: readonly number[]
  /** `card.done` clipped to 160 — for an older shell that still draws v1 cards. */
  readonly detail?: string
  /** Carries `cv` and `stale`. */
  readonly card?: Omit<RouteFlowCard, 'key'>
}

/** What the shell draws of a flow. */
export interface RouteFlowView {
  readonly upToTurnCount: number
  readonly pending: number
  /** `record.model` — "Organized by {model}". */
  readonly model: string
  readonly nodes: readonly RouteFlowViewNode[]
  /** The session card, `stale` when a step changed since it was written. */
  readonly session?: Omit<RouteFlowSession, 'key'>
  /** Nodes by ROLLED-UP state. */
  readonly counts: Readonly<Record<RouteFlowState, number>>
}

/** What the participant's local model can do right now, read from probe STATE only. */
export type RouteOrganizerState =
  'awake' | 'off' | 'unknown' | 'asleep' | 'blocked' | 'needs-permission' | 'empty' | 'no-model'

/** A flow model call in flight for one conversation. */
export type RouteOrganizing =
  | { readonly stage: 'structure' }
  | { readonly stage: 'card'; readonly nodeId: string }
  | { readonly stage: 'session' }

export interface Route {
  /** Only rows that hold work, in thread order. */
  readonly rows: readonly RouteRow[]
  /** The run the shell is waiting on, when it has recorded anything drawable. */
  readonly live?: RoutePiece
  /** Runs no reply row took: drawn after the turn they follow (`afterIndex`,
   *  -1 for a run older than every turn). */
  readonly unfinished: ReadonlyArray<{ readonly afterIndex: number; readonly piece: RoutePiece }>
  /** The conversation's organized workflow, set by `readRoute` only when a
   *  record at this version exists AND is about this thread's history. The
   *  pure derivation leaves it out. */
  readonly flow?: RouteFlowView
  /** Probe STATE only: `organizerGate`, then `organizerModel`. No fetch on
   *  any path. */
  readonly organizerState?: RouteOrganizerState
  /** Present only while `organizerState === 'awake'`. */
  readonly organizer?: { readonly providerId: string; readonly model: string }
  /** A flow model call for THIS conversation is in flight. */
  readonly organizing?: RouteOrganizing
  /** Node ids whose card is in back-off (its last answer was unusable, recently). */
  readonly cardBackoff?: readonly string[]
}

export interface DeriveOptions {
  /** `runIdForAsk(pendingSig)` — the run the shell is waiting on. */
  readonly liveRunId?: string
  /** `errorSig` → the failure text, materialized by the caller. */
  readonly errors?: ReadonlyMap<string, string>
  /** The clock, for the in-progress grace. Injected so the derivation is
   *  pure; defaults to now. */
  readonly now?: number
}

/** How young a run's newest step may be before its missing reply step is
 *  read as "still writing" rather than "no reply landed". */
export const IN_PROGRESS_MS = 30_000

const EMPTY_ROUTE: Route = Object.freeze({ rows: [], unfinished: [] })

/** The target a recorded request named — `cell` is what every writing op
 *  takes, and what the agent panel labels a step by. */
const cellOf = (request: unknown): string | undefined => {
  const cell = (request as { cell?: unknown } | null | undefined)?.cell
  return typeof cell === 'string' && cell.trim() ? cell.trim() : undefined
}

/**
 * Lay the runs along the turns. Pure: no store, no clock but the one passed.
 *
 * `steps` may be raw (retries included) — they are settled here, so every
 * caller reduces the same way. `requests` is keyed by a step's `contentSig`
 * and holds the request it recorded, materialized; a step whose request is
 * missing from the map simply has no target label.
 */
export const deriveRoute = (
  turns: readonly RouteTurn[],
  steps: readonly ChatStep[],
  requests: ReadonlyMap<string, unknown>,
  options: DeriveOptions = {},
): Route => {
  const now = options.now ?? Date.now()
  const liveRunId = String(options.liveRunId ?? '').trim()

  // Runs, in encounter order (settle sorts by run id, which is a hash; the
  // order that matters is decided per run below, by row).
  const runs = new Map<string, ChatStep[]>()
  for (const step of settle(steps)) {
    const held = runs.get(step.runId)
    if (held) held.push(step); else runs.set(step.runId, [step])
  }
  if (!runs.size) return EMPTY_ROUTE

  // Rows are turns WITH a sig — a turn still in flight, or one a surface
  // holds in memory unstored, cannot carry work because nothing can point at
  // it yet.
  const rowBySig = new Map<string, number>()
  turns.forEach((turn, index) => { if (turn.sig) rowBySig.set(turn.sig, index) })

  type Placed = { readonly piece: RoutePiece; readonly lastAt: number }
  const byRow = new Map<number, Placed[]>()
  let live: RoutePiece | undefined
  const unfinished: Array<{ afterIndex: number; piece: RoutePiece; lastAt: number }> = []

  for (const [runId, run] of runs) {
    // `run` is in seq order (settle sorts within a run by seq).
    const attempts: RouteAttempt[] = []
    for (const step of run) {
      if (!isRouteWork(step.verb)) continue
      const cell = step.contentSig ? cellOf(requests.get(step.contentSig)) : undefined
      const error = step.outcome === 'failed' && step.errorSig ? options.errors?.get(step.errorSig) : undefined
      attempts.push({
        seq: step.seq, verb: step.verb, outcome: step.outcome, at: step.at,
        ...(cell ? { cell } : {}),
        ...(error ? { error } : {}),
      })
    }
    // A run that recorded nothing drawable — reads only, or just the reply
    // — has no piece. Reads are not drawn, and an empty piece would be a
    // card saying "did nothing", which is not what an absence means.
    if (!attempts.length) continue
    const leak = attempts.some(attempt => attempt.outcome === 'failed')
    const lastAt = run.reduce((max, step) => (step.at > max ? step.at : max), 0)
    const base = { runId, attempts, leak }

    // Rule 1: the reply row the run's own chat-reply step names. The LAST
    // such reply, when a run replied more than once — the run ended there.
    let replyRow: number | undefined
    for (const step of run) {
      if (step.verb !== 'chat-reply' || step.outcome !== 'ok') continue
      for (const sig of step.sigs ?? []) {
        const index = rowBySig.get(sig)
        if (index !== undefined) replyRow = index
      }
    }
    if (replyRow !== undefined) {
      const placed = byRow.get(replyRow) ?? []
      placed.push({ piece: base, lastAt })
      byRow.set(replyRow, placed)
      continue
    }

    // Rule 2: the run the shell is waiting on.
    if (liveRunId && runId === liveRunId) {
      live = base
      continue
    }

    // Rule 3: by time. The first turn after the run's last step decides —
    // an assistant turn takes the run (only if it has a sig to be keyed by;
    // one still in flight cannot carry work); a user turn, or nothing,
    // means no reply followed it.
    let afterIndex = -1
    let taker: number | undefined
    for (let index = 0; index < turns.length; index++) {
      const turn = turns[index]!
      if (turn.at <= lastAt) { afterIndex = index; continue }
      if (turn.role === 'assistant' && turn.sig) taker = index
      break
    }
    if (taker !== undefined) {
      const placed = byRow.get(taker) ?? []
      placed.push({ piece: { ...base, placedByTime: true }, lastAt })
      byRow.set(taker, placed)
      continue
    }
    const inProgress = now - lastAt < IN_PROGRESS_MS
    unfinished.push({ afterIndex, piece: inProgress ? { ...base, inProgress: true } : base, lastAt })
  }

  const rows: RouteRow[] = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, placed]) => ({
      turnSig: turns[index]!.sig!,
      index,
      pieces: placed.sort((a, b) => a.lastAt - b.lastAt).map(p => p.piece),
    }))
  return {
    rows,
    ...(live ? { live } : {}),
    unfinished: unfinished
      .sort((a, b) => (a.afterIndex - b.afterIndex) || (a.lastAt - b.lastAt))
      .map(({ afterIndex, piece }) => ({ afterIndex, piece })),
  }
}

type StoreLike = {
  getResource?: (sig: string) => Promise<Blob | null>
  /** Opens (creating) a pool — the write path only. */
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  /** Opens a pool WITHOUT creating it — every read path. */
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
  /** One current document per sub-key; writing it drops the previous one. */
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  listOptimizations?: () => Promise<string[]>
  getOptimization?: (sig: string) => Promise<Blob | null>
}

/** Every step in one bucket's ledger, STRICTLY: a file-system rejection
 *  propagates. "No ledger" (the directory was never created — the
 *  conversation ran no agent) is an empty list; "could not open it" is a
 *  throw. The two are told apart by the one name the platform gives a
 *  genuine miss. A zero-byte entry is the ledger's own interrupted write
 *  and an entry that does not parse is not a record: both are states of the
 *  ledger, skipped, not faults in reading it. */
const readLedgerStrict = async (
  bucket: FileSystemDirectoryHandle,
  convoId: string,
): Promise<ChatStep[]> => {
  let ledger: FileSystemDirectoryHandle
  try {
    ledger = await bucket.getDirectoryHandle(await STEP_LEDGER_NAME(), { create: false })
  } catch (err) {
    if ((err as { name?: unknown } | null)?.name === 'NotFoundError') return []
    throw err
  }
  const out: ChatStep[] = []
  const entries = (ledger as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
  for await (const [, handle] of entries) {
    if (handle.kind !== 'file') continue
    const file = await (handle as FileSystemFileHandle).getFile()
    if (file.size === 0) continue
    const text = await file.text()
    let step: ChatStep
    try { step = JSON.parse(text) as ChatStep } catch { continue }
    if (step?.kind !== 'chat-step' || step.convoId !== convoId) continue
    if (!Number.isInteger(step.seq)) continue
    out.push(step)
  }
  return out
}

/**
 * The route for one conversation, read from its records.
 *
 * One bucket resolution, then turns and ledger from that handle — see the
 * header for why neither goes through the swallowing readers. Requests and
 * error texts are materialized here (one resource read per distinct sig)
 * because they are labels on the card: a request that cannot be read costs
 * a target name, never the piece.
 *
 * Throws on any read fault; resolves to an empty route for a conversation
 * that has no bucket. The flow, and what the local model is doing, are read
 * beside it and NEVER throw and NEVER probe: a flow is not load-bearing, so
 * one that cannot be read is simply absent, and "is the model awake?" is a
 * state read, not a knock (§4.1.7–§4.1.8).
 */
export const readRoute = async (convoId: string, liveRunId?: string): Promise<Route> => {
  const records = await readRouteRecords(convoId, liveRunId)
  if (!records) return EMPTY_ROUTE
  const id = String(convoId ?? '').trim()
  const record = await readRouteFlow(id)
  const flow = record ? flowView(record, records.turns, !!record.session && await sessionDue(record)) : undefined
  const organizer = await organizerFields(id)
  const state = flowState()
  const organizing = state.organizingNow.get(id)
  const cardBackoff = flow ? backedOffCards(id, flow, state) : []
  return {
    ...records.route,
    ...(flow ? { flow } : {}),
    ...organizer,
    ...(organizing ? { organizing } : {}),
    ...(cardBackoff.length ? { cardBackoff } : {}),
  }
}

/** The turns and the derived route from ONE bucket resolution — what both
 *  `readRoute` and the flow's minting read. Null for a conversation with no
 *  bucket; throws on any read fault (see the header). */
const readRouteRecords = async (
  convoId: string,
  liveRunId?: string,
): Promise<{ readonly turns: ChatTurn[]; readonly route: Route } | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null
  const bucket = await conversationBucket(id)
  if (!bucket) return null

  const turns = await readTurnsStrict(bucket, id)
  const steps = settle(await readLedgerStrict(bucket, id))
  if (!steps.length) return { turns, route: EMPTY_ROUTE }

  const requests = new Map<string, unknown>()
  const errors = new Map<string, string>()
  const store = get<StoreLike>('@hypercomb.social/Store')
  for (const step of steps) {
    if (!isRouteWork(step.verb)) continue
    if (step.contentSig && !requests.has(step.contentSig)) {
      requests.set(step.contentSig, await stepRequest(step))
    }
    if (step.errorSig && !errors.has(step.errorSig)) {
      try {
        const blob = await store?.getResource?.(step.errorSig)
        const text = blob ? (await blob.text()).trim() : ''
        if (text) errors.set(step.errorSig, text)
      } catch { /* the failure stays named by its verb and target */ }
    }
  }
  return { turns, route: deriveRoute(turns, steps, requests, { liveRunId, errors }) }
}

/** One EXCHANGE: a user turn and everything up to the next one, with the
 *  settled work its rows and its unfinished runs carry. */
export interface RouteExchange {
  readonly index: number
  readonly end: number
  readonly attempts: readonly { readonly runId: string; readonly row: number; readonly attempt: RouteAttempt }[]
}

/** Split the thread into exchanges — a user turn and everything up to the
 *  next — and give each the settled attempts its rows and its unfinished
 *  runs carry, with the row each attempt sits on. Turns before the first user
 *  turn open no exchange. The live run belongs to nobody here. Pure. */
export const routeExchanges = (
  turns: readonly RouteTurn[],
  route: Pick<Route, 'rows' | 'unfinished'>,
): RouteExchange[] => {
  const starts: number[] = []
  turns.forEach((turn, index) => { if (turn.role === 'user') starts.push(index) })
  return starts.map((index, at) => {
    const end = starts[at + 1] ?? turns.length
    const within = (i: number): boolean => i >= index && i < end
    const attempts: { runId: string; row: number; attempt: RouteAttempt }[] = []
    for (const row of route.rows) {
      if (!within(row.index)) continue
      for (const piece of row.pieces) for (const attempt of piece.attempts) attempts.push({ runId: piece.runId, row: row.index, attempt })
    }
    for (const { afterIndex, piece } of route.unfinished) {
      if (!within(afterIndex)) continue
      for (const attempt of piece.attempts) attempts.push({ runId: piece.runId, row: afterIndex, attempt })
    }
    return { index, end, attempts }
  })
}

// ── THE FLOW ────────────────────────────────────────────────────────────
//
// See the header. Everything below is a derived cache over the records
// above: no read path requires a flow, and wiping the pool costs the
// organization, never truth.

/** The pool flows live in. A colon meaning: a SYSTEM pool no tile can name
 *  (`lineageKey` folds every non-letter/number to `-`), addressed only
 *  through the store, which registers the meaning when it derives it. */
export const ROUTE_FLOWS_POOL = 'chat:route-flows'

/** THE SECOND HALF OF THE KEY. Bump on any change to the structure prompt,
 *  the parse, the window, the repair rules, the behind rule or the record's
 *  shape; a record stamped with another version reads as absent and is
 *  minted again. */
export const ROUTE_FLOW_VERSION = 2
/** Bump on any change to the card prompt or its validators. It is stored on
 *  every card, because the card key cannot be recomputed on the synchronous
 *  read path; a card at an older version reads stale at once. */
export const ROUTE_FLOW_CARD_VERSION = 2
/** The session prompt's wording is part of this version too. */
export const ROUTE_FLOW_SESSION_VERSION = 1
export const ROUTE_FLOW_SESSION_STANDS_CHARS = 200

export const ROUTE_FLOW_MAX_NODES = 32
export const ROUTE_FLOW_MAX_DEPTH = 3
export const ROUTE_FLOW_TITLE_WORDS = 8
/** Only this many exchanges of a conversation are ever mapped; the rest stay dormant. */
export const ROUTE_FLOW_MAX_EXCHANGES = 400
/** Exchanges one structure call maps, at most. */
export const ROUTE_FLOW_CHUNK = 10
/** How many later exchanges an assignment must be seen with before it freezes. */
export const ROUTE_FLOW_OVERLAP = 5
/** A structure prompt's ceiling: ~1,700 tokens beside an ~850-token system
 *  prompt and at most 720 answered, inside Ollama's default 4,096. */
export const ROUTE_FLOW_STRUCTURE_INPUT_CHARS = 6000
export const ROUTE_FLOW_CARD_LIMITS = Object.freeze({ goal: 160, done: 280, outcome: 180 })
/** The view's `detail`, for a shell that still draws v1 cards. */
export const ROUTE_FLOW_DETAIL_CHARS = 160

/** The last exchange of a thread is closed only once the thread has been
 *  quiet this long (and nothing is outstanding for it). */
export const ROUTE_FLOW_IDLE_MS = 90_000

/** A cold model load measured 10–17 s, plus ~8 s of the worst generation. */
export const ROUTE_FLOW_STRUCTURE_TIMEOUT_MS = 45_000
export const ROUTE_FLOW_CARD_TIMEOUT_MS = 30_000
/** One passive pass stops STARTING calls after this long… */
export const ROUTE_FLOW_PASS_MS = 90_000
/** …or this many calls, whichever comes first. */
export const ROUTE_FLOW_PASS_CALLS = 48

/** A model answer that could not be used is not asked for again, for the
 *  same inputs, until this long has passed — a small model that cannot do a
 *  thread must not be asked about it every five seconds. */
export const ROUTE_FLOW_RETRY_MS = 10 * 60_000
/** The lane stays shut this long after the participant's own local chat. */
export const ROUTE_FLOW_YIELD_MS = 30_000
/** The back-off map never holds more than this many entries. */
export const ROUTE_FLOW_BACKOFF_CAP = 500
/** A pass that yielded to an attended call names a resume this far out —
 *  the orchestrator's `soonMs`, which this file cannot import without a cycle. */
export const ROUTE_FLOW_ATTENDED_RESUME_MS = 5_000

const FLOW_TITLE_CHARS = 80
const FLOW_CARD_LEAF_CHARS = 7_000
const FLOW_CARD_PARENT_CHARS = 4_000
const FLOW_CARD_MAX_TOKENS = 350
/** Raw model entries looked at, at most — a runaway answer costs bounded work. */
const FLOW_RAW_ENTRIES = 64

// ── one state, pinned ───────────────────────────────────────────────────
//
// THE WEB BUILD HOLDS THIS FILE MORE THAN ONCE. A bee is bundled with only
// namespace specifiers external, so every relative import is inlined into it:
// the orchestrator bee carries its own chat-route.ts (orchestrator.drone.ts
// imports it relatively), `ChatThreads` reaches another copy, and two more
// bees inline chat-thread.ts itself. A `Set` or `Map` in module scope would be
// one guard per copy — the attended call and the drain would mint the same
// flow at once, and the drain would never see the participant's pause. The
// dev shells load one module graph and cannot show this. So every piece of
// flow coordination lives in ONE object on globalThis, the pattern
// `__hypercombEffectBus` already uses (documentation/chat-route.md §4.1.9).
// Routing the drain through IoC instead would have joined the lane and left
// the probe state split; local-liveness.ts pins its report map the same way.

const FLOW_STATE = Symbol.for('hypercomb.chat-route.flow-state')

interface FlowCoordination {
  /** The lane: one flow model call at a time. */
  tail: Promise<void>
  inFlight: { readonly abort: AbortController; readonly attended: boolean; readonly convoId: string } | null
  attendedWaiting: number
  pausedUntil: number
  /** 0 until the `llm:local-used` subscription exists. */
  subscribedAt: number
  /** The per-conversation mint guard. */
  readonly organizing: Set<string>
  readonly organizingNow: Map<string, RouteOrganizing>
  /** convoId → the node the participant is looking at. */
  readonly prefer: Map<string, string>
  /** Structure and card back-off keys → when their answer was unusable. */
  readonly backoff: Map<string, number>
  /** Models whose server refused the knobs this session. */
  readonly plainLocalModels: Set<string>
  /** The model the last passive pass resolved. */
  lastPassModel: string
  /** convoId → when the participant last opened it here. The drain's queue. */
  readonly visited: Map<string, number>
}

/** Where the visited queue lives between reloads; the newest 200 kept. */
export const ROUTE_VISITED_KEY = 'hc:chat-route-visited'
const ROUTE_VISITED_CAP = 200

const readVisited = (): Map<string, number> => {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(ROUTE_VISITED_KEY) ?? 'null') as Record<string, unknown> | null
    const out = new Map<string, number>()
    if (raw && typeof raw === 'object') {
      for (const [id, at] of Object.entries(raw)) if (typeof at === 'number' && Number.isFinite(at) && id) out.set(id, at)
    }
    return out
  } catch { return new Map() }
}

const flowState = (): FlowCoordination =>
  ((globalThis as Record<symbol, unknown>)[FLOW_STATE] ??= {
    tail: Promise.resolve(),
    inFlight: null,
    attendedWaiting: 0,
    pausedUntil: 0,
    subscribedAt: 0,
    organizing: new Set<string>(),
    organizingNow: new Map<string, RouteOrganizing>(),
    prefer: new Map<string, string>(),
    backoff: new Map<string, number>(),
    plainLocalModels: new Set<string>(),
    lastPassModel: '',
    visited: readVisited(),
  } satisfies FlowCoordination) as FlowCoordination

/**
 * THE VISITED QUEUE. Jaime: "if we don't touch the conversation let's not
 * organize the workflow sidebar … it gets into a queue if you visit it and
 * then that will be done in the background." Opening a conversation puts it
 * here; the drain reads only from here, most recently opened first, and a
 * conversation nobody opened on this machine is never organized. Persisted,
 * newest 200, so a reload does not forget what you were working in.
 */
export const markRouteVisited = (convoId: string, at = Date.now()): void => {
  const id = String(convoId ?? '').trim()
  if (!id) return
  const state = flowState()
  state.visited.set(id, at)
  if (state.visited.size > ROUTE_VISITED_CAP) {
    const oldest = [...state.visited.entries()].sort((a, b) => a[1] - b[1]).slice(0, state.visited.size - ROUTE_VISITED_CAP)
    for (const [key] of oldest) state.visited.delete(key)
  }
  try { globalThis.localStorage?.setItem(ROUTE_VISITED_KEY, JSON.stringify(Object.fromEntries(state.visited))) } catch { /* private mode */ }
}

/** The conversations the drain may organize, most recently opened first. */
export const routeVisited = (): ReadonlyMap<string, number> => flowState().visited

/**
 * THE PARTICIPANT'S OWN LOCAL CHAT PRE-EMPTS EVERYTHING. Measured on qwen3:8b:
 * their first token came at 87 ms alone, 3,590 ms behind an un-aborted flow
 * call (Ollama serialized the two), and 107 ms when the flow call was aborted
 * at 300 ms. So a stamp marked `interactive` — only the routed stream, the chat
 * window's own local send, marks one — shuts the lane for 30 s and aborts the
 * call in flight. A stamp without it is the blurb drain, bee banter, a peer
 * being served, or this file's own calls, and changes nothing.
 *
 * One subscription per STATE, not per module copy. EffectBus replays the last
 * value to a new subscriber, so a stamp older than the subscription is a
 * replay and is ignored. In-tab only: a terminal or another app using the same
 * server sends no stamp and waits behind at most one flow call.
 */
const ensureSubscribed = (state: FlowCoordination): void => {
  if (state.subscribedAt) return
  state.subscribedAt = Date.now()
  EffectBus.on<{ interactive?: unknown; at?: unknown } | undefined>('llm:local-used', payload => {
    if (payload?.interactive !== true) return
    const at = Number(payload.at)
    if (!Number.isFinite(at) || at < state.subscribedAt) return
    state.pausedUntil = Math.max(state.pausedUntil, at + ROUTE_FLOW_YIELD_MS)
    state.inFlight?.abort.abort()
  })
}

// Subscribed as the module is evaluated — the earliest use of the state — so a
// chat made before the first pass is already seen when that pass starts.
ensureSubscribed(flowState())

// ── text ────────────────────────────────────────────────────────────────

const STATE_WORDS: Readonly<Record<string, RouteFlowState>> = {
  done: 'done', complete: 'done', completed: 'done', finished: 'done', resolved: 'done', fixed: 'done',
  open: 'open', active: 'open', pending: 'open', ongoing: 'open', blocked: 'open', waiting: 'open',
  'in progress': 'open', 'in-progress': 'open', in_progress: 'open', failing: 'open', failed: 'open',
  decided: 'decided', decision: 'decided', chosen: 'decided', agreed: 'decided',
  dropped: 'dropped', abandoned: 'dropped', rejected: 'dropped', cancelled: 'dropped', canceled: 'dropped', reverted: 'dropped',
}

const stateWord = (value: unknown): RouteFlowState | undefined =>
  typeof value === 'string' ? STATE_WORDS[value.trim().toLowerCase()] : undefined

const QUOTES = /^["'`*_“”‘’]+|["'`*_“”‘’]+$/g

const flat = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim()

const cleanTitle = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  const flattened = value.replace(/\s+/g, ' ').trim()
    .replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, '')
    .replace(QUOTES, '')
    .trim()
  let words = flattened.split(' ').filter(Boolean).slice(0, ROUTE_FLOW_TITLE_WORDS).join(' ')
  words = words.replace(/[.。]+$/, '').replace(QUOTES, '').trim()
  return words.length > FLOW_TITLE_CHARS ? words.slice(0, FLOW_TITLE_CHARS).trimEnd() : words
}

/** A stage-1 working title: cleaned, and never a question. "Assign plots
 *  fairly: waitlist or lottery?" names the task by its first half; a title
 *  that is nothing but a question keeps its words without the mark. */
const cleanWorkingTitle = (value: unknown): string => {
  const title = cleanTitle(value)
  if (!title) return ''
  const stripped = title.replace(/[:\-–—]?\s*[^:]*\?\s*$/, '').trim()
  return stripped || title.replace(/\?/g, '').trim()
}

/** Every fenced code block becomes `[code]`; an unterminated fence runs to the
 *  end. The review conversation's replies opened with code, so a head clip
 *  showed the model code and never the sentence that said what happened. */
const withoutCode = (text: string): string => {
  const out: string[] = []
  let fence: string | null = null
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const opener = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence === null) {
      if (opener) { fence = opener[1]!; out.push('[code]') } else out.push(line)
      continue
    }
    if (opener && opener[1]![0] === fence[0] && opener[1]!.length >= fence.length && line.trim() === opener[1]) fence = null
  }
  return out.join('\n')
}

/** A turn as the structure prompt and the word tests read it: a question as
 *  its one line, code as `[code]`, whitespace flattened. */
const exchangeText = (text: string): string => flat(withoutCode(plainQuestionText(String(text ?? ''))))

/** A turn as a card reads it: everything it said, flattened. */
const cardText = (text: string): string => flat(plainQuestionText(String(text ?? '')))

const headClip = (text: string, chars: number): string =>
  text.length > chars ? `${text.slice(0, chars)}…` : text

const headTailClip = (text: string, head: number, tail: number): string =>
  text.length > head + tail ? `${text.slice(0, head)} … ${text.slice(-tail)}` : text

const STOP = new Set(('a an the of on for to in at by with and or from into about as is are be it its this that these those my our '
  + 'your their new more all both two one via up out off vs').split(' '))
const GENERIC = new Set(('task tasks work working discussion discuss discussing conversation chat question questions answer answers '
  + 'issue issues problem problems help request requests update updates updating change changes stuff thing things misc '
  + 'miscellaneous general topic topics follow followup follow-up next steps step phase node branch detour side overview summary '
  + 'user users assistant participant reply replies message messages turn turns exchange exchanges session item items various '
  + 'other details detail info information progress handle handling address addressing continue continuing do doing make making '
  + 'get getting go going talk talking ask asking check checking look looking review reviewing resolve resolving process '
  + 'processing deal dealing provide providing clarify clarifying explain explaining').split(' '))

const tokens = (text: string): string[] =>
  String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** `words()` of §4.1.4 step 6: lowercased tokens of at least four characters,
 *  minus STOP and GENERIC, each cut to its first five characters — so "fold"
 *  and "fold." meet, and "anchoring" meets "anchor". */
const flowWords = (text: string): Set<string> => {
  const out = new Set<string>()
  for (const token of tokens(text)) {
    if (token.length < 4 || STOP.has(token) || GENERIC.has(token)) continue
    out.add(token.slice(0, 5))
  }
  return out
}

const overlap = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let count = 0
  for (const word of a) if (b.has(word)) count++
  return count
}

/** A title's content words: split keeping `&+#` (C#, R&D), minus STOP and GENERIC. */
const contentWords = (text: string): string[] =>
  String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}&+#]+/u).filter(word => word && !STOP.has(word) && !GENERIC.has(word))

// ── exchanges ───────────────────────────────────────────────────────────

/** The index of every user turn: exchange k starts at `starts[k]`, except
 *  exchange 0, which starts at turn 0 so the turns before the first user turn
 *  ride with it. Every organized turn then belongs to exactly one exchange. */
const exchangeStarts = (turns: readonly Pick<RouteTurn, 'role'>[]): number[] => {
  const starts: number[] = []
  turns.forEach((turn, index) => { if (turn.role === 'user') starts.push(index) })
  return starts
}

const exchangeRange = (starts: readonly number[], k: number, end: number): { readonly from: number; readonly to: number } =>
  ({ from: k === 0 ? 0 : starts[k]!, to: Math.min(starts[k + 1] ?? end, end) })

/** The settled attempts on each row: a reply row's pieces, and an unfinished
 *  run on the row it follows (a run older than every turn sits on row 0). */
const workByRow = (route: Pick<Route, 'rows' | 'unfinished'>): Map<number, RouteAttempt[]> => {
  const out = new Map<number, RouteAttempt[]>()
  const add = (row: number, attempt: RouteAttempt): void => {
    const held = out.get(row)
    if (held) held.push(attempt); else out.set(row, [attempt])
  }
  for (const row of route.rows) for (const piece of row.pieces) for (const attempt of piece.attempts) add(row.index, attempt)
  for (const { afterIndex, piece } of route.unfinished) for (const attempt of piece.attempts) add(Math.max(0, afterIndex), attempt)
  return out
}

interface FlowDecision { readonly prompt: string; readonly chosen: string }

/** The decision each settled question's row carries. An open question has
 *  decided nothing yet. */
const decisionsByRow = (turns: readonly Pick<ChatTurn, 'role' | 'text'>[]): Map<number, FlowDecision> => {
  const out = new Map<number, FlowDecision>()
  settleQuestions(turns).forEach((question, index) => {
    if (!question || question.state === 'open') return
    const chosen = question.state === 'superseded' ? '(went on without an answer)'
      : typeof question.outlet === 'number' ? question.options[question.outlet] ?? ''
      : `(own words) ${headClip(exchangeText(turns[question.answeredBy ?? -1]?.text ?? ''), 80)}`
    out.set(index, { prompt: question.prompt, chosen })
  })
  return out
}

const attemptLine = (attempt: Pick<RouteAttempt, 'verb' | 'cell' | 'outcome'>): string =>
  `${attempt.verb}${attempt.cell ? ` ${attempt.cell}` : ''} ${attempt.outcome === 'failed' ? 'FAILED' : 'ok'}`

/** One exchange as the structure stage reads it. */
export interface RouteFlowExchange {
  /** The participant's words, a question as its one line, code as `[code]`. */
  readonly participant: string
  /** Every reply of the exchange, in order, the same way. */
  readonly replies: readonly string[]
  readonly attempts: readonly Pick<RouteAttempt, 'verb' | 'cell' | 'outcome'>[]
  /** `prompt → chosen`, per settled question. */
  readonly decided: readonly string[]
}

/** The first `count` exchanges of a thread, as the structure stage reads them. */
const flowExchanges = (
  turns: readonly ChatTurn[],
  route: Pick<Route, 'rows' | 'unfinished'>,
  count: number,
): RouteFlowExchange[] => {
  const starts = exchangeStarts(turns)
  const work = workByRow(route)
  const decisions = decisionsByRow(turns)
  const out: RouteFlowExchange[] = []
  for (let k = 0; k < Math.min(count, starts.length); k++) {
    const { from, to } = exchangeRange(starts, k, turns.length)
    let participant = ''
    const replies: string[] = []
    const attempts: RouteAttempt[] = []
    const decided: string[] = []
    for (let index = from; index < to; index++) {
      const turn = turns[index]!
      if (turn.role === 'user') participant = participant ? `${participant} ${exchangeText(turn.text)}` : exchangeText(turn.text)
      else replies.push(exchangeText(turn.text))
      attempts.push(...(work.get(index) ?? []))
      const decision = decisions.get(index)
      if (decision) decided.push(`${decision.prompt} → ${decision.chosen}`)
    }
    out.push({ participant, replies, attempts, decided })
  }
  return out
}

/**
 * One exchange block of the structure prompt:
 *
 *   E{n}:
 *     participant: its first 280 characters
 *     reply: the first reply (a reply over 360 characters: its first 120 … its last 240)
 *     (+k more replies)       only when there were more than two
 *     reply: the last reply, when it is not the first
 *     work: at most six attempts, then +k more
 *     decided: prompt → chosen
 *
 * A reply's outcome sentence is usually at its END, so a long reply keeps its
 * tail. `tight` cuts replies to 120 + 120: the one exchange that is over the
 * input budget on its own.
 */
const exchangeBlock = (exchange: RouteFlowExchange, n: number, tight = false): string => {
  const reply = (text: string): string => tight
    ? headTailClip(text, 120, 120)
    : text.length > 360 ? headTailClip(text, 120, 240) : text
  const lines = [`E${n}:`, `  participant: ${headClip(exchange.participant, 280)}`]
  const { replies } = exchange
  if (replies.length) {
    lines.push(`  reply: ${reply(replies[0]!)}`)
    if (replies.length > 2) lines.push(`  (+${replies.length - 2} more replies)`)
    if (replies.length > 1) lines.push(`  reply: ${reply(replies[replies.length - 1]!)}`)
  }
  if (exchange.attempts.length) {
    const shown = exchange.attempts.slice(0, 6).map(attemptLine).join(' · ')
    const more = exchange.attempts.length > 6 ? ` · +${exchange.attempts.length - 6} more` : ''
    lines.push(`  work: ${shown}${more}`)
  }
  for (const decided of exchange.decided) lines.push(`  decided: ${decided}`)
  return lines.join('\n')
}

// ── stage 1: structure ──────────────────────────────────────────────────

/** What the model is told. Its wording is part of the version: change a word,
 *  bump `ROUTE_FLOW_VERSION`. Measured as the final pipeline (§4.1.3–§4.1.4). */
export const ROUTE_FLOW_STRUCTURE_SYSTEM = [
  'You map a conversation onto the TASKS it worked on, one exchange at a time.',
  'An exchange is one participant message and the reply to it. The tasks form a TREE.',
  '',
  'How the tree grows:',
  '- A fresh goal is a TOP-LEVEL task ("from": ""). Several SEPARATE problems raised together are separate',
  '  tasks; never hang one problem under another.',
  '- A PART of a larger goal that gets worked out on its own (a piece of a plan, a section of a page, a choice',
  '  to make) is a BRANCH of that goal ("from": the goal\'s id).',
  '- A DETOUR is a BRANCH of the task in progress: fixing something it ran into, or a side question asked in',
  '  the middle of it.',
  '- More of the SAME task REUSES its id: the next step, a retry, a confirmation, and any revision of what the',
  '  last reply made (shorter, warmer, add this to it, rename it, save it). Coming BACK to an earlier task',
  '  ("back to", "still broken") reuses that id too. Most exchanges reuse an id.',
  '- A REVERSAL starts a new branch beside the abandoned one (same "from") and names the abandoned one in "drops".',
  '',
  'For EVERY exchange, in order, one entry:',
  '"e": the exchange number. "task": its id; new ids are t1, t2, t3 ... in order of first appearance.',
  '"title": for a NEW id only, 3 to 8 words, verb first, naming the specific thing (tile, page, bug, feature,',
  '  option); for a reused id "". "from": for a NEW id only; for a reused id "".',
  '"state": that task after this exchange: "open" (still going, failing or waiting), "done" (finished),',
  '  "decided" (a choice settled it), "dropped" (abandoned). "drops": an abandoned EARLIER id, else "".',
  'Read the "work" lines (FAILED = that attempt did not work) and the "decided" lines. Reply with JSON only.',
  '',
  'EXAMPLE (a different conversation):',
  'E1 participant: Help me plan a week in Lisbon in May: flights, a hotel, a day trip.',
  'E2 participant: Start with flights, book the morning one. | reply: Booked the 7:05 flight.',
  'E3 participant: Wait, my passport expires in June, is that a problem? | reply: Some airlines refuse it; renew first.',
  'E4 participant: Renewed it. Does the flight booking still hold? | reply: Yes, unchanged.',
  'E5 participant: Now the hotel: the Alfama guesthouse. | decided: Which hotel? → Alfama guesthouse',
  'E6 participant: Cancel Alfama, too many stairs, find one in Baixa. | reply: Cancelled; booked Hotel Baixa.',
  'E7 participant: Add breakfast to that booking. | reply: Breakfast added.',
  '{"exchanges":[',
  '{"e":1,"task":"t1","title":"Plan a week in Lisbon","from":"","state":"open","drops":""},',
  '{"e":2,"task":"t2","title":"Book the morning flight to Lisbon","from":"t1","state":"done","drops":""},',
  '{"e":3,"task":"t3","title":"Check passport expiry for the flight","from":"t2","state":"done","drops":""},',
  '{"e":4,"task":"t2","title":"","from":"","state":"done","drops":""},',
  '{"e":5,"task":"t4","title":"Book the Alfama guesthouse","from":"t1","state":"decided","drops":""},',
  '{"e":6,"task":"t5","title":"Book a hotel in Baixa instead","from":"t1","state":"done","drops":"t4"},',
  '{"e":7,"task":"t5","title":"","from":"","state":"done","drops":""}]}',
].join('\n')

export const ROUTE_FLOW_STRUCTURE_SCHEMA = {
  type: 'object',
  properties: {
    exchanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          e: { type: 'integer' }, task: { type: 'string' }, title: { type: 'string' },
          from: { type: 'string' }, state: { type: 'string', enum: ['open', 'done', 'decided', 'dropped'] },
          drops: { type: 'string' },
        },
        required: ['e', 'task', 'title', 'from', 'state', 'drops'],
      },
    },
  },
  required: ['exchanges'],
} as const

/** The nodes TASKS SO FAR lists: those referenced by the frozen assignments
 *  and their ancestors, in record order. A node referenced only by
 *  provisional exchanges is RELEASED — it is mapped again, and its id may be
 *  issued again. */
const seededNodes = <N extends Pick<RouteFlowNode, 'id' | 'parent'>>(
  nodes: readonly N[],
  exchanges: readonly string[],
  from: number,
): N[] => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const keep = new Set<string>()
  for (const id of exchanges.slice(0, from)) {
    for (let at: string | undefined = id; at && !keep.has(at); at = byId.get(at)?.parent) keep.add(at)
  }
  return nodes.filter(node => keep.has(node.id))
}

const taskNumber = (id: string): number => {
  const match = /^t(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export interface RouteFlowStructurePromptInput {
  /** The closed exchanges, E1 first — at least `upto` of them. */
  readonly exchanges: readonly RouteFlowExchange[]
  /** Exchanges already mapped and frozen before the window. */
  readonly from: number
  /** One past the window's last exchange. */
  readonly upto: number
  /** The seeded nodes (TASKS SO FAR), display titles and stored states. */
  readonly tasks: readonly Pick<RouteFlowNode, 'id' | 'title' | 'state' | 'parent'>[]
  /** A node id per mapped exchange — at least `from` of them. */
  readonly assigned: readonly string[]
  /** Cut the window's replies to 120 + 120 (the input budget's last resort). */
  readonly tight?: boolean
}

/**
 * The user message for one structure window. Fresh (`from === 0`) and
 * incremental mapping are ONE path: every later window, including every
 * re-mapping of provisional exchanges, lists the tasks so far, repeats the
 * last frozen exchange for context, and asks for the window only.
 */
export const routeFlowStructurePrompt = (input: RouteFlowStructurePromptInput): string => {
  const { exchanges, from, upto } = input
  const blocks: string[] = []
  for (let k = from; k < upto; k++) blocks.push(exchangeBlock(exchanges[k]!, k + 1, input.tight))
  if (from === 0) {
    return [`EXCHANGES E1–E${upto}:`, ...blocks, '', `Map every exchange, E1 to E${upto}.`].join('\n')
  }
  const next = 1 + input.tasks.reduce((max, task) => Math.max(max, taskNumber(task.id)), 0)
  return [
    `TASKS SO FAR (E1–E${from} are already mapped):`,
    ...input.tasks.map(task => `- ${task.id}${task.parent ? ` (branch of ${task.parent})` : ''} [${task.state}]: ${task.title}`),
    '',
    'THE LAST MAPPED EXCHANGE, for context:',
    exchangeBlock(exchanges[from - 1]!, from),
    `  → ${input.assigned[from - 1] ?? ''}`,
    '',
    `EXCHANGES E${from + 1}–E${upto}:`,
    ...blocks,
    '',
    `Map only E${from + 1} to E${upto}. Reuse an id above when an exchange continues or returns to that task; the next new id is t${next}.`,
  ].join('\n')
}

export interface RouteFlowWindow {
  readonly from: number
  readonly upto: number
  readonly tight: boolean
  readonly prompt: string
}

/**
 * THE WINDOW. A call maps `E{from+1}…E{upto}`, `from` = the settled count, and
 * is made only when at least one exchange in it is new. The provisional
 * exchanges (never more than five) are mapped again with the new ones.
 *
 * The rendered prompt stays within `ROUTE_FLOW_STRUCTURE_INPUT_CHARS`: first
 * the window shrinks from its end; when it holds only its provisional
 * exchanges plus one new one, the OLDEST provisional exchanges freeze as they
 * are; when one new exchange is over budget alone, its replies are cut to
 * 120 + 120. Thirty-two task lines alone are ~2,000 characters, which is why
 * the budget is enforced and never assumed. Null when there is nothing new.
 */
export const planFlowWindow = (
  exchanges: readonly RouteFlowExchange[],
  previous: Pick<RouteFlowRecord, 'nodes' | 'exchanges' | 'settled'> | null,
): RouteFlowWindow | null => {
  const mapped = previous?.exchanges.length ?? 0
  const closed = Math.min(exchanges.length, ROUTE_FLOW_MAX_EXCHANGES)
  // A settled count far behind what is mapped (a hand-edited record) would
  // leave a window with nothing new in it forever; at most OVERLAP stay open.
  let from = Math.max(0, Math.min(previous?.settled ?? 0, mapped), mapped - ROUTE_FLOW_OVERLAP)
  let upto = Math.min(from + ROUTE_FLOW_CHUNK, closed)
  if (upto <= mapped) return null
  let tight = false
  const render = (): string => routeFlowStructurePrompt({
    exchanges, from, upto, tight,
    tasks: previous ? seededNodes(previous.nodes, previous.exchanges, from) : [],
    assigned: previous?.exchanges ?? [],
  })
  let prompt = render()
  while (prompt.length > ROUTE_FLOW_STRUCTURE_INPUT_CHARS) {
    if (upto - 1 > mapped) upto--
    else if (from < mapped) from++
    else if (!tight) tight = true
    else break
    prompt = render()
  }
  return { from, upto, tight, prompt }
}

/** A tree as stage 1 leaves it: nodes without cards, and an assignment. */
export interface RouteFlowTree {
  readonly nodes: readonly Omit<RouteFlowNode, 'card'>[]
  readonly exchanges: readonly string[]
}

export interface BuildFlowTreeInput {
  readonly previous: Pick<RouteFlowRecord, 'nodes' | 'exchanges'> | null
  readonly from: number
  readonly upto: number
  /** Every exchange's participant and reply texts, E1 first — at least `upto`. */
  readonly texts: readonly Pick<RouteFlowExchange, 'participant' | 'replies'>[]
}

/**
 * PARSE AND REPAIR ONE WINDOW — pure. The model only tags exchanges; code
 * builds the tree, because a model asked for parent pointers across a whole
 * conversation misplaced them (§4.1.3).
 *
 *   1. extract the JSON; `exchanges` or a bare array, else unusable
 *   2. keep one entry per exchange number inside the window; fewer than half
 *      the window is unusable
 *   3. seed the tasks the frozen assignments reference (and their ancestors);
 *      FROZEN ASSIGNMENTS NEVER CHANGE
 *   4. the model's ids are aliases; canonical ids are t1, t2, … and never
 *      renumbered while referenced
 *   5. per exchange: reuse an id; a new id with a usable title (at most 32
 *      nodes, at most 3 deep — deeper re-hangs up the chain); a missing entry
 *      or no usable title continues the previous task (E1 gets an untitled
 *      node); the last reported state wins; a drop marks an earlier task
 *      dropped unless it is this task or its ancestor
 *   6. RE-HOME by words — see `rehome` below
 *   8. preorder, roots and children in order of first appearance
 *   9. a node referenced by nothing, with no referenced descendant, goes
 */
export const buildFlowTree = (answer: string, input: BuildFlowTreeInput): RouteFlowTree | null => {
  const value = extractRouteFlow(answer) as { exchanges?: unknown } | unknown[] | null
  const list = Array.isArray((value as { exchanges?: unknown } | null)?.exchanges)
    ? (value as { exchanges: unknown[] }).exchanges
    : Array.isArray(value) ? value : null
  const { from, upto } = input
  if (!list || !(upto > from) || from < 0) return null

  const kept = new Map<number, Record<string, unknown>>()
  for (const entry of list.slice(0, FLOW_RAW_ENTRIES)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = (entry as { e?: unknown }).e
    if (typeof e !== 'number' || !Number.isInteger(e) || e < from + 1 || e > upto || kept.has(e)) continue
    kept.set(e, entry as Record<string, unknown>)
  }
  if (kept.size < Math.ceil((upto - from) / 2)) return null

  type Draft = { id: string; title: string; named?: true; state: RouteFlowState; parent?: string }
  const previousExchanges = input.previous?.exchanges ?? []
  const assign: string[] = previousExchanges.slice(0, from)
  const tasks = new Map<string, Draft>()
  for (const node of seededNodes(input.previous?.nodes ?? [], previousExchanges, from)) {
    tasks.set(node.id, {
      id: node.id, title: node.title, state: node.state,
      ...(node.named ? { named: true as const } : {}),
      ...(node.parent ? { parent: node.parent } : {}),
    })
  }
  let next = 1 + [...tasks.keys()].reduce((max, id) => Math.max(max, taskNumber(id)), 0)
  const alias = new Map<string, string>([...tasks.keys()].map(id => [id, id]))
  const depthOf = (id: string): number => {
    let depth = 1
    for (let at = tasks.get(id)?.parent; at; at = tasks.get(at)?.parent) depth++
    return depth
  }
  const isAncestor = (ancestor: string, of: string): boolean => {
    for (let at = tasks.get(of)?.parent; at; at = tasks.get(at)?.parent) if (at === ancestor) return true
    return false
  }
  const hang = (parent: string): string => {
    let at = parent
    while (at && depthOf(at) >= ROUTE_FLOW_MAX_DEPTH) at = tasks.get(at)?.parent ?? ''
    return at
  }

  const exchangeWords = input.texts.map(text => flowWords(`${text.participant} ${text.replies.join(' ')}`))
  const participantWords = input.texts.map(text => flowWords(text.participant))

  for (let k = from; k < upto; k++) {
    const entry = kept.get(k + 1)
    const previousId = assign[k - 1] ?? ''
    let id = ''
    let created: Draft | undefined
    if (entry) {
      const raw = flat(entry['task'])
      id = alias.get(raw) ?? ''
      if (!id) {
        const title = cleanWorkingTitle(entry['title'])
        if (title && tasks.size < ROUTE_FLOW_MAX_NODES) {
          id = `t${next++}`
          alias.set(raw || id, id)
          const parent = hang(alias.get(flat(entry['from'])) ?? '')
          created = { id, title, state: 'open', ...(parent ? { parent } : {}) }
          tasks.set(id, created)
        } else {
          id = previousId
        }
      }
    } else {
      id = previousId
    }
    if (!id) {
      // Exchange 1 with nothing usable: an untitled task. The card names it
      // later, and the shell says "untitled" meanwhile.
      id = `t${next++}`
      if (entry && flat(entry['task'])) alias.set(flat(entry['task']), id)
      created = { id, title: '', state: 'open' }
      tasks.set(id, created)
    }
    if (entry) {
      const state = stateWord(entry['state'])
      if (state) tasks.get(id)!.state = state
      const dropped = alias.get(flat(entry['drops']))
      // Dropping one's own ancestor is ignored: the all-new-example variant
      // dropped the whole plan that way.
      if (dropped && dropped !== id && !isAncestor(dropped, id)) tasks.get(dropped)!.state = 'dropped'
    }
    assign[k] = id

    // 6. RE-HOME. The review run filed "Write a test for the fold anchoring
    // from earlier." under an unrelated rename in all five runs. An exchange
    // that shares no word with the node it was put under — nor with any of
    // that node's ancestors — while exactly ONE other node's covered text
    // shares at least two words with it, belongs to that node. Covered text,
    // not titles: the test shares no word with "Fix sidebar jump" and shares
    // "fold" and "anchor" with the exchanges that raised them.
    if (k < 1) continue
    const words = participantWords[k]
    if (!words || words.size < 2) continue
    const tested = created ? created.parent : id
    if (!tested) continue
    const covering = (node: string): number => {
      const covered = new Set<string>(flowWords(tasks.get(node)?.title ?? ''))
      for (let j = 0; j < k; j++) {
        const owner = assign[j]!
        if (owner !== node && !isAncestor(node, owner)) continue
        for (const word of exchangeWords[j] ?? []) covered.add(word)
      }
      return overlap(words, covered)
    }
    if (covering(tested) > 0) continue
    let clear = true
    for (let at = tasks.get(tested)?.parent; at; at = tasks.get(at)?.parent) if (covering(at) > 0) { clear = false; break }
    if (!clear) continue
    const candidates = [...tasks.keys()].filter(node => node !== tested && node !== created?.id && covering(node) >= 2)
    // An ancestor's covered text holds its descendants' by definition, so a
    // node and its own ancestor both matching is ONE match, not a tie: the
    // deepest of a chain is the node the words are about.
    const deepest = candidates.filter(node => !candidates.some(other => other !== node && isAncestor(node, other)))
    if (deepest.length !== 1) continue
    const home = deepest[0]!
    if (created) {
      const parent = hang(home)
      if (parent) created.parent = parent; else delete created.parent
    } else {
      assign[k] = home
    }
  }

  const referenced = new Set(assign)
  const keep = new Set<string>()
  const firstSeen = new Map<string, number>()
  assign.forEach((id, index) => {
    for (let at: string | undefined = id; at; at = tasks.get(at)?.parent) {
      keep.add(at)
      if (!firstSeen.has(at)) firstSeen.set(at, index)
    }
  })
  const children = new Map<string, Draft[]>()
  for (const draft of tasks.values()) {
    if (!keep.has(draft.id)) continue
    const key = draft.parent ?? ''
    const held = children.get(key)
    if (held) held.push(draft); else children.set(key, [draft])
  }
  const order: Draft[] = []
  const walk = (parent: string): void => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0))
    for (const draft of list) { order.push(draft); walk(draft.id) }
  }
  walk('')
  if (!order.length || !referenced.size) return null
  return { nodes: order, exchanges: assign }
}

/** Whatever the model said → the JSON value it meant, or null. Lenient on
 *  purpose: a `<think>` block (closed or not), code fences, and prose around
 *  the JSON come off; a trailing comma is forgiven. */
export const extractRouteFlow = (text: string): unknown => {
  let body = String(text ?? '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
  const fence = /```[\w-]*[ \t]*\r?\n?([\s\S]*?)```/.exec(body)
  if (fence) body = fence[1]!
  else body = body.replace(/^\s*```[\w-]*/, '')
  const spans: Array<[number, string]> = []
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const from = body.indexOf(open)
    const to = body.lastIndexOf(close)
    if (from >= 0 && to > from) spans.push([from, body.slice(from, to + 1)])
  }
  spans.sort((a, b) => a[0] - b[0])
  for (const [, span] of spans) {
    for (const candidate of [span, span.replace(/,\s*([}\]])/g, '$1')]) {
      try { return JSON.parse(candidate) } catch { /* the next form */ }
    }
  }
  return null
}

// ── stage 2: a card per node ────────────────────────────────────────────

/** What the card model is told. Change a word, bump `ROUTE_FLOW_CARD_VERSION`. */
export const ROUTE_FLOW_CARD_SYSTEM = [
  'You write the card for ONE task in a conversation: its name and its summary.',
  'Say only what the messages below show. If they do not say how it ended, say where the last reply left it.',
  '',
  'title: 3 to 8 words. Start with a verb (Build, Fix, Choose, Add, Plan, Trace, Replace ...). Name the SPECIFIC',
  '  thing from the messages: the tile, page, bug, feature, file or option. A task with branches is named for the',
  '  goal ALL its branches serve, never for one of them. Never a vague word like task, issue, problem, discussion,',
  '  question, update, changes, help, work, or conversation. Sentence case, no quotes, no period.',
  '  When a CURRENT NAME is given, keep it unless it no longer fits.',
  'goal: one sentence: what it set out to do.',
  'done: one or two sentences: what was actually done or decided, with the specifics (names, choices, causes,',
  '  fixes, numbers), in the order it happened. For a task with branches, say what the branches came to in a',
  '  few words each; do not repeat their cards.',
  'outcome: one sentence: how it ended: the result, or exactly what is still open. A FAILED attempt that was',
  '  never fixed is still open.',
  'kind: what this was, ONE of: "fix" (something broken was repaired), "idea" (something new was proposed or',
  '  designed), "choice" (an option was weighed or settled), "build" (something was made, added or changed),',
  '  "look" (something was read, checked or explained).',
  '',
  'Write about the work, never about the people ("Fixed the ...", not "The user asked ..."), and never use the',
  'words task, card, branch or state in the text. Reply with JSON only.',
].join('\n')

export const ROUTE_FLOW_CARD_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, goal: { type: 'string' }, done: { type: 'string' }, outcome: { type: 'string' },
    kind: { type: 'string', enum: ['fix', 'idea', 'choice', 'build', 'look'] },
  },
  required: ['title', 'goal', 'done', 'outcome', 'kind'],
} as const

/** A kind word the model gave, or undefined — never a reason to refuse a card. */
export const flowKind = (value: unknown): RouteFlowKind | undefined => {
  const word = flat(value).toLowerCase()
  return (ROUTE_FLOW_KINDS as readonly string[]).includes(word) ? word as RouteFlowKind : undefined
}

// ── the session card ────────────────────────────────────────────────────

/** What the session model is told. Change a word, bump `ROUTE_FLOW_SESSION_VERSION`. */
export const ROUTE_FLOW_SESSION_SYSTEM = [
  'You name ONE conversation and say where it stands, from the cards of the steps it worked through.',
  'name: 3 to 8 words naming the GOAL the whole conversation serves — the thing being built, fixed or decided.',
  '  Verb first or a noun phrase, naming the specific thing. Never a vague word like task, discussion, chat,',
  '  help, work, update, or conversation. Sentence case, no quotes, no period.',
  'stands: one or two sentences, at most 200 characters, on where things stand NOW: what is finished, and',
  '  exactly what is still open or waiting on someone. Name the specifics (the tile, the fix, the choice).',
  '',
  'Write about the work, never about the people, and never use the words task, card, step, branch or',
  'conversation in the text. Reply with JSON only.',
].join('\n')

export const ROUTE_FLOW_SESSION_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' }, stands: { type: 'string' } },
  required: ['name', 'stands'],
} as const

export interface RouteFlowSessionInputs {
  readonly prompt: string
  /** Every card's text — what the name must be grounded in. */
  readonly covered: string
}

/** The session prompt: the steps in preorder, one line each, with their
 *  cards' outcomes; then the counts. Nodes without a current card are listed
 *  by title alone. */
export const routeFlowSessionInputs = (flow: Pick<RouteFlowRecord, 'nodes'>): RouteFlowSessionInputs => {
  const depthOf = (id: string): number => {
    let depth = 0
    for (let at = flow.nodes.find(n => n.id === id)?.parent; at; at = flow.nodes.find(n => n.id === at)?.parent) depth++
    return depth
  }
  const lines = flow.nodes.map(node => {
    const card = node.card && !node.card.stale ? node.card : undefined
    return `${'  '.repeat(depthOf(node.id))}- [${node.state}] ${node.title || 'untitled'}${card ? `: ${card.outcome}` : ''}`
  })
  const counts = countStates(flow.nodes.map(node => node.state))
  const prompt = [
    'STEPS, in order (a step under another is a branch of it):',
    ...lines,
    '',
    `${counts.done} done, ${counts.open} open, ${counts.decided} decided, ${counts.dropped} dropped.`,
    '',
    'Write the name and where it stands as JSON.',
  ].join('\n')
  const covered = flow.nodes.map(node => [node.title, node.card?.goal, node.card?.done, node.card?.outcome].filter(Boolean).join(' ')).join('\n')
  return { prompt, covered }
}

export type FlowSessionCheck =
  | { readonly ok: true; readonly session: { readonly name: string; readonly stands: string } }
  | { readonly ok: false; readonly why: string }

/** The session validator: the name through `checkFlowTitle` against every
 *  card's text; `stands` clipped to its limit at a sentence break, refused
 *  when short, naming a role, or talking about "the task/card/step". */
export const checkFlowSession = (obj: unknown, context: { readonly covered: string }): FlowSessionCheck => {
  const source = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>
  const name = checkFlowTitle(source['name'], { covered: context.covered, corpus: context.covered })
  if (!name.ok) return { ok: false, why: `name rejected (${name.why})` }
  let stands = flat(source['stands']).replace(/^["'`]+|["'`]+$/g, '').trim()
  const limit = ROUTE_FLOW_SESSION_STANDS_CHARS
  if (stands.length > limit) {
    const cut = stands.slice(0, limit)
    const stop = cut.lastIndexOf('. ')
    stands = stop > limit * 0.6 ? cut.slice(0, stop + 1) : `${stands.slice(0, limit - 1).trimEnd()}…`
  }
  if (stands.length < 12) return { ok: false, why: 'short-stands' }
  if (/\b(user|user's|assistant|participant|chatbot)\b/i.test(stands)) return { ok: false, why: 'role-stands' }
  if (/\b(the|this) (task|card|step|branch|conversation)\b/i.test(stands)) return { ok: false, why: 'meta-stands' }
  return { ok: true, session: { name: name.title, stands } }
}

const countStates = (states: readonly RouteFlowState[]): Record<RouteFlowState, number> => {
  const out: Record<RouteFlowState, number> = { done: 0, open: 0, decided: 0, dropped: 0 }
  for (const state of states) out[state]++
  return out
}

/** The session card's key: the nodes' ids, states and card keys, in order —
 *  any step's change makes the session due again. Independent of the model. */
export const sessionKey = (flow: Pick<RouteFlowRecord, 'nodes'>): Promise<string> => {
  const text = [
    'chat:route-flow-session', `sv${ROUTE_FLOW_SESSION_VERSION}`,
    ...flow.nodes.map(node => `${node.id}:${node.state}:${node.card && !node.card.stale ? node.card.key : ''}`),
  ].join('\n')
  const bytes = new TextEncoder().encode(text)
  return SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

/** Is a session card owed? Once every step's card is current — or, when the
 *  caller says so, once nothing more can be carded right now (a refused card
 *  in back-off must not hold the conversation's name for ten minutes). */
export const sessionDue = async (
  record: Pick<RouteFlowRecord, 'nodes' | 'pending' | 'session'>,
  allowPending = false,
): Promise<boolean> => {
  if (record.pending > 0 && !allowPending) return false
  const session = record.session
  if (!session || session.stale || session.sv !== ROUTE_FLOW_SESSION_VERSION) return true
  return session.key !== await sessionKey(record)
}

export interface RouteFlowCardPromptInput {
  readonly state: RouteFlowState
  readonly title: string
  /** The title came from a card: CURRENT NAME, else WORKING NAME. */
  readonly named?: boolean
  /** The parent's display title, when parented. */
  readonly partOf?: string
  readonly branches: readonly { readonly title: string; readonly state: RouteFlowState; readonly outcome?: string }[]
  readonly messages: readonly {
    /** The turn's index in the thread. */
    readonly index: number
    readonly role: TurnRole
    readonly text: string
    readonly work?: readonly Pick<RouteAttempt, 'verb' | 'cell' | 'outcome'>[]
    readonly decided?: string
  }[]
}

/**
 * The user message for one card. A leaf reads up to 7,000 characters of its
 * covered text, a parent 4,000 because it also carries its branches' outcomes;
 * over budget, each turn keeps its first 70% and last 30% of a per-turn cap.
 * Measured: at most 974 tokens in and 161 out.
 */
export const routeFlowCardPrompt = (input: RouteFlowCardPromptInput): string => {
  const lines = [
    `STATUS: ${input.state}`,
    input.named ? `CURRENT NAME: ${input.title}` : `WORKING NAME: ${input.title}`,
    ...(input.partOf !== undefined ? [`PART OF: ${input.partOf}`] : []),
  ]
  if (input.branches.length) {
    lines.push('', 'ITS BRANCHES (each already has its own card):')
    for (const branch of input.branches) lines.push(`- ${branch.title} [${branch.state}]${branch.outcome ? `: ${branch.outcome}` : ''}`)
  }
  lines.push('', 'MESSAGES:')
  const budget = input.branches.length ? FLOW_CARD_PARENT_CHARS : FLOW_CARD_LEAF_CHARS
  const total = input.messages.reduce((sum, message) => sum + message.text.length, 0)
  const cap = Math.max(300, Math.floor(budget / Math.max(1, input.messages.length)))
  for (const message of input.messages) {
    const text = total > budget && message.text.length > cap
      ? `${message.text.slice(0, Math.ceil(cap * 0.7))} … ${message.text.slice(-Math.floor(cap * 0.3))}`
      : message.text
    lines.push(`[${message.index + 1}] ${message.role === 'user' ? 'participant' : 'reply'}: ${text}`)
    if (message.work?.length) lines.push(`    work: ${message.work.map(attemptLine).join(' · ')}`)
    if (message.decided) lines.push(`    decided: ${message.decided}`)
  }
  lines.push('', 'Write the card as JSON.')
  return lines.join('\n')
}

/** A node's own exchanges (0-based) and turns, by id. A parent's turns do not
 *  include its branches': pressing a parent brings the thread to where that
 *  goal was stated, and lighting the whole subtree would light most of the
 *  conversation. */
const nodeCoverage = (
  flow: Pick<RouteFlowRecord, 'exchanges' | 'upToTurnCount'>,
  turns: readonly Pick<RouteTurn, 'role'>[],
): Map<string, { exchanges: number[]; turns: number[] }> => {
  const starts = exchangeStarts(turns)
  const out = new Map<string, { exchanges: number[]; turns: number[] }>()
  flow.exchanges.forEach((id, k) => {
    const held = out.get(id) ?? { exchanges: [], turns: [] }
    held.exchanges.push(k)
    const { from, to } = exchangeRange(starts, k, Math.min(turns.length, flow.upToTurnCount))
    for (let index = from; index < to; index++) held.turns.push(index)
    out.set(id, held)
  })
  return out
}

const childrenOf = <N extends Pick<RouteFlowNode, 'id' | 'parent'>>(nodes: readonly N[]): Map<string, N[]> => {
  const out = new Map<string, N[]>()
  for (const node of nodes) {
    const key = node.parent ?? ''
    const held = out.get(key)
    if (held) held.push(node); else out.set(key, [node])
  }
  return out
}

const postOrder = <N extends Pick<RouteFlowNode, 'id' | 'parent'>>(nodes: readonly N[]): N[] => {
  const children = childrenOf(nodes)
  const known = new Set(nodes.map(node => node.id))
  const out: N[] = []
  const walk = (node: N): void => { for (const child of children.get(node.id) ?? []) walk(child); out.push(node) }
  for (const node of nodes) if (!node.parent || !known.has(node.parent)) walk(node)
  return out
}

const ancestorsOf = (nodes: readonly Pick<RouteFlowNode, 'id' | 'parent'>[], id: string): Set<string> => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const out = new Set<string>()
  for (let at = byId.get(id)?.parent; at && !out.has(at); at = byId.get(at)?.parent) out.add(at)
  return out
}

const descendantsOf = (nodes: readonly Pick<RouteFlowNode, 'id' | 'parent'>[], id: string): Set<string> => {
  const out = new Set<string>()
  for (const node of nodes) if (ancestorsOf(nodes, node.id).has(id)) out.add(node.id)
  return out
}

/** Everything one card call is built from, and what its answer is checked against. */
export interface RouteFlowCardInputs {
  readonly prompt: string
  /** Everything the card was given — the prompt itself. */
  readonly given: string
  /** The covered text of every node that is neither this node, its ancestor nor its descendant. */
  readonly others: string
  /** The node's covered turn texts plus its child display titles. */
  readonly covered: string
  readonly participants: readonly string[]
  readonly childTitles: readonly string[]
  /** The whole conversation, for title casing. */
  readonly corpus: string
  /** How many exchanges the node owns. */
  readonly exchanges: number
  /** Branch cards, for `copies-a-branch`. */
  readonly childCards: readonly Pick<RouteFlowCard, 'done'>[]
}

/**
 * One node's card inputs. MESSAGES are the node's own exchanges, EXCEPT meta
 * exchanges — a wrap-up or courtesy exchange that talks about other steps.
 * On the review conversation "Where are we overall?" sat on the root, and the
 * root's card reported other steps' work as its own. An exchange is meta when
 * all hold: its participant text is at most 8 words; no attempt and no
 * decision sits on its rows; its participant words meet no node title and no
 * other exchange's participant text; and its last reply shares at least two
 * words with the covered text of each of at least two OTHER nodes. The last
 * condition is what keeps a terse "still broken" in: its reply is about its
 * own step. A node of nothing but meta exchanges keeps them all. A meta
 * exchange still belongs to its node for lighting and for the card key.
 */
export const routeFlowCardInputs = (
  flow: Pick<RouteFlowRecord, 'nodes' | 'exchanges' | 'upToTurnCount'>,
  nodeId: string,
  turns: readonly Pick<ChatTurn, 'role' | 'text'>[],
  route: Pick<Route, 'rows' | 'unfinished'>,
): RouteFlowCardInputs | null => {
  const node = flow.nodes.find(candidate => candidate.id === nodeId)
  if (!node) return null
  const coverage = nodeCoverage(flow, turns)
  const own = coverage.get(nodeId) ?? { exchanges: [], turns: [] }
  const starts = exchangeStarts(turns)
  const end = Math.min(turns.length, flow.upToTurnCount)
  const work = workByRow(route)
  const decisions = decisionsByRow(turns)
  const byId = new Map(flow.nodes.map(candidate => [candidate.id, candidate]))
  const children = flow.nodes.filter(candidate => candidate.parent === nodeId)

  const participantOf = (k: number): string => {
    const { from, to } = exchangeRange(starts, k, end)
    return turns.slice(from, to).filter(turn => turn.role === 'user').map(turn => exchangeText(turn.text)).join(' ')
  }
  const lastReplyOf = (k: number): string => {
    const { from, to } = exchangeRange(starts, k, end)
    const replies = turns.slice(from, to).filter(turn => turn.role === 'assistant')
    return exchangeText(replies[replies.length - 1]?.text ?? '')
  }
  const coveredText = (id: string): string =>
    (coverage.get(id)?.turns ?? []).map(index => exchangeText(turns[index]!.text)).join(' ')

  const titleWords = flowWords(flow.nodes.map(candidate => candidate.title).join(' '))
  const otherNodeWords = flow.nodes.filter(candidate => candidate.id !== nodeId).map(candidate => flowWords(coveredText(candidate.id)))
  const isMeta = (k: number): boolean => {
    const participant = participantOf(k)
    if (participant.split(' ').filter(Boolean).length > 8) return false
    const { from, to } = exchangeRange(starts, k, end)
    for (let index = from; index < to; index++) if (work.get(index)?.length || decisions.has(index)) return false
    const words = flowWords(participant)
    if (overlap(words, titleWords) > 0) return false
    for (let j = 0; j < flow.exchanges.length; j++) {
      if (j !== k && overlap(words, flowWords(participantOf(j))) > 0) return false
    }
    const reply = flowWords(lastReplyOf(k))
    return otherNodeWords.filter(covered => overlap(reply, covered) >= 2).length >= 2
  }
  const meta = new Set(own.exchanges.filter(isMeta))
  const messageExchanges = meta.size === own.exchanges.length ? own.exchanges : own.exchanges.filter(k => !meta.has(k))
  const messageTurns: number[] = []
  for (const k of messageExchanges) {
    const { from, to } = exchangeRange(starts, k, end)
    for (let index = from; index < to; index++) messageTurns.push(index)
  }

  const parent = node.parent ? byId.get(node.parent) : undefined
  const prompt = routeFlowCardPrompt({
    state: node.state,
    title: node.title,
    named: !!node.named,
    ...(parent ? { partOf: parent.title } : {}),
    branches: children.map(child => ({
      title: child.title, state: child.state,
      ...(child.card && !child.card.stale ? { outcome: child.card.outcome } : {}),
    })),
    messages: messageTurns.map(index => {
      const decision = decisions.get(index)
      return {
        index,
        role: turns[index]!.role,
        text: cardText(turns[index]!.text),
        ...(work.get(index)?.length ? { work: work.get(index) } : {}),
        ...(decision ? { decided: `${decision.prompt} → ${decision.chosen}` } : {}),
      }
    }),
  })
  const related = new Set([nodeId, ...ancestorsOf(flow.nodes, nodeId), ...descendantsOf(flow.nodes, nodeId)])
  return {
    prompt,
    given: prompt,
    others: flow.nodes.filter(candidate => !related.has(candidate.id)).map(candidate => coveredText(candidate.id)).join('\n'),
    covered: [...own.turns.map(index => cardText(turns[index]!.text)), ...children.map(child => child.title)].join('\n'),
    participants: own.turns.filter(index => turns[index]!.role === 'user').map(index => cardText(turns[index]!.text)),
    childTitles: children.map(child => child.title),
    corpus: turns.map(turn => String(turn.text ?? '')).join('\n'),
    exchanges: own.exchanges.length,
    childCards: children.flatMap(child => (child.card ? [child.card] : [])),
  }
}

export type FlowTitleCheck =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly title: string; readonly why: string }

/** Sentence case the way the conversation writes: a non-first word shaped
 *  `Word` is lowercased when the conversation writes it in lowercase, so
 *  "Waitlist" becomes "waitlist" and "Fraunces", "Inter" and "Crumb" keep
 *  their capitals. (The review run put "Fix Ollama host Shadowing" on a card.) */
const sentenceCase = (title: string, corpus: string): string => {
  const lower = new Set(String(corpus ?? '').split(/[^\p{L}\p{N}]+/u).filter(word => /^\p{Ll}/u.test(word)))
  return title.split(' ').map((word, index) => {
    if (index === 0 || !/^\p{Lu}\p{Ll}+$/u.test(word.replace(/[^\p{L}]/gu, ''))) return word
    return lower.has(word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()) ? word.toLowerCase() : word
  }).join(' ')
}

/**
 * THE TITLE VALIDATOR (§4.1.5). Cleaned of quotes and a closing period, then
 * refused when it is too short or long, a question, names a role, holds no
 * content word, holds no content word the covered text grounds, copies the
 * start of a participant message (five words or more), or is exactly a
 * branch's title. An accepted title comes back sentence-cased against
 * `corpus` (the covered text when none is given).
 */
export const checkFlowTitle = (
  raw: unknown,
  context: {
    readonly covered: string
    readonly participants?: readonly string[]
    readonly childTitles?: readonly string[]
    readonly corpus?: string
  },
): FlowTitleCheck => {
  const title = flat(raw).replace(/^["'`*_“”‘’]+/, '').replace(/["'`*_“”‘’.。]+$/, '').trim()
  const words = title.split(' ').filter(Boolean)
  if (words.length < 2) return { ok: false, title, why: 'too-short' }
  if (words.length > ROUTE_FLOW_TITLE_WORDS) return { ok: false, title, why: 'too-long' }
  if (/[?!]/.test(title)) return { ok: false, title, why: 'question' }
  if (/\b(user|assistant|participant|chatbot)\b/i.test(title)) return { ok: false, title, why: 'role-word' }
  const content = contentWords(title)
  if (!content.length) return { ok: false, title, why: 'generic' }
  const hay = flat(context.covered).toLowerCase()
  if (!content.some(word => word.length >= 3 && hay.includes(word.slice(0, Math.min(5, word.length))))) {
    return { ok: false, title, why: 'ungrounded' }
  }
  const low = title.toLowerCase()
  if (words.length >= 5 && (context.participants ?? []).some(text => flat(text).toLowerCase().startsWith(low))) {
    return { ok: false, title, why: 'copied' }
  }
  if ((context.childTitles ?? []).some(child => flat(child).toLowerCase() === low)) return { ok: false, title, why: 'names-a-branch' }
  return { ok: true, title: sentenceCase(title, context.corpus ?? context.covered) }
}

/**
 * WHICH TITLE A NODE KEEPS, in order: a card-given title stays while the node
 * covers fewer than twice the exchanges it had when that card named it —
 * hysteresis, so names do not flap as a node grows a little; else a valid
 * model title; else the stage-1 working title, if it validates; else the
 * title as it is.
 */
export const pickFlowTitle = (input: {
  readonly current: string
  readonly named: boolean
  /** The node's card's `exchanges`, when it has a card. */
  readonly cardExchanges?: number
  /** How many exchanges the node covers now. */
  readonly exchanges: number
  readonly model: FlowTitleCheck
  readonly working?: FlowTitleCheck
}): { readonly title: string; readonly named: boolean } => {
  if (input.named && input.cardExchanges !== undefined && input.exchanges < 2 * input.cardExchanges) {
    return { title: input.current, named: true }
  }
  if (input.model.ok) return { title: input.model.title, named: true }
  if (!input.named && input.working?.ok) return { title: input.working.title, named: false }
  return { title: input.current, named: input.named }
}

export type FlowSummaryCheck =
  | { readonly ok: true; readonly summary: { readonly goal: string; readonly done: string; readonly outcome: string } }
  | { readonly ok: false; readonly why: string; readonly word?: string }

const jaccard = (a: string, b: string): number => {
  const x = new Set(contentWords(a))
  const y = new Set(contentWords(b))
  let shared = 0
  for (const word of x) if (y.has(word)) shared++
  return shared / Math.max(1, x.size + y.size - shared)
}

/**
 * THE SUMMARY VALIDATOR (§4.1.5). Each part is flattened and cut to its limit
 * (at the last sentence break past 60% of it, else a hard cut with `…`, never
 * longer than the limit), then the card is refused when a part is under 12
 * characters, names a role, talks about "the task/card/branch", two parts
 * repeat, a parent's `done` copies a branch's (content-word Jaccard over
 * 0.7), or a part holds a word of five letters or more that the card was
 * never given but ANOTHER step's text holds — another step's facts leaking
 * in. It cannot catch a fact invented from nowhere: a paraphrase and an
 * invention look the same to a word check.
 */
export const checkFlowSummary = (
  obj: unknown,
  context: { readonly given: string; readonly others: string; readonly childCards?: readonly Pick<RouteFlowCard, 'done'>[] },
): FlowSummaryCheck => {
  const source = (obj && typeof obj === 'object' ? obj : {}) as Record<string, unknown>
  const parts = { goal: '', done: '', outcome: '' }
  for (const part of ['goal', 'done', 'outcome'] as const) {
    const limit = ROUTE_FLOW_CARD_LIMITS[part]
    let text = flat(source[part]).replace(/^["'`]+|["'`]+$/g, '').trim()
    if (text.length > limit) {
      const cut = text.slice(0, limit)
      const stop = cut.lastIndexOf('. ')
      text = stop > limit * 0.6 ? cut.slice(0, stop + 1) : `${text.slice(0, limit - 1).trimEnd()}…`
    }
    if (text.length < 12) return { ok: false, why: `short-${part}` }
    if (/\b(user|user's|assistant|participant|chatbot)\b/i.test(text)) return { ok: false, why: `role-${part}` }
    if (/\b(the|this) (task|card|branch)\b/i.test(text)) return { ok: false, why: `meta-${part}` }
    parts[part] = text
  }
  if (parts.goal === parts.done || parts.done === parts.outcome) return { ok: false, why: 'repeated' }
  if ((context.childCards ?? []).some(card => jaccard(card.done, parts.done) > 0.7)) return { ok: false, why: 'copies-a-branch' }
  const given = flowWords(context.given)
  const others = flowWords(context.others)
  for (const part of ['goal', 'done', 'outcome'] as const) {
    for (const token of tokens(parts[part])) {
      if (token.length < 5 || STOP.has(token) || GENERIC.has(token)) continue
      const word = token.slice(0, 5)
      if (!given.has(word) && others.has(word)) return { ok: false, why: `ungrounded-${part}`, word: token }
    }
  }
  return { ok: true, summary: parts }
}

// ── the record ──────────────────────────────────────────────────────────

export interface RouteFlowCardKeyInput {
  /** The STORED state, not the rolled-up view state. */
  readonly state: RouteFlowState
  readonly turnSigs: readonly string[]
  readonly work: readonly Pick<RouteAttempt, 'verb' | 'cell' | 'outcome'>[]
  readonly decided: readonly FlowDecision[]
  /** The branches' keys, in order. */
  readonly childKeys: readonly string[]
}

/**
 * THE CARD KEY — keyed by the card's inputs, as the derived-cache doctrine
 * asks: the covered turns (a turn sig covers role and text), their settled
 * work, their decisions, the node's stored state and the branches beneath it.
 * Stamped with BOTH versions, because a key over immutable inputs is not
 * self-invalidating when the deriving code changes. It leaves out the model —
 * switching models must not re-derive every conversation — and titles, which
 * are outputs.
 */
export const cardKey = (input: RouteFlowCardKeyInput): Promise<string> => {
  const text = [
    'chat:route-flow-card', `cv${ROUTE_FLOW_CARD_VERSION}`, `v${ROUTE_FLOW_VERSION}`,
    `state:${input.state}`,
    ...input.turnSigs.map(sig => `turn:${sig}`),
    ...input.work.map(attempt => `work:${attempt.verb} ${attempt.cell ?? ''} ${attempt.outcome}`),
    ...input.decided.map(decision => `decided:${decision.prompt}→${decision.chosen}`),
    ...input.childKeys.map(key => `child:${key}`),
  ].join('\n')
  const bytes = new TextEncoder().encode(text)
  return SignatureService.sign(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

/** Every node's card key, post-order so a parent's key holds its branches'. */
const flowCardKeys = async (
  flow: Pick<RouteFlowRecord, 'nodes' | 'exchanges' | 'upToTurnCount'>,
  turns: readonly ChatTurn[],
  route: Pick<Route, 'rows' | 'unfinished'>,
): Promise<Map<string, string>> => {
  const coverage = nodeCoverage(flow, turns)
  const work = workByRow(route)
  const decisions = decisionsByRow(turns)
  const children = childrenOf(flow.nodes)
  const keys = new Map<string, string>()
  for (const node of postOrder(flow.nodes)) {
    const rows = coverage.get(node.id)?.turns ?? []
    keys.set(node.id, await cardKey({
      state: node.state,
      turnSigs: rows.map(index => turns[index]?.sig ?? ''),
      work: rows.flatMap(index => work.get(index) ?? []),
      decided: rows.flatMap(index => { const decision = decisions.get(index); return decision ? [decision] : [] }),
      childKeys: (children.get(node.id) ?? []).map(child => keys.get(child.id) ?? ''),
    }))
  }
  return keys
}

const HEX64 = /^[0-9a-f]{64}$/

const parseCard = (raw: unknown): RouteFlowCard | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const card = raw as Record<string, unknown>
  if (typeof card['key'] !== 'string' || !HEX64.test(card['key'])) return undefined
  if (typeof card['cv'] !== 'number' || !Number.isInteger(card['cv'])) return undefined
  const parts = { goal: '', done: '', outcome: '' }
  for (const part of ['goal', 'done', 'outcome'] as const) {
    const text = card[part]
    if (typeof text !== 'string' || !text.trim() || text.length > ROUTE_FLOW_CARD_LIMITS[part]) return undefined
    parts[part] = text
  }
  const exchanges = card['exchanges']
  if (typeof exchanges !== 'number' || !Number.isInteger(exchanges) || exchanges < 1) return undefined
  if (typeof card['model'] !== 'string' || !card['model'].trim()) return undefined
  const stale = card['stale'] === true || card['cv'] !== ROUTE_FLOW_CARD_VERSION
  const kind = flowKind(card['kind'])
  return {
    key: card['key'], cv: card['cv'], ...parts, ...(kind ? { kind } : {}), exchanges, model: card['model'],
    at: typeof card['at'] === 'number' && Number.isFinite(card['at']) ? card['at'] : 0,
    ...(stale ? { stale: true as const } : {}),
  }
}

/** A stored session card, or undefined — an invalid one is dropped, the
 *  record kept; an old `sv` reads `stale`. */
const parseSession = (raw: unknown): RouteFlowSession | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const session = raw as Record<string, unknown>
  if (typeof session['key'] !== 'string' || !HEX64.test(session['key'])) return undefined
  if (typeof session['sv'] !== 'number' || !Number.isInteger(session['sv'])) return undefined
  const name = flat(session['name'])
  const stands = flat(session['stands'])
  if (!name || name.length > FLOW_TITLE_CHARS || !stands || stands.length > ROUTE_FLOW_SESSION_STANDS_CHARS) return undefined
  if (typeof session['model'] !== 'string' || !session['model'].trim()) return undefined
  const stale = session['stale'] === true || session['sv'] !== ROUTE_FLOW_SESSION_VERSION
  return {
    key: session['key'], sv: session['sv'], name, stands, model: session['model'],
    at: typeof session['at'] === 'number' && Number.isFinite(session['at']) ? session['at'] : 0,
    ...(stale ? { stale: true as const } : {}),
  }
}

const pendingOf = (nodes: readonly RouteFlowNode[]): number =>
  nodes.filter(node => !node.card || node.card.stale).length

/**
 * A stored value → a record at THIS version for THIS conversation, repaired,
 * or null. The same function checks every record before it is written.
 *
 *   - another kind, version or conversation, no sig, or an `exchanges` that is
 *     not 1–400 strings reads as absent (a v1 record is minted again)
 *   - `settled` that is not an integer in [0, n] reads max(0, n − 5), always a
 *     window the next call can progress from
 *   - node ids are unique `t1…t999`; at most 32 nodes; a title is cleaned and
 *     may be empty only for exchange 1's node; an unknown state reads done; a
 *     parent must precede its node; deeper than 3 re-hangs at depth 2; a node
 *     nothing references (directly or through a descendant) drops
 *   - an exchange that names no node makes the record absent
 *   - an invalid card is removed and its node kept; a card at an older `cv`
 *     is kept and reads `stale`
 *   - `pending` is recomputed, never trusted from storage
 */
export const parseFlowRecord = (value: unknown, convoId: string): RouteFlowRecord | null => {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record['kind'] !== 'chat:route-flow' || record['v'] !== ROUTE_FLOW_VERSION || record['convoId'] !== convoId) return null
  const upTo = record['upToTurnCount']
  if (typeof upTo !== 'number' || !Number.isInteger(upTo) || upTo < 1) return null
  const upToSig = record['upToTurnSig']
  if (typeof upToSig !== 'string' || !upToSig) return null
  const exchanges = record['exchanges']
  if (!Array.isArray(exchanges) || !exchanges.length || exchanges.length > ROUTE_FLOW_MAX_EXCHANGES) return null
  if (!exchanges.every(id => typeof id === 'string' && id)) return null
  if (!Array.isArray(record['nodes'])) return null

  type Kept = { node: RouteFlowNode; depth: number }
  const kept = new Map<string, Kept>()
  for (const item of record['nodes'].slice(0, FLOW_RAW_ENTRIES)) {
    if (kept.size >= ROUTE_FLOW_MAX_NODES) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const id = typeof raw['id'] === 'string' && /^t\d{1,3}$/.test(raw['id']) ? raw['id'] : ''
    if (!id || kept.has(id)) continue
    const title = cleanWorkingTitle(raw['title'])
    if (!title && exchanges[0] !== id) continue
    let parent = typeof raw['parent'] === 'string' ? kept.get(raw['parent']) : undefined
    while (parent && parent.depth >= ROUTE_FLOW_MAX_DEPTH) parent = parent.node.parent ? kept.get(parent.node.parent) : undefined
    const card = parseCard(raw['card'])
    const node: RouteFlowNode = {
      id, title,
      ...(raw['named'] === true ? { named: true as const } : {}),
      state: stateWord(raw['state']) ?? 'done',
      ...(parent ? { parent: parent.node.id } : {}),
      ...(card ? { card } : {}),
    }
    kept.set(id, { node, depth: parent ? parent.depth + 1 : 1 })
  }
  for (const id of exchanges as string[]) if (!kept.has(id)) return null

  const referenced = new Set<string>()
  for (const id of exchanges as string[]) {
    for (let at: string | undefined = id; at && !referenced.has(at); at = kept.get(at)?.node.parent) referenced.add(at)
  }
  const nodes = [...kept.values()].map(entry => entry.node).filter(node => referenced.has(node.id))
  if (!nodes.length) return null
  const settledRaw = record['settled']
  const settled = typeof settledRaw === 'number' && Number.isInteger(settledRaw) && settledRaw >= 0 && settledRaw <= exchanges.length
    ? settledRaw
    : Math.max(0, exchanges.length - ROUTE_FLOW_OVERLAP)
  const session = parseSession(record['session'])
  return {
    kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId,
    upToTurnCount: upTo, upToTurnSig: upToSig,
    at: typeof record['at'] === 'number' && Number.isFinite(record['at']) ? record['at'] : 0,
    model: typeof record['model'] === 'string' ? record['model'] : '',
    exchanges: exchanges as string[], settled, nodes, pending: pendingOf(nodes),
    ...(session ? { session } : {}),
  }
}

/** Is this flow about THIS thread's history? The turn it read up to must still
 *  be there, with the same sig. */
export const flowMatches = (
  record: Pick<RouteFlowRecord, 'upToTurnCount' | 'upToTurnSig'>,
  turns: readonly RouteTurn[],
): boolean =>
  record.upToTurnCount <= turns.length && turns[record.upToTurnCount - 1]?.sig === record.upToTurnSig

/** The flow is about this history AND maps exactly the exchanges that start
 *  below what it read. Anything else is no flow: every exchange is a stage. */
const flowFits = (record: Pick<RouteFlowRecord, 'upToTurnCount' | 'upToTurnSig' | 'exchanges'>, turns: readonly RouteTurn[]): boolean =>
  flowMatches(record, turns)
  && exchangeStarts(turns).filter(start => start < record.upToTurnCount).length === record.exchanges.length

/**
 * THE VIEW the shell draws — never stored. A node's exchanges are 1-based; its
 * turns are its own exchanges' ranges. Its display state ROLLS UP: a node whose
 * own state is `open` shows `done` when it has branches, every descendant is
 * settled, and all of its own exchanges came before its first descendant's —
 * "Build a landing page [open]" over five finished branches. It does not fire
 * when the conversation came back to the parent later. Unmeasured.
 */
const flowView = (record: RouteFlowRecord, turns: readonly RouteTurn[], sessionStale = false): RouteFlowView | undefined => {
  if (!flowFits(record, turns)) return undefined
  const coverage = nodeCoverage(record, turns)
  const nodes = record.nodes.map((node): RouteFlowViewNode => {
    const own = coverage.get(node.id) ?? { exchanges: [], turns: [] }
    let state = node.state
    if (state === 'open') {
      const descendants = [...descendantsOf(record.nodes, node.id)]
      const settledAll = descendants.length > 0
        && descendants.every(id => record.nodes.find(candidate => candidate.id === id)?.state !== 'open')
      const firstDescendant = Math.min(...descendants.flatMap(id => coverage.get(id)?.exchanges ?? []))
      if (settledAll && own.exchanges.every(k => k < firstDescendant)) state = 'done'
    }
    const { key: _key, ...card } = node.card ?? ({} as RouteFlowCard)
    return {
      id: node.id, title: node.title,
      ...(node.named ? { named: true as const } : {}),
      state,
      ...(node.parent ? { parent: node.parent } : {}),
      exchanges: own.exchanges.map(k => k + 1),
      turns: own.turns,
      ...(node.card ? { detail: headClip(node.card.done, ROUTE_FLOW_DETAIL_CHARS - 1), card } : {}),
    }
  })
  const session = record.session
  return {
    upToTurnCount: record.upToTurnCount, pending: record.pending, model: record.model, nodes,
    ...(session ? { session: { sv: session.sv, name: session.name, stands: session.stands, model: session.model, at: session.at, ...(session.stale || sessionStale ? { stale: true as const } : {}) } } : {}),
    counts: countStates(nodes.map(node => node.state)),
  }
}

/** Node ids of this flow with a card answer in back-off right now. */
const backedOffCards = (convoId: string, flow: RouteFlowView, state: FlowCoordination): string[] => {
  const now = Date.now()
  const prefix = `${convoId}|c|`
  const ids = new Set(flow.nodes.map(node => node.id))
  const out = new Set<string>()
  for (const [key, at] of state.backoff) {
    if (!key.startsWith(prefix) || now - at >= ROUTE_FLOW_RETRY_MS) continue
    const nodeId = key.slice(prefix.length).split('|')[0] ?? ''
    if (ids.has(nodeId)) out.add(nodeId)
  }
  return [...out]
}

export interface FlowClosedOptions {
  readonly now?: number
  readonly idleMs?: number
  /** The run the shell is waiting on. */
  readonly liveRunId?: string
  /** The shell's own wait (a host stream has no run). */
  readonly waiting?: boolean
  /** A `mode:'chat'` ask for this conversation is still in the pool. */
  readonly pendingAsk?: boolean
}

/**
 * THE BEHIND RULE's half that reads the thread: one past the last turn of
 * the last CLOSED exchange, or 0 when no exchange is closed.
 *
 * An exchange with a later user turn is closed. The LAST exchange is closed
 * only when all hold: it holds a reply; nothing is live and nothing is
 * waiting; no `mode:'chat'` ask is outstanding for the conversation; and the
 * thread has been idle `ROUTE_FLOW_IDLE_MS`. Turns before the first user turn
 * open no exchange and ride along with the first one closed.
 */
export const closedFlowEnd = (turns: readonly RouteTurn[], options: FlowClosedOptions = {}): number => {
  const starts = exchangeStarts(turns)
  if (!starts.length) return 0
  const last = starts[starts.length - 1]!
  const lastClosed = !String(options.liveRunId ?? '').trim()
    && !options.waiting
    && !options.pendingAsk
    && turns.slice(last + 1).some(turn => turn.role === 'assistant')
    && (options.now ?? Date.now()) - (turns[turns.length - 1]?.at ?? 0) >= (options.idleMs ?? ROUTE_FLOW_IDLE_MS)
  if (lastClosed) return turns.length
  return starts.length > 1 ? last : 0
}

/** THE BEHIND RULE: re-derive when a closed exchange lies beyond what the
 *  flow read — or there is no flow and something is closed. */
export const flowIsBehind = (
  record: Pick<RouteFlowRecord, 'upToTurnCount'> | null | undefined,
  closedEnd: number,
): boolean => closedEnd > 0 && (!record || closedEnd > record.upToTurnCount)

/** The closed end, capped: only the first 400 exchanges are ever mapped, so a
 *  flow that holds 400 is never behind for what follows them. */
const cappedClosedEnd = (turns: readonly RouteTurn[], options: FlowClosedOptions): number => {
  const starts = exchangeStarts(turns)
  const closed = closedFlowEnd(turns, options)
  return starts.length > ROUTE_FLOW_MAX_EXCHANGES ? Math.min(closed, starts[ROUTE_FLOW_MAX_EXCHANGES]!) : closed
}

/** The flows pool: opened without creating on every read, created only by a
 *  write. Null when the store cannot say. */
const flowsPool = async (store: StoreLike | undefined, create: boolean): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return (create ? await store?.getPool?.(ROUTE_FLOWS_POOL) : await store?.openPool?.(ROUTE_FLOWS_POOL)) ?? null
  } catch { return null }
}

/** The flow held for one conversation, or null: absent, empty, unparseable,
 *  another version, another conversation — all the same answer. Never throws,
 *  never creates the pool. */
export const readRouteFlow = async (convoId: string): Promise<RouteFlowRecord | null> => {
  const id = String(convoId ?? '').trim()
  if (!id) return null
  try {
    const store = get<StoreLike>('@hypercomb.social/Store')
    const pool = await flowsPool(store, false)
    if (!pool || !store?.getPoolDoc) return null
    const bytes = await store.getPoolDoc(pool, id)
    if (!bytes || !bytes.byteLength) return null
    return parseFlowRecord(JSON.parse(new TextDecoder().decode(bytes)), id)
  } catch { return null }
}

/** RECYCLE THE SLOT: the record becomes the conversation's ONE document in the
 *  pool (`putPoolDoc` with the convoId as sub-key writes the new member, then
 *  drops every other). Written straight into the pool — no resource, so no
 *  `content:wrote`, and nothing is enqueued for a host. The whole record is
 *  validated with `parseFlowRecord` before a byte is written: complete or
 *  absent, never a record the reader would refuse. */
export const writeRouteFlow = async (record: RouteFlowRecord): Promise<boolean> => {
  const checked = parseFlowRecord(record, record?.convoId)
  if (!checked) return false
  try {
    const store = get<StoreLike>('@hypercomb.social/Store')
    const pool = await flowsPool(store, true)
    if (!pool || !store?.putPoolDoc) return false
    const bytes = new TextEncoder().encode(JSON.stringify(checked))
    return !!(await store.putPoolDoc(pool, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, checked.convoId))
  } catch { return false }
}

/** WRITE THE RECORD, THEN ANNOUNCE IT. */
const commitFlow = async (record: RouteFlowRecord): Promise<boolean> => {
  if (!(await writeRouteFlow(record))) return false
  EffectBus.emit('chat:route-flow-changed', { convoId: record.convoId })
  return true
}

/**
 * CARDS FOLLOW NODES across a re-mapped window, by the first rule that holds:
 * the same id with the same first exchange is the same node, so its card stays
 * (current when its key matches, stale otherwise); else a previous card whose
 * key equals this node's key is exactly about this node's inputs; else none. A
 * released id issued again to a different node never inherits the old card.
 * A carried card brings the name it gave.
 */
const carryCards = (
  nodes: readonly Omit<RouteFlowNode, 'card'>[] | readonly RouteFlowNode[],
  exchanges: readonly string[],
  previous: Pick<RouteFlowRecord, 'nodes' | 'exchanges'> | null,
  keys: ReadonlyMap<string, string>,
): RouteFlowNode[] => {
  const firstOf = (list: readonly string[]): Map<string, number> => {
    const out = new Map<string, number>()
    list.forEach((id, index) => { if (!out.has(id)) out.set(id, index) })
    return out
  }
  const previousById = new Map((previous?.nodes ?? []).map(node => [node.id, node]))
  const previousFirst = firstOf(previous?.exchanges ?? [])
  const nextFirst = firstOf(exchanges)
  const byKey = new Map<string, RouteFlowNode>()
  for (const node of previous?.nodes ?? []) if (node.card) byKey.set(node.card.key, node)
  return nodes.map(draft => {
    const { card: _drop, ...node } = draft as RouteFlowNode
    const key = keys.get(node.id) ?? ''
    const same = previousById.get(node.id)
    const from = same?.card && previousFirst.get(node.id) === nextFirst.get(node.id) ? same : byKey.get(key)
    if (!from?.card) return node
    const current = from.card.key === key && !from.card.stale && from.card.cv === ROUTE_FLOW_CARD_VERSION
    const card: RouteFlowCard = current ? from.card : { ...from.card, stale: true }
    return { ...node, ...(from.named ? { title: from.title, named: true as const } : {}), card }
  })
}

// ── the gate, the model, the labeller ───────────────────────────────────

/**
 * THE MODEL YOU USE — an installed wire id on THIS provider, or null. Never
 * roster order: in order, the participant's stored choice (the model of their
 * last own local chat) when it names this provider and is still installed;
 * `fallback`, the model the last passive pass used, so the attended call never
 * forces a 10–17 s swap between two models; a conversation's remembered local
 * model, in the order given — the migration path for a hive whose stored
 * choice was never written, and never roster order either, because
 * `hc:chat-models` holds a local model only where it answered or was named.
 * Otherwise null, and the flow does not run. `modelForTier` and `defaultModel`
 * are never consulted: for anyone who chats through the bridge they WOULD be
 * the whole rule (§4.1.1).
 */
export const participantLocalModel = (
  provider: LlmProviderDescriptor,
  registry: Pick<LlmProviderRegistry, 'providerForModel' | 'resolveModelId'>,
  choice: { readonly providerId: string; readonly model: string } | null,
  options: { readonly convoIds?: readonly string[]; readonly fallback?: string } = {},
): string | null => {
  const installed = new Set(provider.models.map(m => m.id))
  const local = (word: string): string | null => {
    const w = word.trim()
    if (!w || registry.providerForModel(w)?.id !== provider.id) return null
    const id = registry.resolveModelId(provider, w)
    return installed.has(id) ? id : null
  }
  if (choice && choice.providerId === provider.id) { const id = local(choice.model); if (id) return id }
  if (options.fallback && installed.has(options.fallback)) return options.fallback
  for (const convoId of options.convoIds ?? []) { const id = local(conversationModel(convoId)); if (id) return id }
  return null
}

/**
 * STATE ONLY — a state read, never a knock.
 *
 * `localModelServerUp` is NOT used: it calls `refreshLocalServer`, which
 * probes whenever `worthKnocking` holds. This reads `localServerReport`, which
 * is `machineLocalEndpoint` (localStorage and a URL parse) plus a map lookup —
 * no fetch on any path. A provider counts only when its endpoint is loopback,
 * the participant has not switched it off, and the last probe somebody else
 * made said `awake`; its id must also resolve to itself, so a future resolver
 * fallback could not slip another vendor in. Not awake: 'off' when no
 * machine-local provider is enabled, else the first provider's report state,
 * local first.
 *
 * The dispatch modules are imported lazily, so reading a thread's route never
 * pulls the provider roster into the thread module's import graph.
 */
export const localOrganizerState = async (): Promise<
  | { readonly state: 'awake'; readonly provider: LlmProviderDescriptor }
  | { readonly state: Exclude<RouteOrganizerState, 'awake' | 'no-model'> }
> => {
  const [{ llmProviderRegistry }, { llmActivation }, liveness, dispatch] = await Promise.all([
    import('./llm-provider-registry.js'),
    import('./llm-activation.js'),
    import('./providers/local-liveness.js'),
    import('./llm-dispatch.js'),
  ])
  const all = llmProviderRegistry().all()
  const ordered = [...all.filter(p => p.id === 'local'), ...all.filter(p => p.id !== 'local')]
  let best: Exclude<RouteOrganizerState, 'awake' | 'no-model' | 'off'> | undefined
  for (const provider of ordered) {
    if (!liveness.machineLocalEndpoint(provider)) continue
    if (!llmActivation.isEnabled(provider.id)) continue
    const { state } = liveness.localServerReport(provider)
    if (state !== 'awake') { best ??= state; continue }
    let resolved
    try { resolved = dispatch.resolveProvider({ providerId: provider.id }) } catch { continue }
    if (resolved.id !== provider.id || !liveness.machineLocalEndpoint(resolved)) continue
    return { state: 'awake', provider }
  }
  return { state: best ?? 'off' }
}

/**
 * WHO MAY RUN THE BACKGROUND HELPER — the participant's setting
 * (`llmPolicy.orchestratorProvider`, model-policy.ts) decides between the
 * machine-local probe above and a named paid provider, gated the same way
 * every other tier is: switched on, and keyed if it needs a key. Default is
 * `'anthropic'` — Jaime, 2026-09-11, moved off the local-only default because
 * the local model is "just not there yet" — `'local'` asks for exactly the
 * probe `localOrganizerState` always ran.
 */
export const organizerGate = async (): Promise<
  | { readonly state: 'awake'; readonly provider: LlmProviderDescriptor }
  | { readonly state: Exclude<RouteOrganizerState, 'awake' | 'no-model'> }
> => {
  const { llmPolicy } = await import('./model-policy.js')
  const chosen = llmPolicy.orchestratorProvider
  if (chosen === 'local') return localOrganizerState()
  const [{ llmProviderRegistry }, { llmActivation }, core] = await Promise.all([
    import('./llm-provider-registry.js'),
    import('./llm-activation.js'),
    import('@hypercomb/core'),
  ])
  const provider = llmProviderRegistry().all().find(p => p.id === chosen)
  if (!provider) return { state: 'off' }
  if (!llmActivation.isEnabled(provider.id)) return { state: 'off' }
  if (provider.requiresKey !== false && !core.llmKeyStore.has(provider.id)) return { state: 'off' }
  return { state: 'awake', provider }
}

/** The wire model `organizerGate`'s provider should run at — the
 *  participant's own remembered local model for `'local'` (unchanged from
 *  before this setting existed), else the provider's model at
 *  `llmPolicy.orchestratorTier` (default `fast` — Haiku-weight: cheap and
 *  quick, the right size for mechanical tagging/summarizing). */
const organizerModel = async (
  gate: { readonly state: 'awake'; readonly provider: LlmProviderDescriptor },
  options: { readonly convoIds?: readonly string[]; readonly fallback?: string } = {},
): Promise<string | undefined> => {
  if (gate.provider.id === 'local') {
    const [{ llmProviderRegistry }, dispatch] = await Promise.all([import('./llm-provider-registry.js'), import('./llm-dispatch.js')])
    return participantLocalModel(gate.provider, llmProviderRegistry(), dispatch.participantLocalChoice(), options) ?? undefined
  }
  const { llmPolicy, modelForTier } = await import('./model-policy.js')
  return modelForTier(gate.provider, llmPolicy.orchestratorTier)
}

/** The machine-local model that may organize, ALREADY known awake. */
export interface RouteLabeller {
  readonly id: string
  /** The wire model every call of this labeller names. */
  readonly model: string
  readonly call: (call: LlmCall) => Promise<LlmCallResult>
}

/**
 * A labeller for a model ALREADY resolved. Run again immediately before every
 * call: it re-reads state and checks `model` is still installed; it never
 * re-resolves the model.
 *
 * A machine-local model's call strips the caller's knobs and adds
 * `thinking: false`, `jsonSchema` and `temperature` back — unless this server
 * refused them once this session, so the plain retry really is plain. A paid
 * provider's call passes the caller's knobs through unchanged — it is not the
 * one refusing them. Either way `providerId` and `model` are set LAST, so
 * nothing a caller passes can re-point the call. An explicit provider and
 * model give `routeCandidates` exactly one candidate and `callModel` makes one
 * attempt: there is no fallback to any other vendor.
 */
export const awakeOrganizerLabeller = async (model: string): Promise<RouteLabeller | null> => {
  const wanted = String(model ?? '').trim()
  if (!wanted) return null
  const gate = await organizerGate()
  if (gate.state !== 'awake') return null
  if (!gate.provider.models.some(m => m.id === wanted)) return null
  const dispatch = await import('./llm-dispatch.js')
  const id = gate.provider.id
  const isLocal = id === 'local'
  return {
    id,
    model: wanted,
    call: c => {
      if (!isLocal) return dispatch.callModel({ ...c, providerId: id, model: wanted })
      const { thinking: _thinking, jsonSchema, temperature, ...rest } = c
      const plain = flowState().plainLocalModels.has(wanted)
      return dispatch.callModel({
        ...rest,
        ...(plain ? {} : { thinking: false as const, jsonSchema, temperature }),
        providerId: id, model: wanted,
      })
    },
  }
}

/** `organizerState` and `organizer` for a route read. Never throws, never probes. */
const organizerFields = async (convoId: string): Promise<Pick<Route, 'organizerState' | 'organizer'>> => {
  try {
    const gate = await organizerGate()
    if (gate.state !== 'awake') return { organizerState: gate.state }
    const model = await organizerModel(gate, { fallback: flowState().lastPassModel, convoIds: [convoId] })
    return model ? { organizerState: 'awake', organizer: { providerId: gate.provider.id, model } } : { organizerState: 'no-model' }
  } catch { return {} }
}

// ── the lane ────────────────────────────────────────────────────────────

/** The conversations with a `mode:'chat'` ask still in the pool — read at
 *  most once per pass. Null when that cannot be found out, which the behind
 *  rule treats as "maybe": a last exchange is never closed on a guess. */
const pendingChatAsks = async (): Promise<Set<string> | null> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  if (!store?.listOptimizations || !store.getOptimization) return null
  let sigs: string[]
  try { sigs = await store.listOptimizations() } catch { return null }
  const out = new Set<string>()
  for (const sig of sigs) {
    try {
      const blob = await store.getOptimization(sig)
      if (!blob) continue
      const record = JSON.parse(await blob.text()) as { kind?: unknown; payload?: { mode?: unknown; convoId?: unknown } }
      if (record?.kind === 'ask' && record.payload?.mode === 'chat' && typeof record.payload.convoId === 'string') {
        out.add(record.payload.convoId)
      }
    } catch { /* an unreadable record is not an ask for anyone */ }
  }
  return out
}

const once = <T,>(read: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined
  return () => (held ??= read())
}

type OrganizeOutcome =
  | 'wrote'       // a record was written and announced
  | 'current'     // nothing to do
  | 'busy'        // another mint for this conversation is running
  | 'backoff'     // its last answer was unusable, recently
  | 'unusable'    // the model answered nothing valid; no write for it
  | 'unreadable'  // its records could not be read; no call
  | 'gate'        // no machine-local model awake, or the model is gone
  | 'fault'       // a call or a write failed — the pass stops
  | 'yielded'     // the participant's chat or an attended call took the lane
  | 'timeout'     // a call ran out of time — the pass stops
  | 'budget'      // the pass's call or time budget ran out

type CallOutcome = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly why: 'gate' | 'yielded' | 'timeout' | 'fault' | 'budget' }

interface OrganizeOptions {
  readonly attended: boolean
  /** The wire model every call names — resolved once by the caller. */
  readonly model: string
  readonly liveRunId?: string
  readonly waiting?: boolean
  readonly now: () => number
  readonly pending: () => Promise<Set<string> | null>
  /** The list's own facts, when the drain has them. */
  readonly summary?: Pick<ConversationSummary, 'turnCount'>
  /** Checked before every call: a reason to stop, or null. */
  readonly beforeCall?: () => 'yield' | 'budget' | null
  /** Counted after every call. */
  readonly afterCall?: () => void
  /** The attended run's claim on the lane, counted once it first wants a call. */
  readonly claim?: { counted: boolean }
}

/** A 400/422 that names a knob: this server does not speak them. */
const refusesKnobs = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status
  return (status === 400 || status === 422)
    && /reasoning_effort|response_format|json_schema/i.test(String((error as { message?: unknown } | null)?.message ?? ''))
}

/**
 * ONE FLOW MODEL CALL AT A TIME, and the participant always wins.
 *
 * Refused before anything while the lane is paused after the participant's own
 * chat. An attended call never waits behind the drain: it aborts a passive
 * call in flight, whose outcome is then `yielded` with no back-off and nothing
 * written. A passive call that waited re-checks for an attended call before it
 * starts. The call runs under its own controller, aborted by a pause, by an
 * attended call, or by its timeout — an aborted fetch is rethrown by the
 * dispatch without re-probing, so a timeout never marks the server asleep.
 */
const withLane = async (
  state: FlowCoordination,
  attended: boolean,
  convoId: string,
  timeoutMs: number,
  run: (signal: AbortSignal, timedOut: () => boolean) => Promise<CallOutcome>,
): Promise<CallOutcome> => {
  if (attended && state.inFlight && !state.inFlight.attended) state.inFlight.abort.abort()
  const before = state.tail
  let release!: () => void
  const mine = new Promise<void>(resolve => { release = resolve })
  state.tail = before.then(() => mine)
  try {
    await before
    if (Date.now() < state.pausedUntil) return { ok: false, why: 'yielded' }
    if (!attended && state.attendedWaiting > 0) return { ok: false, why: 'yielded' }
    const abort = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; abort.abort() }, timeoutMs)
    state.inFlight = { abort, attended, convoId }
    try {
      return await run(abort.signal, () => timedOut)
    } finally {
      clearTimeout(timer)
      if (state.inFlight?.abort === abort) state.inFlight = null
    }
  } finally {
    release()
  }
}

/** One flow model call, gated, through the lane, announced around itself. */
const flowCall = async (
  convoId: string,
  options: OrganizeOptions,
  stage: RouteOrganizing,
  call: Omit<LlmCall, 'signal' | 'providerId' | 'model'>,
  timeoutMs: number,
): Promise<CallOutcome> => {
  const state = flowState()
  const stop = options.beforeCall?.()
  if (stop) return { ok: false, why: stop === 'budget' ? 'budget' : 'yielded' }
  if (Date.now() < state.pausedUntil) return { ok: false, why: 'yielded' }
  const labeller = await awakeOrganizerLabeller(options.model)
  if (!labeller) return { ok: false, why: 'gate' }
  if (options.attended && options.claim && !options.claim.counted) {
    options.claim.counted = true
    state.attendedWaiting++
  }
  return withLane(state, options.attended, convoId, timeoutMs, async (signal, timedOut) => {
    state.organizingNow.set(convoId, stage)
    EffectBus.emit('chat:route-flow-organizing', { convoId, ...stage, active: true })
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await labeller.call({ ...call, signal })
          return { ok: true, text: result.text ?? '' }
        } catch (error) {
          if (signal.aborted) return { ok: false, why: timedOut() ? 'timeout' : 'yielded' }
          // A server that refuses the knobs gets them never again this
          // session, and this call once more, plain. The labeller reads the
          // set on every call, so the retry really carries none of them.
          if (attempt === 0 && refusesKnobs(error) && !state.plainLocalModels.has(labeller.model)) {
            state.plainLocalModels.add(labeller.model)
            continue
          }
          return { ok: false, why: 'fault' }
        }
      }
    } finally {
      if (state.organizingNow.get(convoId) === stage) state.organizingNow.delete(convoId)
      EffectBus.emit('chat:route-flow-organizing', { convoId, ...stage, active: false })
      options.afterCall?.()
    }
  })
}

// ── one conversation ────────────────────────────────────────────────────

interface OrganizeResult {
  readonly outcome: OrganizeOutcome
  readonly wrote: boolean
  readonly dueIn?: number
}

/** A record over a stage-1 tree or an advance, cards carried and flagged. */
const settleRecord = async (
  base: Pick<RouteFlowRecord, 'convoId' | 'upToTurnCount' | 'upToTurnSig' | 'model' | 'exchanges' | 'settled'> & {
    readonly nodes: readonly Omit<RouteFlowNode, 'card'>[] | readonly RouteFlowNode[]
  },
  previous: (Pick<RouteFlowRecord, 'nodes' | 'exchanges'> & { readonly session?: RouteFlowSession }) | null,
  turns: readonly ChatTurn[],
  route: Pick<Route, 'rows' | 'unfinished'>,
): Promise<RouteFlowRecord> => {
  const keys = await flowCardKeys(
    { nodes: base.nodes as RouteFlowNode[], exchanges: base.exchanges, upToTurnCount: base.upToTurnCount }, turns, route)
  const nodes = carryCards(base.nodes, base.exchanges, previous, keys)
  return {
    kind: 'chat:route-flow', v: ROUTE_FLOW_VERSION, convoId: base.convoId,
    upToTurnCount: base.upToTurnCount, upToTurnSig: base.upToTurnSig, at: Date.now(), model: base.model,
    exchanges: base.exchanges, settled: base.settled, nodes, pending: pendingOf(nodes),
    // The session card rides along; `sessionDue` reads its key against the
    // new nodes, so a changed step makes it due without a flag here.
    ...(previous?.session ? { session: previous.session } : {}),
  }
}

/** The next node to card: post-order, the preferred node's subtree first. */
const nextCard = (
  flow: RouteFlowRecord,
  keys: ReadonlyMap<string, string>,
  skip: ReadonlySet<string>,
  prefer: string | undefined,
): RouteFlowNode | undefined => {
  const due = postOrder(flow.nodes).filter(node => {
    if (skip.has(node.id)) return false
    const card = node.card
    return !card || card.stale || card.cv !== ROUTE_FLOW_CARD_VERSION || card.key !== keys.get(node.id)
  })
  if (prefer && flow.nodes.some(node => node.id === prefer)) {
    const subtree = descendantsOf(flow.nodes, prefer).add(prefer)
    const first = due.find(node => subtree.has(node.id))
    if (first) return first
  }
  return due[0]
}

/**
 * ONE CONVERSATION — the body the attended call and the drain share. Silent on
 * every failure. In order: the pinned guard; the held flow; the shortcut (a
 * flow that read every turn and has no pending card is current without
 * reading the thread — an old `cv` counts as pending, so a card version bump
 * never takes it); the records and the behind rule; the labeller; stage 1
 * window by window, then W-structure — or, when the growth is inside the last
 * mapped exchange, W-advance with no call; then stage 2, post-order with the
 * participant's preferred node first, written after each card when attended
 * and once when passive.
 */
const organizeOne = async (convoId: string, options: OrganizeOptions): Promise<OrganizeResult> => {
  const state = flowState()
  if (state.organizing.has(convoId)) return { outcome: 'busy', wrote: false }
  state.organizing.add(convoId)
  let wrote = false
  const stop = (outcome: OrganizeOutcome): OrganizeResult => ({ outcome, wrote })
  try {
    const held = await readRouteFlow(convoId)
    if (held && options.summary && held.upToTurnCount >= options.summary.turnCount && held.pending === 0 && !(await sessionDue(held))) return stop('current')

    let records: Awaited<ReturnType<typeof readRouteRecords>>
    try { records = await readRouteRecords(convoId, options.liveRunId) } catch { return stop('unreadable') }
    if (!records || !records.turns.length) return stop('current')
    const { turns, route } = records
    let record = held && flowFits(held, turns) ? held : null

    const now = options.now()
    const rule = { now, liveRunId: options.liveRunId, waiting: options.waiting }
    let closed = cappedClosedEnd(turns, rule)
    if (closed === turns.length) {
      const pending = await options.pending()
      if (!pending || pending.has(convoId)) closed = cappedClosedEnd(turns, { ...rule, pendingAsk: true })
    }
    const starts = exchangeStarts(turns)
    const closedExchanges = Math.min(starts.filter(start => start < closed).length, ROUTE_FLOW_MAX_EXCHANGES)
    const mapped = record?.exchanges.length ?? 0
    const lastSig = closed > 0 ? turns[closed - 1]?.sig : undefined
    const needStructure = closedExchanges > mapped && !!lastSig
    const needAdvance = !needStructure && !!record && closed > record.upToTurnCount && !!lastSig
    const needCards = !!record && record.pending > 0
    const needSession = !!record && await sessionDue(record)

    if (!needStructure && !needAdvance && !needCards && !needSession) {
      // What ONLY the clock is holding back: the thread is not yet quiet, and
      // once it is the last exchange would close. A thread already quiet and
      // still held (an ask outstanding) is not waiting on the clock — naming a
      // due time for it would wake the drain for nothing, over and over.
      const quietFor = now - turns[turns.length - 1]!.at
      if (quietFor >= ROUTE_FLOW_IDLE_MS) return stop('current')
      const quietAt = cappedClosedEnd(turns, { ...rule, now: Number.POSITIVE_INFINITY })
      return quietAt > closed && flowIsBehind(record, quietAt)
        ? { outcome: 'current', wrote: false, dueIn: ROUTE_FLOW_IDLE_MS - quietFor }
        : stop('current')
    }

    const structureKey = `${convoId}|s|${lastSig ?? ''}`
    const structureTried = state.backoff.get(structureKey)
    const structureBackedOff = needStructure && structureTried !== undefined && now - structureTried < ROUTE_FLOW_RETRY_MS
    if (structureBackedOff && !needCards && !needSession) return stop('backoff')

    // No local model awake means no call and no write — W-advance included:
    // it changes nothing the participant can see until a card follows it.
    if (!(await awakeOrganizerLabeller(options.model))) return stop('gate')

    if (needStructure && !structureBackedOff) {
      const texts = flowExchanges(turns, route, closedExchanges)
      let tree: Pick<RouteFlowRecord, 'exchanges' | 'settled'> & { nodes: readonly Omit<RouteFlowNode, 'card'>[] } | null =
        record ? { nodes: record.nodes, exchanges: record.exchanges, settled: record.settled } : null
      let progressed = false
      let halt: OrganizeOutcome | null = null
      while ((tree?.exchanges.length ?? 0) < closedExchanges) {
        const plan = planFlowWindow(texts, tree as Pick<RouteFlowRecord, 'nodes' | 'exchanges' | 'settled'> | null)
        if (!plan) break
        const answer = await flowCall(convoId, options, { stage: 'structure' }, {
          system: ROUTE_FLOW_STRUCTURE_SYSTEM,
          messages: [{ role: 'user', content: plan.prompt }],
          jsonSchema: ROUTE_FLOW_STRUCTURE_SCHEMA as unknown as Readonly<Record<string, unknown>>,
          temperature: 0,
          maxTokens: 60 * (plan.upto - plan.from) + 120,
        }, ROUTE_FLOW_STRUCTURE_TIMEOUT_MS)
        if (!answer.ok) {
          if (answer.why === 'timeout') state.backoff.set(structureKey, options.now())
          halt = answer.why
          break
        }
        const built = buildFlowTree(answer.text, {
          previous: tree as Pick<RouteFlowRecord, 'nodes' | 'exchanges'> | null, from: plan.from, upto: plan.upto, texts,
        })
        if (!built) {
          state.backoff.set(structureKey, options.now())
          halt = 'unusable'
          break
        }
        tree = {
          nodes: built.nodes,
          exchanges: built.exchanges,
          settled: plan.upto >= ROUTE_FLOW_MAX_EXCHANGES ? plan.upto : Math.max(plan.from, plan.upto - ROUTE_FLOW_OVERLAP),
        }
        progressed = true
      }
      if (progressed && tree) {
        // The successful prefix of this pass's windows is written whole.
        const upTo = Math.min(starts[tree.exchanges.length] ?? turns.length, closed)
        const next = await settleRecord({
          convoId, upToTurnCount: upTo, upToTurnSig: turns[upTo - 1]?.sig ?? '', model: options.model,
          exchanges: tree.exchanges, settled: tree.settled, nodes: tree.nodes,
        }, record, turns, route)
        if (!(await commitFlow(next))) return stop('fault')
        wrote = true
        record = next
        state.backoff.delete(structureKey)
      }
      if (halt) return stop(halt)
    } else if (needAdvance && record) {
      // W-ADVANCE: a second or late reply inside the last mapped exchange.
      // Stage 1 maps exchange starts, so without this the conversation would
      // be behind forever and revisited every five seconds. No call.
      const next = await settleRecord({ ...record, upToTurnCount: closed, upToTurnSig: lastSig! }, record, turns, route)
      if (!(await commitFlow(next))) return stop('fault')
      wrote = true
      record = next
    }

    if (!record) return stop(wrote ? 'wrote' : 'current')

    // Stage 2.
    const keys = await flowCardKeys(record, turns, route)
    const skip = new Set<string>()
    let working = record
    let unsaved = false
    let backedOff = false
    const save = async (): Promise<boolean> => {
      if (!(await commitFlow(working))) return false
      wrote = true
      unsaved = false
      return true
    }
    for (;;) {
      const node = nextCard(working, keys, skip, state.prefer.get(convoId))
      if (!node) break
      skip.add(node.id)
      const key = keys.get(node.id) ?? ''
      const cardBackoffKey = `${convoId}|c|${node.id}|${key}`
      const tried = state.backoff.get(cardBackoffKey)
      if (tried !== undefined && options.now() - tried < ROUTE_FLOW_RETRY_MS) { backedOff = true; continue }

      const inputs = routeFlowCardInputs(working, node.id, turns, route)
      if (!inputs) continue
      const request = (content: string): Omit<LlmCall, 'signal' | 'providerId' | 'model'> => ({
        system: ROUTE_FLOW_CARD_SYSTEM,
        messages: [{ role: 'user', content }],
        jsonSchema: ROUTE_FLOW_CARD_SCHEMA as unknown as Readonly<Record<string, unknown>>,
        temperature: 0,
        maxTokens: FLOW_CARD_MAX_TOKENS,
      })
      const titleContext = { covered: inputs.covered, participants: inputs.participants, childTitles: inputs.childTitles, corpus: inputs.corpus }
      const summaryContext = { given: inputs.given, others: inputs.others, childCards: inputs.childCards }
      const stage: RouteOrganizing = { stage: 'card', nodeId: node.id }

      const first = await flowCall(convoId, options, stage, request(inputs.prompt), ROUTE_FLOW_CARD_TIMEOUT_MS)
      if (!first.ok) {
        if (first.why === 'timeout') state.backoff.set(cardBackoffKey, options.now())
        if (unsaved && !(await save())) return stop('fault')
        return stop(first.why)
      }
      const firstValue = extractRouteFlow(first.text)
      let title = checkFlowTitle((firstValue as { title?: unknown } | null)?.title, titleContext)
      let summary = checkFlowSummary(firstValue, summaryContext)
      if (!title.ok || !summary.ok) {
        const why = [
          title.ok ? '' : `title rejected (${title.why})`,
          summary.ok ? '' : `summary rejected (${summary.why}${summary.word ? `: ${summary.word}` : ''})`,
        ].filter(Boolean).join('; ')
        const retry = await flowCall(convoId, options, stage,
          request(`${inputs.prompt}\n\nYour last answer was not usable: ${why}.\n${JSON.stringify(firstValue)}\nWrite it again, fixed.`),
          ROUTE_FLOW_CARD_TIMEOUT_MS)
        if (!retry.ok) {
          if (retry.why === 'timeout') state.backoff.set(cardBackoffKey, options.now())
          if (unsaved && !(await save())) return stop('fault')
          return stop(retry.why)
        }
        const retryValue = extractRouteFlow(retry.text)
        if (!title.ok) title = checkFlowTitle((retryValue as { title?: unknown } | null)?.title, titleContext)
        if (!summary.ok) summary = checkFlowSummary(retryValue, summaryContext)
      }
      if (!summary.ok) {
        // Nothing partial: the node keeps its previous card, stale, or none.
        state.backoff.set(cardBackoffKey, options.now())
        backedOff = true
        continue
      }
      const current = working.nodes.find(candidate => candidate.id === node.id)!
      const chosen = pickFlowTitle({
        current: current.title,
        named: !!current.named,
        ...(current.card ? { cardExchanges: current.card.exchanges } : {}),
        exchanges: inputs.exchanges,
        model: title,
        working: checkFlowTitle(current.title, titleContext),
      })
      const kind = flowKind((firstValue as { kind?: unknown } | null)?.kind)
      const card: RouteFlowCard = {
        key, cv: ROUTE_FLOW_CARD_VERSION, ...summary.summary, ...(kind ? { kind } : {}),
        exchanges: Math.max(1, inputs.exchanges), model: options.model, at: Date.now(),
      }
      const nodes = working.nodes.map(candidate => candidate.id !== node.id ? candidate : {
        id: candidate.id,
        title: chosen.title || candidate.title,
        ...(chosen.named ? { named: true as const } : {}),
        state: candidate.state,
        ...(candidate.parent ? { parent: candidate.parent } : {}),
        card,
      })
      working = { ...working, at: Date.now(), nodes, pending: pendingOf(nodes) }
      state.backoff.delete(cardBackoffKey)
      unsaved = true
      // Attended: after EACH card, so summaries appear one by one while the
      // participant watches. Passive: once, when the loop ends.
      if (options.attended && !(await save())) return stop('fault')
    }
    // THE SESSION CARD — once every step's card is current. One call, one
    // retry that names the reason, backed off by key on an unusable answer.
    if (await sessionDue(working, backedOff)) {
      const key = await sessionKey(working)
      const sessionBackoffKey = `${convoId}|x|${key}`
      const tried = state.backoff.get(sessionBackoffKey)
      if (tried !== undefined && options.now() - tried < ROUTE_FLOW_RETRY_MS) {
        backedOff = true
      } else {
        const inputs = routeFlowSessionInputs(working)
        const stage: RouteOrganizing = { stage: 'session' }
        const request = (content: string): Omit<LlmCall, 'signal' | 'providerId' | 'model'> => ({
          system: ROUTE_FLOW_SESSION_SYSTEM,
          messages: [{ role: 'user', content }],
          jsonSchema: ROUTE_FLOW_SESSION_SCHEMA as unknown as Readonly<Record<string, unknown>>,
          temperature: 0,
          maxTokens: 220,
        })
        const first = await flowCall(convoId, options, stage, request(inputs.prompt), ROUTE_FLOW_CARD_TIMEOUT_MS)
        if (!first.ok) {
          if (first.why === 'timeout') state.backoff.set(sessionBackoffKey, options.now())
          if (unsaved && !(await save())) return stop('fault')
          return stop(first.why)
        }
        const firstValue = extractRouteFlow(first.text)
        let check = checkFlowSession(firstValue, inputs)
        if (!check.ok) {
          const retry = await flowCall(convoId, options, stage,
            request(`${inputs.prompt}\n\nYour last answer was not usable: ${check.why}.\n${JSON.stringify(firstValue)}\nWrite it again, fixed.`),
            ROUTE_FLOW_CARD_TIMEOUT_MS)
          if (!retry.ok) {
            if (retry.why === 'timeout') state.backoff.set(sessionBackoffKey, options.now())
            if (unsaved && !(await save())) return stop('fault')
            return stop(retry.why)
          }
          check = checkFlowSession(extractRouteFlow(retry.text), inputs)
        }
        if (check.ok) {
          working = {
            ...working, at: Date.now(),
            session: { key, sv: ROUTE_FLOW_SESSION_VERSION, ...check.session, model: options.model, at: Date.now() },
          }
          state.backoff.delete(sessionBackoffKey)
          unsaved = true
        } else {
          state.backoff.set(sessionBackoffKey, options.now())
          backedOff = true
        }
      }
    }
    if (unsaved && !(await save())) return stop('fault')
    return stop(wrote ? 'wrote' : backedOff ? 'backoff' : 'current')
  } catch {
    return stop('fault')
  } finally {
    state.organizing.delete(convoId)
  }
}

/**
 * THE ATTENDED CALL — the shell, after a route refresh of the open
 * conversation. `prefer` names the node the participant is looking at; it is
 * recorded even while a mint for the conversation is already running, and that
 * node's uncarded subtree is carded first.
 *
 * REFUSED BEFORE ANYTHING while `waiting` (the shell is waiting on a reply
 * here) or while the lane is paused after the participant's own local chat:
 * it resolves 0 having read nothing, called nothing and emitted nothing, so it
 * cannot re-trigger itself through a refresh hint. The gate runs before a
 * single read, too. Resolves 1 when a flow was written (and announced with
 * `chat:route-flow-changed { convoId }`), else 0.
 */
export const organizeRoute = async (
  convoId: string,
  liveRunId?: string,
  waiting = false,
  prefer?: string,
): Promise<number> => {
  const id = String(convoId ?? '').trim()
  if (!id) return 0
  const state = flowState()
  ensureSubscribed(state)
  // The shell calls this for the conversation on screen: that is a visit,
  // whatever the gate says next — the drain picks it up once a model wakes.
  markRouteVisited(id)
  const preferred = String(prefer ?? '').trim()
  if (preferred) state.prefer.set(id, preferred)
  if (waiting || Date.now() < state.pausedUntil) return 0
  const claim = { counted: false }
  try {
    const gate = await organizerGate()
    if (gate.state !== 'awake') return 0
    const model = await organizerModel(gate, { fallback: state.lastPassModel, convoIds: [id] })
    if (!model) return 0
    const { wrote } = await organizeOne(id, {
      attended: true, model, liveRunId, waiting, now: Date.now, pending: once(pendingChatAsks), claim,
    })
    return wrote ? 1 : 0
  } catch {
    return 0
  } finally {
    if (claim.counted) state.attendedWaiting--
  }
}

/** What one passive pass did — for the orchestrator's schedule. */
export interface RouteFlowDrain {
  /** Conversations with a flow written this pass. */
  readonly organized: number
  /** Conversations found behind that this pass did not organize. */
  readonly behind: number
  /** Why the pass ended early: no model (`gate`), its budget (`budget` — there
   *  may be more to do), a failed call or write (`fault`), the participant's
   *  chat or an attended call (`yield`), or a call out of time (`timeout`). */
  readonly stopped?: 'gate' | 'budget' | 'fault' | 'yield' | 'timeout'
  /** Milliseconds until a conversation's last exchange goes quiet enough to
   *  close, when one is only waiting on the clock. */
  readonly dueIn?: number
  /** Set whenever `stopped === 'yield'`: `pausedUntil` after the participant's
   *  own chat, now + `ROUTE_FLOW_ATTENDED_RESUME_MS` after an attended call. */
  readonly resumeAt?: number
  /** Always set: how long the pass took, from its first read. */
  readonly elapsedMs: number
}

export interface RouteFlowDrainOptions {
  /** Model calls one pass may make. */
  readonly calls?: number
  readonly budgetMs?: number
  readonly now?: () => number
  /** Between conversations. Defaults to an idle callback. */
  readonly pause?: () => Promise<void>
}

/** Give the main thread back: an idle callback where there is one, else a
 *  macrotask. */
const yieldToIdle = (): Promise<void> => new Promise(resolve => {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number })
    .requestIdleCallback
  if (typeof idle === 'function') idle.call(globalThis, () => resolve(), { timeout: 1_000 })
  else setTimeout(resolve, 0)
})

/** Back-off entries older than the retry window go; at most the cap stay, newest kept. */
const pruneBackoff = (state: FlowCoordination, now: number): void => {
  for (const [key, at] of state.backoff) if (now - at >= ROUTE_FLOW_RETRY_MS) state.backoff.delete(key)
  if (state.backoff.size <= ROUTE_FLOW_BACKOFF_CAP) return
  const oldest = [...state.backoff.entries()].sort((a, b) => a[1] - b[1])
  for (const [key] of oldest.slice(0, state.backoff.size - ROUTE_FLOW_BACKOFF_CAP)) state.backoff.delete(key)
}

/**
 * THE PASSIVE DRAIN — "ollama visits as many chats as possible".
 *
 * Gate first: with no machine-local model awake it reads nothing, calls
 * nothing, fetches nothing and logs nothing. The pass model is resolved ONCE,
 * from the participant's stored choice and the live conversations, and pinned
 * as `lastPassModel` — a model swap on the participant's machine measured
 * 10–17 s and evicts the model they chat with. Then every conversation the
 * participant has OPENED here (the visited queue), most recently opened first,
 * one at a time, the gate re-read before each and the main thread given back between
 * them. Before every call: the participant's pause and an attended call end the
 * pass as `yield` with a `resumeAt`; 48 calls or 90 s end it as `budget`.
 * `elapsedMs` is always returned, so the orchestrator can rest as long as the
 * pass ran. Never a bee, never agent work, silent on every failure.
 */
export const drainRouteFlows = async (options: RouteFlowDrainOptions = {}): Promise<RouteFlowDrain> => {
  const callCap = options.calls ?? ROUTE_FLOW_PASS_CALLS
  const budgetMs = options.budgetMs ?? ROUTE_FLOW_PASS_MS
  const now = options.now ?? Date.now
  const pause = options.pause ?? yieldToIdle
  const state = flowState()
  ensureSubscribed(state)
  const started = now()
  const elapsed = (): number => Math.max(0, now() - started)
  let organized = 0
  let behind = 0
  try {
    const gate = await organizerGate()
    if (gate.state !== 'awake') return { organized, behind, stopped: 'gate', elapsedMs: elapsed() }
    let conversations: ConversationSummary[]
    try { conversations = await listConversations() } catch { return { organized, behind, stopped: 'fault', elapsedMs: elapsed() } }
    // ONLY THE VISITED, most recently opened first — live or archived alike;
    // a conversation nobody opened here is left as it is.
    const worth = (convo: ConversationSummary): boolean => convo.turnCount >= 2 && convo.replied !== false
    const visitedAt = (convo: ConversationSummary): number => state.visited.get(convo.convoId) ?? 0
    const ordered = conversations.filter(convo => worth(convo) && visitedAt(convo) > 0).sort((a, b) => visitedAt(b) - visitedAt(a) || b.lastAt - a.lastAt)
    const live = ordered.filter(convo => !convo.archived)

    const model = await organizerModel(gate, { convoIds: live.map(convo => convo.convoId) })
    if (!model) return { organized, behind, stopped: 'gate', elapsedMs: elapsed() }
    state.lastPassModel = model
    pruneBackoff(state, now())

    let calls = 0
    const yielded = (): RouteFlowDrain => ({
      organized, behind, stopped: 'yield', elapsedMs: elapsed(),
      resumeAt: Date.now() < state.pausedUntil ? state.pausedUntil : Date.now() + ROUTE_FLOW_ATTENDED_RESUME_MS,
    })
    const beforeCall = (): 'yield' | 'budget' | null => {
      if (Date.now() < state.pausedUntil || state.attendedWaiting > 0) return 'yield'
      if (calls >= callCap || elapsed() >= budgetMs) return 'budget'
      return null
    }
    const pending = once(pendingChatAsks)
    let dueIn: number | undefined
    let stopped: RouteFlowDrain['stopped']
    for (const [at, convo] of ordered.entries()) {
      if (at > 0) await pause()
      const reason = beforeCall()
      if (reason === 'yield') return { ...yielded(), ...(dueIn !== undefined ? { dueIn } : {}) }
      if (reason === 'budget') { stopped = 'budget'; break }
      if ((await organizerGate()).state !== 'awake') { stopped = 'gate'; break }
      const result = await organizeOne(convo.convoId, {
        attended: false, model, now, pending, summary: convo, beforeCall, afterCall: () => { calls++ },
      })
      if (result.dueIn !== undefined) dueIn = Math.min(dueIn ?? Number.POSITIVE_INFINITY, result.dueIn)
      if (result.wrote) organized++
      if (result.outcome === 'busy') { behind++; continue }
      if (result.outcome === 'yielded') return { ...yielded(), ...(dueIn !== undefined ? { dueIn } : {}) }
      if (result.outcome === 'gate') { stopped = 'gate'; break }
      if (result.outcome === 'timeout') { stopped = 'timeout'; break }
      if (result.outcome === 'budget') { stopped = 'budget'; behind++; break }
      if (result.outcome === 'fault') { stopped = 'fault'; behind++; break }
    }
    return {
      organized, behind,
      ...(stopped ? { stopped } : {}),
      ...(dueIn !== undefined ? { dueIn } : {}),
      elapsedMs: elapsed(),
    }
  } catch {
    return { organized, behind, stopped: 'fault', elapsedMs: elapsed() }
  }
}
