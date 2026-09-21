// Shell contract for the replaceable essentials decision service. No module
// import: the web shell resolves services from the signed installation.
//
// JEV RUNS THE SHOW (documentation/jev-decisions.md). The worker model never
// picks the next step. It ends a round with a POSSIBILITY TABLE — every step
// that could reasonably come next, as rows the hive can already run — and Jev
// answers one batch of snap questions about the rows. Code composes the plan.
export const JEV_IOC_KEY = '@hypercomb.social/JevDecision'
export const JEV_MODEL = '~typesafe/jev-latest'
export const JEV_MAX_ROWS = 8
export type RowKind = 'read' | 'do' | 'answer' | 'ask'
/** Set by the hive from the census for do rows; decides gates, never sent to Jev. */
export type Reach = 'additive' | 'editing' | 'destructive'
export interface Row { readonly id: string; readonly kind: RowKind; readonly label: string; readonly lines: readonly string[]; readonly why?: string; readonly reach?: Reach }
export type Plan =
  | { readonly kind: 'answer' }
  | { readonly kind: 'ask'; readonly row: string }
  | { readonly kind: 'read'; readonly rows: readonly string[] }
  | { readonly kind: 'do'; readonly row: string; readonly review: boolean }
  | { readonly kind: 'participant'; readonly rows: readonly string[] }
  | { readonly kind: 'revise' }
export interface Decision {
  readonly plan: Plan
  readonly rejected: readonly string[]
  readonly reason: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly usage?: { inputTokens?: number; outputTokens?: number; cost?: number }
}
export interface JevLike {
  ready(providerId: string): boolean
  evaluate(input: unknown, source: { providerId: string; system: string; messages: readonly { content: string }[] }, signal?: AbortSignal): Promise<Decision>
}
interface UsageAttempt {
  readonly category?: string
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly estimatedCostUsd?: number }
}

/** Only measured provider usage is counted; absent counts remain visible. */
export const formatJevUsage = (attempts: readonly UsageAttempt[]): string => {
  const summarize = (rows: readonly UsageAttempt[]): string => {
    if (!rows.length) return 'no calls'
    const count = (key: 'inputTokens' | 'outputTokens', label: string): string => {
      const measured = rows.map(row => row.usage?.[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0)
      if (!measured.length) return `${label} unavailable`
      const total = measured.reduce((sum, value) => sum + value, 0)
      return `${total} ${label}${measured.length < rows.length ? ' (partial)' : ''}`
    }
    return `${count('inputTokens', 'input')}, ${count('outputTokens', 'output')}`
  }
  return `Tokens — workers: ${summarize(attempts.filter(row => row.category !== 'jev-decision'))}; Jev: ${summarize(attempts.filter(row => row.category === 'jev-decision'))}.`
}
interface ResourceWriter { putResource?(blob: Blob, options: { emit: boolean }): Promise<string> }
const resource = (store: ResourceWriter, value: unknown): Promise<string | undefined> =>
  store.putResource?.(new Blob([JSON.stringify(value)], { type: 'application/json' }), { emit: false }) ?? Promise.resolve(undefined)

/** Durable provenance references immutable content; only the wire packet is inline. */
export const persistJevInput = async (store: ResourceWriter | undefined, input: {
  request: string; doctrine: string; evidence: readonly string[]; rows: readonly Row[]
}): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  const request = await resource(store, input.request)
  const doctrine = await resource(store, input.doctrine)
  const evidence = await Promise.all(input.evidence.map(value => resource(store, value)))
  const rows = await Promise.all(input.rows.map(async row => resource(store, {
    id: row.id, kind: row.kind, label: await resource(store, row.label), lines: await resource(store, row.lines),
    ...(row.why ? { why: await resource(store, row.why) } : {}),
    ...(row.reach ? { reach: row.reach } : {}),
  })))
  return resource(store, { kind: 'jev-input', model: JEV_MODEL, rubric: 4, request, doctrine, evidence, rows })
}

