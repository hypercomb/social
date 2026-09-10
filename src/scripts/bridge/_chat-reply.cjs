// Deliver a reply INTO a conversation in the chat window.
//
//   node scripts/bridge/_chat-reply.cjs <convoId> [prose] --ask <askSig>
//       [--question "<prompt>" --option "<a>" --option "<b>" [--option …]]
//
// Two positionals — the convoId, and optionally the prose — and three flags
// (`--ask`, `--question`, `--option`) that may sit anywhere among them. Only
// those three names are flags: prose that opens with `---` or `-- ` is prose.
// A reply needs prose or a question (or both); a question needs two to four
// options. The question is serialized AFTER the prose as one fenced
// `hypercomb-question` block — the convention documentation/chat-route.md §2
// defines, parsed by the ONE parser in hypercomb-core/src/question-fence.ts.
// The serializer here spells the same rules in CommonJS (a script cannot
// import the TypeScript); _chat-reply.spec.ts round-trips it against the core
// parser so the two can never drift silently.
//
// The prose is scanned with the parser's own fence rule before the question
// is appended: a fence the prose leaves open would swallow the question (the
// question's opener would CLOSE it), and a `hypercomb-question` fence already
// in the prose would make two of them — either way the parser declines and
// the participant sees a code block with no radiogroup. Both are refused as
// usage errors, so a question this script delivers always parses.
//
// `--ask <sig>` attaches `run: { ask }` to the request. The renderer resolves
// the bucket itself — a chat ask's reply is filed in the conversation's own
// ledger, anything else under `agent:<sig>` — so the step this reply records
// lands where the route can find it (chat-route.md §3.1). Without the flag,
// nothing is recorded. There is deliberately NO environment fallback here
// (chat-route.md §7): a stale HYPERCOMB_RUN_ASK in a persistent shell would
// file this conversation's reply under an older ask's conversation, and a
// reply misfiled is worse than a reply unrecorded.
//
// Sends the `chat-reply` bridge op (cell = convoId, text = reply); the
// renderer stores the turn and surfaces it via the `ask:chat-reply` effect,
// and the open conversation appends it. This is the CHAT half of the ask
// loop — replies here are conversation turns, never notes. Retire the
// chat-turn ask separately (`_ask-drain.cjs retire <sig>`), and when you
// asked a question, END THE TURN: the pick arrives as the next mode:'chat'
// ask, whose transcript holds the question.
//
// A reply the renderer refuses (the ask already retired, the turn not
// storable) exits 1 with the renderer's reason — the reply was NOT delivered,
// so do not retire on the strength of it.
//
// BRIDGE_URL env overrides the broker (default ws://localhost:2401);
// HYPERCOMB_BRIDGE_TOKEN is the bearer for a remote broker.

const USAGE = [
  'Usage: _chat-reply.cjs <convoId> [prose] --ask <askSig>',
  '           [--question "<prompt>" --option "<a>" --option "<b>" [--option "<c>" [--option "<d>"]]]',
  '  prose or a question (2-4 options) is required; the question is appended after the prose.',
].join('\n')

// ── The question fence, as core spells it ──────────────────────────────

const QUESTION_FENCE_LANG = 'hypercomb-question'

/** The limits the convention sets. Must equal QUESTION_LIMITS in core —
 *  the spec compares every rejection reason, so a drift here fails a test
 *  rather than emitting a fence the parser turns back into a code block. */
const QUESTION_LIMITS = Object.freeze({
  promptMax: 280,
  optionMax: 80,
  optionsMin: 2,
  optionsMax: 4,
})

/** U+0000–U+001F and U+007F: the C0 controls and DEL. Written as escapes so
 *  the source itself never carries one. */
const CONTROL_RE = /[\u0000-\u001F\u007F]/

const length = s => Array.from(s).length

/**
 * Why a question is not a question — or `null` when it is one. Word for
 * word core's `questionProblem`: the RAW strings are read for control
 * characters, so a stray newline inside an option is refused even though
 * trimming would have hidden it at the ends.
 */
