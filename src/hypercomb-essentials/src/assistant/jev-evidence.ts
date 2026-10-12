// JEV READS WHAT THE HIVE READ, AS TEXT (jev-verify.ts; documentation/jev-creative-plan.md §2.1).
//
// A read reaches the worker as its receipt: one line of JSON built for a
// machine (the shell's formatHypercombObservationReceipt) — the grammar, the
// route, a 64-hex signature, every child with its signature, the projection,
// and the notes LAST, each an escaped string. Shown that line, Jev hedged on
// answers that quoted a note word for word: "Jev could not confirm this
// answer against what the hive read (supported .30–.55)", live 2026-10-11/12.
//
// THE SOURCE BOUNDARY STILL RUNS FIRST, on every piece exactly as the worker
// was sent it (jev-decision.service.ts verify). Only past it is a piece
// rendered here — from the very message that holds it, so the text says
// nothing the worker was not sent — and that text is what Jev reads:
//   · each read: its header (grammar, route, tile), its notes with noteCount,
//     what was asked for, then the structure it also returned;
//   · every line of the hive's own text — a note, a projection, content, a
//     summary, a page of code — sits behind JEV_QUOTE, and every name is
//     quoted, so nothing the hive holds can pass itself off as a header, a
//     field, or another read;
//   · signatures are left out, or cut to 8 characters where items need
//     telling apart; nothing else the read returned is dropped — a field
//     this file does not know is shown as `key: value`;
//   · a piece fitted to Jev's room (the shell's fitEvidence keeps a long
//     piece as its head and its tail) shows only what it holds, names each
//     read it touches, and says what was cut;
//   · a piece more than one result holds (a tail two tiles share, the head of
//     a tile read twice) could belong to either: its read, its noteCount and
//     what was cut are not the piece's own to tell, so it is shown as written.
// A line that is not a read receipt — the request, a context line, a
// withheld or not-run notice — is shown exactly as it was, but for a line
// separator JSON leaves raw (U+2028, U+2029, NEL), written as its escape so
// a name in it cannot open a line of its own. The verdict stays Jev's alone.

/** Every line of the hive's own text is shown behind this, so it reads as
 *  quoted text and can never stand for a header or a field. */
export const JEV_QUOTE = '  | '

const RECEIPT_KIND = 'hypercomb-tree-observation'
const RECEIPT_LINE = `{"kind":"${RECEIPT_KIND}"`
const SIGNATURE = /^[0-9a-f]{64}$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/
/** Every character a reader may take for a line's end (the set Python's
 *  str.splitlines uses): the hive's own text is cut into lines at each. */
const BREAK = /\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/
/** What JSON.stringify leaves raw though a reader may take it for a line's
 *  end (U+2028, U+2029, NEL) or cannot see it (the C1 controls). */
