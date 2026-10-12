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
/** The most lines one change row may carry, and the most characters. */
export const JEV_ROW_LINES = 6
export const JEV_ROW_CHARS = 2_000
/** What parseTable says when a row is over either: named, so a caller can
 *  tell THAT refusal from a malformed table and say something a model can
 *  act on. */
export const ROW_OVER_BUDGET = 'A row exceeds its budget'
/** Mirrors JEV_RUBRIC in essentials jev-decision.ts, which replay admits;
 *  stamped on receipts. The shell may not import a module, so the two are
 *  kept equal by jev-rubric-parity.spec.ts. */
export const JEV_RUBRIC = 5
export type RowKind = 'read' | 'do' | 'write' | 'answer' | 'ask'
/** Set by the hive from the census for do rows; decides gates, never sent to Jev. */
export type Reach = 'additive' | 'editing' | 'destructive'
export interface Row {
  readonly id: string
  readonly kind: RowKind
  readonly label: string
  /** The read line, the do sentences, the write header, or the ask question. */
  readonly lines: readonly string[]
  readonly why?: string
  readonly reach?: Reach
  /** A write row's code, as the signature of the resource holding it. Set by
   *  the hive; the receipt keeps it, Jev never sees it (the essentials
   *  parser rebuilds every row from its known fields). */
  readonly body?: string
}
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
  /** The decision receipt's signature, once the store has kept it. */
  readonly receipt?: string
}
/** The direct path's answer (essentials jev-direct.ts): a sentence to run
 *  when Jev is sure the request is one census step, or why it is not. */
export interface DirectDecision {
  readonly sentence?: string
  readonly behaviour?: string
  readonly reach?: Reach
  readonly reason: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly usage?: { inputTokens?: number; outputTokens?: number; cost?: number }
}
/** THE FRONT DOOR's answer (essentials jev-front.ts): the direct path's
 *  answer when behaviours were offered, whether Jev steps aside for the turn,
 *  and the weight of the request when Jev is sure of it. */
export interface FrontDecision {
  readonly direct?: DirectDecision
  readonly aside: boolean
  readonly weight?: 'fast' | 'balanced' | 'deep'
  readonly carry: boolean
  readonly reason: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly usage?: { inputTokens?: number; outputTokens?: number; cost?: number }
}
/** Jev's check of a final answer (essentials jev-verify.ts). */
export interface VerifyDecision {
  readonly verified: boolean
  readonly reason: string
  readonly model: string
  readonly answers: Record<string, unknown>
  readonly usage?: { inputTokens?: number; outputTokens?: number; cost?: number }
  /** The evidence exactly as Jev was shown it: each piece the service took
   *  as the worker was sent it, rendered as text past its source boundary
   *  (essentials jev-evidence.ts). Absent from an older module. */
  readonly evidence?: readonly string[]
}
export interface JevLike {
  ready(providerId: string): boolean
  verify?(input: unknown, source: { providerId: string; system: string; messages: readonly { content: string }[] }, signal?: AbortSignal): Promise<VerifyDecision>
  front?(input: unknown, source: { providerId: string; system: string; messages: readonly { content: string }[] }, signal?: AbortSignal): Promise<FrontDecision>
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

/** THE DOCTRINE, SECTION BY SECTION, cut from the anatomy the worker was sent.
 *  Jev judges each section in its own question (jev-decision.ts); each piece
 *  is a verbatim span of the worker's own system text, so the source boundary
 *  still holds. The sections come from the anatomy — never a list kept here. */
export const doctrineSections = (anatomy: string): string[] => {
  const start = anatomy.indexOf('# Doctrine')
  if (start < 0) return anatomy.trim() ? [anatomy.trim()] : []
  const sections = anatomy.slice(start).split(/\n(?=### )/).slice(1).map(section => section.trim()).filter(Boolean)
  return sections.length ? sections : [anatomy.slice(start).trim()]
}

/** Durable provenance references immutable content; only the wire packet is inline. */
export const persistJevInput = async (store: ResourceWriter | undefined, input: {
  request: string; doctrine: readonly string[]; evidence: readonly string[]; rows: readonly Row[]
}): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  const request = await resource(store, input.request)
  const doctrine = await Promise.all(input.doctrine.map(section => resource(store, section)))
  const evidence = await Promise.all(input.evidence.map(value => resource(store, value)))
  const rows = await Promise.all(input.rows.map(async row => resource(store, {
    id: row.id, kind: row.kind, label: await resource(store, row.label), lines: await resource(store, row.lines),
    ...(row.why ? { why: await resource(store, row.why) } : {}),
    ...(row.reach ? { reach: row.reach } : {}),
    ...(row.body ? { body: row.body } : {}),
  })))
  return resource(store, { kind: 'jev-input', model: JEV_MODEL, rubric: JEV_RUBRIC, request, doctrine, evidence, rows })
}

/** The front door's provenance: what was asked, what Jev answered, what ran. */
export const persistJevFront = async (store: ResourceWriter | undefined, request: string, result: FrontDecision): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  const reason = result.direct ? `${result.reason}; ${result.direct.reason}` : result.reason
  return resource(store, {
    kind: 'jev-front', requestedModel: JEV_MODEL, model: result.model, rubric: 1, aside: result.aside,
    ...(result.weight ? { weight: result.weight } : {}),
    request: await resource(store, request), reason: await resource(store, reason), answers: await resource(store, result.answers),
    ...(result.direct?.sentence ? { sentence: await resource(store, result.direct.sentence) } : {}),
  })
}

/** A verification's provenance: what was checked and what Jev answered. The
 *  verdict is Jev's alone; the request and the evidence EXACTLY as Jev was
 *  shown it are kept too, each piece by signature, so a verdict can be
 *  replayed from the outcomes pool against what Jev actually saw. That is the
 *  evidence the verdict carries — the fitted pieces as the service rendered
 *  them for Jev — or, from a module that does not return it, the fitted
 *  pieces (fitEvidence) as they were sent. */
export const persistJevVerify = async (
  store: ResourceWriter | undefined, answer: string, result: VerifyDecision,
  checked?: { readonly request: string; readonly evidence: readonly string[] },
): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  return resource(store, {
    kind: 'jev-verify', requestedModel: JEV_MODEL, model: result.model, rubric: 1, verified: result.verified,
    answer: await resource(store, answer), reason: await resource(store, result.reason), answers: await resource(store, result.answers),
    ...(checked ? {
      request: await resource(store, checked.request),
      evidence: await Promise.all((result.evidence ?? checked.evidence).map(part => resource(store, part))),
    } : {}),
  })
}

