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
 */
const TAG_OPEN_RE = /^\s{0,3}<(hypercomb-[a-z]+)>(.*)$/

const tagBlock = (lines: readonly string[], index: number): Block | null => {
  const open = TAG_OPEN_RE.exec(lines[index])
  if (!open) return null
  const kind = kindOf(open[1])
  if (!kind) return null
  const closer = `</${open[1]}>`
  const body: string[] = []
  let rest = open[2]
  let end = index
  for (;;) {
    const at = rest.indexOf(closer)
    if (at >= 0) { if (rest.slice(0, at).trim()) body.push(rest.slice(0, at)); break }
    if (rest.trim()) body.push(rest)
    end++
    if (end >= lines.length) break
    rest = lines[end]
  }
  return { kind, open: index, end, body }
}

/** Every work block, skipping the inside of any other fence. */
const scan = (lines: readonly string[]): Block[] => {
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

/** Split a finished round into what the model said and what it asked for. */
export const splitWork = (text: string): SplitWork => {
  const lines = String(text ?? '').split('\n')
  const blocks = scan(lines)
  if (!blocks.length) {
    // The whole reply is the table, with no fence at all.
    if (looksLikeTable(lines)) return { prose: '', request: { kind: 'table', lines } }
    return { prose: String(text ?? '') }
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
const TAG_STEM = '<hypercomb-'
/** …or a tag line: held while it is still a prefix of the stem, and to the
 *  end of the line once it carries it. */
const mayOpenWork = (line: string): boolean => {
  if (MAY_BE_FENCE.test(line)) return true
  const text = line.replace(/^\s{0,3}/, '')
  return TAG_STEM.startsWith(text) || text.startsWith(TAG_STEM)
}

/**
 * WHAT MAY BE SHOWN WHILE A ROUND STREAMS. Prose goes out as it arrives; from
 * the first line that opens a work block everything is held, because the
 * block is machinery the participant sees in the Execution window instead. A
 * line that has only begun is held while it could still become a fence line,
 * and released the moment it cannot. Ordinary code blocks pass straight
 * through, and nothing inside one is mistaken for a work block.
 */
export class WorkStreamGuard {
  #line = ''
  #released = false
  #fence: string | null = null
  #holding = false

  get holding(): boolean { return this.#holding }

  push(chunk: string): string {
    if (this.#holding) return ''
    let out = ''
    for (const char of chunk) {
      if (this.#released) {
        out += char
        if (char === '\n') this.#released = false
        continue
      }
      this.#line += char
      if (char === '\n') {
        if (this.#opensWork(this.#line.slice(0, -1))) {
          this.#holding = true
          this.#line = ''
          return out
        }
        out += this.#line
        this.#line = ''
      } else if (!mayOpenWork(this.#line)) {
        out += this.#line
        this.#line = ''
        this.#released = true
      }
    }
    return out
  }

  /** The held tail at the end of a round, unless a work block took it. */
  end(): string {
    if (this.#holding) return ''
    const rest = this.#line
    this.#line = ''
    if (rest && this.#opensWork(rest)) {
      this.#holding = true
      return ''
    }
    return rest
  }

  #opensWork(line: string): boolean {
    const match = FENCE_RE.exec(line)
    if (!match) {
      // The tag spelling opens work too, outside any ordinary code block.
      const tag = this.#fence ? null : TAG_OPEN_RE.exec(line)
      return !!tag && !!kindOf(tag[1])
    }
    if (this.#fence) {
      if (closes(line, this.#fence)) this.#fence = null
      return false
    }
    if (kindOf(match[2])) return true
    this.#fence = match[1]
    return false
  }
}

/** A block the hive would not run, said so the model can correct it. It goes
 *  back to the model as the next message; any other error ends the work. */
