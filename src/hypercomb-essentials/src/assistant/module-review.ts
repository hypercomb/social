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

import { broodRoster, sectionOf, SignatureService, isMetaEnvelope, isSandboxLabel, metaPayloadOf, mintMetaEnvelope } from '@hypercomb/core'
import { diffLines, type DiffRow, type LineDiff } from './line-diff.js'
import { JEV_READING_CHARS, JEV_READING_FILES, JEV_RUBRIC, type JevReadingFile, type JevReadingInput, type JevReadingResult, type JevReadingVerdict, type JevPassInput, type JevPassResult, type JevReadingRule, type JevTrialStanding, JEV_PASS_TRIALS } from './jev-decision.js'

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
  /** When it was committed — what a zone's trial listing orders by. Changes
   *  committed before 2026-09-22 carry none. */
  readonly at?: number
  /** Paths folded in from other builds — a trial taken by hand and accepted
   *  here — with the root each came from. A build for everybody says whose
   *  changes it carries. */
  readonly taken?: readonly { readonly path: string; readonly root: string }[]
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

// ── the trail wears the Life Primitive (documentation/life-primitive.md) ───
//
// EVERY HOP A READER OPENS IS A META ENVELOPE — one typed payload key that
// says how the signature resolves, and the relation the record holds it by:
// a section's text before and after, the host AI's findings, an assessor's
// note. What a reader MATCHES (the package root, the change a reading is of)
// stays a signature, as an index key does. Records written before 2026-09-23
// hold raw signatures in these fields; `openHop` reads both, so nothing is
// migrated and nothing heals destructively. An envelope is never wrapped: a
// hop resolves once. jwize, 2026-09-23: "every part of the experience shares
// the same properties".

/** Put one typed incidence around an artifact. The same hop is the same bytes, so the same signature. */
export const putHop = async (deps: Pick<ReviewDeps, 'put'>, kind: 'resource' | 'layer', sig: string, relation: string): Promise<string> =>
  deps.put(JSON.stringify(mintMetaEnvelope({ [kind]: sig, relation })), 'application/json')

/** Open a hop: the artifact an envelope names, or the bytes themselves when
 *  the field holds a raw signature (a record from before the primitive). */
export const openHop = async (sig: string, get: (sig: string) => Promise<string | null>): Promise<{ sig: string; text: string } | null> => {
  const text = await get(sig)
  if (text === null) return null
  let value: unknown = null
  try { value = JSON.parse(text) } catch { return { sig, text } }
  if (!isMetaEnvelope(value)) return { sig, text }
  const payload = metaPayloadOf(value)!
  const inner = await get(payload.sig)
  return inner === null ? null : { sig: payload.sig, text: inner }
}

/** The change with every hop opened to the text it names — what a reviewer is
 *  shown. Null when a changed file is not held where it is read. */
