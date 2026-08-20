// diamondcoreprocessor.com/assistant/feedback-summaries.ts
//
// THE FEEDBACK SUMMARY LOG — one append-only record per bridge start, saying
// WHO WAS WAITING ON WHOM at that moment.
//
// The feedback inbox can only ever answer "what is true right now". Every
// read is a live recount: open questions, undrained answers, and participant
// items that nobody has looked at. Nothing is retained between reads, so
// there is no way to ask how long Susan has been waiting, whether a question
// has been sitting open since last week, or whether the backlog is growing.
// The inbox has no memory of itself.
//
// This is that memory. One record per bridge start in the
// `sign('feedback:summaries')` pool, holding the three buckets:
//
//   • participants — routed feedback nobody has marked seen
//   • host        — open questions waiting on THIS participant to answer
//   • routine     — answered questions waiting to be drained into notes
//
// A record is written on EVERY start, not only when something changed: "the
// inbox stood still for nine starts" is itself the finding, and a log that
// silently skips the quiet days cannot report it. Each record carries a
// `digest` of its own state (with `at` excluded), so a reader can collapse a
// run of identical starts into "unchanged since T" without having to diff the
// bodies. Appending is the whole write — the records are content-addressed,
// so a start whose state matches an earlier one still lands its own file
// because the timestamp differs.
//
// TRUTH POOL, never minted from the optimize phase. A past inbox state is not
// derivable from layers by any means: the feedback that produced it may since
// have been answered, drained, or removed. A cold client could never rebuild
// this (optimize-phase.md litmus), so it is state and gets its own pool of
// meaning rather than a corner of the derived-cache pool.
//
// The pool meaning carries a COLON on purpose. Lineage bags share the flat
// root namespace and a bag is named sha256 of its location key, so a bare word
// like `feedback` would collide with any tile whose slug is "feedback" — and
// `/flatten` on a colliding address has already hard-deleted a whole pool
// once. `lineageKey` folds every non-alphanumeric to `-`, so a colon can never
// be produced by a location.

/** Pool of meaning holding the log. Colon-scoped — see the note above. */
export const FEEDBACK_SUMMARY_POOL = 'feedback:summaries'

/** A participant's item that nobody has marked seen. */
export interface WaitingParticipant {
  /** Where the item was filed from — '' when the sender gave no route. */
  readonly route: string
  readonly category: string
  readonly text: string
  /** The feedback record's own id, so the item can be found again. */
  readonly id: string
  readonly at: number
}

/** A question waiting on this participant to answer. */
export interface WaitingHost {
  readonly appliesTo: readonly string[]
  readonly question: string
  readonly qId: string
}

/** A question this participant answered more than once. The count is the
 *  finding: the answer records carry no timestamp, so several answers to one
 *  question is a CONTESTED question, not a resolved one, and nothing can tell
 *  which came last. */
export interface ContestedQuestion {
  readonly appliesTo: readonly string[]
  readonly qId: string
  readonly count: number
}

export interface FeedbackSummaryRecord {
  readonly kind: 'feedback-summary'
  readonly at: number
  /** Signature of this record's state with `at` removed — equal digests mean
   *  the inbox did not move between two starts. */
  readonly digest: string
  readonly totals: {
    readonly feedback: number
    readonly unseen: number
    readonly openQuestions: number
    readonly answerRecords: number
    readonly answeredQuestions: number
    readonly contested: number
  }
  readonly participants: readonly WaitingParticipant[]
  readonly host: readonly WaitingHost[]
  readonly routine: readonly ContestedQuestion[]
  /** What produced the record — 'bridge-start' today; a scheduled sweep or a
   *  manual read would say so instead. */
  readonly source: string
}

type StoreLike = {
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null>
}

/** Everything the record says EXCEPT when it was taken — the state a digest
 *  compares. Two starts with the same shape produce the same string. */
const stateOf = (record: Omit<FeedbackSummaryRecord, 'digest'>): string =>
  JSON.stringify({
    totals: record.totals,
    participants: record.participants,
    host: record.host,
    routine: record.routine,
  })

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Stamp a summary with its state digest. Exported so a caller that only
 *  wants to COMPARE two reads can do so without writing anything. */
export const sealSummary = async (
  record: Omit<FeedbackSummaryRecord, 'digest'>,
): Promise<FeedbackSummaryRecord> => ({ ...record, digest: await sha256Hex(stateOf(record)) })

/**
 * Append one summary to the log. Returns the record's signature — its
 * filename in the pool — or null when the pool is unavailable.
 *
 * A log that cannot be written must not abort the read it describes: the
 * caller still has the summary in hand and should report it, saying that it
 * went unrecorded rather than reporting a clean run.
 */
export const putSummary = async (
  record: Omit<FeedbackSummaryRecord, 'digest'>,
): Promise<string | null> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(FEEDBACK_SUMMARY_POOL)
  if (!pool) {
    console.warn('[feedback-summaries] pool unavailable — summary not recorded')
    return null
  }

  try {
    const sealed = await sealSummary(record)
    const bytes = new TextEncoder().encode(JSON.stringify(sealed)).buffer as ArrayBuffer
    // APPEND, never replace: one sig-named file per start. `putPoolDoc` would
    // be wrong here — it keeps a single current member and drops the rest,
    // which for a log means every entry erases its history.
    const name = await sha256Hex(JSON.stringify(sealed))
    const handle = await pool.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(new Blob([bytes as BlobPart])) } finally { await writable.close() }
    return name
  } catch (err) {
    console.warn('[feedback-summaries] could not write the record:', err)
    return null
  }
}

/** Every summary on record, newest first. */
export const listSummaries = async (): Promise<FeedbackSummaryRecord[]> => {
  const store = get<StoreLike>('@hypercomb.social/Store')
  const pool = await store?.getPool?.(FEEDBACK_SUMMARY_POOL)
  if (!pool) return []

  const out: FeedbackSummaryRecord[] = []
  try {
    const entries = (pool as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()
    for await (const [, handle] of entries) {
      if (handle.kind !== 'file') continue
      try {
        const file = await (handle as FileSystemFileHandle).getFile()
        const rec = JSON.parse(await file.text()) as FeedbackSummaryRecord
        if (rec?.kind !== 'feedback-summary' || typeof rec.at !== 'number') continue
        out.push(rec)
      } catch { /* one unreadable record must not hide the rest */ }
    }
  } catch (err) {
    console.warn('[feedback-summaries] could not list:', err)
  }
  return out.sort((a, b) => b.at - a.at)
}

/** One entry per RUN of identical starts, newest first — the shape a list
 *  view wants. A stretch where the inbox did not move collapses to its most
 *  recent record plus how many starts saw the same thing, and `since` is when
 *  that state was first observed. */
export interface SummaryRun {
  readonly record: FeedbackSummaryRecord
  readonly starts: number
  readonly since: number
}

export const listSummaryRuns = async (): Promise<SummaryRun[]> => {
  const all = await listSummaries()
  const runs: SummaryRun[] = []
  for (const rec of all) {
    const head = runs[runs.length - 1]
    if (head && head.record.digest === rec.digest) {
      runs[runs.length - 1] = { record: head.record, starts: head.starts + 1, since: rec.at }
      continue
    }
    runs.push({ record: rec, starts: 1, since: rec.at })
  }
  return runs
}
