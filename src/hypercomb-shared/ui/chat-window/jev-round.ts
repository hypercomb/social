// jev-round.ts — THE DECISIONS OF ONE JEV ROUND, without the machinery.
//
// The chat window's round loop does input and output: it streams, calls the
// router, queues work in Execution, yields text. Everything it DECIDES about a
// possibility table lives here instead, pure, so every branch can be tested
// without a browser (documentation/jev-decisions.md):
//
//   tableFor        which reply is a table — including a bare change block in
//                   Jev mode, wrapped as a one-row table in the worker's words
//   prepareTable    the hive's parsers go first: what can run, what cannot
//   stepFor         Jev's plan made into the one thing the loop does next
//   offeredSentence the participant answered a table question in the hive's
//                   own language, so the sentence runs as a behaviour
//
// The census is handed in as two functions that throw when the hive would not
// run a line, so this module names no behaviour and keeps no vocabulary.

import { splitQuestion } from '@hypercomb/core'
import { JEV_ANSWER_NOW, parseTable, SENTENCE_JOIN, tableChoiceNote, tableQuestion, QUESTION_WORDS, type Decision, type QuestionWords, type Reach, type Row } from './hypercomb-jev'
import { WorkRefused, type WorkRequest } from './hypercomb-work-fence'

/** The live census, as the loop reads it. Both throw on a line the hive refuses. */
export interface RoundCensus {
  /** One read line → its canonical grammar. */
  readRead(line: string): string
  /** A change's lines → canonical grammars and how far they reach. */
  readDo(lines: readonly string[]): { readonly grammars: readonly string[]; readonly reach: Reach }
}

export interface PreparedTable {
  /** Rows the hive can run, in the worker's own words, with reach on changes. */
  readonly rows: readonly Row[]
  /** What each runnable row runs as. */
  readonly grammarOf: ReadonlyMap<string, readonly string[]>
  /** Rows the census refused, with the hive's reason — recorded as misses. */
  readonly dropped: readonly { readonly id: string; readonly reason: string; readonly sentence: string }[]
}

export type RoundStep =
  | { readonly kind: 'refuse'; readonly reason: string }
  | { readonly kind: 'question'; readonly text: string }
  | { readonly kind: 'answer'; readonly reply: string }
  | { readonly kind: 'read'; readonly grammars: readonly string[]; readonly note: string }
  | { readonly kind: 'do'; readonly grammars: readonly string[]; readonly review: boolean; readonly note: string }

export const TABLE_REFUSAL = 'send one closed hypercomb-table JSON block with two to eight distinct rows of kind read, do, answer or ask'

/** The table this reply carries, as JSON lines, or undefined when it carries
 *  none. A bare change block in Jev mode is a one-row table; its label is the
 *  worker's own first line, bare, because the source boundary only lets Jev
 *  see what the worker itself wrote. Reads run as written, never judged. */
export const tableFor = (request: WorkRequest, jevMode: boolean): readonly string[] | undefined => {
  if (request.kind === 'table') return request.lines
  if (!jevMode || request.kind !== 'do' || !request.lines.length) return undefined
  const label = request.lines[0].replace(/^\//, '').replace(/[\x00-\x1f\x7f`~*]/g, ' ').trim().slice(0, 70) || 'change'
  return [JSON.stringify({ rows: [{ id: 'action', kind: 'do', label, lines: request.lines }] })]
}

/** THE HIVE'S PARSERS GO FIRST. Jev only ever chooses among rows the hive can
 *  already run; a row it cannot is dropped and said. Throws WorkRefused when
 *  the table is malformed or nothing in it can run. */
export const prepareTable = (lines: readonly string[], census: RoundCensus): PreparedTable => {
  let parsed: readonly Row[]
  try { parsed = parseTable(lines) } catch { throw new WorkRefused(TABLE_REFUSAL) }
  const dropped: { id: string; reason: string; sentence: string }[] = []
  const grammarOf = new Map<string, readonly string[]>()
  const rows = parsed.flatMap((row): Row[] => {
    try {
      if (row.kind === 'read') {
        grammarOf.set(row.id, [census.readRead(row.lines[0])])
        return [row]
      }
      if (row.kind === 'do') {
        const { grammars, reach } = census.readDo(row.lines)
        grammarOf.set(row.id, grammars)
        return [{ ...row, reach }]
      }
      return [row]
    } catch (error) {
      dropped.push({ id: row.id, reason: error instanceof Error ? error.message : 'the hive cannot run it', sentence: row.lines.join(' · ') })
      return []
    }
  })
  if (!rows.length) throw new WorkRefused(`no row can run: ${dropped.map(row => `${row.id}: ${row.reason}`).join('; ')}`)
  return { rows, grammarOf, dropped }
}

/** Jev's plan, made into the one thing the loop does next. */
export const stepFor = (decision: Decision, table: PreparedTable, words: QuestionWords = QUESTION_WORDS): RoundStep => {
  const plan = decision.plan
  const note = tableChoiceNote(decision, table.rows, table.dropped)
  const row = (id: string): Row | undefined => table.rows.find(candidate => candidate.id === id)
  switch (plan.kind) {
    case 'revise':
      return { kind: 'refuse', reason: decision.reason }
    case 'participant':
    case 'ask': {
      const asked = plan.kind === 'ask' ? row(plan.row) : undefined
      // Best first, by Jev's own fit for each row; the worker's order breaks ties.
      const fit = (id: string): number => {
        const answer = decision.answers[`${id}_fit`] as { noul?: unknown } | undefined
        return typeof answer?.noul === 'number' ? answer.noul : 0
      }
      const choices = table.rows
        .filter(candidate => candidate.kind !== 'answer' && candidate.id !== asked?.id && !decision.rejected.includes(candidate.id))
        .map((candidate, order) => ({ candidate, order }))
        .sort((a, b) => fit(b.candidate.id) - fit(a.candidate.id) || a.order - b.order)
        .map(({ candidate }) => candidate)
      return { kind: 'question', text: tableQuestion(choices, decision.reason, asked?.lines[0], words) }
    }
    case 'answer':
      return { kind: 'answer', reply: `${note} ${JEV_ANSWER_NOW}` }
    case 'read':
      return { kind: 'read', grammars: plan.rows.flatMap(id => table.grammarOf.get(id) ?? []), note }
    case 'do':
      return { kind: 'do', grammars: table.grammarOf.get(plan.row) ?? [], review: plan.review, note }
  }
}

/** THE PARTICIPANT SPEAKS THE HIVE'S LANGUAGE. When the message IS one of the
 *  sentences the previous assistant turn offered as an option, it runs as the
 *  behaviour the census says it is. Only an OFFERED sentence counts: ordinary
 *  prose never becomes a command, and no label is ever matched. */
export const offeredSentence = (
  message: string,
  lastAssistantText: string | undefined,
  census: RoundCensus,
): { readonly kind: 'do' | 'read'; readonly grammars: readonly string[] } | null => {
  const said = String(message ?? '').trim()
  if (!said || !lastAssistantText) return null
  const offered = (splitQuestion(lastAssistantText).question?.options ?? []).map(option => option.trim().toLowerCase())
  if (!offered.includes(said.toLowerCase())) return null
  // One option is one row: its sentences, joined by the quiet dot.
  const sentences = said.split(SENTENCE_JOIN).map(sentence => sentence.trim()).filter(Boolean)
  try { return { kind: 'do', grammars: census.readDo(sentences).grammars } } catch { /* not a change */ }
  if (sentences.length !== 1) return null
  try { return { kind: 'read', grammars: [census.readRead(sentences[0])] } } catch { /* not a read either */ }
  return null
}
