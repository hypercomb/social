// core/work-fence.ts
//
// THE FENCES, AS PRIMITIVES (documentation/agent-harness.md, step 3). A model
// asks in words: it ends a reply with ONE fenced block — read, do, table,
// write, handoff, continue — and the hive finds the block, turns its lines
// into the canonical grammar and holds a work block back from the visible
// stream. That finding is pure text work, and the `stretch` step (a streamed
// round, core/agent-stretch.ts) needs it, so it lives here where both the
// chat window (shared) and a step bee (essentials) can reach it. The words a
// model is TAUGHT — the instructions and the messages sent back — stay in
// the shared work-fence module, which re-exports everything here.

import { FENCE_RE } from '../question-fence.js'
import { CONTINUE_FENCE_LANG } from './agent-leg.js'

export const READ_FENCE_LANG = 'hypercomb-read'
export const DO_FENCE_LANG = 'hypercomb-do'
export const TABLE_FENCE_LANG = 'hypercomb-table'
/** A module section written back (documentation/hive-read-fence.md, "Writing
 *  a module"): first line `<bee signature> <src/path.ts>`, the rest the
 *  section's new body. The hive drafts the module and runs it here. */
export const WRITE_FENCE_LANG = 'hypercomb-write'

/** Rounds one participant message may take before the model must answer. */
/** HANDING OFF. A model that cannot do the work says so in this fence, one
 *  line, and the turn goes to another model instead of an apology
 *  (jwize, 2026-09-24: "have one of the subscriptions take care of that").
 *  The provider that wrote it is not asked again this turn. */
export const HANDOFF_FENCE_LANG = 'hypercomb-handoff'
/** How many times one turn may change hands before it stops. */
export const MAX_HANDOFFS = 2

export type WorkKind = 'read' | 'do' | 'table' | 'write'

export type WorkRequest = {
  readonly kind: WorkKind
  /** Canonical slash grammar, in the order the model wrote it. */
  readonly lines: readonly string[]
}

export type SplitWork = {
  /** The reply with every work block removed. */
  readonly prose: string
  /** What to run this round. Reads win when one reply carries both. */
  readonly request?: WorkRequest
  /** A do block rode alongside a read block and was not run. */
  readonly heldDo?: true
  /** The model gave the work up, with its reason. Wins over any request. */
  readonly handoff?: string
  /** The model handed the work to its next leg: what is left, one line. */
  readonly left?: string
  /** The reply NAMES a work block inside markup and carries none that can be
   *  run: the block's word, so the loop can send it back to be written. */
  readonly unwritten?: string
}

type BlockKind = WorkKind | 'handoff' | 'continue'

type Block = {
  readonly kind: BlockKind
  readonly open: number
  /** Index of the closing fence line, or `lines.length` when never closed. */
  readonly end: number
  readonly body: readonly string[]
}

/**
 * Some smaller models put the requested info string on the first line of a
 * generic text fence instead of on the opening fence itself:
 *
 * ```text
 * hypercomb-read
 * read /somewhere
 * ```
 *
 * The literal marker is still an unambiguous opt-in to the work protocol.
 * Accept only that exact first non-empty line; never infer work from an
 * unlabeled block containing ordinary slash-looking examples.
 */
const markedBody = (info: string, body: readonly string[]):
  { readonly kind: BlockKind; readonly body: readonly string[] } | null => {
  if (kindOf(info)) return null
  const first = body.findIndex(line => line.trim().length > 0)
  if (first < 0) return null
  const kind = kindOf(body[first])
  if (!kind) return null
  return { kind, body: body.slice(first + 1) }
}

/** A table is unmistakable by shape: a JSON object whose first key is rows.
 *  Models that were told to write a hypercomb-table fence still reach for a
 *  json fence, or no fence; the shape is the opt-in either way. */