const SEPARATORS = /[\u007f-\u009f\u2028\u2029]/g
const escaped = (text: string): string => text.replace(SEPARATORS, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
/** A value as JSON on one line, the separators JSON leaves raw escaped too. */
const quote = (value: unknown): string => escaped(JSON.stringify(value))

// ── JSON, with where each value was written ────────────────────────────────

type Json =
  | { readonly t: 'object'; readonly s: number; readonly e: number; readonly fields: readonly (readonly [string, Json])[] }
  | { readonly t: 'array'; readonly s: number; readonly e: number; readonly items: readonly Json[] }
  /** `at[k]` is where character k was written; `at[length]` is the closing quote. */
  | { readonly t: 'string'; readonly s: number; readonly e: number; readonly value: string; readonly at: readonly number[] }
  | { readonly t: 'scalar'; readonly s: number; readonly e: number; readonly value: number | boolean | null }
type JsonObject = Extract<Json, { t: 'object' }>
type JsonArray = Extract<Json, { t: 'array' }>
type JsonString = Extract<Json, { t: 'string' }>

const ESCAPES: Readonly<Record<string, string>> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
const LITERAL = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y

function notJson(): never { throw new SyntaxError('not JSON') }

/** JSON, every value with where it sits in the text and every character of a
 *  string with where it was written, so a cut of the text maps to the values
 *  it holds. Throws on anything that is not JSON. */
const parseJson = (text: string): Json => {
  let i = 0
  const space = (): void => { while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r') i++ }
  const string = (): JsonString => {
    const s = i++
    let value = ''
    const at: number[] = []
    for (;;) {
      if (i >= text.length) notJson()
      const c = text[i]
      at.push(i)
      if (c === '"') { i++; return { t: 'string', s, e: i, value, at } }
      if (c < ' ') notJson()
      if (c !== '\\') { value += c; i++; continue }
      const next = text[i + 1]
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) notJson()
        value += String.fromCharCode(parseInt(hex, 16))
        i += 6
      } else {
        if (next === undefined || !Object.hasOwn(ESCAPES, next)) notJson()
        value += ESCAPES[next]
        i += 2
      }
    }
  }
  const value = (): Json => {
    space()
    const s = i
    if (text[i] === '"') return string()
    if (text[i] === '{' || text[i] === '[') {
      const object = text[i++] === '{'
      const close = object ? '}' : ']'
      const fields: (readonly [string, Json])[] = []
      const items: Json[] = []
      space()
      if (text[i] === close) i++
      else for (;;) {
        if (object) {
          space()
          if (text[i] !== '"') notJson()
          const key = string().value
          space()
          if (text[i++] !== ':') notJson()
          fields.push([key, value()])
        } else items.push(value())
        space()
        const c = text[i++]
        if (c === ',') continue
        if (c === close) break
        notJson()
      }
      return object ? { t: 'object', s, e: i, fields } : { t: 'array', s, e: i, items }
    }
    LITERAL.lastIndex = i
    const literal = LITERAL.exec(text)
    if (!literal) notJson()
    i = LITERAL.lastIndex
    return { t: 'scalar', s, e: i, value: JSON.parse(literal[0]) as number | boolean | null }
  }
  const root = value()
  space()
  if (i !== text.length) notJson()
  return root
}

const plain = (node: Json): unknown => node.t === 'object' ? Object.fromEntries(node.fields.map(([key, value]) => [key, plain(value)]))
  : node.t === 'array' ? node.items.map(plain) : node.value
const field = (node: Json | undefined, key: string): Json | undefined =>
  node?.t === 'object' ? node.fields.find(([name]) => name === key)?.[1] : undefined
/** A value as one word: a string as written, anything else as JSON. */
const say = (node: Json | undefined): string => node === undefined ? '' : node.t === 'string' ? node.value : JSON.stringify(plain(node))

// ── what a piece holds ─────────────────────────────────────────────────────

/** The part of a receipt line a piece holds: [a, b). */
type Span = { readonly a: number; readonly b: number }
const within = (node: Json, span: Span): boolean => node.s >= span.a && node.e <= span.b
const touches = (node: Json, span: Span): boolean => node.s < span.b && node.e > span.a
type Clipped = { readonly text: string; readonly from: boolean; readonly to: boolean }
/** The characters of a string written inside the span, and whether its start
 *  or its end lies outside it; undefined when none of it does. */
const clip = (node: JsonString, span: Span): Clipped | undefined => {
  if (within(node, span)) return { text: node.value, from: false, to: false }
  let first = 0
  while (first < node.value.length && node.at[first] < span.a) first++
  let last = node.value.length
  while (last > first && node.at[last] > span.b) last--
  return first < last ? { text: node.value.slice(first, last), from: first > 0, to: last < node.value.length } : undefined
}
const partly = (cut: { readonly from?: boolean; readonly to?: boolean }): string =>
  cut.from && cut.to ? ' (a middle part; the rest is cut to fit)' : cut.from ? ' (its start is cut to fit)' : cut.to ? ' (its end is cut to fit)' : ''

type Picked = { readonly k: number; readonly node: Json; readonly text: string; readonly from?: boolean; readonly to?: boolean }
/** The items of a list the piece holds whole — and, for `clipped` lists, the
 *  part of a string item it holds. */