export const persistJevReceipt = async (store: ResourceWriter | undefined, source: string, result: Decision): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  return resource(store, { ...result, kind: 'jev-decision', source, requestedModel: JEV_MODEL,
    reason: await resource(store, result.reason), answers: await resource(store, result.answers),
  })
}

export const JEV_WORK_INSTRUCTION =
  'JEV RUNS THE SHOW. You do not choose the next step; you list the possible ones and Jev, a decision service, picks in one fast call. '
  + 'Every round, end your reply with ONE closed fence whose opening line is exactly three backticks followed by hypercomb-table (never json, never a bare fence), holding JSON: {"rows":[{"id":"a","kind":"read","label":"See who is under people","line":"list /business/people"},'
  + '{"id":"b","kind":"do","label":"Create the people tile","lines":["create people"]},{"id":"c","kind":"answer","label":"Answer now"},{"id":"d","kind":"ask","label":"Ask how to group","line":"Group by city or by role?"}]}. '
  + `Two to ${JEV_MAX_ROWS} rows. Kinds: read (one read line: tree, read, list, history, summary, find or code), do (one to six behaviour sentences from the vocabulary, in lines), answer (you could answer the request now from what the messages hold), ask (a question only the participant can answer, in line). `
  + 'Ids are lowercase letters, digits, underscores; labels under 70 characters and distinct; an optional why under 200 characters. '
  + 'List every step that could reasonably be next: the reads that would settle an assumption, the change the request asks for, the answer row whenever you might be done, the ask row when a preference is missing. '
  + 'Do not argue for a row, rank the rows, or reason about which is best — that is Jev\'s job and it is faster at it. Write no prose while working. '
  + 'The next message says what Jev chose and what ran; continue from it. After a change ran, include a read row that would verify it. When told to answer, answer in prose with no block.'

