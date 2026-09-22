// assistant/module-review.ts
//
// THE HOST'S AI READS EVERY SANDBOX (documentation/module-sandbox.md, step 4:
// jwize 2026-09-22 — "review the code from our AI on that host … in sandbox
// until we are happy with it … other people can view the code and make their
// own assessments").
//
// Two public artifacts per sandbox, both signed pointers in the publisher's
// own index beside `install:try-<change>`:
//
//   change:try-<change>  THE CHANGE, as a reader needs it: every source file a
//                        draft wrote, BEFORE and AFTER, each its own resource,
//                        and the paths the package left out. It is what the
//                        AI reads, what a person at the door reads, and what a
//                        "what changed" view walks one difference at a time.
//   review:try-<change>  THE HOST'S READING of it: findings (a resource), a
//                        verdict (accept · refuse · unclear), the model that
//                        answered, and the change it read.
//
// The review is asked of the host the sandbox was published to (`/ai/ask`),
// which reads the before/after files from its own heap by signature — the host
// reads the code itself, nothing is pasted. A verdict is a reading, never a
// gate: promotion stays the participant's word.
//
// A dependency: it registers nothing. The `module` queen drives it.

import { sectionOf } from '@hypercomb/core'

export type ReviewVerdict = 'accept' | 'refuse' | 'unclear'

export interface CommittedChange {
  readonly path: string
  readonly section: string
  readonly from: string
  readonly to: string
}

export interface ChangeFile extends CommittedChange {
  /** Resource signatures of the section's text before and after the change. */
  readonly before: string
  readonly after: string
}

export interface ModuleChangeRecord {
  readonly kind: 'module-change'
  readonly sandbox: string
  readonly root: string
  readonly changes: readonly ChangeFile[]
  readonly off: readonly string[]
}

export interface ModuleReviewRecord {
  readonly kind: 'module-review'
  readonly sandbox: string
  readonly root: string
  readonly change: string
  readonly host: string
  readonly model: string
  readonly findings: string
  readonly verdict: ReviewVerdict
  readonly at: number
}

/** Everything the review touches, so a spec can hand it a world. */
export interface ReviewDeps {
  put(text: string, type: string): Promise<string>
  get(sig: string): Promise<string | null>
  bytesOf(sig: string): Promise<Uint8Array | null>
  publish(host: string, sigs: readonly string[]): Promise<{ ok: true } | { ok: false; error: string }>
  ask(host: string, question: string, context: readonly string[]): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }>
  stamp(host: string, key: string, sig: string): Promise<{ ok: boolean; reason?: string }>
  now(): number
}

/** The host AI reads at most eight files. */
const CONTEXT_MAX = 8
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** One source section of a module, header line included, or '' when absent. */
export const sectionText = (moduleText: string, section: string): string => {
  const found = sectionOf(moduleText, section)
  return found ? moduleText.slice(found.from, found.to) : ''
}

/** The files a reviewer reads, AFTER then BEFORE for each change, at most eight. */
export const reviewContext = (changes: readonly ChangeFile[]): string[] =>
  changes.flatMap(change => [change.after, change.before]).slice(0, CONTEXT_MAX)

/** The question the host's AI is asked — within its 4000-character budget. */
export const reviewQuestion = (sandbox: string, changes: readonly ChangeFile[], off: readonly string[]): string => {
  const listed = changes.slice(0, CONTEXT_MAX / 2).map(change => `- ${change.section} (package path ${change.path})`).join('\n')
  const lines = [
    `Review a proposed change to the code of a Hypercomb hive before it goes live. It is published as the sandbox ${sandbox}.`,
    'Hypercomb runs in the browser: its modules can read and write the participant\'s storage (OPFS), sign with their Nostr key, and reach the network.',
    'The context holds each changed source file as a pair: the file AFTER the change first, then the same file BEFORE it.',
    `Changed files:\n${listed || '- none (the change only leaves parts out)'}`,
    off.length ? `Left out of the package (unreachable, not deleted): ${off.join(', ')}` : '',
    'Say briefly and concretely: what the change does; anything it reaches that the old code did not (network, storage, keys, other participants); anything that deletes or overwrites; anything that looks wrong or unfinished.',
    'End with exactly one line: VERDICT: accept, VERDICT: refuse, or VERDICT: unclear.',
  ].filter(Boolean)
  return lines.join('\n\n').slice(0, 3_900)
}

/** The verdict a reading ends with; `unclear` when it names none. */
export const verdictOf = (text: string): ReviewVerdict => {
  const all = [...String(text ?? '').matchAll(/VERDICT:\s*(accept|refuse|unclear)\b/gi)]
  return (all.at(-1)?.[1]?.toLowerCase() as ReviewVerdict | undefined) ?? 'unclear'
}

/**
 * THE CHANGE, WRITTEN DOWN. Every drafted section's text before and after is
 * put as its own resource, and a record names them. Returns the record's
 * signature and every signature a host must serve for it to be read.
 */
export const recordChange = async (
  sandbox: string, root: string, changes: readonly CommittedChange[], off: readonly string[], deps: Pick<ReviewDeps, 'put' | 'bytesOf'>,
): Promise<{ sig: string; files: string[]; record: ModuleChangeRecord } | { error: string }> => {
  const files: ChangeFile[] = []
  for (const change of changes) {
    const [was, now] = await Promise.all([deps.bytesOf(change.from), deps.bytesOf(change.to)])
    if (!was || !now) return { error: `the module behind ${change.section} is not held here` }
    const before = await deps.put(sectionText(decode(was), change.section), 'text/javascript')
    const after = await deps.put(sectionText(decode(now), change.section), 'text/javascript')
    files.push({ ...change, before, after })
  }
  const record: ModuleChangeRecord = { kind: 'module-change', sandbox, root, changes: files, off: [...off] }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  return { sig, files: [...new Set(files.flatMap(file => [file.before, file.after])), sig], record }
}

