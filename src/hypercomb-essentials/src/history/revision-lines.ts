// history/revision-lines.ts
//
// NAMED REVISIONS, AND THE STEPS UNDER EACH NAME (jwize, 2026-11-16: "We
// should be able to save named revisions and then incremental subitems just
// like before so a new name just starts a new list of updates and if we want
// to change revisions we would first save the current one unless we wanted to
// discard with confirmations. This way we can always put our development away
// for a bit.").
//
// Nothing new is stored. A tile's revisions are its BUILD RECORDS
// (builds-slot.ts: `{ seal, label, at }` in the `builds` slot, the one
// grouping primitive, documentation/build-revisions.md), read two ways:
//
//   • A NAME IS A LINE. The records that share a label are one line of work,
//     and each is a step in it, oldest first. Saving under the name in hand
//     adds a step; saving under a new name starts a new line.
//   • THE NEWEST RECORD NAMES THE LINE IN HAND. Opening a revision appends a
//     record under its name (the same seal, no new one), so which line is
//     being worked on is read from the slot: it travels with the tile, it is
//     undone like any other change, and no device keeps a note of it.
//
// CHANGING REVISIONS SAVES FIRST. Opening another revision records the tree
// as it stands as a step of the line being left (free when nothing changed:
// `mintBuildRecord` declines an unchanged seal), then brings the other one in
// with the shared restore walk (seal-restore.ts), which appends and never
// deletes. Discarding is the one path that does not save, and its caller asks
// first; even then the discarded state stays one step back in history.

import { BUILDS_SLOT, appendBuildRecord, mintBuildRecord, readBuildsAt, type BuildRecord } from './builds-slot.js'
import { applySealAt } from './seal-restore.js'

/** One name and the steps saved under it, oldest first. */
export type RevisionLine = {
  /** The name as it was last written. */
  readonly name: string
  /** The name folded for comparing: `Red Theme` and `red theme` are one line. */
  readonly key: string
  readonly steps: readonly BuildRecord[]
  /** When the line was last saved to or opened. */
  readonly at: number
}

/** A label folded for comparing. */
export const lineKey = (label: string): string => String(label ?? '').trim().toLowerCase()

/**
 * The records as lines, the most recently touched first. A revision opened
 * again is a record that repeats a seal its line already holds; it moves the
 * line's date and adds no step, so the steps are the states that were saved.
 */
export const revisionLines = (records: readonly BuildRecord[]): RevisionLine[] => {
  // The slot's own order says which line was touched last: two records can
  // carry the same millisecond, and the slot is the truth of their order.
  const lines = new Map<string, { name: string; key: string; steps: BuildRecord[]; at: number; last: number }>()
  records.forEach((record, index) => {
    const key = lineKey(record.label)
    if (!key) return
    const line = lines.get(key) ?? { name: record.label.trim(), key, steps: [], at: 0, last: index }
    line.name = record.label.trim()
    line.at = Math.max(line.at, record.at)
    line.last = index
    if (!line.steps.some(step => step.seal === record.seal)) line.steps.push(record)
    lines.set(key, line)
  })
  return [...lines.values()]
    .sort((a, b) => b.last - a.last)
    .map(({ name, key, steps, at }) => ({ name, key, steps, at }))
}

/** The line being worked on: the newest record's name, or '' with no record. */
export const currentLine = (records: readonly BuildRecord[]): string =>
  records.length ? records[records.length - 1]!.label.trim() : ''

/**
 * The line that was in hand at a moment: the name of the newest record at or
 * before it. Work done before the first save belongs to the first line, which
 * is what that work became.
 */
export const lineAt = (records: readonly BuildRecord[], time: number): string => {
  let held = records.length ? records[0]!.label.trim() : ''
  for (const record of records) {
    if (record.at > time) break
    held = record.label.trim()
  }
  return held
}

/** Which step of its line a record is, counted from 1; 0 when it is none. */
export const stepOf = (lines: readonly RevisionLine[], record: Pick<BuildRecord, 'seal' | 'label'>): number => {
  const line = lines.find(candidate => candidate.key === lineKey(record.label))
  return line ? line.steps.findIndex(step => step.seal === record.seal) + 1 : 0
}

