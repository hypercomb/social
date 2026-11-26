// commands/utterance/line-plan.ts — WHAT A LINE WILL DO, before it runs.
//
// jwize, 2026-11-26: "a full screen view … so you can see what the command
// line is going to execute with a clear description based on the behaviors."
// The run preview (assistant/run-preview.view.ts) draws one plan per line of a
// call from outside; this module makes the plan, and nothing here runs.
//
// THE PLAN READS THE LINE THE WAY THE DOOR WILL. Lines from outside are said
// through the remote door (shared command-line.component.ts, the REMOTE_SUBMIT
// listener), and the plan follows that door's fork in the same order:
//
//   1. a word that keeps its arguments verbatim (`rawArgs`) is given its slash;
//   2. a line with a slash is one behaviour word and its arguments;
//   3. any other line is a SENTENCE, read by the utterance reader — every
//      behaviour word it names runs, in word order, with the words after it;
//   4. a sentence that names no word but speaks the structural grammar (a
//      path, a selection, a sigil, a mark, a view) goes to the line's own
//      pipeline; one that speaks nothing is refused, so no tile is minted
//      from a sentence.
//
// Every verb is then asked of core's machine admission with the participant's
// grant, exactly as the door asks it, so a line the door will refuse is shown
// refused here, with the door's own reason, before Enter is pressed.
//
// Pure: the census, the reader and the grant are handed in. The view wires the
// live ones; line-plan.spec.ts hands in fixed ones.

import {
  admitMachineCall, currentMachineGrant, spokenEntry,
  type AdmissionEntry, type MachineGrant,
} from '@hypercomb/core'
import type { UtteranceReading, UtteranceSpan } from './utterance-reading.js'

/** A census row as the plan reads it: the door's admission fields plus what
 *  the preview shows. */
export type PlanEntry = AdmissionEntry & {
  readonly description?: string
  readonly descriptionKey?: string
  readonly rawArgs?: boolean
  readonly options?: readonly string[]
  readonly machine?: AdmissionEntry['machine'] & { readonly refuse?: (args: string) => string | undefined }
}

/** One behaviour the line will run. */
export type PlanStep = {
  /** The behaviour's own name (an alias said is resolved to it). */
  readonly command: string
  /** The word as it was said, when that was an alias. */
  readonly said?: string
  /** Exactly what the behaviour is handed. */
  readonly args: string
  /** What the behaviour does, in the participant's language. Empty when the
   *  behaviour declares nothing. */
  readonly description: string
  /** No live behaviour answers to the word: the line's own pipeline takes it. */
  readonly unknown?: boolean
}

export type LinePlan = {
  readonly text: string
  /**
   *  word       — one behaviour word, with its slash or keeping its arguments
   *  sentence   — plain language, read into behaviour words
   *  structure  — the line's own grammar (path, selection, sigil, mark, view)
   *  inert      — names nothing: refused, nothing runs
   */
  readonly kind: 'word' | 'sentence' | 'structure' | 'inert'
  readonly steps: readonly PlanStep[]
  /** The reading's spans for a sentence — the view lights the words that run
   *  and dims what is thrown away. */
  readonly spans?: readonly UtteranceSpan[]
  /** A word two behaviours claim: nothing runs, the caller must choose. */
  readonly ambiguous?: { readonly word: string; readonly candidates: readonly string[] }
  /** Why the door will refuse the line, in the door's own words. */
  readonly refused?: string
}

export type PlanDeps = {
  readonly census: readonly PlanEntry[]
  /** The utterance reader over the live census. Absent → no sentence is read. */
  readonly read?: (text: string) => UtteranceReading | null
  readonly grant?: MachineGrant
  /** A word nothing live claims may be retired. */
  readonly retired?: (name: string) => AdmissionEntry['retired']
}

