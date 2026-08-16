// behaviour-call.ts — the `target@behaviour(args)` call expression.
//
// `@` attaches a behaviour to a tile. It used to be a bare pairing —
// `diagram@slides` — matched by regex. A regex cannot carry an ARGUMENT,
// which is why every behaviour whose payload is content (a post-it's message,
// a page's text) needed its own slash command instead. This is that pairing
// grown into a real call expression, parsed properly.
//
// THE DEFAULT SPELLING IS PAREN-LESS. A space ends the behaviour's name and
// the rest of the line is the message, verbatim:
//
//     meetup@postit Don't forget to check this location out!
//
// Nothing in that text is grammar: no quotes to balance, no characters to
// escape, no colon or comma that means something. Parentheses are the OPT-IN,
// for when a behaviour needs more than one thing said to it:
//
//     meetup@postit("Doors at 7", title: "Meetup")
//     deck@slide(3)
//     ~diagram@slides                 (the `~` prefix still detaches)
//
// ── Why a parser and not a bigger regex ───────────────────────────────
//
// The argument is HUMAN TEXT. Human text contains spaces, commas, quotes and
// — constantly — apostrophes. A regex cannot tell the apostrophe in "don't"
// from a string terminator, so the readable case is exactly the case a regex
// gets wrong. Parsing is what buys the readability.
//
// ── The quoting rule: strict first, human fallback ────────────────────
//
// The professional standard and the readable one disagree about this line:
//
//     tile@postit('Don't forget to check this out!')
//
// A conventional lexer ends the string at `Don` and chokes on the rest; the
// conventional fix is `'Don\'t forget'`, which is precisely not human. So we
// run BOTH readings, in a fixed order:
//
//   1. STRICT — the ordinary programming grammar. Both quote styles delimit,
//      backslash escapes decode (\' \" \\ \n \t \r), several arguments are
//      allowed, named arguments are allowed.
//   2. HUMAN — only if strict finds no valid reading of the whole argument
//      list: a body that opens and closes on the same quote character is ONE
//      string, running to the LAST such quote. Apostrophes just work.
//
// The two can never disagree, because the fallback only runs where the strict
// grammar has no valid parse at all. Writing `\'` opts you into strict; typing
// naturally opts you into forgiving. Neither mode is a special case of the
// tokenizer — they are two attempts, in order.
//
// This module is a PRIMITIVE: the command line (shell) and the drones
// (essentials) both parse the same syntax, and neither may import the other,
// so the grammar lives in core where both can reach it.

/** A parsed argument value. Deliberately small — the syntax is for naming
 *  content, not for computing. */
export type CallValue = string | number | boolean | null

export interface BehaviourCall {
  /** The tile the behaviour attaches to, as written (never normalized here —
   *  the caller owns name resolution). */
  readonly target: string
  /** The behaviour's view name, lowercased. */
  readonly view: string
  /** True for the `~` detach prefix. */
  readonly remove: boolean
  /** Positional arguments, in order. */
  readonly args: readonly CallValue[]
  /** Named arguments (`draft: true`). */
  readonly named: Readonly<Record<string, CallValue>>
  /** True when the argument list was written at all — `tile@postit()` is an
   *  empty call, `tile@postit` is no call. Lets a behaviour tell "attach with
   *  nothing" from "attach". */
  readonly called: boolean
  /** True when the HUMAN fallback produced this parse — the strict grammar had
   *  no reading. Surfaced so a caller can explain itself. */
  readonly forgiving: boolean
  /** True for the PAREN-LESS form — `meetup@postit Doors at 7`. The whole
   *  remainder is one argument, taken verbatim. */
  readonly parenless: boolean
}