export const openChangeHops = async (record: ModuleChangeRecord, get: (sig: string) => Promise<string | null>): Promise<ModuleChangeRecord | null> => {
  const changes: ChangeFile[] = []
  for (const file of record.changes) {
    const [before, after] = await Promise.all([openHop(file.before, get), openHop(file.after, get)])
    if (!before || !after) return null
    changes.push({ ...file, before: before.sig, after: after.sig })
  }
  return { ...record, changes }
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
export const reviewQuestion = (sandbox: string, changes: readonly ChangeFile[], off: readonly string[], taken: readonly { path: string; root: string }[] = []): string => {
  const listed = changes.slice(0, CONTEXT_MAX / 2).map(change => `- ${change.section} (package path ${change.path})`).join('\n')
  const lines = [
    `Review a proposed change to the code of a Hypercomb hive before it goes live. It is published as the sandbox ${sandbox}.`,
    'Hypercomb runs in the browser: its modules can read and write the participant\'s storage (OPFS), sign with their Nostr key, and reach the network.',
    'The context holds each changed source file as a pair: the file AFTER the change first, then the same file BEFORE it.',
    `Changed files:\n${listed || '- none (the change only leaves parts out)'}`,
    off.length ? `Left out of the package (unreachable, not deleted): ${off.join(', ')}` : '',
    taken.length ? `Folded in from other builds, taken by hand and accepted by the publisher: ${taken.map(t => `${t.path} (from ${t.root.slice(0, 12)}…)`).join(', ')}` : '',
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
  sandbox: string, root: string, changes: readonly CommittedChange[], off: readonly string[], deps: Pick<ReviewDeps, 'put' | 'bytesOf' | 'now'>,
  taken: readonly { path: string; root: string }[] = [],
): Promise<{ sig: string; files: string[]; record: ModuleChangeRecord } | { error: string }> => {
  const files: ChangeFile[] = []
  const served: string[] = []
  for (const change of changes) {
    const [was, now] = await Promise.all([deps.bytesOf(change.from), deps.bytesOf(change.to)])
    if (!was || !now) return { error: `the module behind ${change.section} is not held here` }
    const beforeText = await deps.put(sectionText(decode(was), change.section), 'text/javascript')
    const afterText = await deps.put(sectionText(decode(now), change.section), 'text/javascript')
    const before = await putHop(deps, 'resource', beforeText, 'before')
    const after = await putHop(deps, 'resource', afterText, 'after')
    files.push({ ...change, before, after })
    served.push(beforeText, afterText, before, after)
  }
  const record: ModuleChangeRecord = {
    kind: 'module-change', sandbox, root, changes: files, off: [...off], at: deps.now(),
    ...(taken.length ? { taken: taken.map(({ path, root: from }) => ({ path, root: from })) } : {}),
  }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  return { sig, files: [...new Set(served), sig], record }
}

/** Publish the change and stamp `change:<sandbox>` beside the sandbox. */
export const publishChange = async (
  host: string, sandbox: string, root: string, changes: readonly CommittedChange[], off: readonly string[], deps: ReviewDeps,
  taken: readonly { path: string; root: string }[] = [],
): Promise<{ ok: true; sig: string; record: ModuleChangeRecord } | { ok: false; error: string }> => {
  const recorded = await recordChange(sandbox, root, changes, off, deps, taken)
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
  const opened = await openChangeHops(record, deps.get)
  if (!opened) return { ok: false, error: 'a changed file is not held here' }
  const answered = await deps.ask(host, reviewQuestion(opened.sandbox, opened.changes, opened.off, opened.taken ?? []), reviewContext(opened.changes))
  if (!answered.ok) return { ok: false, error: answered.error }
  const findingsText = await deps.put(answered.text, 'text/plain; charset=utf-8')
  const findings = await putHop(deps, 'resource', findingsText, 'findings')
  const review: ModuleReviewRecord = {
    kind: 'module-review', sandbox: record.sandbox, root: record.root, change: changeSig, host,
    model: answered.model, findings, verdict: verdictOf(answered.text), at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(review), 'application/json')
  const published = await deps.publish(host, [findingsText, findings, sig])
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
  /** Jev's reading of the change (`jev:<sandbox>`), and where it stands. */
  readonly jev?: string
  readonly jevVerdict?: JevReadingVerdict
  readonly assessments?: readonly { readonly pubkey: string; readonly record: string; readonly verdict: ReviewVerdict; readonly at: number }[]
}

/** One open trial on a zone, as the zone's /trials.json lists it (worker
 *  serveTrials): what its door serves, what its change touched, when it was
 *  committed, and the host AI's verdict. */
export interface SandboxTrial {
  readonly name: string
  readonly door: string
  readonly package: string
  readonly pubkey: string
  readonly publisher: string
  readonly at: number | null
  readonly sections: readonly string[]
  readonly off: readonly string[]
  readonly change?: string
  readonly review?: string
  readonly reviewVerdict?: ReviewVerdict
  readonly jev?: string
  readonly jevVerdict?: JevReadingVerdict
  /** Paths it folded in from other builds, and the root each came from. */
  readonly taken?: readonly { readonly path: string; readonly root: string }[]
}

const SIG_RE = /^[a-f0-9]{64}$/
const strings = (value: unknown): string[] => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === 'string' && !!item)

/** A listed trial as it arrives: every field unknown until it is checked. */
type TrialEntry = {
  readonly name?: unknown; readonly door?: unknown; readonly package?: unknown; readonly pubkey?: unknown
  readonly publisher?: unknown; readonly at?: unknown; readonly sections?: unknown; readonly off?: unknown
  readonly change?: unknown; readonly review?: unknown; readonly reviewVerdict?: unknown
  readonly jev?: unknown; readonly jevVerdict?: unknown; readonly taken?: unknown
} | null

/** The trials a zone lists, newest first. An entry that is not a trial —
 *  no try- name, no door, no package — is left out, never guessed at. */
export const trialsOf = (listing: unknown): SandboxTrial[] => {
  const raw = (listing as { trials?: unknown } | null)?.trials
  const trials: SandboxTrial[] = []
  for (const entry of Array.isArray(raw) ? raw as TrialEntry[] : []) {
    if (!entry || !isSandboxLabel(String(entry.name ?? '')) || !/^https?:\/\//.test(String(entry.door ?? ''))) continue
    if (!SIG_RE.test(String(entry.package ?? '')) || !SIG_RE.test(String(entry.pubkey ?? ''))) continue
    const verdict = VERDICTS.includes(entry.reviewVerdict as ReviewVerdict) ? entry.reviewVerdict as ReviewVerdict : undefined
    trials.push({
      name: String(entry.name), door: String(entry.door), package: String(entry.package), pubkey: String(entry.pubkey),
      publisher: typeof entry.publisher === 'string' ? entry.publisher : '',
      at: Number.isFinite(entry.at) ? Number(entry.at) : null,
      sections: strings(entry.sections), off: strings(entry.off),
      ...(SIG_RE.test(String(entry.change ?? '')) ? { change: String(entry.change) } : {}),
      ...(SIG_RE.test(String(entry.review ?? '')) ? { review: String(entry.review), ...(verdict ? { reviewVerdict: verdict } : {}) } : {}),
      ...(SIG_RE.test(String(entry.jev ?? '')) ? { jev: String(entry.jev), ...(JEV_VERDICTS.includes(entry.jevVerdict as JevReadingVerdict) ? { jevVerdict: entry.jevVerdict as JevReadingVerdict } : {}) } : {}),
      taken: (Array.isArray(entry.taken) ? entry.taken as { path?: unknown; root?: unknown }[] : [])
        .filter(pick => PACKAGE_PATH_RE.test(String(pick?.path ?? '')) && SIG_RE.test(String(pick?.root ?? '')))
        .map(pick => ({ path: String(pick.path), root: String(pick.root) })),
    })
  }
  return trials.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
}

/** Is this what a sandbox door answers at /site.json? */
export const isSandboxSite = (value: unknown): value is SandboxSite => {
  const site = value as Partial<SandboxSite> | null
  return !!site && site.sandbox === true && typeof site.title === 'string' && SIG_RE.test(String(site.package ?? ''))
}

/**
 * WHOSE WORD COUNTS: yours, and the publisher whose packages you follow
 * (`hc:install-follow` — the key the runtime calls `followed`). Anyone else's
 * assessment is shown and never counted: a fresh key costs nothing, so a
 * stranger's word is only as good as your own reading of the code.
 */
export const countedAssessors = (own?: string | null): ReadonlySet<string> => {
  const keys = new Set<string>()
  const ownKey = String(own ?? '').toLowerCase()
  if (SIG_RE.test(ownKey)) keys.add(ownKey)
  try {
    const followed = String((JSON.parse(localStorage.getItem('hc:install-follow') ?? 'null') as { pubkey?: unknown } | null)?.pubkey ?? '').toLowerCase()
    if (SIG_RE.test(followed)) keys.add(followed)
  } catch { /* 'off', or never set: nobody else */ }
  return keys
}

/** How the people who assessed a sandbox read it: the ones `counted` names
 *  by verdict, everyone else only as a number (all of them, when no set is
 *  given). */
export const tallyAssessments = (site: Pick<SandboxSite, 'assessments'>, counted?: ReadonlySet<string>): Record<ReviewVerdict | 'others', number> => {
  const tally: Record<ReviewVerdict | 'others', number> = { accept: 0, refuse: 0, unclear: 0, others: 0 }
  for (const assessment of site.assessments ?? []) {
    if (counted && !counted.has(String(assessment.pubkey).toLowerCase())) { tally.others++; continue }
    tally[VERDICTS.includes(assessment.verdict) ? assessment.verdict : 'unclear']++
  }
  return tally
}

/** Sign an assessment of a sandbox with this hive's key and make it public. */
export const assessSandbox = async (
  host: string, site: Pick<SandboxSite, 'title' | 'package' | 'change'>, verdict: ReviewVerdict, note: string, deps: ReviewDeps,
): Promise<{ ok: true; sig: string; record: ModuleAssessmentRecord } | { ok: false; error: string }> => {
  if (!VERDICTS.includes(verdict)) return { ok: false, error: 'a verdict is accept, refuse or unclear' }
  const noteText = await deps.put(note.trim() || '(no note)', 'text/plain; charset=utf-8')
  const noteSig = await putHop(deps, 'resource', noteText, 'note')
  const record: ModuleAssessmentRecord = {
    kind: 'module-assessment', sandbox: site.title, root: site.package, change: site.change ?? null, verdict, note: noteSig, at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [noteText, noteSig, sig])
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

// ── one difference at a time ───────────────────────────────────────────────
//
// A TRIAL AS A READER WALKS IT: every file its change touched, before and
// after as diff rows, the paths it turned off, what the host's AI said, and
// what people said with their notes. Everything is read by signature through
// `read`, which the caller makes answer only bytes that hash to the name
// asked for; a record that is not what its kind says is left out, and every
// signature that could not be read is named, so a missing file is never
// shown as a file that was emptied.

export interface TrialFile {
  readonly section: string
  readonly path: string
  readonly before: string
  readonly after: string
  /** Null when either side could not be read. */
  readonly diff: LineDiff | null
}

export interface TrialReading {
  readonly files: readonly TrialFile[]
  /** Jev's reading, when the trial has one. */
  readonly jev: { readonly verdict: JevReadingVerdict; readonly model: string; readonly files: readonly JevReadingFile[] } | null
  readonly off: readonly string[]
  /** Paths the trial folded in from other builds, and where each came from. */
  readonly taken: readonly { readonly path: string; readonly root: string }[]
  readonly at: number | null
  readonly review: { readonly verdict: ReviewVerdict; readonly model: string; readonly findings: string } | null
  readonly people: readonly { readonly pubkey: string; readonly verdict: ReviewVerdict; readonly note: string; readonly at: number }[]
  readonly missing: readonly string[]
}

export const readTrial = async (site: SandboxSite, read: (sig: string) => Promise<string | null>): Promise<TrialReading> => {
  const missing = new Set<string>()
  const text = async (sig: unknown): Promise<string | null> => {
    if (typeof sig !== 'string' || !SIG_RE.test(sig)) return null
    const got = await read(sig).catch(() => null)
    if (got === null) missing.add(sig)
    return got
  }
  const json = async <T,>(sig: unknown): Promise<T | null> => {
    const got = await text(sig)
    try { return got === null ? null : JSON.parse(got) as T } catch { return null }
  }
  const hop = async (sig: unknown): Promise<string | null> => {
    if (typeof sig !== 'string' || !SIG_RE.test(sig)) return null
    const opened = await openHop(sig, read).catch(() => null)
    if (!opened) missing.add(sig)
    return opened?.text ?? null
  }
  const verdict = (value: unknown): ReviewVerdict => VERDICTS.includes(value as ReviewVerdict) ? value as ReviewVerdict : 'unclear'

  const record = await json<ModuleChangeRecord>(site.change)
  const change = record?.kind === 'module-change' && Array.isArray(record.changes) ? record : null
  const files = await Promise.all((change?.changes ?? []).map(async (file): Promise<TrialFile> => {
    const [before, after] = await Promise.all([hop(file.before), hop(file.after)])
    return {
      section: String(file.section ?? ''), path: String(file.path ?? ''), before: before ?? '', after: after ?? '',
      diff: before === null || after === null ? null : diffLines(before, after),
    }
  }))

  const jevRecord = await json<JevReadingRecord>(site.jev)
  const jev = jevRecord?.kind === 'jev-reading' && Array.isArray(jevRecord.files)
    ? { verdict: JEV_VERDICTS.includes(jevRecord.verdict) ? jevRecord.verdict : 'unsure' as JevReadingVerdict, model: String(jevRecord.model ?? ''), files: jevRecord.files }
    : null
  const reviewRecord = await json<ModuleReviewRecord>(site.review)
  const review = reviewRecord?.kind === 'module-review'
    ? { verdict: verdict(reviewRecord.verdict), model: String(reviewRecord.model ?? ''), findings: (await hop(reviewRecord.findings)) ?? '' }
    : null

  const people = (await Promise.all((site.assessments ?? []).slice(0, 50).map(async assessment => {
    const assessed = await json<ModuleAssessmentRecord>(assessment.record)
    if (assessed?.kind !== 'module-assessment' || assessed.root !== site.package) return null
    return { pubkey: assessment.pubkey, verdict: verdict(assessed.verdict), note: (await hop(assessed.note)) ?? '', at: assessment.at }
  }))).filter((person): person is NonNullable<typeof person> => person !== null)

  const taken = (Array.isArray(change?.taken) ? change!.taken : [])
    .filter(entry => PACKAGE_PATH_RE.test(String(entry?.path ?? '')) && SIG_RE.test(String(entry?.root ?? '')))
    .map(entry => ({ path: String(entry.path), root: String(entry.root) }))
  return {
    files, jev, off: strings(change?.off), taken, at: Number.isFinite(change?.at) ? Number(change!.at) : null,
    review, people, missing: [...missing],
  }
}

/** Reads a signature from a trial's door, believing only bytes that hash to it. */
export const doorReader = (door: string) => async (sig: string): Promise<string | null> => {
  const res = await fetch(`${door.replace(/\/+$/, '')}/${sig}`, { cache: 'force-cache' }).catch(() => null)
  if (!res?.ok) return null
  const bytes = await res.arrayBuffer()
  return (await SignatureService.sign(bytes)) === sig ? new TextDecoder().decode(bytes) : null
}

// ── your own build: take one community change at one path ─────────────────
//
// TAKE A TRIAL AT THE PATHS ITS CHANGE TOUCHED, LEAVE THE REST (documentation/
// module-sandbox.md, "Your own build"; jwize 2026-09-22: anyone's, held). The
// trial's layer at each path becomes a pick in this hive, made BY HAND: the
// gate lets a root nothing here vouches for in as a stranger's (runtime
// activation-authority.ts, the HAND door), and every bee and bundle it brings
// that the trunk does not already run waits in the brood until the
// participant accepts it with the two warnings. Nothing it brought runs
// before that. `module drop <path>` gives the path back to the trunk.

/** The install provider, as far as taking needs it (core InstallProvider). */
export interface TakeDeps {
  revisionsOf(path: string, zones: readonly string[], roots: readonly string[]): Promise<readonly { readonly layer: string; readonly sources: readonly { readonly root: string }[] }[]>
  pick(path: string, revision: { layer: string; root: string }, zones: readonly string[], options: { byHand: true }): Promise<{ ok: boolean; error?: string }>
  /** How much of what came from `root` waits in the brood, unruled. */
  held(root: string): Promise<number>
}

export interface TakeOutcome {
  readonly taken: readonly string[]
  readonly refused: readonly { readonly path: string; readonly error: string }[]
  readonly held: number
}

const PACKAGE_PATH_RE = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})*$/i

/** The package paths a change touched, once each, in order. */
export const changedPaths = (record: Pick<ModuleChangeRecord, 'changes'> | null): string[] =>
  [...new Set((record?.changes ?? []).map(file => String(file.path ?? '')).filter(path => PACKAGE_PATH_RE.test(path)))]

/** Take the trial rooted at `root` at each path, by hand. */
export const takeTrial = async (root: string, paths: readonly string[], zones: readonly string[], deps: TakeDeps): Promise<TakeOutcome> => {
  const taken: string[] = []
  const refused: { path: string; error: string }[] = []
  for (const path of paths) {
    const revisions = await deps.revisionsOf(path, zones, [root]).catch(() => [])
    const layer = revisions.find(revision => revision.sources.some(source => source.root === root))?.layer
    if (!layer) { refused.push({ path, error: `the trial does not carry ${path}` }); continue }
    const picked = await deps.pick(path, { layer, root }, zones, { byHand: true })
      .catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : 'the pick failed' }))
    if (picked.ok) taken.push(path)
    else refused.push({ path, error: picked.error ?? 'the pick was refused' })
  }
  return { taken, refused, held: taken.length ? await deps.held(root).catch(() => 0) : 0 }
}