export const persistJevReceipt = async (store: ResourceWriter | undefined, source: string, result: Decision): Promise<string | undefined> => {
  if (!store?.putResource) return undefined
  return resource(store, { ...result, kind: 'jev-decision', source, requestedModel: JEV_MODEL,
    reason: await resource(store, result.reason), answers: await resource(store, result.answers),
  })
}

/** JEV IS THE CHANGE GATE (jwize, 2026-09-26: the hive AI must work like an
 *  agent, not hand the participant a menu). The worker takes its own steps
 *  with the ordinary read, do and write blocks; reads run as written; Jev
 *  judges each change and the final answer. A table is still understood, but
 *  no longer asked for. */
export const JEV_WORK_INSTRUCTION =
  'JEV CHECKS THE CHANGES. You choose your own steps with the blocks above, and keep going until the request is done: reads run as written. '
  + 'Every change you send — a hypercomb-do block, or a hypercomb-write block — is first judged by Jev, a decision service, against the doctrine and against what you read this turn (read a module section before you write it, or the write is not grounded). '
  + 'A change Jev clears runs; one it cannot clear waits in Execution for the participant\'s review; one that conflicts with the doctrine comes back to you refused, with the reason — revise it or choose another way. '
  + 'Jev also checks your final answer against what the hive read, so say only what the reads showed. '
  + 'Ask the participant (one hypercomb-question) only for a preference that is truly theirs; never ask them to pick your next step.'

/** Jev's own limits on what it is shown (essentials jev-decision.ts
 *  JEV_MAX_STATE_CHARS and the evidence limits of jevInput / jevVerifyInput),
 *  restated because the shell may not import a module. */
export const JEV_STATE_CHARS = 24_000
const JEV_EVIDENCE_CHARS = 16_000
const JEV_EVIDENCE_ITEMS = 12

/** Where a cut may fall, and how much of the mark the tail skips: a line's
 *  end, a line's end inside a JSON string (`\n` as written), or the comma
 *  between two JSON fields or items. */
const BREAKS: readonly (readonly [string, number])[] = [['\n', 1], ['\\n', 2], [',"', 1]]