const pick = (list: JsonArray, span: Span, clipped: boolean): Picked[] => list.items.flatMap((node, k): Picked[] => {
  if (within(node, span)) return [{ k, node, text: say(node) }]
  const cut = clipped && node.t === 'string' ? clip(node, span) : undefined
  return cut ? [{ k, node, ...cut }] : []
})
const counted = (shown: readonly Picked[], total: number): string =>
  shown.length === total && shown.every(item => !item.from && !item.to) ? `${total}` : `${shown.length} of ${total} in this piece, the rest cut to fit`

// ── how a value is shown ───────────────────────────────────────────────────

/** A value on its label's line: as written, unless it holds a line break or
 *  another control character — then quoted, so it stays on its line. */
const inline = (text: string): string => CONTROL.test(text) ? quote(text) : text
/** A name the hive holds, always quoted: where it ends is never in doubt. */
const named = (text: string): string => quote(text)
const short = (text: string): string => SIGNATURE.test(text) ? `${text.slice(0, 8)}…` : inline(text)
/** The hive's own text, every line of it behind JEV_QUOTE. */
const quoted = (text: string): string[] => text.split(BREAK).map(line => JEV_QUOTE + line)
const when = (time: Json | undefined): string => {
  const date = time?.t === 'scalar' && typeof time.value === 'number' ? new Date(time.value) : undefined
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : inline(say(time))
}
/** Fields of a list item this file does not know, shown rather than dropped. */
const extra = (item: Json, known: readonly string[]): string => {
  if (item.t !== 'object') return ''
  const rest = item.fields.filter(([key]) => !known.includes(key))
    .map(([key, value]) => `${inline(key)}: ${quote(plain(value))}`)
  return rest.length ? ` (${rest.join('; ')})` : ''
}
/** Names that stand for more than one signature in a list: only those keep
 *  a signature's first characters, to tell the items apart. */
const twins = (items: readonly Json[]): Set<string> => {
  const sigs = new Map<string, Set<string>>()
  for (const item of items) {
    const name = say(field(item, 'name'))
    sigs.set(name, (sigs.get(name) ?? new Set<string>()).add(say(field(item, 'sig'))))
  }
  return new Set([...sigs].filter(([, set]) => set.size > 1).map(([name]) => name))
}
const nameOf = (item: Json, alike: ReadonlySet<string>): string => {
  if (item.t !== 'object') return quote(plain(item))
  const name = say(field(item, 'name'))
  return `${named(name)}${alike.has(name) ? ` (${short(say(field(item, 'sig')))})` : ''}`
}
/** A path, and the tile's name beside it only when the path does not end in it. */
const pathOf = (item: Json): string => {
  const path = say(field(item, 'path'))
  const name = field(item, 'name')
  return `${inline(path)}${name === undefined || path === say(name) || path.endsWith(`/${say(name)}`) ? '' : ` (tile ${named(say(name))})`}`
}

// ── one read ───────────────────────────────────────────────────────────────