const looksLikeTable = (body: readonly string[]): boolean =>
  /^\{\s*"rows"\s*:/.test(body.map(line => line.trim()).filter(Boolean).join(''))

const kindOf = (info: string): BlockKind | null => {
  const word = info.trim().split(/\s+/)[0] ?? ''
  if (word === HANDOFF_FENCE_LANG) return 'handoff'
  if (word === CONTINUE_FENCE_LANG) return 'continue'
  if (word === READ_FENCE_LANG) return 'read'
  if (word === DO_FENCE_LANG) return 'do'
  if (word === TABLE_FENCE_LANG) return 'table'
  if (word === WRITE_FENCE_LANG) return 'write'
  return null
}

const closes = (line: string, run: string): boolean => {
  const match = FENCE_RE.exec(line)
  return !!match && match[1][0] === run[0] && match[1].length >= run.length && !match[2].trim()
}

/**
 * THE TAG SPELLING. Some models write the block as a tag instead of a fence:
 *
 *   <hypercomb-read> read / </hypercomb-read>
 *
 * The tag name is the same literal marker the fence carries, so it is the
 * same unambiguous opt-in — and a reply that carries it and is not run ends
 * the turn with the machinery showing and nothing read (jwize's drive test,
 * 2026-09-30). Only the exact work words open one; any other tag is prose.
 *
 * It may open anywhere on a line outside a code fence — what stands before it
 * stays prose — but a model also MENTIONS the tag in a sentence, so only two
 * shapes are a block: the BLOCK form (nothing after the opener on its line,
 * the body on the lines below, the closer later; never closed still counts,
 * as an unclosed fence does) and the INLINE form (the closer on the opener's
 * own line). An opener followed by words and no closer on that line is a
 * sentence about the tag, and so is one written inside inline code.
 */
const TAG_STEM = '<hypercomb-'
const TAG_OPEN_RE = /^<(hypercomb-[a-z]+)>/
/** The closer as a model spells it: any case, spaces inside the brackets. */
const tagCloser = (name: string): RegExp => new RegExp(`<\\s*/\\s*${name}\\s*>`, 'i')
/** Inside inline code: an odd number of ticks before it on the line. */
const inCode = (lead: string): boolean => lead.split('`').length % 2 === 0

type Tag = {
  readonly kind: BlockKind
  /** What stands before the opener on its line. It stays prose. */
  readonly lead: string
  /** What follows the opener on its line. */
  readonly after: string
  readonly closer: RegExp
}

/** The first work tag a line opens, in one of the two shapes. */
const tagAt = (line: string): Tag | null => {
  for (let at = line.indexOf(TAG_STEM); at >= 0; at = line.indexOf(TAG_STEM, at + 1)) {
    const open = TAG_OPEN_RE.exec(line.slice(at))
    const kind = open ? kindOf(open[1]) : null
    if (!open || !kind) continue
    const lead = line.slice(0, at)
    if (inCode(lead)) continue
    const after = line.slice(at + open[0].length)
    const closer = tagCloser(open[1])
    if (after.trim() && !closer.test(after)) continue
    return { kind, lead, after, closer }
  }
  return null
}

/**
 * A model mixing the two spellings wraps a fence in the tag. The outer fence
 * pair is wrapping, not body: left in, its lines are read as commands and the
 * whole block is refused. Only that pair goes; the rest stays as written.
 */
const unfenced = (body: readonly string[]): readonly string[] => {
  const first = body.findIndex(line => line.trim().length > 0)
  const fence = first < 0 ? null : FENCE_RE.exec(body[first])
  if (!fence) return body
  let last = body.length - 1
  while (last > first && !body[last].trim()) last--
  return body.slice(first + 1, last > first && closes(body[last], fence[1]) ? last : undefined)
}

/**
 * The tag block a line opens. The lines are the scanner's own and are re-cut
 * here, so the words around a block survive it: what stands before the opener
 * becomes its own line above, and what follows the closer its own line below
 * — where the scanner reads it next, as prose or as a further block.
 */
const tagBlock = (lines: string[], index: number): Block | null => {
  const tag = tagAt(lines[index])
  if (!tag) return null
  if (tag.lead.trim()) lines.splice(index++, 0, tag.lead.trimEnd())
  const body: string[] = []
  let rest = tag.after
  let end = index
  for (;;) {
    const close = tag.closer.exec(rest)
    if (close) {
      if (rest.slice(0, close.index).trim()) body.push(rest.slice(0, close.index))
      const tail = rest.slice(close.index + close[0].length).trimStart()
      if (tail) lines.splice(end + 1, 0, tail)
      break
    }
    // Interior lines are kept as written, blank ones too, exactly as the
    // fence path keeps them: a write block is code and a doctrine write is
    // markdown. Only the empty remainder of the opener's line falls away.
    if (end > index) body.push(rest)
    end++
    if (end >= lines.length) break
    rest = lines[end]
  }
  return { kind: tag.kind, open: index, end, body: unfenced(body) }
}

/** Every work block, skipping the inside of any other fence. A tag block
 *  re-cuts `lines` (see tagBlock); the indices are into the array as left. */
const scan = (lines: string[]): Block[] => {
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const open = FENCE_RE.exec(lines[index])
    if (!open) {
      const tagged = tagBlock(lines, index)
      if (tagged) { blocks.push(tagged); index = tagged.end + 1 } else index++
      continue
    }
    let end = index + 1
    while (end < lines.length && !closes(lines[end], open[1])) end++
    const body = lines.slice(index + 1, end)
    const marked = markedBody(open[2], body)
    const kind = kindOf(open[2]) ?? marked?.kind ?? (looksLikeTable(body) ? 'table' : null)
    // An unclosed work block still counts: a model that stopped generating
    // before the closer meant the request all the same.
    if (kind) blocks.push({ kind, open: index, end, body: marked?.body ?? body })
    index = end + 1
  }
  return blocks
}