export class BehaviourCallError extends Error {
  constructor(message: string, readonly index: number) {
    super(message)
    this.name = 'BehaviourCallError'
  }
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/
const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`',
}

/** A cursor over the argument-list source. Small hand-written scanner: the
 *  grammar is tiny and the error positions matter more than generality. */
class Scanner {
  #i = 0
  constructor(private readonly src: string) { }

  get index(): number { return this.#i }
  get done(): boolean { return this.#i >= this.src.length }
  peek(): string { return this.src[this.#i] ?? '' }
  next(): string { return this.src[this.#i++] ?? '' }

  skipSpace(): void {
    while (this.#i < this.src.length && /\s/.test(this.src[this.#i])) this.#i++
  }

  fail(message: string): never {
    throw new BehaviourCallError(message, this.#i)
  }

  /** A STRICT string literal: escapes decode, the first unescaped matching
   *  quote closes it. */
  readString(): string {
    const quote = this.next()
    let out = ''
    while (!this.done) {
      const c = this.next()
      if (c === '\\') {
        if (this.done) this.fail('the text ends on a backslash')
        const e = this.next()
        out += ESCAPES[e] ?? e
        continue
      }
      if (c === quote) return out
      out += c
    }
    this.fail(`this text is never closed — no matching ${quote}`)
  }

  readBareword(): CallValue {
    let out = ''
    while (!this.done && !/[,)\s]/.test(this.peek())) out += this.next()
    if (out === 'true') return true
    if (out === 'false') return false
    if (out === 'null') return null
    if (out !== '' && !Number.isNaN(Number(out))) return Number(out)
    if (out === '') this.fail('an argument is missing')
    return out
  }

  readValue(): CallValue {
    const c = this.peek()
    if (c === '"' || c === "'" || c === '`') return this.readString()
    return this.readBareword()
  }
}

/** Strip ONE symmetric outer quote pair from a paren-less message, so a person
 *  who quotes out of habit doesn't get the quotes stored in their note. Only
 *  the outermost pair, and only when it matches — inner quotes are text. */
function unwrapOuterQuotes(message: string): string {
  const q = message[0]
  if ((q === '"' || q === "'" || q === '`') && message.length >= 2 && message.endsWith(q)) {
    return message.slice(1, -1)
  }
  return message
}

/** A paren-less message that is ENTIRELY one scalar token becomes that scalar
 *  — `deck@slide 3` should mean the number 3, exactly as `deck@slide(3)` does.
 *  Anything with more to it stays text, so `postit 3 things to bring` is a
 *  sentence and not the number 3. */
function coerceWholeLine(message: string): CallValue {
  if (message === 'true') return true
  if (message === 'false') return false
  if (message === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(message)) return Number(message)
  return message
}

/** STRICT parse of the inside of the parentheses. Throws on any malformation
 *  — the caller decides whether to fall back. */
function parseArgsStrict(body: string): { args: CallValue[]; named: Record<string, CallValue> } {
  const s = new Scanner(body)
  const args: CallValue[] = []
  const named: Record<string, CallValue> = {}
  s.skipSpace()
  if (s.done) return { args, named }

  for (;;) {
    s.skipSpace()
    if (s.done) s.fail('an argument is missing after the comma')

    // Lookahead for `name:` — a bareword followed by a colon is a NAMED
    // argument. A quoted value can never be a name, so quotes settle it.
    const start = s.index
    let name = ''
    if (/[A-Za-z_]/.test(s.peek())) {
      const probe = new Scanner(body.slice(start))
      let ident = ''
      while (!probe.done && /[A-Za-z0-9_-]/.test(probe.peek())) ident += probe.next()
      probe.skipSpace()
      if (ident && probe.peek() === ':' && IDENT_RE.test(ident)) {
        name = ident
        // consume the ident, the space and the colon on the real scanner
        for (let k = 0; k < ident.length; k++) s.next()
        s.skipSpace()
        s.next()   // ':'
        s.skipSpace()
      }
    }

    const value = s.readValue()
    if (name) {
      if (name in named) s.fail(`"${name}" is given twice`)
      named[name] = value
    } else {
      if (Object.keys(named).length > 0) s.fail('a plain argument cannot follow a named one')
      args.push(value)
    }

    s.skipSpace()
    if (s.done) break
    if (s.peek() !== ',') s.fail(`unexpected "${s.peek()}" — arguments are separated by commas`)
    s.next()
  }
  return { args, named }
}

