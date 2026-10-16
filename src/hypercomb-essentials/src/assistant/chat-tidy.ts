// assistant/chat-tidy.ts
//
// PUT AWAY THE JOBS (jwize, 2026-10-12: "a whole lot of conversations piling
// up in the hive … hard to read"). Every one-off job a session hands the hive
// — `manager.cjs ask` — is a conversation of its own, `chat:tile:/::<ms>-<id>`,
// and they piled up faster than anyone could read them: 95 answered ones, then
// 28 nobody ever answered, a column of "waiting for reply… find betz /" two
// days old (2026-10-15).
//
// The word is `chats tidy` (chats.queen.ts); this is what it does. A job is
// put away — archived, never deleted: the chat window's archive lists it and
// one click files it back — when it
//   · opened with a question (a manager's own conversation opens with its
//     report, and is never a job),
//   · is not waiting on the participant,
//   · and is quiet: answered and still for `olderThanMs` (default ten
//     minutes), or never answered and still for `staleMs` (default an hour —
//     an ask waits fifteen minutes at most, so an hour is never a live one).
// The participant's own chats and every tile's chat are never touched.

import { listConversations, readTurns, setConversationArchived } from './chat-thread.js'

/** The id a one-off job conversation is minted with. */
const JOB_PREFIX = 'chat:tile:/::'

export interface TidyOptions {
  readonly olderThanMs?: number
  readonly staleMs?: number
  /** List what would be put away; change nothing. */
  readonly dryRun?: boolean
}

export interface TidyResult {
  /** What was put away — or, on a dry run, what would be. */
  readonly jobs: readonly { readonly convoId: string; readonly title: string; readonly replied: boolean }[]
  /** How many of them are archived now (0 on a dry run). */
  readonly archived: number
  /** What was passed over, by reason. */
  readonly passed: Readonly<Record<string, number>>
}

export const tidyJobConversations = async (options: TidyOptions = {}): Promise<TidyResult> => {
  const olderThanMs = options.olderThanMs ?? 600_000
  const staleMs = options.staleMs ?? 3_600_000
  const now = Date.now()
  const jobs: { convoId: string; title: string; replied: boolean }[] = []
  const passed: Record<string, number> = {}
  const pass = (why: string): void => { passed[why] = (passed[why] ?? 0) + 1 }
  for (const convo of await listConversations()) {
    if (convo.archived) continue
    if (!convo.convoId.startsWith(JOB_PREFIX)) { pass(convo.convoId.startsWith('chat:tile:') ? 'tile chat' : 'your own chat'); continue }
    if (convo.asking) { pass('waiting on you'); continue }
    if (now - convo.lastAt < (convo.replied ? olderThanMs : staleMs)) { pass(convo.replied ? 'recent' : 'unanswered, still young'); continue }
    const first = (await readTurns(convo.convoId))[0]
    if (first?.role !== 'user') { pass('a manager’s own'); continue }
    jobs.push({ convoId: convo.convoId, title: convo.title, replied: convo.replied })
  }
  if (options.dryRun) return { jobs, archived: 0, passed }
  let archived = 0
  for (const job of jobs) if (await setConversationArchived(job.convoId, true)) archived++
  return { jobs, archived, passed }
}