/** What a take needs, from this hive's install provider and its brood. */
export const takeDepsFrom = (install: Pick<TakeDeps, 'revisionsOf' | 'pick'>): TakeDeps => ({
  revisionsOf: (path, zones, roots) => install.revisionsOf(path, zones, roots),
  pick: (path, revision, zones, options) => install.pick(path, revision, zones, options),
  held: async root => (await broodRoster()).filter(record => record.source.packageSig === root && !record.ruling).length,
})

// ── Jev reads a trial ──────────────────────────────────────────────────────
//
// JEV'S READING OF A CHANGE, PUBLIC BESIDE IT (jev-decision.ts, "Jev reads a
// trial"). Every changed file's diff is judged against every doctrine
// section; the record names each file's chance of breaking each rule and the
// worst of them, and the change's standing: follows · unsure · breaks. It is
// stamped as `jev:<sandbox>` in the publisher's index. A reading is a reading,
// never a gate: promotion stays the participant's word.

export const JEV_VERDICTS: readonly JevReadingVerdict[] = ['follows', 'unsure', 'breaks']

export interface JevReadingRecord {
  readonly kind: 'jev-reading'
  readonly sandbox: string
  readonly root: string
  readonly change: string
  readonly model: string
  readonly rubric: number
  readonly verdict: JevReadingVerdict
  readonly files: readonly JevReadingFile[]
  readonly at: number
}

