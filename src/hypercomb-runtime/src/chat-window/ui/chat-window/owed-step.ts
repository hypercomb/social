// owed-step.ts — WHAT A LEG'S END LEAVES OWED (documentation/conversation-continuity.md).
//
// jwize, 2026-10-24: "sometimes the conversations just say they are going to
// wait or do something but they are finished already … they should all be
// robust and survive refreshes." The window used to keep a leg's handover in
// memory and continue it only for the conversation on screen, within the
// hour. Now every leg's end becomes a record in the conversation's own bucket
// (essentials chat-thread.ts `writeOwed`), and this decides what that record
// says — pure, so every case can be tested without a model.
//
// The shell may not import essentials, so the record's shape is restated here
// structurally; the bucket checks every field it reads back.

import { turnEnding } from '@hypercomb/core'

export type OwedState = 'continue' | 'waiting' | 'paused'

export interface OwedSpent { readonly rounds: number; readonly tokens: number; readonly legs: number }

export interface OwedLike {
  readonly state: OwedState
  readonly why: string
  readonly left: string
  readonly lastLeft: string
  readonly promises: number
  readonly idleLegs: number
  readonly failures: number
  /** Times a stall in this request has been picked back up. Optional on a
   *  record written before that count existed. */
  readonly pickups?: number
  readonly spent: OwedSpent
  readonly tried: readonly { readonly model: string; readonly at: number; readonly error: string }[]
  readonly asker?: string
  readonly next: number
  /** When the record was last written. */
  readonly at?: number
}

export type OwedPatchLike = Partial<OwedLike>

/** How one leg ended. `worked`: it read or changed something in the hive. */
export type LegEnd =
  | { readonly kind: 'left'; readonly left: string; readonly budgetSpent: boolean; readonly worked: boolean; readonly spent: OwedSpent }
  | { readonly kind: 'answered'; readonly prose: string; readonly worked: boolean; readonly spent: OwedSpent }
  | { readonly kind: 'failed'; readonly model: string; readonly error: string; readonly request: string; readonly spent: OwedSpent }
  /** The leg stopped where a person, or no remaining model, has to move it.
   *  Recorded, so the chat does not look finished. */
  | { readonly kind: 'park'; readonly why: 'question' | 'gave-up'; readonly left: string; readonly spent: OwedSpent }

/** Backoff after each failure in a row; past the last, the work waits on the participant. */
export const OWED_BACKOFF_MS = [30_000, 120_000, 600_000] as const
/** Promises in a row with nothing done between them before the work stops and says so. */
export const OWED_PROMISES_MAX = 3
/** Legs in a row that asked the hive for nothing before the work stops and says so. */
export const OWED_IDLE_LEGS_MAX = 2

const same = (a: string, b: string): boolean =>
  !!a && !!b && a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

const seconds = (ms: number): string => ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`

/** THE CUE UNDER A CONVERSATION (jwize, 2026-10-24: "if there is something
 *  happening we need a visual cue"). What the record says, as one line the
 *  window shows beneath the transcript: a catalog key, its parameters, and
 *  the English it falls back to. Null when nothing is owed. Pure. */
export const owedCue = (owed: OwedLike | undefined, now: number): {
  readonly kind: OwedState
  readonly key: string
  readonly params: Readonly<Record<string, string | number>>
  readonly fallback: string
} | null => {
  if (!owed) return null
  const left = owed.left.replace(/\s+/g, ' ').trim().slice(0, 240)
  if (owed.state === 'paused') {
    return { kind: 'paused', key: 'chat.owed.paused', params: { left }, fallback: `Paused — this request's budget is spent. Say "continue" to carry on: ${left}` }
  }
  if (owed.state === 'waiting') {
    if (owed.why === 'gave-up') {
      const model = owed.tried[owed.tried.length - 1]?.model ?? ''
      return { kind: 'waiting', key: 'chat.owed.gaveUp', params: { left, model }, fallback: `No model could carry this on${model ? ` (last: ${model})` : ''}. Say "continue" to try again.` }
    }
    if (owed.why === 'stalled') {
      return { kind: 'waiting', key: 'chat.owed.stalled', params: { left }, fallback: `Stalled on: ${left}. Picking it back up from there.` }
    }
    return { kind: 'waiting', key: 'chat.owed.waiting', params: { left }, fallback: `Waiting on you: ${left}` }
  }
  const wait = owed.next - now
  if (owed.why === 'unstick') {
    const cue = agentOwnsCue(owed.left, wait)
    return { kind: 'continue', key: wait > 0 ? 'chat.owed.unstickLater' : 'chat.owed.unstick', params: { left: cue, wait: seconds(Math.max(0, wait)) }, fallback: cue }
  }
  if (wait > 0) {
    return { kind: 'continue', key: 'chat.owed.later', params: { left, wait: seconds(wait) }, fallback: `Carrying on in ${seconds(wait)}${owed.why === 'failed' ? ' — the model fell off' : ''}: ${left}` }
  }
  return { kind: 'continue', key: 'chat.owed.now', params: { left }, fallback: `Carrying on: ${left}` }
}

