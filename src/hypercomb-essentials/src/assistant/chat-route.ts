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

import { isRouteWork } from './bridge-ops.js'
import { STEP_LEDGER_NAME, conversationBucket, readTurnsStrict, type TurnRole } from './chat-thread.js'
import { settle, stepRequest, type ChatStep, type StepOutcome } from './chat-steps.js'

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

export interface Route {
  /** Only rows that hold work, in thread order. */
  readonly rows: readonly RouteRow[]
  /** The run the shell is waiting on, when it has recorded anything drawable. */
  readonly live?: RoutePiece
  /** Runs no reply row took: drawn after the turn they follow (`afterIndex`,
   *  -1 for a run older than every turn). */
  readonly unfinished: ReadonlyArray<{ readonly afterIndex: number; readonly piece: RoutePiece }>
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
 * that has no bucket.
 */
export const readRoute = async (convoId: string, liveRunId?: string): Promise<Route> => {
  const id = String(convoId ?? '').trim()
  if (!id) return EMPTY_ROUTE
  const bucket = await conversationBucket(id)
  if (!bucket) return EMPTY_ROUTE

  const turns = await readTurnsStrict(bucket, id)
  const steps = settle(await readLedgerStrict(bucket, id))
  if (!steps.length) return EMPTY_ROUTE

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
  return deriveRoute(turns, steps, requests, { liveRunId, errors })
}