/** A diff as Jev reads it: one line per row, cut to `maxChars` with a count of what was cut. */
export const diffText = (diff: LineDiff, maxChars: number): string => {
  const lines: string[] = []
  let used = 0
  for (let i = 0; i < diff.rows.length; i++) {
    const row: DiffRow = diff.rows[i]!
    const line = row.kind === 'skip' ? `⋯ ${row.count} unchanged lines` : `${row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '} ${row.text}`
    if (used + line.length + 1 > maxChars) { lines.push(`… (cut: ${diff.rows.length - i} more rows)`); break }
    lines.push(line)
    used += line.length + 1
  }
  return lines.join('\n')
}

/** Read every changed file before and after, judge the diffs, publish the reading. */
export const jevReadTrial = async (
  host: string, changeSig: string, record: ModuleChangeRecord, doctrine: readonly string[],
  jev: (input: JevReadingInput) => Promise<JevReadingResult>, deps: ReviewDeps,
): Promise<{ ok: true; sig: string; record: JevReadingRecord } | { ok: false; error: string }> => {
  const judged = record.changes.slice(0, JEV_READING_FILES)
  if (!judged.length) return { ok: false, error: 'the change has no source file to read' }
  if (!doctrine.length) return { ok: false, error: 'no doctrine is loaded to judge by' }
  const perFile = Math.floor(JEV_READING_CHARS / judged.length)
  const files: { section: string; diff: string }[] = []
  for (const file of judged) {
    const [before, after] = await Promise.all([openHop(file.before, deps.get), openHop(file.after, deps.get)])
    if (!before || !after) return { ok: false, error: `${file.section} is not held here` }
    files.push({ section: file.section, diff: diffText(diffLines(before.text, after.text), perFile) })
  }
  let read: JevReadingResult
  try { read = await jev({ sandbox: record.sandbox, files, doctrine }) } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Jev did not answer' }
  }
  const reading: JevReadingRecord = {
    kind: 'jev-reading', sandbox: record.sandbox, root: record.root, change: changeSig, model: read.model, rubric: JEV_RUBRIC,
    verdict: read.verdict, files: read.files, at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(reading), 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `jev:${record.sandbox}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the reading pointer was not stamped' }
  return { ok: true, sig, record: reading }
}

// ── JEV WEIGHS A ZONE (documentation/module-sandbox.md, "Deciding directions") ──
//
// THE OPEN TRIALS, WEIGHED TOGETHER. Code gathers what is known about each
// trial from public records alone — the zone's listing, each door's site and
// the signed change, reading and assessment records behind it — writes it in
// plain words, and Jev weighs the table (jev-decision.ts, "Jev weighs a
// zone"). Code adds what needs no judgment: which trials change one file (one
// layer per path: only one can be folded, or a merge drafted) and who took
// whose package (adoption, from the signed change records). The pass is
// published under the participant's key as `pass:<zone>` — replayable and
// reviewable like everything else. It proposes; it takes nothing and folds
// nothing.

export interface PassTrial {
  readonly name: string
  readonly package: string
  readonly change: string | null
  readonly standing: JevTrialStanding
  readonly conforms: number
  readonly refused: number
  /** Trials that change one of the same source files. */
  readonly clashes: readonly string[]
  /** Trials that took this one's package at a path. */
  readonly takenBy: readonly string[]
}
export interface JevPassRecord {
  readonly kind: 'jev-pass'
  readonly zone: string
  readonly model: string
  readonly rubric: number
  readonly trials: readonly PassTrial[]
  readonly focus: string | null
  readonly at: number
}

const NOTES_TOLD = 6
const NOTE_CHARS = 200

/** Which trials change one of the same source files. */
export const trialClashes = (trials: readonly Pick<SandboxTrial, 'name' | 'sections'>[]): Map<string, string[]> => {
  const clashes = new Map(trials.map(trial => [trial.name, [] as string[]]))
  for (const a of trials) for (const b of trials) {
    if (a.name !== b.name && a.sections.some(section => b.sections.includes(section))) clashes.get(a.name)!.push(b.name)
  }
  return clashes
}

/** Which trials took a trial's package at a path. */
export const trialAdoption = (trials: readonly Pick<SandboxTrial, 'name' | 'package' | 'taken'>[]): Map<string, string[]> => {
  const takenBy = new Map(trials.map(trial => [trial.name, [] as string[]]))
  for (const trial of trials) for (const other of trials) {
    if (trial.name !== other.name && (other.taken ?? []).some(pick => pick.root === trial.package)) takenBy.get(trial.name)!.push(other.name)
  }
  return takenBy
}

/** What is known about a trial, in plain words. People's notes are their
 *  words: data for Jev to weigh, never instructions. Only the people
 *  `counted` names are counted (countedAssessors); the host's AI and Jev
 *  readings are records the PUBLISHER stamps in its own index, so they are
 *  told as its word and never as a verdict. */
export const trialEvidence = (
  trial: SandboxTrial, read: Pick<TrialReading, 'people' | 'jev'> | null, takenBy: readonly string[], clashes: readonly string[],
  counted: ReadonlySet<string> | null = null,
): string => {
  const everyone = read?.people ?? []
  const people = counted ? everyone.filter(person => counted.has(person.pubkey.toLowerCase())) : everyone
  const others = everyone.length - people.length
  const tally: Record<ReviewVerdict, number> = { accept: 0, refuse: 0, unclear: 0 }
  for (const person of people) tally[person.verdict]++
  const notes = people.filter(person => person.note.trim()).slice(0, NOTES_TOLD)
    .map(person => `${person.verdict} — "${person.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS)}"`)
  const worst = read?.jev?.files.reduce<JevReadingRule | null>((top, file) => !top || file.worst.breaks > top.breaks ? file.worst : top, null) ?? null
  const what = [
    trial.sections.length ? `changes ${trial.sections.join(', ')}` : 'no source changes',
    trial.off.length ? `turns off ${trial.off.join(', ')}` : '',
    trial.taken?.length ? `takes ${trial.taken.map(pick => pick.path).join(', ')} from other builds` : '',
  ].filter(Boolean).join('; ')
  return [
    `${trial.name} by ${trial.publisher || trial.pubkey.slice(0, 12) + '…'}${trial.at ? `, ${new Date(trial.at).toISOString().slice(0, 10)}` : ''}: ${what}.`,
    `The publisher's own records, which nobody checked, say its host's AI read ${trial.reviewVerdict ?? 'nothing yet'} and its Jev read ${read?.jev ? `${read.jev.verdict}${worst ? ` (closest to breaking "${worst.rule}", ${Math.round(worst.breaks * 100)}%)` : ''}` : 'nothing yet'} — the publisher's word, not evidence.`,
    `People who count: ${tally.accept} accept, ${tally.refuse} refuse, ${tally.unclear} unclear.${others ? ` ${others} others assessed it and are not counted.` : ''}${notes.length ? ` Notes: ${notes.join('; ')}.` : ''}`,
    takenBy.length ? `Taken into ${takenBy.join(', ')}.` : '',
    clashes.length ? `Changes a file that ${clashes.join(', ')} also changes.` : '',
  ].filter(Boolean).join('\n')
}

