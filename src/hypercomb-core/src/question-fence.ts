// question-fence.ts — the ONE parser for a question asked inside a reply.
//
// A responder that needs a direction decided does not get a new bridge op, a
// new record kind or a payload field. It sends an ordinary reply whose text
// ends with one fenced block whose info string is `hypercomb-question`:
//
//     Two ways to lay this out.
//
//     ```hypercomb-question
//     {"prompt":"How many pages?","options":["One long page","Several pages"]}
//     ```
//
// That is reply TEXT, so it works on every tier — the bridge stores it through
// `chat-reply`, the host and the local providers stream it — and the answer is
// simply the next user turn. Which turn answered which question is DERIVED
// from the turns, never stored (documentation/chat-route.md §2).
//
// ── Why this lives in core ────────────────────────────────────────────
//
// The shell draws the question (the radiogroup, the settled line, the route
// junction) and essentials reads the same turns for the one-line readers (the
// agent panel, the blurb transcript). Shared never imports essentials and
// essentials never imports shared, so a parser in either would be written
// twice and drift on the details — trimming, the 280/80 caps, which fence is
// "last". Core is the only place both can reach, and the same is true of the
// serializer: the reply script and the specs round-trip against THIS module,
// so a fence that serializes always parses.
//
// ── Strict, total, one rule ───────────────────────────────────────────
//
// Model output is untrusted. A turn holds a question only when it contains
// EXACTLY ONE `hypercomb-question` fence, that fence is the LAST fence in the
// turn, it is CLOSED, and its body validates. Anything else — two such fences,
// a fence after it, an unterminated fence, a body that is not the shape — and
// nothing is parsed: `splitQuestion` hands the text back untouched and the
// fence renders as the code block it already is. There is no partial reading
// and no repair.
//
// The fence grammar is chat-markdown's, to the character. `FENCE_RE` is
// exported from here and chat-markdown imports it, so the block this module
// removes is exactly the block the renderer would have drawn.
//
// Framework-free by construction: nothing here touches the DOM.

/**
 * The fence opener/closer, as chat-markdown recognises it: up to three
 * spaces of indent, then a run of backticks or tildes, then the info string.
 * A closer is a match whose run uses the SAME character as the opener and is
 * at least as long — so a ```` fence is not closed by a ``` line inside it.
 * No global flag on purpose: a shared regex with state would be a bug.
 */