/**
 * One line of a block → the canonical grammar the parsers read. List markers
 * and inline-code ticks fall away, the leading slash is optional, the verb is
 * lower-cased, and for READS the word `here` names the current page, which the
 * observation parser spells as a bare verb.
 */
export const workLineGrammar = (raw: string, kind: WorkKind): string => {
  // A table is JSON and a write is code: both are taken as written.
  if (kind === 'table' || kind === 'write') return raw
  let line = String(raw ?? '').trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^`(.*)`$/, '$1')
    .trim()
    .replace(/^\//, '')
    .replace(/^[A-Za-z][\w-]*/, verb => verb.toLowerCase())
  if (!line) return ''
  if (kind === 'read') {
    if (/^[0-9a-f]{64}$/i.test(line)) return `/read ${line.toLowerCase()}`
    line = line.replace(/^([a-z][a-z0-9-]*)\s+here$/, '$1')
    // Small models sometimes treat the code-discovery grammar as prose and
    // say `read code core`. That spelling cannot name a tile (routes require
    // a leading slash), so correcting it to `code core` is unambiguous. Keep
    // `read /code` literal: that really does mean the tile at /code.
    line = line.replace(/^read\s+code(?:\s+(.+))?$/i, (_whole, query: string | undefined) =>
      query?.trim() ? `code ${query.trim()}` : 'code')
  }
  return `/${line}`
}

/**
 * A BLOCK NAMED AND NOT WRITTEN. The fence, the tag, the info string on a
 * text fence's first line — each spelling was learned from a turn that ended
 * with the machinery on the screen and nothing done, and a model will find a
 * fourth: `<block info="hypercomb-read">` came next (jwize's drive session,
 * 2026-09-30). Rather than learn spellings one dead turn at a time, a reply
 * that names a work block's word INSIDE MARKUP — angle brackets — and carries
 * no block the hive can run says which word it was, so the loop sends it back
 * to be written properly. A sentence that merely mentions the word, a word in
 * inline code, and anything inside an ordinary code fence are not markup and
 * say nothing. Nor does the hive's own tag (`<hypercomb-read>`): the scanner
 * above already weighed that one, and an opener it left as prose is a
 * sentence about the tag — only a word carried by SOME OTHER markup is the
 * unread spelling this is for.
 */