/** A piece cut to `kept` characters, as written: its head and its tail as
 *  two pieces (or its head alone when `both` is false). Each end stops at a
 *  break when one is near, so neither opens or closes on half a name. */
const ends = (part: string, kept: number, both: boolean): string[] => {
  if (!both) return [part.slice(0, kept).trim()].filter(Boolean)
  let front = part.slice(0, Math.ceil(kept / 2))
  let back = part.slice(part.length - Math.floor(kept / 2))
  const end = Math.max(...BREAKS.map(([mark]) => front.lastIndexOf(mark)))
  if (end > 0 && front.length - end < 240) front = front.slice(0, end)
  const start = Math.min(...BREAKS.map(([mark, skip]) => { const at = back.indexOf(mark); return at < 0 ? Infinity : at + skip }))
  if (start < 240) back = back.slice(start)
  return [front.trim(), back.trim()].filter(Boolean)
}

/** WHAT JEV IS SHOWN OF THE EVIDENCE. Reading a lot is the work, never a
 *  reason for Jev to fall away: the first `keep` pieces (the request) stay,
 *  then the newest pieces the worker can still see as written — after the
 *  ledger folded older rounds, those are the ones Jev may judge by — within
 *  `room` characters as they travel (JSON-escaped) and Jev's own limits.
 *
 *  EVERY PIECE STAYS AS WRITTEN. Jev's source boundary (essentials
 *  jev-decision.service.ts: verify, and jevUnseen for a decision) takes a
 *  piece only when the worker was sent it as written; a piece rendered,
 *  re-ordered or carrying a cut marker is refused, and the refusal goes
 *  unseen — the verify door then checks nothing at all. So a piece too long
 *  is shown as its head and its tail, two pieces each as written: a read
 *  receipt's head names the read, its tail holds the notes, which the
 *  receipt writes after the children and the projection (a cut from the
 *  start alone dropped them on a big tile, live 2026-10-11/12). With one
 *  place left it keeps its head. Jev still reads every piece as text: the
 *  verify door renders it past that boundary (essentials jev-evidence.ts). */
export const fitEvidence = (evidence: readonly string[], seen: (part: string) => boolean, room: number, keep = 0): string[] => {
  const cost = (parts: readonly string[]): number => parts.reduce((sum, part) => sum + JSON.stringify(part).length + 1, 0)
  const head = evidence.slice(0, keep)
  let left = Math.min(room, JEV_EVIDENCE_CHARS) - cost(head)
  const tail: string[] = []
  for (let i = evidence.length - 1; i >= keep && head.length + tail.length < JEV_EVIDENCE_ITEMS && left > 256; i--) {
    if (!seen(evidence[i])) continue
    const part = evidence[i].trim()
    const both = JEV_EVIDENCE_ITEMS - head.length - tail.length > 1
    let shown = part ? [part] : []
    for (let kept = part.length; shown.length && cost(shown) > left;) {
      kept = Math.floor(kept * Math.min(0.9, left / cost(shown)))
      shown = kept > 0 ? ends(part, kept, both) : []
    }
    if (!shown.length) continue
    tail.unshift(...shown)
    left -= cost(shown)
  }
  return [...head, ...tail]
}

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
      || (kind !== 'read' && kind !== 'do' && kind !== 'write' && kind !== 'answer' && kind !== 'ask')
      || typeof row['label'] !== 'string' || !row['label'].trim() || row['label'].length > 70 || /[\x00-\x1f\x7f`~*]/.test(row['label'])
      || row['label'].trim() === 'Something else') throw new Error('Invalid row')
    const raw_lines = row['lines'] ?? (row['line'] === undefined ? [] : [row['line']])
    if (!Array.isArray(raw_lines) || raw_lines.some(line => typeof line !== 'string' || !line.trim() || line.length > 1_000)) throw new Error('Invalid row line')
    const lines = (raw_lines as string[]).map(line => line.trim())
    if (kind === 'answer' ? lines.length : !lines.length) throw new Error('Invalid row line')
    if ((kind !== 'do' && lines.length > 1) || lines.length > JEV_ROW_LINES || lines.join('\n').length > JEV_ROW_CHARS) throw new Error(ROW_OVER_BUDGET)
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
  // A write is not a sentence the participant can say back: its code lives in
  // the block, so it is shown, never offered.
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