/** The person-facing line for a pickup. The model's continue word stays in
 *  the record. This says the open steps belong to the agent. */
export const agentOwnsCue = (left: string, waitMs: number): string => {
  const found = left.match(/Open step for the agent:\s*([^.]*)/)
  const steps = found?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 180) || ''
  const owned = steps ? `Open steps for the agent: ${steps}.` : 'The open steps belong to the agent.'
  if (waitMs > 0) {
    const wait = waitMs < 60_000 ? `${Math.round(waitMs / 1000)} s` : `${Math.round(waitMs / 60_000)} min`
    return `${owned} The agent picks them up in ${wait}.`
  }
  return `${owned} The agent is picking them up.`
}

/** How long a live turn can sit without a new word or a progress line before
 *  the beacon says the round has gone quiet. The round is still open. */
export const WORK_QUIET_MS = 12_000

export type WorkBeaconState = 'live' | 'quiet' | 'carry' | 'retry' | 'budget' | 'you' | 'gave-up' | 'unattended' | 'steps'

/** A wait that is not the turn clock: a press in Execution, a command still
 *  running, a question in the reply, or workflow steps still open. */
export interface WorkPending {
  readonly kind: 'exec-you' | 'exec-run' | 'question' | 'steps'
  readonly text: string
}

export interface WorkBeaconOwed {
  readonly kind: OwedState
  readonly why: string
  readonly left: string
  readonly next: number
  readonly text: string
}

export interface WorkBeaconInput {
  readonly now: number
  readonly waiting: boolean
  readonly unattended: boolean
  readonly activity: string
  readonly quietMs: number
  readonly elapsed: string
  readonly owed: WorkBeaconOwed | null
  readonly rounds: number
  readonly ktokens: number
  readonly budgetRounds: number
  readonly budgetK: number
  readonly pending?: WorkPending | null
}

export interface WorkBeacon {
  readonly state: WorkBeaconState
  readonly key: string
  readonly params: Readonly<Record<string, string | number>>
  readonly fallback: string
}

const spendLine = (input: WorkBeaconInput): string =>
  input.rounds > 0 || input.ktokens > 0
    ? `${input.rounds} of ${input.budgetRounds} rounds, ${input.ktokens}k of ${input.budgetK}k tokens`
    : ''

const clockOf = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

/** THE BEACON (the participant, 2026-10-27: a quiet chat looked the same as a
 *  hang, a timeout, or a token limit). One line for the footer, so the state
 *  stays on screen when the transcript is still or scrolled away. Pure. */
