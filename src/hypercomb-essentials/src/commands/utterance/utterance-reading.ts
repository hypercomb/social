// utterance-reading.ts — the pure READING: plain language resolved into spans.
//
// Common Tongue, phase 1. An utterance is read, never guessed. Every span
// resolves to exactly one of four roles:
//
//   action    — a word carrying a behaviour (it will run code; it must be lit)
//   argument  — the text an action takes, verbatim (the paren-less rule)
//   ambiguity — a word more than one behaviour claims; the line waits for a
//               pathway choice before anything runs
//   residue   — filler that will be thrown away; it stays visibly plain
//
// Deterministic and data-driven: the lexicon IS the live SlashBehaviourDrone
// census (names + aliases), hidden behaviours never light from prose, and an
// action's color is the color its behaviour already has in the hive — the
// category keyword painted on its behaviour tile, resolved through TagRegistry.
// No model in the loop: the assistant is a pathway, never the parser.
//
// The pure core (readUtterance) is exported for the spec; the IoC wrapper
// (UtteranceReader) wires it to the live registries. Dependency direction
// holds: this module imports core/essentials only, and the shell reaches it
// through '@diamondcoreprocessor.com/UtteranceReader'.

export interface UtteranceLexiconEntry {
  readonly name: string
  readonly aliases?: readonly string[]
  readonly description?: string
  readonly hidden?: boolean
  /** Runs only as the first word of a line — never lit from prose. */
  readonly lineStart?: boolean
  /** Everything after this word is its argument, verbatim (`QueenBee.rawArgs`)
   *  — wherever on the line the word stands, no later word is another action. */
  readonly rawArgs?: boolean
  /** The forms the behaviour documents (`QueenBee.options`). A literal form's
   *  first word, or any word when a form is a `<slot>`, is read as this
   *  word's argument when it comes directly after it. */
  readonly options?: readonly string[]
}

export interface UtteranceSpan {
  /** Offsets into the ORIGINAL text — marks render over the exact glyphs. */
  readonly start: number
  readonly end: number
  readonly text: string
  readonly role: 'action' | 'argument' | 'residue' | 'ambiguity'
  /** The resolved behaviour (role 'action'). */
  readonly command?: string
  /** The claimants (role 'ambiguity'), in census order. */
  readonly candidates?: readonly { name: string; description: string }[]
  /** The behaviour's own color — its category keyword's TagRegistry color.
   *  Undefined when the hive doesn't know one; the shell falls back. */
  color?: string
}

export interface UtteranceAction {
  readonly command: string
  /** Verbatim slice of the utterance between this action and the next —
   *  the paren-less rule: rest-of-sentence is one argument, unescaped. */
  readonly args: string
}

export interface UtteranceReading {
  readonly text: string
  readonly spans: readonly UtteranceSpan[]
  readonly actions: readonly UtteranceAction[]
  /** True while any ambiguity span is unresolved — Enter must wait. */
  readonly ambiguous: boolean
  /** True when the reading found anything executable (or choosable). */
  readonly hasAction: boolean
}

/** Connectives are residue when they sit directly before the next action —
 *  "spotlight the snacks AND record" discards the 'and'. Anywhere else they
 *  are ordinary argument words ("meeting with sam and ana" keeps its 'and').
 *  English seed; the words phase (words.* catalogs) will localize this. */
export const CONNECTIVES = new Set(['and', 'then', 'also', 'plus'])

interface Token { start: number; end: number; text: string; lower: string }

// Plain language carries punctuation glued to its words — 'help?', 'record,',
// 'snacks.' — and an exact-token lookup would read every one as residue. Each
// token is trimmed to its CORE: edge characters that are not letters, numbers,
// or hyphens (command names carry hyphens: push-to-talk) fall out of the span
// into the plain gap, so the mark covers exactly the word that fires and the
// '?' stays unlit. A token with no core at all (a lone em-dash) stays whole.
const CORE_LEAD_RE = /^[^\p{L}\p{N}-]+/u
const CORE_TAIL_RE = /[^\p{L}\p{N}-]+$/u

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const whole = m[0]
    const lead = whole.match(CORE_LEAD_RE)?.[0].length ?? 0
    const tail = whole.match(CORE_TAIL_RE)?.[0].length ?? 0
    const core = lead + tail < whole.length ? whole.slice(lead, whole.length - tail) : whole
    const start = m.index + (lead + tail < whole.length ? lead : 0)
    tokens.push({ start, end: start + core.length, text: core, lower: core.toLowerCase() })
  }
  return tokens
}

/** Does `entry` take the word directly after it as its own argument? Yes when
 *  the word opens one of its literal forms (`vocabulary publish`, `meeting
 *  join`), or when a form is a `<slot>` the participant fills (`tree docs`,
 *  `create docs`) — a slot holds any name, behaviour words included. A
 *  connective is never a slot's filler: `tree and record` still runs both. */