const renderRead = (read: JsonObject, index: number, count: number, span: Span): string[] => {
  const fields = new Map(read.fields)
  // Machine words only: each read's own signature, and whether a summary
  // came from the cache (`minted` is said when it was made for this read).
  const used = new Set(['sig', 'layerSig', 'minted'])
  const out: string[] = []
  const cut: string[] = []
  const take = (key: string): Json | undefined => { if (fields.has(key)) used.add(key); return fields.get(key) }
  const word = (key: string): string | undefined => { const node = take(key); return node === undefined ? undefined : say(node) }
  const remark = (key: string): void => { const text = word(key); if (text !== undefined) out.push(`  hive remark: ${inline(text)}`) }
  /** The hive's own text under a label, as much of it as the piece holds. */
  const block = (key: string, label: string): void => {
    const node = take(key)
    if (node === undefined) return
    if (node.t !== 'string') { if (node.t !== 'scalar' || node.value !== null) used.delete(key); return }
    const shown = clip(node, span)
    if (!shown) { cut.push(key); return }
    out.push(`  ${label}${partly(shown)}:`, ...quoted(shown.text))
  }
  /** A list, as much of it as the piece holds. */
  const list = (key: string, title: (counts: string) => string, line: (item: Picked, all: readonly Json[]) => string[], clipped = false): void => {
    const node = fields.get(key)
    if (node?.t !== 'array') return
    used.add(key)
    if (!touches(node, span)) { cut.push(key); return }
    const shown = pick(node, span, clipped)
    out.push(`  ${title(counted(shown, node.items.length))}:`, ...shown.flatMap(item => line(item, node.items)))
  }
  const scalar = (key: string): string | undefined => {
    const node = fields.get(key)
    if (node?.t !== 'scalar') return undefined
    used.add(key)
    return String(node.value)
  }

  // HEADER: what was asked, where it resolved, which tile. Named for every
  // read a piece touches, so a piece's notes are never without their tile.
  out.push(`read ${index} of ${count}: ${inline(word('grammar') ?? '')}${read.s < span.a ? ' (continued: its start is cut to fit)' : ''}`)
  const root = word('root')
  if (root !== undefined) out.push(`  route: ${short(root)}`)
  const name = word('name')
  if (name !== undefined) out.push(`  tile: ${named(name)}`)
  const opened = word('of')
  if (opened !== undefined) {
    const type = word('type')
    const size = scalar('size')
    const from = scalar('from')
    out.push(`  opened: ${inline(opened)}${type !== undefined ? ` ${inline(type)}` : ''}${size !== undefined ? `, ${size} bytes` : ''}${from !== undefined ? `, from byte ${from}` : ''}`)
  }
  const section = word('section')
  if (section !== undefined) out.push(`  section: ${inline(section)}`)
  const query = word('query')
  if (query !== undefined) out.push(`  looked for: ${named(query)}`)
  const error = word('error')
  if (error !== undefined) out.push(`  error: ${inline(error)}`)
  remark('scopeNote')

  // NOTES, with how many there are.
  const notes = fields.get('notes')
  if (notes?.t === 'array') {
    used.add('notes')
    const noteCount = scalar('noteCount') ?? `${notes.items.length}`
    if (!touches(notes, span)) cut.push(`notes (noteCount ${noteCount})`)
    else if (!notes.items.length) out.push(`  notes (noteCount ${noteCount}): none`)
    else {
      const shown = pick(notes, span, true)
      const sent = noteCount === `${notes.items.length}` ? '' : `; ${notes.items.length} in this read`
      const held = shown.length === notes.items.length && shown.every(item => !item.from && !item.to) ? '' : `; ${shown.length} in this piece, the rest cut to fit`
      out.push(`  notes (noteCount ${noteCount}${sent}${held}):`, ...shown.flatMap(item => [`  note ${item.k + 1}${partly(item)}:`, ...quoted(item.text)]))
    }
  }
  remark('notesNote')

  // WHAT WAS ASKED FOR.
  const by = word('summarisedBy')
  const minted = fields.get('minted')
  block('summary', `summary${by !== undefined ? ` by ${inline(by)}` : ''}${minted?.t === 'scalar' && minted.value === true ? ', made for this read' : ''}`)
  block('text', 'text')
  remark('note')
  block('projection', 'content (projection)')
  const content = fields.get('content')
  if (content?.t === 'object') {
    used.add('content')
    if (!touches(content, span)) cut.push('content')
    else {
      // Each field under its own label, and a field the cut went through says
      // which end is missing: its text alone never reads as a whole value.
      const lines = content.fields.flatMap(([key, value]): string[] => {
        const shown = value.t === 'string' ? clip(value, span) : within(value, span) ? { text: quote(plain(value)), from: false, to: false } : undefined
        return shown ? [`  content field ${quote(key)}${partly(shown)}:`, ...quoted(shown.text)] : []
      })
      out.push(`  content${within(content, span) ? '' : ' (part of it; the rest is cut to fit)'}:`, ...lines)
    }
  }
  list('matches', counts => `matches (${counts})`, ({ node }) => [`  - ${pathOf(node)}${extra(node, ['path', 'name'])}`])
  list('nodes', counts => `tiles (${counts})`, ({ node }) => [`  - ${pathOf(node)} (${inline(say(field(node, 'childCount')))} children)${extra(node, ['path', 'name', 'depth', 'childCount'])}`])
  const total = scalar('total')
  list('markers', counts => `versions (${counts}${total !== undefined ? `; ${total} in all` : ''})`, ({ node }) =>
    [`  - #${inline(say(field(node, 'index')))} ${when(field(node, 'at'))} ${named(say(field(node, 'name')))} (layer ${short(say(field(node, 'layerSig')))})${extra(node, ['index', 'at', 'name', 'layerSig'])}`])
  const hit = ({ node }: Picked, all: readonly Json[]): string[] => {
    const at = field(node, 'section')
    return [`  - ${nameOf(node, twins(all))}${at !== undefined ? ` ${inline(say(at))}` : ''} at ${inline(say(field(node, 'at')))}${extra(node, ['sig', 'name', 'section', 'at', 'text'])}:`, ...quoted(say(field(node, 'text')))]
  }
  list('hits', counts => `lines of code holding the word (${counts})`, hit)
  remark('hitsNote')
  // `code` is the running code that names a tile on a read, and the modules
  // and dependencies on a code listing: told apart by what an item holds.
  const code = fields.get('code')
  const running = code?.t === 'array' && code.items.some(item => field(item, 'text') !== undefined)
  if (running) list('code', counts => `running code that names this tile (${counts})`, hit)
  remark('codeNote')

  // WHAT WAS CUT, beside what was asked — a code listing's is its list's.
  const cutLines = (): void => {
    const truncated = scalar('truncated')
    if (truncated !== undefined) out.push(`  truncated: ${truncated === 'true' ? 'yes' : truncated === 'false' ? 'no' : truncated}`)
    remark('truncatedNote')
    const all = scalar('unfinishedCount')
    list('unfinished', counts => `unfinished branches (${counts}${all !== undefined ? `; ${all} in all` : ''})`, ({ node }) => [`  - ${inline(say(node))}`])
    const next = scalar('next')
    if (next !== undefined) out.push(`  continues at ${next}`)
  }
  const listing = code?.t === 'array' && !running
  if (!listing) cutLines()

  // THE STRUCTURE the read also returned.
  list('children', counts => `children (${counts})`, ({ node }, all) => [`  - ${nameOf(node, twins(all))}${extra(node, ['name', 'sig'])}`])
  list('unresolved', counts => `children not on this device (${counts})`, ({ node }) => [`  - ${short(say(node))}`])
  remark('unresolvedNote')
  if (listing) {
    list('code', counts => `modules and dependencies (${counts}${total !== undefined ? `; ${total} in all` : ''})`, ({ node }, all) =>
      [`  - ${nameOf(node, twins(all))} (${inline(say(field(node, 'of')))})${extra(node, ['name', 'sig', 'of'])}`])
    cutLines()
  }
  list('sections', counts => `sections (${counts})`, ({ node }) => [`  - ${inline(say(field(node, 'path')))} (${inline(say(field(node, 'lines')))} lines)${extra(node, ['path', 'lines'])}`])

  // ANYTHING ELSE the read returned, as it came: nothing that carries
  // content is dropped.
  for (const [key, value] of read.fields) if (!used.has(key)) out.push(...unknown(key, value, span, cut))
  if (cut.length) out.push(`  not in this piece (cut to fit): ${cut.join(', ')}`)
  return out
}