export const FENCE_RE = /^\s{0,3}(```+|~~~+)(.*)$/

/** The info string that marks a question fence. Exact, case-sensitive. */
export const QUESTION_FENCE_LANG = 'hypercomb-question'

/** The limits the convention sets, in one place so the serializer and the
 *  parser can never disagree about them. Lengths count code points. */
export const QUESTION_LIMITS = Object.freeze({
  promptMax: 280,
  optionMax: 80,
  optionsMin: 2,
  optionsMax: 4,
})

export interface ChatQuestion {
  /** The prompt, trimmed. 1–280 characters. */
  readonly prompt: string
  /** 2–4 options, each trimmed, 1–80 characters, distinct. */
  readonly options: readonly string[]
}

export interface SplitQuestion {
  /** The turn's text with the question block removed — or the whole text
   *  when the turn holds no question. This is what the participant said. */
  readonly prose: string
  /** Present only when the turn holds a valid question. */
  readonly question?: ChatQuestion
}

/** The least a turn must carry for the settle rule. The shell's `ChatTurn`
 *  and the thread's stored turn both satisfy it structurally. */
export interface QuestionTurn {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export type QuestionState = 'open' | 'settled' | 'superseded'

export interface SettledQuestion {
  /** Index of the assistant turn that holds the question. */
  readonly index: number
  readonly prompt: string
  readonly options: readonly string[]
  /** `open`: nothing has answered it yet (only ever the last assistant
   *  turn). `settled`: a user turn answered it. `superseded`: the responder
   *  went on with another reply before any answer arrived. */
  readonly state: QuestionState
  /** Index of the user turn that settled it. Present only when `settled`. */
  readonly answeredBy?: number
  /** Which outlet the answer took: the index of the option whose label the
   *  turn's text equals (trimmed, exact), or `'own'` for a typed answer.
   *  Present only when `settled`. */
  readonly outlet?: number | 'own'
}

// ── Fence scanning ─────────────────────────────────────────────────────

interface Fence {
  /** First word of the info string, as chat-markdown labels the block. */
  readonly lang: string
  /** Line index of the opener. */
  readonly open: number
  /** Line index of the closer, or -1 when the fence runs to the end of the
   *  text (chat-markdown closes it at EOF; here it is simply not closed). */
  readonly close: number
  readonly body: readonly string[]
}

/**
 * Walk the lines the way chat-markdown's loop does, recording every fence.
 * The nesting rule is reproduced exactly: while a fence is open, a line is
 * either its closer (same character, at least as long) or part of its body —
 * an opener of the other character, or a shorter run, is body.
 */
const scanFences = (lines: readonly string[]): Fence[] => {
  const fences: Fence[] = []
  let opener = ''
  let lang = ''
  let open = -1
  let body: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FENCE_RE)
    if (opener) {
      if (match && match[1][0] === opener[0] && match[1].length >= opener.length) {
        fences.push({ lang, open, close: i, body })
        opener = ''
        lang = ''
        body = []
      } else {
        body.push(lines[i])
      }
      continue
    }
    if (match) {
      opener = match[1]
      lang = match[2].trim().split(/\s+/)[0] ?? ''
      open = i
      body = []
    }
  }
  if (opener) fences.push({ lang, open, close: -1, body })
  return fences
}

// ── Validation ─────────────────────────────────────────────────────────

/** U+0000–U+001F and U+007F: the C0 controls and DEL. Written as escapes so
 *  the source itself never carries one. */
const CONTROL_RE = /[\u0000-\u001F\u007F]/

const length = (s: string): number => Array.from(s).length

/**
 * Why a question is not a question — or `null` when it is one. The single
 * validator behind both `questionFence` (which throws the reason) and
 * `splitQuestion` (which silently declines). Reads the RAW strings for control
 * characters, so a stray newline inside an option is refused even though
 * trimming would have hidden it at the ends.
 */
export const questionProblem = (prompt: unknown, options: unknown): string | null => {
  if (typeof prompt !== 'string') return 'prompt must be a string'
  if (CONTROL_RE.test(prompt)) return 'prompt holds a control character'
  const p = length(prompt.trim())
  if (p < 1) return 'prompt is empty'
  if (p > QUESTION_LIMITS.promptMax) return `prompt is longer than ${QUESTION_LIMITS.promptMax} characters`

  if (!Array.isArray(options)) return 'options must be an array'
  if (options.length < QUESTION_LIMITS.optionsMin) return `fewer than ${QUESTION_LIMITS.optionsMin} options`
  if (options.length > QUESTION_LIMITS.optionsMax) return `more than ${QUESTION_LIMITS.optionsMax} options`
  const seen = new Set<string>()
  for (const option of options) {
    if (typeof option !== 'string') return 'an option is not a string'
    if (CONTROL_RE.test(option)) return 'an option holds a control character'
    const trimmed = option.trim()
    const n = length(trimmed)
    if (n < 1) return 'an option is empty'
    if (n > QUESTION_LIMITS.optionMax) return `an option is longer than ${QUESTION_LIMITS.optionMax} characters`
    if (seen.has(trimmed)) return 'two options are the same'
    seen.add(trimmed)
  }
  return null
}

/** The body must be a plain object holding `prompt` and `options` and nothing
 *  else — an unknown key is a shape this convention did not define, and a
 *  strict parser refuses what it does not know rather than guess. */
const parseBody = (body: string): ChatQuestion | null => {
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const keys = Object.keys(parsed as object)
  if (keys.length !== 2 || !keys.includes('prompt') || !keys.includes('options')) return null
  const { prompt, options } = parsed as { prompt: unknown; options: unknown }
  if (questionProblem(prompt, options) !== null) return null
  return {
    prompt: (prompt as string).trim(),
    options: (options as string[]).map(option => option.trim()),
  }
}

// ── Splitting ──────────────────────────────────────────────────────────

const isBlank = (line: string): boolean => !line.trim()

/** Drop trailing blank lines. */
const trimTail = (lines: readonly string[]): string[] => {
  let end = lines.length
  while (end > 0 && isBlank(lines[end - 1])) end--
  return lines.slice(0, end)
}

/** Drop leading blank lines. */
const trimHead = (lines: readonly string[]): string[] => {
  let start = 0
  while (start < lines.length && isBlank(lines[start])) start++
  return lines.slice(start)
}

/**
 * Put the text back together around a removed block. Each non-empty part is
 * separated from the next by ONE blank line: the block was a block, so what
 * sat on either side of it were separate paragraphs and must stay separate,
 * while the blank lines that framed the block itself are not owed to anyone.
 */
const stitch = (...parts: readonly (readonly string[])[]): string =>
  parts
    .map(part => trimHead(trimTail(part)))
    .filter(part => part.length)
    .map(part => part.join('\n'))
    .join('\n\n')

interface Located {
  readonly question: ChatQuestion
  readonly lines: readonly string[]
  readonly fence: Fence
}

/** The strict rule, applied. `null` unless every condition holds. */
const locate = (text: string): Located | null => {
  const lines = String(text ?? '').split('\n')
  const fences = scanFences(lines)
  if (!fences.length) return null
  const questions = fences.filter(fence => fence.lang === QUESTION_FENCE_LANG)
  if (questions.length !== 1) return null
  const fence = questions[0]
  if (fence !== fences[fences.length - 1]) return null
  if (fence.close < 0) return null
  const question = parseBody(fence.body.join('\n'))
  if (!question) return null
  return { question, lines, fence }
}

/**
 * Split a turn into what the participant said and the question it asked.
 * Total: never throws, and a turn that holds no valid question comes back as
 * `{ prose: text }` with the text untouched.
 */
export const splitQuestion = (text: string): SplitQuestion => {
  const found = locate(text)
  if (!found) return { prose: text }
  const { lines, fence, question } = found
  return {
    prose: stitch(lines.slice(0, fence.open), lines.slice(fence.close + 1)),
    question,
  }
}

/**
 * Serialize a question as the fence the parser reads. Throws on anything the
 * parser would refuse, so a script can never emit a question that arrives as
 * a code block. Round-trips: `splitQuestion(questionFence(p, o))` yields
 * `{ prose: '', question: { prompt: p.trim(), options: o.map(trim) } }`.
 */
export const questionFence = (prompt: string, options: readonly string[]): string => {
  const problem = questionProblem(prompt, options)
  if (problem) throw new Error(`hypercomb-question: ${problem}`)
  const body = JSON.stringify({ prompt: prompt.trim(), options: options.map(option => option.trim()) })
  return '```' + QUESTION_FENCE_LANG + '\n' + body + '\n```'
}

/** The one-line rendering of a question, for readers that show a turn as a
 *  single line: `Q: How many pages? — One long page · Several pages`. */
export const questionLine = (question: ChatQuestion): string =>
  `Q: ${question.prompt} — ${question.options.join(' · ')}`

/**
 * The turn's text with the question fence replaced by its one-line form, in
 * the place the fence stood. For the agent panel's resting view, the blurb
 * transcript and the thread preview — readers that would otherwise show the
 * participant a lump of JSON. Text without a question is returned untouched.
 */
export const plainQuestionText = (text: string): string => {
  const found = locate(text)
  if (!found) return text
  const { lines, fence, question } = found
  return stitch(lines.slice(0, fence.open), [questionLine(question)], lines.slice(fence.close + 1))
}

// ── Settling ───────────────────────────────────────────────────────────

/** The nearest user turn before `index`, or -1. This is the turn a retry on
 *  the question's reply resends (`#questionFor` walks back to it). */
const priorUserTurn = (turns: readonly QuestionTurn[], index: number): number => {
  for (let i = index - 1; i >= 0; i--) if (turns[i].role === 'user') return i
  return -1
}

/**
 * Which turn answers which question — derived, never stored. Returns an
 * array the length of `turns`: `null` where a turn holds no question, and for
 * each assistant turn that does, its state.
 *
 * Walking forward from the question:
 * - nothing follows → `open` (so only the last assistant turn can be open);
 * - an assistant turn comes first → `superseded`, the responder went on;
 * - a user turn comes first → it `settled` the question; its outlet is the
 *   option whose label equals the turn's text, else `'own'`.
 *
 * The retry exception: a user turn whose text equals the user turn that
 * preceded the question is a RETRY of that message, not an answer. It is
 * skipped — the question stays open past it, and whatever follows the retry
 * decides as above.
 */
export const settleQuestions = (turns: readonly QuestionTurn[]): readonly (SettledQuestion | null)[] =>
  turns.map((turn, index) => {
    if (turn.role !== 'assistant') return null
    const { question } = splitQuestion(turn.text)
    if (!question) return null
    const { prompt, options } = question

    const prior = priorUserTurn(turns, index)
    const retryText = prior >= 0 ? turns[prior].text.trim() : null

    for (let j = index + 1; j < turns.length; j++) {
      const next = turns[j]
      if (next.role === 'assistant') return { index, prompt, options, state: 'superseded' }
      const answer = next.text.trim()
      if (retryText !== null && answer === retryText) continue
      const picked = options.indexOf(answer)
      return { index, prompt, options, state: 'settled', answeredBy: j, outlet: picked >= 0 ? picked : 'own' }
    }
    return { index, prompt, options, state: 'open' }
  })

/**
 * The host tier is stateless, so when a user turn answers an open question
 * the WIRE text restates the question with the answer:
 *
 *     Question: How many pages?
 *     Options: One long page · Several pages
 *     Answer: Several pages
 *
 * The stored turn stays the bare answer. `send()` has already appended that
 * turn when this is called, so a trailing user turn equal to `message` is
 * taken as the answer; when the caller passes turns without it, the message
 * is considered as if appended. `null` when `message` answers no open
 * question — including when it is a retry.
 */
export const hostWireText = (turns: readonly QuestionTurn[], message: string): string | null => {
  const answer = String(message ?? '').trim()
  const last = turns[turns.length - 1]
  const list: QuestionTurn[] = last && last.role === 'user' && last.text.trim() === answer
    ? [...turns]
    : [...turns, { role: 'user', text: answer }]
  const at = list.length - 1
  const settled = settleQuestions(list).find(q => q !== null && q.state === 'settled' && q.answeredBy === at)
  if (!settled) return null
  return `Question: ${settled.prompt}\nOptions: ${settled.options.join(' · ')}\nAnswer: ${answer}`
}