export const workBeaconOf = (input: WorkBeaconInput): WorkBeacon | null => {
  const spend = spendLine(input)
  const spendTail = spend ? ` · ${spend}` : ''
  const pending = input.pending ?? null
  // A press, a question, or a command in flight is the thing that is pending.
  // The turn clock's "Thinking…" line does not say so, and with the column
  // closed it was off screen.
  if (pending && (pending.kind === 'exec-you' || pending.kind === 'question')) {
    return { state: 'you', key: 'chat.beacon.pending', params: { text: pending.text }, fallback: pending.text }
  }
  if (pending?.kind === 'exec-run') {
    const fallback = input.waiting ? `${pending.text} · ${input.elapsed}` : pending.text
    return { state: 'live', key: 'chat.beacon.running', params: { text: pending.text, elapsed: input.elapsed }, fallback }
  }
  if (input.waiting) {
    if (input.unattended) {
      return {
        state: 'unattended', key: 'chat.beacon.unattended', params: { elapsed: input.elapsed },
        fallback: `Nothing is listening yet · ${input.elapsed}. The question is saved until a session connects.`,
      }
    }
    if (input.quietMs >= WORK_QUIET_MS) {
      const quiet = clockOf(input.quietMs)
      const tokens = spend || 'Token use reports when this round comes back.'
      const doing = input.activity.trim()
      const where = doing ? `${doing}. ` : ''
      return {
        state: 'quiet', key: 'chat.beacon.quiet',
        params: { quiet, elapsed: input.elapsed, spend: tokens, doing },
        fallback: `Quiet for ${quiet}. ${where}This round is still open (${input.elapsed} on the turn). ${tokens}`,
      }
    }
    const doing = input.activity.trim() || 'Thinking…'
    return {
      state: 'live', key: 'chat.beacon.live',
      params: { doing, elapsed: input.elapsed, spend },
      fallback: `${doing} · ${input.elapsed}${spendTail}`,
    }
  }
  const owed = input.owed
  if (!owed) {
    if (pending?.kind === 'steps') {
      return { state: 'steps', key: 'chat.beacon.steps', params: { text: pending.text }, fallback: pending.text }
    }
    return null
  }
  if (owed.kind === 'paused' || owed.why === 'budget') {
    return {
      state: 'budget', key: 'chat.beacon.budget', params: { spend },
      fallback: spend
        ? `Paused on the request budget (${spend}). Say continue to carry on.`
        : 'Paused on the request budget. Say continue to carry on.',
    }
  }
  if (owed.kind === 'waiting' && owed.why === 'gave-up') {
    return { state: 'gave-up', key: 'chat.beacon.gaveUp', params: { text: owed.text }, fallback: owed.text }
  }
  if (owed.kind === 'waiting') {
    return { state: 'you', key: 'chat.beacon.you', params: { text: owed.text }, fallback: owed.text }
  }
  const wait = owed.next - input.now
  if (owed.why === 'unstick') {
    const cue = agentOwnsCue(owed.left, wait)
    return { state: 'carry', key: 'chat.beacon.unstick', params: { text: cue }, fallback: cue }
  }
  if (wait > 0) {
    const when = clockOf(wait)
    const fallback = owed.why === 'failed'
      ? `The model fell off. Trying again in ${when}.${spendTail}`
      : `Carrying on in ${when}.${spendTail}`
    return {
      state: 'retry', key: 'chat.beacon.retry',
      params: { when, spend, why: owed.why },
      fallback,
    }
  }
  const left = owed.left.replace(/\s+/g, ' ').trim().slice(0, 160)
  return {
    state: 'carry', key: 'chat.beacon.carry', params: { left, spend },
    fallback: left ? `Carrying on: ${left}${spendTail}` : `Carrying on.${spendTail}`,
  }
}

/** A page change that was only read is not finished. The model stopping
 *  there is the idle breakdown: the next leg writes the page. A wait on the
 *  participant, a write that ran, or a block the participant skipped is left
 *  as the leg recorded it. Pure. */
export const pageChangeStillOwed = (
  message: string,
  prose: string,
  read: boolean,
  wrotePage: boolean,
  skipped: boolean,
): string | null => {
  if (!read || wrotePage || skipped) return null
  const ask = String(message ?? '')
  const asksChange = /\b(write|change|update|add|added|revise|revision)s?\b/i.test(ask)
  const aboutPage = /\b(page|pages|trial|build|builds|revision|revisions|html|website)\b/i.test(ask) || /\btry-/.test(ask)
  if (!asksChange || !aboutPage) return null
  if (turnEnding(prose)?.kind === 'waiting') return null
  return 'The page was read and not written. Write the next build on this same tile now. Do not read the same signatures again.'
}