function questionProblem(prompt, options) {
  if (typeof prompt !== 'string') return 'prompt must be a string'
  if (CONTROL_RE.test(prompt)) return 'prompt holds a control character'
  const p = length(prompt.trim())
  if (p < 1) return 'prompt is empty'
  if (p > QUESTION_LIMITS.promptMax) return `prompt is longer than ${QUESTION_LIMITS.promptMax} characters`

  if (!Array.isArray(options)) return 'options must be an array'
  if (options.length < QUESTION_LIMITS.optionsMin) return `fewer than ${QUESTION_LIMITS.optionsMin} options`
  if (options.length > QUESTION_LIMITS.optionsMax) return `more than ${QUESTION_LIMITS.optionsMax} options`
  const seen = new Set()
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

/**
 * Serialize a question as the fence the parser reads. Throws on anything the
 * parser would refuse, so this script can never emit a question that arrives
 * as a code block. Byte-identical to core's `questionFence`.
 */
function questionFence(prompt, options) {
  const problem = questionProblem(prompt, options)
  if (problem) throw new Error(`hypercomb-question: ${problem}`)
  const body = JSON.stringify({ prompt: prompt.trim(), options: options.map(option => option.trim()) })
  return '```' + QUESTION_FENCE_LANG + '\n' + body + '\n```'
}

// ── The prose, as the parser will read it ──────────────────────────────

/** The fence opener/closer, as core's FENCE_RE spells it: up to three spaces
 *  of indent, a run of backticks or tildes, then the info string. */
const FENCE_RE = /^\s{0,3}(```+|~~~+)(.*)$/

/**
 * Why the prose cannot carry a question after it — or `null` when it can.
 * Walks the lines the way core's `scanFences` does (a closer is a run of the
 * SAME character at least as long as the opener; anything else inside an
 * open fence is body). Two things disqualify the prose: a fence left open,
 * because the question's own opener would close it and the question's closer
 * would open a new unterminated fence; and a `hypercomb-question` fence
 * already present, because the parser accepts exactly one. The script has no
 * parser to check its output against, so it checks the input instead.
 */
function proseProblem(prose) {
  let opener = ''
  for (const line of String(prose ?? '').split('\n')) {
    const match = line.match(FENCE_RE)
    if (opener) {
      if (match && match[1][0] === opener[0] && match[1].length >= opener.length) opener = ''
      continue
    }
    if (!match) continue
    opener = match[1]
    const lang = match[2].trim().split(/\s+/)[0] ?? ''
    if (lang === QUESTION_FENCE_LANG) return 'prose already holds a hypercomb-question fence — ask with --question instead'
  }
  if (opener) return 'prose leaves a code fence open — close it or drop it'
  return null
}

// ── Arguments ──────────────────────────────────────────────────────────

const SIG_RE = /^[0-9a-f]{64}$/

/** The only words that are flags. Everything else is a positional, so prose
 *  may begin with a horizontal rule or a dash and still be prose. */
const FLAGS = new Set(['--ask', '--question', '--option'])

/**
 * Build the reply from argv (everything after the script path). Pure: no
 * socket, no exit — a usage problem THROWS, and only main() turns that into
 * a message and an exit code, so the serializer and the parsing are what the
 * spec exercises and a bad invocation never opens a connection.
 *
 * Returns `{ convoId, text, run }`: where to deliver, the text to deliver,
 * and the run to attach (`{ ask }` from --ask, else null — never the
 * environment, see the header).
 */
function buildReply(argv) {
  const positionals = []
  let ask = ''
  let question
  const options = []

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i])
    if (!FLAGS.has(arg)) { positionals.push(arg); continue }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    i++
    if (arg === '--ask') {
      if (ask) throw new Error('--ask given twice')
      ask = String(value).trim()
      if (!SIG_RE.test(ask)) throw new Error('--ask must be the 64-hex signature of the ask')
    } else if (arg === '--question') {
      if (question !== undefined) throw new Error('one question per reply — ask the next one in the next turn')
      question = String(value)
    } else {
      options.push(String(value))
    }
  }

  const [convoId, prose, extra] = positionals
  if (extra !== undefined) {
    // A third positional is usually one of two mistakes; name the likelier.
    if (extra.startsWith('--')) throw new Error(`unknown flag ${extra} — the flags are --ask, --question, --option`)
    throw new Error('too many positional arguments — quote the prose as one argument')
  }
  if (!convoId || !convoId.trim()) throw new Error('convoId is required')
  const said = String(prose ?? '').trim()

  if (question === undefined && options.length) throw new Error('--option needs a --question')
  if (question === undefined && !said) throw new Error('nothing to say — give prose, a question, or both')

  // Refused whether or not a question follows: an open fence swallows the
  // rest of the reply into a code block either way, and a hand-written
  // question fence bypasses the validation this script promises.
  const problem = proseProblem(said)
  if (problem) throw new Error(problem)

  // The fence is serialized last, after the prose: the convention reads the
  // LAST fence in the turn, so the question must be the last thing said.
  const fence = question === undefined ? '' : questionFence(question, options)
  const text = said && fence ? `${said}\n\n${fence}` : (fence || said)

  return { convoId: convoId.trim(), text, run: ask ? { ask } : null }
}

module.exports = { questionFence, questionProblem, proseProblem, buildReply, QUESTION_LIMITS, USAGE }

// ── Delivery ───────────────────────────────────────────────────────────

function main() {
  let built
  try {
    built = buildReply(process.argv.slice(2))
  } catch (err) {
    console.error(String(err && err.message ? err.message : err))
    console.error(USAGE)
    process.exit(1)
  }
  const { convoId } = built

  // Only once the arguments are sound does this touch the broker.
  const WebSocket = require('ws')
  const BRIDGE = process.env.BRIDGE_URL || 'ws://localhost:2401'
  // Only needed when driving a REMOTE broker (loopback senders are trusted).
  const TOKEN = String(process.env.HYPERCOMB_BRIDGE_TOKEN || '').trim()

  const req = { op: 'chat-reply', cell: convoId, text: built.text, id: `chatreply-${Date.now()}` }
  if (built.run) req.run = built.run

  const ws = new WebSocket(BRIDGE, TOKEN ? { headers: { Authorization: `Bearer ${TOKEN}` } } : undefined)
  const t = setTimeout(() => { console.error('bridge timeout'); process.exit(1) }, 15_000)
  ws.on('open', () => ws.send(JSON.stringify(req)))
  ws.on('message', raw => {
    clearTimeout(t)
    const r = JSON.parse(String(raw))
    if (!r.ok) { console.error('chat-reply failed:', r.error); process.exit(1) }
    console.log(`[chat-reply] delivered to ${convoId}${built.run ? ' (run recorded)' : ''}`)
    ws.close()
  })
  ws.on('error', e => { clearTimeout(t); console.error(String(e)); process.exit(1) })
}

if (require.main === module) main()