/** The table the model wrote, before the hive's parsers and Jev see it. */
export const parseTable = (lines: readonly string[]): readonly Row[] => {
  if (lines.join('\n').length > 9_000) throw new Error('The table exceeds the decision budget')
  const value = JSON.parse(lines.join('\n')) as { rows?: unknown }
  if (!value || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > JEV_MAX_ROWS) throw new Error(`Provide one to ${JEV_MAX_ROWS} rows`)
  const rows = value.rows.map((raw: unknown): Row => {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid row')
    const row = raw as Record<string, unknown>
    const kind = row['kind']
    if (typeof row['id'] !== 'string' || !/^[a-z][a-z0-9_-]{0,23}$/.test(row['id']) || row['id'] === 'none'
      || (kind !== 'read' && kind !== 'do' && kind !== 'answer' && kind !== 'ask')
      || typeof row['label'] !== 'string' || !row['label'].trim() || row['label'].length > 70 || /[\x00-\x1f\x7f`~*]/.test(row['label'])
      || row['label'].trim() === 'Something else') throw new Error('Invalid row')
    const raw_lines = row['lines'] ?? (row['line'] === undefined ? [] : [row['line']])
    if (!Array.isArray(raw_lines) || raw_lines.some(line => typeof line !== 'string' || !line.trim() || line.length > 1_000)) throw new Error('Invalid row line')
    const lines = (raw_lines as string[]).map(line => line.trim())
    if (kind === 'answer' ? lines.length : !lines.length) throw new Error('Invalid row line')
    if ((kind !== 'do' && lines.length > 1) || lines.length > 6 || lines.join('\n').length > 2_000) throw new Error('A row exceeds its budget')
    const why = typeof row['why'] === 'string' && row['why'].trim() && row['why'].length <= 200 ? row['why'].trim() : undefined
    return { id: row['id'], kind, label: row['label'].trim(), lines, ...(why ? { why } : {}) }
  })
  if (new Set(rows.map(r => r.id)).size !== rows.length || new Set(rows.map(r => r.label)).size !== rows.length) throw new Error('Rows must have distinct ids and labels')
  if (rows.filter(r => r.kind === 'answer').length > 1) throw new Error('One answer row at most')
  return rows
}

/** The question itself is normal persisted conversation text, so the next
 * worker sees the alternatives and the participant's answer after reload.
 * THE OPTIONS ARE THE SENTENCES — behaviour lines in the hive's own grammar,
 * the vocabulary the census teaches — never labels. What the participant
 * picks is a sentence the hive can run as it stands. */
/** The two words a table question needs in the participant's language. The
 *  shell passes them from its catalog; English is only the fallback. */
export interface QuestionWords { readonly which: string; readonly other: string }
export const QUESTION_WORDS: QuestionWords = { which: 'Which step should the hive take?', other: 'Something else' }

/** The sentence a row offers as ONE option: all its lines, bare, joined by
 *  a quiet dot — so picking it runs the whole step, never a third of it. */
export const SENTENCE_JOIN = ' · '
export const rowSentence = (row: Row): string =>
  row.lines.map(line => line.replace(/^\//, '').replace(/[\r\n`~]/g, ' ').trim()).join(SENTENCE_JOIN)

/** The question format's own limits (core QUESTION_LIMITS): four options of at
 *  most eighty characters, a prompt of at most 280. A question that breaks
 *  them is silently refused and falls through as raw code, so this never
 *  builds one. */
const OPTIONS_MAX = 4
const OPTION_CHARS = 80
const PROMPT_CHARS = 280

export const tableQuestion = (rows: readonly Row[], reason: string, prompt?: string, words: QuestionWords = QUESTION_WORDS): string => {
  const details = rows.map(row => {
    const head = `**${row.label.replace(/[\r\n`*]/g, ' ')}**`
    if (row.kind === 'answer') return head
    // A question is prose for the participant; a sentence is the hive's language.
    if (row.kind === 'ask') return `${head}\n${row.lines[0].replace(/[\r\n`*_~]/g, ' ')}`
    return `${head}\n${row.lines.map(line => `\`${line.replace(/^\//, '').replace(/[`~]/g, '')}\``).join(' ')}`
  }).join('\n\n')
  const other = words.other.replace(/[\r\n`]/g, ' ').trim()
  const options = [...new Set(rows
    .filter(row => row.kind === 'read' || row.kind === 'do')
    .map(rowSentence)
    .filter(sentence => sentence && sentence.length <= OPTION_CHARS && sentence !== other))]
    .slice(0, OPTIONS_MAX - 1)
  const said = (prompt ?? words.which).replace(/[\r\n`]/g, ' ').trim()
  const asking = said.length > PROMPT_CHARS ? `${said.slice(0, PROMPT_CHARS - 1)}…` : said
  // Nothing clickable: the reason and the steps stand as prose, and the
  // participant answers in their own words.
  if (!options.length) return `${reason}\n\n${details}\n\n${asking}`
  return `${reason}\n\n${details}\n\n\`\`\`hypercomb-question\n${JSON.stringify({
    prompt: asking, options: [...options, other],
  })}\n\`\`\``
}

/** What the worker is told after Jev decided: the choice, then what ran. */
export const tableChoiceNote = (decision: Decision, rows: readonly Row[], dropped: readonly { id: string; reason: string }[]): string => {
  const label = (id: string): string => rows.find(row => row.id === id)?.label ?? id
  const plan = decision.plan
  const chose = plan.kind === 'read' ? `Jev chose to read: ${plan.rows.map(label).join(' · ')}.`
    : plan.kind === 'do' ? `Jev chose ${label(plan.row)}${plan.review ? ' and asked the participant to review it first' : ''}.`
    : plan.kind === 'answer' ? 'Jev decided the evidence answers the request.'
    : plan.kind === 'ask' ? `Jev chose to ask the participant: ${label(plan.row)}.`
    : decision.reason
  const skipped = dropped.length ? ` Rows the hive could not run: ${dropped.map(row => `${row.id} (${row.reason})`).join('; ')}.` : ''
  const conflicts = decision.rejected.length ? ` Rows conflicting with doctrine, never to be proposed again: ${decision.rejected.map(label).join(' · ')}.` : ''
  return `${chose}${skipped}${conflicts} This decision grants no permission of its own.`
}

export const JEV_ANSWER_NOW = 'Jev decided the evidence already answers the request. Answer the participant now in prose, with no block.'