const NAMED_IN_MARKUP = /<(?!\s*\/?\s*hypercomb-)[^<>\n]*\b(hypercomb-(?:read|do|table|write|handoff|continue))\b[^<>\n]*>/g

/**
 * ...AND WORK WRITTEN WITH NO BLOCK AT ALL. A reply that was nothing but
 * `/file on /bubble-bobble-dos-v1: …` lines, bare, ended as "answered" with
 * six notes owed and none filed (jwize's drive session, 2026-10-01). A line
 * that opens with a slash, a word, and a space is a command line the hive
 * would run — a route never has the space (`/games/bubble is …` reads as a
 * route) — so two or more of them outside any fence are a hypercomb-do block
 * that was never opened. One alone may be a sentence about a command.
 */
const BARE_COMMAND = /^\s*\/[a-z][a-z-]*\s+\S/
const BARE_COMMANDS_MIN = 2

const unwrittenIn = (lines: readonly string[]): string | undefined => {
  let fence: string | null = null
  let bare = 0
  for (const line of lines) {
    const mark = FENCE_RE.exec(line)
    if (mark) {
      if (!fence) fence = mark[1]
      else if (closes(line, fence)) fence = null
      continue
    }
    if (fence) continue
    for (const named of line.matchAll(NAMED_IN_MARKUP)) {
      if (!inCode(line.slice(0, named.index))) return named[1]
    }
    if (BARE_COMMAND.test(line)) bare += 1
  }
  return bare >= BARE_COMMANDS_MIN ? 'hypercomb-do' : undefined
}