/** What the record becomes after a leg ends, and the line the conversation
 *  says about it. `patch: null` — nothing is owed; the record goes. Pure. */
export const owedAfter = (
  before: OwedLike | undefined,
  end: LegEnd,
  now: number,
): { readonly patch: OwedPatchLike | null; readonly say?: string } => {
  if (end.kind === 'park') {
    return {
      patch: { state: 'waiting', why: end.why, left: end.left, failures: before?.failures ?? 0, spent: end.spent, next: 0 },
    }
  }

  if (end.kind === 'failed') {
    const failures = (before?.failures ?? 0) + 1
    const left = before?.left || `the request: ${end.request.replace(/\s+/g, ' ').trim().slice(0, 600)}`
    const tried = [...(before?.tried ?? []), { model: end.model, at: now, error: end.error.slice(0, 500) }]
    if (failures > OWED_BACKOFF_MS.length) {
      return {
        patch: { state: 'waiting', why: 'gave-up', left, failures, tried, spent: end.spent, next: 0 },
        say: `\n\n*No model could carry this on after ${failures - 1} more tries (${end.error}). Say "continue" to try again.*`,
      }
    }
    const wait = OWED_BACKOFF_MS[failures - 1]
    return {
      patch: { state: 'continue', why: 'failed', left, failures, tried, spent: end.spent, next: now + wait },
      say: `\n\n*The model fell off (${end.error}). Trying again in ${seconds(wait)}.*`,
    }
  }

  if (end.kind === 'left') {
    if (end.budgetSpent) {
      return { patch: { state: 'paused', why: 'budget', left: end.left, lastLeft: before?.left ?? '', failures: 0, spent: end.spent, next: 0 } }
    }
    const idleLegs = end.worked ? 0 : (before?.idleLegs ?? 0) + 1
    // The same words twice is a loop only when the leg also did nothing: batch
    // work that is making progress may well describe what is left the same way.
    const repeated = before?.state === 'continue' && same(before.left, end.left) && !end.worked
    if (repeated || idleLegs >= OWED_IDLE_LEGS_MAX) {
      return {
        patch: { state: 'waiting', why: 'stalled', left: end.left, lastLeft: before?.left ?? '', idleLegs, failures: 0, spent: end.spent, next: 0 },
        say: `\n\n*Stalled: ${repeated ? 'the same work came back twice' : 'two legs in a row did nothing in the hive'} (${end.left}). Picking it back up from there, a different way.*`,
      }
    }
    return {
      patch: {
        state: 'continue', why: 'handover', left: end.left, lastLeft: before?.left ?? '', idleLegs, promises: 0, failures: 0, spent: end.spent, next: 0,
        ...(end.worked ? { pickups: 0 } : {}),
      },
      say: `\n\n*Continuing: ${end.left}*`,
    }
  }

  const ending = turnEnding(end.prose)
  if (!ending) return { patch: null }
  if (ending.kind === 'waiting') {
    return { patch: { state: 'waiting', why: 'question', left: ending.step, failures: 0, spent: end.spent, next: 0 } }
  }
  const promises = end.worked ? 1 : (before?.promises ?? 0) + 1
  if (promises >= OWED_PROMISES_MAX) {
    return {
      patch: { state: 'waiting', why: 'stalled', left: ending.step, promises, failures: 0, spent: end.spent, next: 0 },
      say: `\n\n*Stalled: it said it would ${ending.step.replace(/[.!]+$/, '')} ${promises} times without doing it. Picking it back up from there, a different way.*`,
    }
  }
  return {
    patch: {
      state: 'continue', why: 'promised', left: ending.step, lastLeft: before?.left ?? '', promises, failures: 0, spent: end.spent, next: 0,
      ...(end.worked ? { pickups: 0 } : {}),
    },
    say: `\n\n*Continuing: ${ending.step}*`,
  }
}
