// JEV'S GOLDEN SET (documentation/jev-creative-plan.md §3).
//
// Thresholds are tuned on our own outcomes, never guessed. Every decided
// round left two things behind: its outcome (`jev:outcomes`: what the
// participant did) and its receipt, which names by signature everything Jev
// was shown and everything it answered. So any past decision can be decided
// AGAIN, offline, under candidate thresholds — no Jev call, no cost — and
// compared with what actually happened.
//
// The report counts, per candidate: decisions it would decide the same way;
// ones it would newly run on its own, split by whether the participant ran or
// skipped them when asked; and ones it would newly hold, split the same way.
// A change the participant skipped that a candidate would run on its own is a
// gate set too low. Nothing here writes, gates or decides anything live.
//
// Asked over the bridge as the `jev:replay` intent (scripts/jev-golden.cjs);
// the report arrives as `jev:replay-result`.

import { EffectBus } from '@hypercomb/core'
import { JEV_RUBRIC, jevInput, jevResult, type JevPlan, type JevRubric } from './jev-decision.js'
import { jevOutcomes, type JevOutcome, type JevSpeeds } from './jev-outcomes.js'

export interface JevReplayCandidate extends JevRubric { readonly name: string }
export interface JevReplayReport {
  readonly name: string
  /** Decisions that could be replayed. */
  readonly decisions: number
  readonly same: number
  readonly newlyAutomatic: { readonly ran: number; readonly skipped: number; readonly other: number }
  readonly newlyHeld: { readonly ran: number; readonly skipped: number; readonly other: number }
}
export interface JevReplayResult {
  readonly at: number
  readonly reports: readonly JevReplayReport[]
  /** Outcomes that could not be replayed, and why. */
  readonly skipped: Readonly<Record<string, number>>
  /** WHAT JEV HAS DONE IN THIS HIVE, read-only: every outcome counted by the
   *  plan it came from (`front ran`, `verify unverified`, `do skipped`, …),
   *  and the median turn time per path (jev-outcomes.ts speeds). The honest
   *  answer to "is Jev paying off here", without a second tab on the hive. */
  readonly plans?: Readonly<Record<string, number>>
  readonly speeds?: JevSpeeds
  readonly turns?: number
}

const TABLE_PLANS = new Set(['do', 'read', 'answer', 'ask', 'participant', 'revise'])

/** Would this plan act without the participant? Reads and answers change
 *  nothing; a change runs on its own only when it did not wait for review. */
export const runsOnItsOwn = (plan: { kind: string; review?: boolean }): boolean =>
  plan.kind === 'read' || plan.kind === 'answer' || (plan.kind === 'do' && plan.review !== true)

/** One decision, reconstructed from its receipt, ready to decide again. */
export interface ReplayCase {
  readonly outcome: JevOutcome
  readonly answers: Record<string, unknown>
  readonly input: ReturnType<typeof jevInput>
}

/** Pure: decide every case again under each candidate and count the moves. */
export const replayCases = (cases: readonly ReplayCase[], candidates: readonly JevReplayCandidate[]): JevReplayReport[] =>
  candidates.map(candidate => {
    let same = 0
    const newlyAutomatic = { ran: 0, skipped: 0, other: 0 }
    const newlyHeld = { ran: 0, skipped: 0, other: 0 }
    for (const item of cases) {
      const before = { kind: item.outcome.plan, review: item.outcome.review === true }
      const after: JevPlan = jevResult({ answers: item.answers }, item.input, candidate).plan
      const was = runsOnItsOwn(before)
      const now = runsOnItsOwn(after as { kind: string; review?: boolean })
      if (after.kind === before.kind && (after.kind !== 'do' || (after as { review: boolean }).review === before.review)) same++
      const bucket = item.outcome.outcome === 'ran' ? 'ran' : item.outcome.outcome === 'skipped' ? 'skipped' : 'other'
      if (!was && now) newlyAutomatic[bucket]++
      if (was && !now) newlyHeld[bucket]++
    }
    return { name: candidate.name, decisions: cases.length, same, newlyAutomatic, newlyHeld }
  })