export interface PassDeps extends Pick<ReviewDeps, 'put' | 'publish' | 'stamp' | 'now'> {
  /** What a trial's door says about itself, or null when it does not answer. */
  readonly site: (trial: SandboxTrial) => Promise<SandboxSite | null>
  /** A reader of signatures from a trial's door. */
  readonly reader: (door: string) => (sig: string) => Promise<string | null>
  /** Whose assessments count (countedAssessors); everyone, when absent. */
  readonly counted?: ReadonlySet<string>
}

/** Gather every trial's evidence, ask Jev to weigh the table, publish the pass. */
export const jevPassZone = async (
  host: string, zone: string, listed: readonly SandboxTrial[], jev: (input: JevPassInput) => Promise<JevPassResult>, deps: PassDeps,
): Promise<{ ok: true; sig: string; record: JevPassRecord } | { ok: false; error: string }> => {
  const trials = listed.slice(0, JEV_PASS_TRIALS)
  if (!trials.length) return { ok: false, error: 'no trial is open' }
  const clashes = trialClashes(trials)
  const takenBy = trialAdoption(trials)
  const evidence = await Promise.all(trials.map(async trial => {
    const site = await deps.site(trial)
    const read = site ? await readTrial(site, deps.reader(trial.door)) : null
    return trialEvidence(trial, read, takenBy.get(trial.name) ?? [], clashes.get(trial.name) ?? [], deps.counted ?? null)
  }))
  let weighed: JevPassResult
  try { weighed = await jev({ zone, trials: trials.map((trial, i) => ({ name: trial.name, evidence: evidence[i]! })) }) } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Jev did not answer' }
  }
  const record: JevPassRecord = {
    kind: 'jev-pass', zone, model: weighed.model, rubric: JEV_RUBRIC,
    trials: trials.map((trial, i) => ({
      name: trial.name, package: trial.package, change: trial.change ?? null,
      standing: weighed.trials[i]!.standing, conforms: weighed.trials[i]!.conforms, refused: weighed.trials[i]!.refused,
      clashes: clashes.get(trial.name) ?? [], takenBy: takenBy.get(trial.name) ?? [],
    })),
    focus: weighed.focus, at: deps.now(),
  }
  const sig = await deps.put(JSON.stringify(record), 'application/json')
  const published = await deps.publish(host, [sig])
  if (!published.ok) return { ok: false, error: published.error }
  const stamped = await deps.stamp(host, `pass:${zone}`, sig)
  if (!stamped.ok) return { ok: false, error: stamped.reason ?? 'the pass pointer was not stamped' }
  return { ok: true, sig, record }
}