function takesNextWord(entry: UtteranceLexiconEntry, lower: string): boolean {
  const options = entry.options ?? []
  for (const form of options) {
    const first = form.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? ''
    if (first && !first.startsWith('<') && first === lower) return true
  }
  return !CONNECTIVES.has(lower) && options.some(form => form.trim().startsWith('<'))
}

/**
 * The pure reading. `resolutions` maps an ambiguity span's START offset to
 * the chosen command — a pinned choice turns that span into a plain action.
 */
export function readUtterance(
  text: string,
  entries: readonly UtteranceLexiconEntry[],
  resolutions?: ReadonlyMap<number, string>,
): UtteranceReading {
  // word → the distinct canonical commands claiming it (name and aliases;
  // hidden behaviours are destructive/dev surfaces typed in full on purpose —
  // prose must never light them).
  const claims = new Map<string, Map<string, string>>()   // word → (command → description)
  const entryOf = new Map<string, UtteranceLexiconEntry>()  // command → its row (rawArgs, options)
  for (const e of entries) {
    if (e.hidden || e.lineStart) continue
    if (!entryOf.has(e.name)) entryOf.set(e.name, e)
    const words = [e.name, ...(e.aliases ?? [])]
    for (const w of words) {
      const key = w.toLowerCase()
      let m = claims.get(key)
      if (!m) claims.set(key, (m = new Map()))
      if (!m.has(e.name)) m.set(e.name, e.description ?? '')
    }
  }

  const tokens = tokenize(text)
  type Role = UtteranceSpan['role']
  const roles: Role[] = new Array(tokens.length)
  const commands: (string | undefined)[] = new Array(tokens.length)
  const candidates: ({ name: string; description: string }[] | undefined)[] = new Array(tokens.length)

  // Pass 1 — what does each word claim to be? An action's own words are
  // claimed first: a word that keeps the rest of the line (rawArgs) and a
  // word its forms name are its ARGUMENT, never a second action. Read as
  // actions, `vocabulary publish` ran publish and `please ask how do I
  // publish my files` ran ask AND publish — a window nobody asked for.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const claim = claims.get(t.lower)
    if (!claim) { roles[i] = 'residue'; continue }
    const names = [...claim.keys()]
    const pinned = resolutions?.get(t.start)
    if (names.length === 1 || (pinned && names.includes(pinned))) {
      roles[i] = 'action'
      commands[i] = pinned && names.includes(pinned) ? pinned : names[0]
    } else {
      roles[i] = 'ambiguity'
      candidates[i] = names.map(n => ({ name: n, description: claim.get(n) ?? '' }))
      continue
    }
    const entry = entryOf.get(commands[i]!)
    if (!entry) continue
    if (entry.rawArgs) {
      for (let j = i + 1; j < tokens.length; j++) roles[j] = 'argument'
      break
    }
    const next = tokens[i + 1]
    if (next && !resolutions?.has(next.start) && takesNextWord(entry, next.lower)) {
      roles[i + 1] = 'argument'
      i++
    }
  }

  // Pass 2 — attachment. Words between an action (or ambiguity) and the next
  // one are its argument text; words before the first are residue; a
  // connective directly before an action-word is residue.
  let seenAction = false
  for (let i = 0; i < tokens.length; i++) {
    if (roles[i] === 'action' || roles[i] === 'ambiguity') { seenAction = true; continue }
    if (!seenAction) continue                       // leading filler stays residue
    const nextIsAction = i + 1 < tokens.length && (roles[i + 1] === 'action' || roles[i + 1] === 'ambiguity')
    if (CONNECTIVES.has(tokens[i].lower) && (nextIsAction || i === tokens.length - 1)) continue
    roles[i] = 'argument'
  }

  // Pass 3 — spans and actions. Argument text is the verbatim slice from the
  // first to the last argument token of each action (paren-less rule).
  const spans: UtteranceSpan[] = tokens.map((t, i) => ({
    start: t.start, end: t.end, text: t.text,
    role: roles[i],
    command: commands[i],
    candidates: candidates[i],
  }))

  const actions: UtteranceAction[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (roles[i] !== 'action') continue
    let argStart = -1, argEnd = -1
    for (let j = i + 1; j < tokens.length && roles[j] !== 'action' && roles[j] !== 'ambiguity'; j++) {
      if (roles[j] !== 'argument') continue
      if (argStart < 0) argStart = tokens[j].start
      argEnd = tokens[j].end
    }
    actions.push({ command: commands[i]!, args: argStart >= 0 ? text.slice(argStart, argEnd) : '' })
  }

  const ambiguous = roles.includes('ambiguity')
  return { text, spans, actions, ambiguous, hasAction: ambiguous || actions.length > 0 }
}