/** Publish the change and stamp `change:<sandbox>` beside the sandbox. */
export const publishChange = async (
  host: string, sandbox: string, root: string, changes: readonly CommittedChange[], off: readonly string[], deps: ReviewDeps,
): Promise<{ ok: true; sig: string; record: ModuleChangeRecord } | { ok: false; error: string }> => {
  const recorded = await recordChange(sandbox, root, changes, off, deps)
  if ('error' in recorded) return { ok: false, error: recorded.error }
  const published = await deps.publish(host, recorded.files)
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `change:${sandbox}`, recorded.sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the change pointer was not stamped' }
  return { ok: true, sig: recorded.sig, record: recorded.record }
}

/**
 * THE HOST'S AI READS IT. Asks the host the sandbox lives on, publishes the
 * findings and the review record there, and stamps `review:<sandbox>`.
 */
export const reviewChange = async (
  host: string, changeSig: string, record: ModuleChangeRecord, deps: ReviewDeps,
): Promise<{ ok: true; sig: string; verdict: ReviewVerdict; model: string; findings: string } | { ok: false; error: string }> => {
  const answered = await deps.ask(host, reviewQuestion(record.sandbox, record.changes, record.off), reviewContext(record.changes))
  if (!answered.ok) return { ok: false, error: answered.error }
  const findings = await deps.put(answered.text, 'text/plain; charset=utf-8')
  const review: ModuleReviewRecord = {
    kind: 'module-review', sandbox: record.sandbox, root: record.root, change: changeSig, host,
    model: answered.model, findings, verdict: verdictOf(answered.text), at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(review), 'application/json')
  const published = await deps.publish(host, [findings, sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `review:${record.sandbox}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the review pointer was not stamped' }
  return { ok: true, sig, verdict: review.verdict, model: review.model, findings: answered.text }
}

// ── public assessments ─────────────────────────────────────────────────────
//
// ANYONE MAY ASSESS A SANDBOX, under their own key: a verdict and a note, the
// note a resource, the record a resource, both uploaded to the host, and the
// record named in the ASSESSOR'S OWN signed index as `assess:<package root>`.
// The signature on their index is the signature on the assessment; the host
// lists every assessment of a root on the sandbox's door (worker
// assessmentsOf), re-verifying each index as it reads it. Like the host AI's
// review, an assessment is a reading, never a gate.

export const VERDICTS: readonly ReviewVerdict[] = ['accept', 'refuse', 'unclear']

export interface ModuleAssessmentRecord {
  readonly kind: 'module-assessment'
  readonly sandbox: string
  /** The package root the assessment is of — what the door lists it under. */
  readonly root: string
  /** The published change it read, when the sandbox had one. */
  readonly change: string | null
  readonly verdict: ReviewVerdict
  /** Resource signature of the note. */
  readonly note: string
  readonly at: number
}

/** What a sandbox's door says about itself (worker serveSandbox /site.json). */
export interface SandboxSite {
  readonly sandbox: true
  readonly title: string
  readonly package: string
  readonly pubkey: string
  readonly publisher?: string
  readonly change?: string
  readonly review?: string
  readonly reviewVerdict?: ReviewVerdict
  readonly assessments?: readonly { readonly pubkey: string; readonly record: string; readonly verdict: ReviewVerdict; readonly at: number }[]
}

/** Is this what a sandbox door answers at /site.json? */
export const isSandboxSite = (value: unknown): value is SandboxSite => {
  const site = value as Partial<SandboxSite> | null
  return !!site && site.sandbox === true && typeof site.title === 'string' && /^[a-f0-9]{64}$/.test(String(site.package ?? ''))
}

/** How the people who assessed a sandbox read it, counted. */
export const tallyAssessments = (site: Pick<SandboxSite, 'assessments'>): Record<ReviewVerdict, number> => {
  const tally: Record<ReviewVerdict, number> = { accept: 0, refuse: 0, unclear: 0 }
  for (const assessment of site.assessments ?? []) tally[VERDICTS.includes(assessment.verdict) ? assessment.verdict : 'unclear']++
  return tally
}

/** Sign an assessment of a sandbox with this hive's key and make it public. */
export const assessSandbox = async (
  host: string, site: Pick<SandboxSite, 'title' | 'package' | 'change'>, verdict: ReviewVerdict, note: string, deps: ReviewDeps,
): Promise<{ ok: true; sig: string; record: ModuleAssessmentRecord } | { ok: false; error: string }> => {
  if (!VERDICTS.includes(verdict)) return { ok: false, error: 'a verdict is accept, refuse or unclear' }
  const noteSig = await deps.put(note.trim() || '(no note)', 'text/plain; charset=utf-8')
  const record: ModuleAssessmentRecord = {
    kind: 'module-assessment', sandbox: site.title, root: site.package, change: site.change ?? null, verdict, note: noteSig, at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [noteSig, sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `assess:${site.package}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the assessment was not signed into your index' }
  return { ok: true, sig, record }
}

/** A change record held here or on the host, parsed, or null. */
export const readChange = async (sig: string, deps: Pick<ReviewDeps, 'get'>): Promise<ModuleChangeRecord | null> => {
  try {
    const record = JSON.parse((await deps.get(sig)) ?? '') as ModuleChangeRecord
    return record?.kind === 'module-change' && Array.isArray(record.changes) ? record : null
  } catch { return null }
}