/** HUMAN fallback: the whole body is ONE string, opening and closing on the
 *  same quote, taken to the LAST such quote so apostrophes inside are just
 *  apostrophes. Returns null when the body is not shaped that way. */
function parseArgsForgiving(body: string): { args: CallValue[] } | null {
  const t = body.trim()
  if (t.length < 2) return null
  const quote = t[0]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  const end = t.lastIndexOf(quote)
  if (end <= 0) return null
  return { args: [t.slice(1, end)] }
}

/**
 * Parse `target@view`, `target@view(args)` or `~target@view`.
 *
 * Returns null when the input is not a behaviour call at all (so a stray `@`
 * never hijacks a create or a paste). Throws BehaviourCallError when it IS a
 * call but a malformed one — the difference matters: silence for "not mine",
 * a pointed message for "mine, and wrong".
 */
export function parseBehaviourCall(input: string): BehaviourCall | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  const remove = raw.startsWith('~')
  const rest = remove ? raw.slice(1) : raw

  // The target ends at the FIRST `@`; a later `@` inside a quoted message is
  // the message's business, not the grammar's.
  const at = rest.indexOf('@')
  if (at <= 0) return null
  const target = rest.slice(0, at).trim()
  if (!target || /[@:[\]/!#~]/.test(target)) return null

  const after = rest.slice(at + 1).trim()
  if (!after) return null

  const open = after.indexOf('(')
  const firstSpace = after.search(/\s/)

  // ── PAREN-LESS, the default spelling ────────────────────────────────
  //
  //     meetup@postit Doors at 7 — bring the humidor
  //
  // A space ends the behaviour's name and everything after it is the message,
  // verbatim: no quotes to balance, no characters to escape, nothing in the
  // text reinterpreted as grammar. This is the form a person reaches for, so
  // it is the one that costs nothing to write; parentheses are the opt-in for
  // when a behaviour needs more than one thing said to it.
  //
  // Checked BEFORE the parenthesised form so a `(` inside a message is just a
  // bracket — `meetup@postit call Ana (she has the keys)` is one sentence, not
  // a malformed call.
  if (firstSpace !== -1 && (open === -1 || firstSpace < open)) {
    const view = after.slice(0, firstSpace).toLowerCase()
    if (!IDENT_RE.test(view)) return null
    const message = after.slice(firstSpace + 1).trim()
    if (!message) return { target, view, remove, args: [], named: {}, called: false, forgiving: false, parenless: false }
    return {
      target, view, remove,
      args: [coerceWholeLine(unwrapOuterQuotes(message))],
      named: {}, called: true, forgiving: false, parenless: true,
    }
  }

  if (open === -1) {
    const view = after.toLowerCase()
    if (!IDENT_RE.test(view)) return null
    return { target, view, remove, args: [], named: {}, called: false, forgiving: false, parenless: false }
  }

  const view = after.slice(0, open).trim().toLowerCase()
  if (!IDENT_RE.test(view)) return null
  const tail = after.slice(open)
  if (!tail.endsWith(')')) {
    throw new BehaviourCallError('this call is never closed — no matching )', after.length)
  }
  const body = tail.slice(1, -1)

  let args: readonly CallValue[] = []
  let named: Readonly<Record<string, CallValue>> = {}
  let forgiving = false
  try {
    const strict = parseArgsStrict(body)
    args = strict.args
    named = strict.named
  } catch (strictError) {
    const human = parseArgsForgiving(body)
    if (!human) throw strictError
    args = human.args
    forgiving = true
  }

  return { target, view, remove, args, named, called: true, forgiving, parenless: false }
}

/** The first positional argument as text, or ''. What a single-message
 *  behaviour (a post-it) wants, without every caller re-deriving it. */
export function primaryText(call: BehaviourCall): string {
  const v = call.args[0]
  return v === null || v === undefined ? '' : String(v)
}