/** The same test as the door's `speaksStructure` (shared remote-verbs.ts). */
export const speaksStructure = (line: string): boolean =>
  /^\s*[[~#?>.]/.test(line) || /[\/@:\[\]]/.test(line)

/** The door's slash split: after the slash, trimmed, the name runs to the
 *  first space or `(`; arguments start AT a paren and AFTER a space. */
const slashCall = (line: string): { name: string; args: string } => {
  const raw = line.trimStart().slice(1).trim()
  const space = raw.indexOf(' ')
  const paren = raw.indexOf('(')
  const at = space >= 0 && (paren < 0 || space < paren) ? space : paren
  if (at < 0) return { name: raw.toLowerCase(), args: '' }
  return { name: raw.slice(0, at).toLowerCase(), args: raw.slice(at === paren ? at : at + 1).trim() }
}

const firstWord = (line: string): string =>
  line.trim().replace(/^\/+/, '').split(/[\s(]/, 1)[0]?.toLowerCase() ?? ''

const stepOf = (said: string, args: string, census: readonly PlanEntry[]): PlanStep => {
  const entry = spokenEntry(said, census)
  if (!entry) return { command: said, args, description: '', unknown: true }
  const command = entry.name
  return {
    command, args, description: entry.description?.trim() ?? '',
    ...(command.toLowerCase() !== said.toLowerCase() ? { said } : {}),
  }
}

/** Plan one line. Never throws: a line it cannot read is planned as inert. */
export const planLine = (text: string, deps: PlanDeps): LinePlan => {
  const census = deps.census
  const trimmed = text.trim()
  const keeps = !trimmed.startsWith('/') && spokenEntry(firstWord(trimmed), census)?.rawArgs === true
  const line = keeps ? '/' + trimmed : trimmed
  const prose = !line.startsWith('/')

  let kind: LinePlan['kind']
  let steps: PlanStep[] = []
  let spans: readonly UtteranceSpan[] | undefined
  let ambiguous: LinePlan['ambiguous']

  const reading = prose ? safeRead(deps.read, trimmed.toLowerCase()) : null
  if (reading?.actions.length || reading?.ambiguous) {
    kind = 'sentence'
    spans = reading.spans
    steps = reading.actions.map(action => stepOf(action.command, action.args, census))
    const span = reading.spans.find(s => s.role === 'ambiguity')
    if (span) ambiguous = { word: span.text, candidates: (span.candidates ?? []).map(c => c.name) }
  } else if (prose) {
    kind = speaksStructure(trimmed) ? 'structure' : 'inert'
  } else {
    const call = slashCall(line)
    kind = 'word'
    if (call.name) steps = [stepOf(call.name, call.args, census)]
  }

  const plan = (refused?: string): LinePlan => ({
    text: trimmed, kind, steps,
    ...(spans ? { spans } : {}),
    ...(ambiguous ? { ambiguous } : {}),
    ...(refused ? { refused } : {}),
  })

  // THE DOOR'S JUDGEMENT, asked the same way: every verb, the first refusal
  // answers; a line that names nothing is asked about as the empty verb.
  const grant = deps.grant ?? currentMachineGrant()
  const verbs = steps.length ? steps.map(s => ({ verb: s.said ?? s.command, args: s.args })) : [{ verb: '', args: undefined }]
  for (const { verb, args } of verbs) {
    const live = spokenEntry(verb, census)
    const retired = live || !verb ? undefined : deps.retired?.(verb)
    const entry: PlanEntry | undefined = live ?? (retired ? { name: verb, retired } : undefined)
    const verdict = admitMachineCall(verb, entry, 'operator', grant)
    const refused = !verdict.admit ? verdict.reason
      : args === undefined ? undefined : safeRefuse(entry, args)
    if (refused) return plan(refused)
  }
  if (ambiguous) return plan()
  if (kind === 'inert') {
    return plan('no word in this line matched a behaviour, so nothing will run — to make a tile, say: create <name>')
  }
  return plan()
}

const safeRead = (read: PlanDeps['read'], text: string): UtteranceReading | null => {
  try { return read?.(text) ?? null } catch { return null }
}

const safeRefuse = (entry: PlanEntry | undefined, args: string): string | undefined => {
  try { return entry?.machine?.refuse?.(args) } catch { return undefined }
}