/** What of a value the piece holds: whole values, and the part of a string. */
const part = (node: Json, span: Span): unknown => within(node, span) ? plain(node)
  : node.t === 'array' ? node.items.filter(item => touches(item, span)).map(item => part(item, span))
  : node.t === 'object' ? Object.fromEntries(node.fields.filter(([, value]) => touches(value, span)).map(([key, value]) => [key, part(value, span)]))
  : node.t === 'string' ? clip(node, span)?.text ?? '' : node.value

/** A field this file does not know: a string is the hive's own text, behind
 *  JEV_QUOTE; a number or a yes/no beside its key; anything else as JSON on
 *  one line — as much of it as the piece holds. */
const unknown = (key: string, value: Json, span: Span, cut: string[]): string[] => {
  if (value.t === 'scalar') return [`  ${inline(key)}: ${String(value.value)}`]
  if (!touches(value, span)) { cut.push(inline(key)); return [] }
  if (value.t === 'string') {
    const shown = clip(value, span)
    if (!shown) { cut.push(inline(key)); return [] }
    return [`  ${inline(key)}${partly(shown)}:`, ...quoted(shown.text)]
  }
  return [`  ${inline(key)}${within(value, span) ? '' : ' (part of it; the rest is cut to fit)'}: ${quote(part(value, span))}`]
}