// ── reading the receipts back ──────────────────────────────────────────────

type StoreLike = { getResource?: (sig: string) => Promise<Blob | null> }
const store = (): StoreLike | undefined => window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined
const read = async (sig: unknown): Promise<unknown> => {
  if (typeof sig !== 'string') throw new Error('not a signature')
  const blob = await store()?.getResource?.(sig)
  if (!blob) throw new Error('missing resource')
  return JSON.parse(await blob.text())
}
const readAll = (sigs: unknown): Promise<unknown[]> => Array.isArray(sigs) ? Promise.all(sigs.map(read)) : Promise.reject(new Error('not a list'))

/** Rebuild one case from an outcome record, or say why it cannot be. */
export const loadCase = async (outcome: JevOutcome): Promise<ReplayCase | string> => {
  if (!TABLE_PLANS.has(outcome.plan)) return 'not a table decision'
  if (!outcome.decision) return 'no receipt'
  try {
    const receipt = await read(outcome.decision) as Record<string, unknown>
    if (receipt['kind'] !== 'jev-decision') return 'not a decision receipt'
    const manifest = await read(receipt['source']) as Record<string, unknown>
    if (manifest['kind'] !== 'jev-input' || manifest['rubric'] !== JEV_RUBRIC) return 'older rubric'
    const rows = await Promise.all((await readAll(manifest['rows'])).map(async raw => {
      const row = raw as Record<string, unknown>
      return {
        id: row['id'], kind: row['kind'], label: await read(row['label']), lines: await read(row['lines']),
        ...(row['why'] ? { why: await read(row['why']) } : {}),
        ...(row['reach'] ? { reach: row['reach'] } : {}),
      }
    }))
    const input = jevInput({
      request: await read(manifest['request']),
      doctrine: await readAll(manifest['doctrine']),
      evidence: await readAll(manifest['evidence']),
      rows,
    })
    const answers = await read(receipt['answers']) as Record<string, unknown>
    return { outcome, answers, input }
  } catch (error) {
    return error instanceof Error && /budget|proposal|row|Jev/.test(error.message) ? 'unreadable input' : 'missing resource'
  }
}

export const replayJevDecisions = async (candidates: readonly JevReplayCandidate[]): Promise<JevReplayResult> => {
  await jevOutcomes.load()
  const cases: ReplayCase[] = []
  const skipped: Record<string, number> = {}
  for (const outcome of jevOutcomes.records()) {
    const loaded = await loadCase(outcome)
    if (typeof loaded === 'string') skipped[loaded] = (skipped[loaded] ?? 0) + 1
    else cases.push(loaded)
  }
  const named = candidates.some(candidate => candidate.name === 'current') ? candidates : [{ name: 'current' }, ...candidates]
  const plans: Record<string, number> = {}
  for (const record of jevOutcomes.records()) plans[`${record.plan} ${record.outcome}`] = (plans[`${record.plan} ${record.outcome}`] ?? 0) + 1
  return { at: Date.now(), reports: replayCases(cases, named), skipped, plans, speeds: jevOutcomes.speeds(), turns: jevOutcomes.turns().length }
}

const candidatesOf = (payload: unknown): JevReplayCandidate[] => {
  const list = (payload as { candidates?: unknown } | undefined)?.candidates
  return Array.isArray(list)
    ? list.filter((item): item is JevReplayCandidate => !!item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string').slice(0, 12)
    : []
}

EffectBus.on('jev:replay', payload => {
  void replayJevDecisions(candidatesOf(payload))
    .then(result => EffectBus.emit('jev:replay-result', result))
    .catch(error => EffectBus.emit('jev:replay-result', { at: Date.now(), reports: [], skipped: { [String(error?.message ?? error)]: 1 } }))
})