/** Where a tile's revisions stand. */
export type RevisionState = {
  readonly records: readonly BuildRecord[]
  readonly lines: readonly RevisionLine[]
  /** The name of the line in hand, or '' while nothing has been saved. */
  readonly current: string
  /** The tree holds changes its newest record does not. False while unknown. */
  readonly dirty: boolean
}

/** Read where the revisions at `segments` stand. Writes nothing. */
export async function readRevisions(segments: readonly string[]): Promise<RevisionState> {
  const records = await readBuildsAt(segments)
  let dirty = false
  if (records.length) {
    const probe = await mintBuildRecord(segments, undefined, { dryRun: true }).catch(() => null)
    dirty = !!probe && !('error' in probe) && !probe.unchanged
  }
  return { records, lines: revisionLines(records), current: currentLine(records), dirty }
}

export type RevisionOutcome =
  | { readonly ok: true; readonly name: string; readonly step: number; readonly unchanged: boolean }
  | { readonly ok: false; readonly error: string; readonly needsName?: true }

/**
 * SAVE. Under the name in hand it is the next step of that line; under a new
 * name it is the first step of a new one. A name is needed only for the first
 * save. Saving an unchanged tree under a name it does not have yet starts the
 * new line from that same state.
 */
export async function saveRevision(segments: readonly string[], name?: string): Promise<RevisionOutcome> {
  const before = await readBuildsAt(segments)
  const label = String(name ?? '').trim() || currentLine(before)
  if (!label) return { ok: false, error: 'a first save needs a name', needsName: true }
  const minted = await mintBuildRecord(segments, label)
  if ('error' in minted) return { ok: false, error: minted.error }
  let unchanged = minted.unchanged
  if (minted.unchanged && lineKey(minted.label) !== lineKey(label)) {
    const named = await appendBuildRecord(segments, minted.seal, label)
    if ('error' in named) return { ok: false, error: named.error }
    unchanged = false
  }
  const after = await readBuildsAt(segments)
  return { ok: true, name: label, step: stepOf(revisionLines(after), { seal: minted.seal, label }), unchanged }
}

export type OpenOutcome =
  | { readonly ok: true; readonly name: string; readonly changed: number; readonly failed: number }
  | { readonly ok: false; readonly error: string }

/**
 * OPEN a revision: its tree becomes the live one. The tree as it stands is
 * saved first as a step of the line being left, unless `discard` says not to
 * (the caller has asked). A save that fails stops the change: nothing is
 * opened over work that could not be recorded.
 */
export async function openRevision(
  segments: readonly string[],
  target: Pick<BuildRecord, 'seal' | 'label'>,
  options: { discard?: boolean } = {},
): Promise<OpenOutcome> {
  const before = await readBuildsAt(segments)
  const leaving = currentLine(before)
  if (!options.discard && leaving) {
    const saved = await mintBuildRecord(segments, leaving)
    if ('error' in saved) return { ok: false, error: saved.error }
  }
  const walked = await applySealAt(segments, target.seal, [BUILDS_SLOT])
  if (walked.failed > 0 && walked.changed === 0) {
    return { ok: false, error: 'that revision is not held on this device' }
  }
  // Said in the list: the line just opened is the line in hand.
  const after = await readBuildsAt(segments)
  const newest = after.length ? after[after.length - 1]! : null
  if (!newest || lineKey(newest.label) !== lineKey(target.label) || newest.seal !== target.seal) {
    const said = await appendBuildRecord(segments, target.seal, target.label)
    if ('error' in said) return { ok: false, error: said.error }
  }
  return { ok: true, name: target.label.trim(), changed: walked.changed, failed: walked.failed }
}

/** DISCARD what changed since the newest record: that record's tree is opened
 *  again, without saving. The caller asks first. */
export async function discardChanges(segments: readonly string[]): Promise<OpenOutcome> {
  const records = await readBuildsAt(segments)
  const newest = records.length ? records[records.length - 1]! : null
  if (!newest) return { ok: false, error: 'nothing has been saved here yet' }
  return openRevision(segments, newest, { discard: true })
}
