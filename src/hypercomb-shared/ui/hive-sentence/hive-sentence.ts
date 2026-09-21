// hive-sentence.ts — THE HIVE'S LANGUAGE HAS ONE LOOK (jwize, 2026-09-20).
//
// "Instead of showing the slash in front of the behaviors just change the
// colours in the language … a standard every time we see them in text."
//
// A behaviour sentence — `copy drafts`, `list /`, `create jev-proof` — is
// drawn the same way wherever it appears: the chat, a table question, the
// Execution column, a receipt. No slash. The behaviour word wears its OWN
// colour, the one the command line already paints it (its behaviour tile's
// category keyword through TagRegistry), with an underline so colour is
// never the only signal. Arguments stay in ordinary ink.
//
// The reading is not done here. The command line's reader
// (`@diamondcoreprocessor.com/UtteranceReader`, essentials) is handed in, so
// a word reads and colours identically on every surface — one lexicon, the
// live census, never a list kept in the shell. Without a reader the first
// word is the verb and it takes the standard colour.
//
// Pure and framework-free; the look itself lives in
// `hypercomb-shared/styles/_hive-sentence.scss`, loaded by every shell.

import { executionLineParts } from '../chat-window/execution-line'

export type SentenceRole = 'verb' | 'arg' | 'residue' | 'ambiguity'

export interface SentencePart {
  readonly text: string
  readonly role: SentenceRole
  /** The behaviour's own colour, when the hive knows one. Always a safe CSS colour. */
  readonly color?: string
  /** The complete signature, when this part is its compact display form. */
  readonly signature?: string
}

/** The command line's reader, over IoC. Only what this module reads of it. */
export interface SentenceReader {
  read(text: string): {
    readonly spans: readonly {
      readonly start: number
      readonly end: number
      readonly role: 'action' | 'argument' | 'residue' | 'ambiguity'
      readonly color?: string
    }[]
  } | null
}

export interface SentenceOptions {
  /** Draw the line as a sentence even when its first word is not known —
   *  for lines the hive has already parsed as behaviour grammar. */
  readonly force?: boolean
  /** Words that open a sentence besides the census: the read verbs. */
  readonly verbs?: ReadonlySet<string>
}

/** A colour from the registry lands in a style attribute, so only plain
 *  colour syntax passes: hex, rgb(a), hsl(a). Anything else falls back. */
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9\s.,%a-z/-]{1,48}\))$/i
export const safeColor = (value: string | undefined): string | undefined => {
  const color = String(value ?? '').trim()
  return color && COLOR.test(color) && !/[;:"'<>]|url|expression/i.test(color) ? color : undefined
}

/** The display form: the slash lives in the icon and in the register, not on
 *  the page. The line that RUNS is never changed by this. */
export const bareSentence = (line: string): string => String(line ?? '').trim().replace(/^\/(?=\S)/, '')

const ROLES: Record<string, SentenceRole> = { action: 'verb', argument: 'arg', residue: 'residue', ambiguity: 'ambiguity' }

/** Long signatures shrink to their prefix, exactly as the Execution line did. */
const compact = (part: SentencePart): SentencePart[] =>
  part.role === 'verb'
    ? [part]
    : executionLineParts(part.text).map(piece => ({ ...part, text: piece.text, ...(piece.signature ? { signature: piece.signature } : {}) }))

/**
 * Read one line as a hive sentence. Returns null when it is not one — the
 * first word is neither a behaviour the reader knows nor one of `verbs` —
 * unless `force` is set.
 */
export const hiveSentenceParts = (
  line: string,
  reader?: SentenceReader,
  options: SentenceOptions = {},
): readonly SentencePart[] | null => {
  const bare = bareSentence(line)
  if (!bare) return null
  const firstEnd = bare.search(/\s|$/)
  const first = bare.slice(0, firstEnd).toLowerCase()
  let reading: ReturnType<SentenceReader['read']> = null
  try { reading = reader?.read(bare) ?? null } catch { reading = null }
  const spans = [...(reading?.spans ?? [])].sort((a, b) => a.start - b.start)
  const opening = spans.find(span => span.start === 0)
  const read = !!opening && (opening.role === 'action' || opening.role === 'ambiguity')
  if (!read && !options.verbs?.has(first) && !options.force) return null

  const parts: SentencePart[] = []
  if (read) {
    let cursor = 0
    for (const span of spans) {
      if (span.start < cursor || span.end > bare.length) continue
      if (span.start > cursor) parts.push({ text: bare.slice(cursor, span.start), role: 'arg' })
      const color = safeColor(span.color)
      parts.push({ text: bare.slice(span.start, span.end), role: ROLES[span.role] ?? 'arg', ...(color ? { color } : {}) })
      cursor = span.end
    }
    if (cursor < bare.length) parts.push({ text: bare.slice(cursor), role: 'arg' })
  } else {
    parts.push({ text: bare.slice(0, firstEnd), role: 'verb' })
    if (firstEnd < bare.length) parts.push({ text: bare.slice(firstEnd), role: 'arg' })
  }
  return parts.flatMap(compact)
}

const esc = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The same parts as HTML, for surfaces that render markup (chat markdown). */
export const hiveSentenceHtml = (parts: readonly SentencePart[]): string =>
  `<span class="hc-sentence">${parts.map(part => {
    const classes = `hc-sentence-${part.role}${part.signature ? ' hc-sentence-sig' : ''}`
    const style = part.color ? ` style="color:${esc(part.color)}"` : ''
    const title = part.signature ? ` title="${esc(part.signature)}"` : ''
    return `<span class="${classes}"${style}${title}>${esc(part.text)}</span>`
  }).join('')}</span>`