/** Split a finished round into what the model said and what it asked for. */
export const splitWork = (text: string): SplitWork => {
  const lines = String(text ?? '').split('\n')
  const blocks = scan(lines)
  if (!blocks.length) {
    // The whole reply is the table, with no fence at all.
    if (looksLikeTable(lines)) return { prose: '', request: { kind: 'table', lines } }
    const unwritten = unwrittenIn(lines)
    return { prose: String(text ?? ''), ...(unwritten ? { unwritten } : {}) }
  }
  const removed = new Set<number>()
  for (const block of blocks) {
    for (let at = block.open; at <= Math.min(block.end, lines.length - 1); at++) removed.add(at)
  }
  const prose = lines.filter((_, at) => !removed.has(at)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const oneLine = (block: Block, fallback: string): string =>
    block.body.map(line => line.trim()).filter(Boolean).join(' ').slice(0, 300) || fallback
  const handoff = blocks.find(block => block.kind === 'handoff')
  if (handoff) return { prose, handoff: oneLine(handoff, 'no reason given') }
  const next = blocks.find(block => block.kind === 'continue')
  const left = next ? { left: oneLine(next, 'the rest of the request') } : {}
  const linesOf = (kind: WorkKind): string[] => blocks
    .filter(block => block.kind === kind)
    .flatMap(block => block.body)
    .map(line => workLineGrammar(line, kind))
    .filter(Boolean)
  const reads = linesOf('read')
  const changes = linesOf('do')
  const tables = blocks.filter(block => block.kind === 'table')
  // A WRITE IS ONE BLOCK, KEPT WHOLE: its lines are code, and a block the
  // model never closed is not code the hive should run.
  const writes = blocks.filter(block => block.kind === 'write')
  const held = changes.length || tables.length || writes.length ? { heldDo: true as const } : {}
  if (reads.length) return { prose, request: { kind: 'read', lines: reads }, ...held, ...left }
  if (writes.length) {
    const valid = writes.length === 1 && writes[0].end < lines.length
    return { prose, request: { kind: 'write', lines: valid ? writes[0].body : [] }, ...(changes.length || tables.length ? { heldDo: true as const } : {}), ...left }
  }
  if (tables.length) {
    const valid = tables.length === 1 && tables[0].end < lines.length
    return { prose, request: { kind: 'table', lines: valid ? tables[0].body : [] }, ...(changes.length ? { heldDo: true as const } : {}), ...left }
  }
  if (changes.length) return { prose, request: { kind: 'do', lines: changes }, ...left }
  return { prose, ...left }
}

/** Could a line that has only begun still turn out to be a fence line? */
const MAY_BE_FENCE = /^\s{0,3}(?:[`~].*)?$/
/** …or an opener that is still being written? */
const MAY_BE_TAG = /^<hypercomb-[a-z]*$/

/**
 * Where a line that is still arriving must wait from: the first `<` at or
 * after `from` that may yet open a work tag — a prefix of the stem, an opener
 * still being written, or a whole work opener, whose shape only the end of
 * its line settles. The line's length when nothing has to wait.
 */
const tagHold = (line: string, from: number): number => {
  for (let at = line.indexOf('<', from); at >= 0; at = line.indexOf('<', at + 1)) {
    const text = line.slice(at)
    const open = TAG_OPEN_RE.exec(text)
    const may = open ? !!kindOf(open[1]) : TAG_STEM.startsWith(text) || MAY_BE_TAG.test(text)
    if (may && !inCode(line.slice(0, at))) return at
  }
  return line.length
}

/**
 * WHAT MAY BE SHOWN WHILE A ROUND STREAMS. Prose goes out as it arrives; from
 * the first work block on, everything is held, because the block is machinery
 * the participant sees in the Execution window instead. A line that has only
 * begun is held while it could still become a fence line, and released the
 * moment it cannot. A tag may open anywhere on a line, so the words before it
 * are shown and the line waits from its `<` on, until it is settled whether
 * that opens work or is a sentence. Ordinary code blocks pass straight
 * through, and nothing inside one is mistaken for a work block.
 */
export class WorkStreamGuard {
  /** The line being written, whole, and how much of it has been shown. */
  #line = ''
  #shown = 0
  #fence: string | null = null
  #holding = false

  get holding(): boolean { return this.#holding }

  push(chunk: string): string {
    if (this.#holding) return ''
    let out = ''
    for (const char of chunk) {
      if (char !== '\n') {
        this.#line += char
        const hold = this.#holdFrom()
        out += this.#line.slice(this.#shown, hold)
        this.#shown = hold
        continue
      }
      const work = this.#opensWork(this.#line)
      if (work >= 0) {
        out += this.#line.slice(this.#shown, work)
        this.#holding = true
        this.#line = ''
        this.#shown = 0
        return out
      }
      out += `${this.#line.slice(this.#shown)}\n`
      this.#line = ''
      this.#shown = 0
    }
    return out
  }

  /** The held tail at the end of a round, unless a work block took it. */
  end(): string {
    if (this.#holding) return ''
    const line = this.#line
    const shown = this.#shown
    this.#line = ''
    this.#shown = 0
    const work = line ? this.#opensWork(line) : -1
    if (work < 0) return line.slice(shown)
    this.#holding = true
    return line.slice(shown, work)
  }

  /** How much of the line so far may be shown. */
  #holdFrom(): number {
    const line = this.#line
    if (MAY_BE_FENCE.test(line)) return 0
    if (this.#fence) return line.length
    const at = tagHold(line, this.#shown)
    // An indent is not prose: it waits with the tag it stands before.
    return at < line.length && !line.slice(0, at).trim() ? this.#shown : at
  }

  /** Where on a finished line the held work begins, or -1 when it opens none. */
  #opensWork(line: string): number {
    const match = FENCE_RE.exec(line)
    if (!match) {
      // The tag spelling opens work too, outside any ordinary code block; the
      // words before it on the line are prose, and are shown.
      const tag = this.#fence ? null : tagAt(line)
      if (!tag) return -1
      return tag.lead.trim() ? tag.lead.length : 0
    }
    if (this.#fence) {
      if (closes(line, this.#fence)) this.#fence = null
      return -1
    }
    if (kindOf(match[2])) return 0
    this.#fence = match[1]
    return -1
  }
}

/** A block the hive would not run, said so the model can correct it. It goes
 *  back to the model as the next message; any other error ends the work. */
