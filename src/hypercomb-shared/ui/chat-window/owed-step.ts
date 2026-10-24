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
      return { kind: 'waiting', key: 'chat.owed.stalled', params: { left }, fallback: `Stopped, so it does not loop: ${left}. Say "continue" to carry it on.` }
    }
    return { kind: 'waiting', key: 'chat.owed.waiting', params: { left }, fallback: `Waiting on you: ${left}` }
  }
  const wait = owed.next - now
  if (wait > 0) {
    return { kind: 'continue', key: 'chat.owed.later', params: { left, wait: seconds(wait) }, fallback: `Carrying on in ${seconds(wait)}${owed.why === 'failed' ? ' — the model fell off' : ''}: ${left}` }
  }
  return { kind: 'continue', key: 'chat.owed.now', params: { left }, fallback: `Carrying on: ${left}` }
}

/** What the record becomes after a leg ends, and the line the conversation
 *  says about it. `patch: null` — nothing is owed; the record goes. Pure. */
export const owedAfter = (
  before: OwedLike | undefined,
  end: LegEnd,
  now: number,
): { readonly patch: OwedPatchLike | null; readonly say?: string } => {
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
        say: `\n\n*Stopped here: ${repeated ? 'the same work came back twice' : 'two legs in a row did nothing in the hive'} (${end.left}). Say "continue" to carry it on, or say what to change.*`,
      }
    }
    return {
      patch: { state: 'continue', why: 'handover', left: end.left, lastLeft: before?.left ?? '', idleLegs, promises: 0, failures: 0, spent: end.spent, next: 0 },
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
      say: `\n\n*Stopped here: it said it would ${ending.step.replace(/[.!]+$/, '')} ${promises} times without doing it. Say "continue" to carry it on, or say what to change.*`,
    }
  }
  return {
    patch: { state: 'continue', why: 'promised', left: ending.step, lastLeft: before?.left ?? '', promises, failures: 0, spent: end.spent, next: 0 },
    say: `\n\n*Continuing: ${ending.step}*`,
  }
}