// ── one receipt ────────────────────────────────────────────────────────────

/** A receipt line, or the part of it in [a, b), as text; undefined when the
 *  line is not a read receipt after all. */
const renderReceipt = (line: string, span: Span): string[] | undefined => {
  let root: Json
  try { root = parseJson(line) } catch { return undefined }
  const kind = field(root, 'kind')
  const observations = field(root, 'observations')
  if (root.t !== 'object' || kind?.t !== 'string' || kind.value !== RECEIPT_KIND || observations?.t !== 'array') return undefined
  const reads = observations.items
  const whole = span.a <= 0 && span.b >= line.length
  const out = [`hive read results, ${reads.length} read${reads.length === 1 ? '' : 's'}: lines behind "|" are the hive's own text, exactly as the read returned it; signatures are left out, or cut to 8 characters where items need telling apart.${whole ? '' : ' This piece holds part of these results; the rest was cut to fit.'}`]
  const away: number[] = []
  reads.forEach((read, k) => {
    if (!touches(read, span)) away.push(k + 1)
    else if (read.t === 'object') out.push(...renderRead(read, k + 1, reads.length, span))
    else out.push(`read ${k + 1} of ${reads.length}: ${quote(plain(read))}`)
  })
  const cut: string[] = away.length ? [`read${away.length === 1 ? '' : 's'} ${away.join(', ')}`] : []
  for (const [key, value] of root.fields) {
    if (key !== 'kind' && key !== 'structureOnly' && key !== 'observations') out.push(...unknown(key, value, span, cut))
  }
  if (cut.length) out.push(`not in this piece (cut to fit): ${cut.join(', ')}`)
  return out
}

// ── a piece ────────────────────────────────────────────────────────────────

/** The piece at `offset` in `holder`, as text: a line that is (part of) a
 *  read receipt there is rendered — only the part the piece holds, with each
 *  read it touches named — and every other line is shown as it was. */
const renderAt = (holder: string, offset: number, piece: string): string => {
  const out: string[] = []
  for (const line of piece.split('\n')) {
    const from = holder.lastIndexOf('\n', offset - 1) + 1
    const end = holder.indexOf('\n', offset)
    const whole = holder.slice(from, end < 0 ? holder.length : end)
    const rendered = whole.startsWith(RECEIPT_LINE) ? renderReceipt(whole, { a: offset - from, b: offset - from + line.length }) : undefined
    out.push(...(rendered ?? [escaped(line)]))
    offset += line.length + 1
  }
  return out.join('\n')
}

/** More places than this holding one piece, and it is shown as written. */
const PLACES = 16

/** A piece of evidence as Jev reads it, rendered from the place in the
 *  messages the worker was sent that holds it. A piece held in more than one
 *  place is rendered from each, and when they disagree — a short tail two
 *  tiles share, the head of a tile read twice whose notes changed — which
 *  read it belongs to is not the piece's to tell: it is shown as written,
 *  never under another read's header or noteCount. With no message holding
 *  it, a piece stands alone: its whole receipt lines are rendered, and a cut
 *  one stays as written. */
export const jevEvidenceText = (piece: string, messages: readonly { readonly content: string }[] = []): string => {
  const shown = new Set<string>()
  let places = 0
  for (const { content } of messages) {
    for (let at = content.indexOf(piece); at >= 0; at = content.indexOf(piece, at + 1)) {
      if (++places > PLACES) return escaped(piece)
      shown.add(renderAt(content, at, piece))
    }
  }
  if (!places) return renderAt(piece, 0, piece)
  return shown.size === 1 ? [...shown][0] : escaped(piece)
}
