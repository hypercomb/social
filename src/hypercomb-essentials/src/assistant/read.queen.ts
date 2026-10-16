// assistant/read.queen.ts
//
// `read` — what a tile holds, said aloud: the tiles under it and its notes.
// The chat's models always read with `read /<route>`; a participant, and a
// session speaking for one, had only private bridge ops (`list-at`,
// `note-list`) — retired for this word (2026-10-15: "retire the bridge and
// fix the dialect whenever we reach for the bridge").
//
//   read            the tile you stand on
//   read /          the root: its tiles
//   read /<route>   any tile
//
// Tiles are said as routes, never bare names, so the session door can mask a
// withheld one wherever it appears; a withheld tile itself is never read out
// — open it to see it.

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'
import { HIVE_TREE_READER_IOC_KEY, type HypercombNodeRead } from './hive-tree-reader.js'

type LineageLike = { explorerSegments?: () => readonly string[] }
type ReaderLike = { readNode?: (segments: readonly string[], options?: { maxBytes?: number; withContent?: boolean }) => Promise<HypercombNodeRead> }
type WithheldLike = { covers?: (segments: readonly string[]) => boolean }

const get = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** Tiles said on one line; past this, a count. */
const SHOWN_TILES = 60
/** One note's text on its line; past this, cut and said so. */
const NOTE_CHARS = 2_000

const routeOf = (segments: readonly string[]): string => `/${segments.join('/')}`

/** What `read` says, as lines. Pure. */
export const readLines = (segments: readonly string[], read: HypercombNodeRead, hidden: (segments: readonly string[]) => boolean): string[] => {
  const route = routeOf(segments)
  if (!read.ok) return [`Read ${route}: there is no tile here to read (${read.code})`]
  const tiles = read.children.map(child => [...segments, child.name])
  const shown = tiles.filter(tile => !hidden(tile))
  const withheld = tiles.length - shown.length
  const listed = shown.slice(0, SHOWN_TILES).map(routeOf)
  const lines = [`Read ${route}: ${tiles.length} tile${tiles.length === 1 ? '' : 's'}`
    + (listed.length ? ` — ${listed.join(', ')}${shown.length > SHOWN_TILES ? ` and ${shown.length - SHOWN_TILES} more` : ''}` : '')
    + (withheld ? `; ${withheld} withheld from AI readers` : '')
    + (read.unresolved?.length ? `; ${read.unresolved.length} not on this device` : '')]
  if (!segments.length) return lines
  const notes = read.notes ?? []
  if (!notes.length) { lines.push('  notes: none'); return lines }
  lines.push(`  notes (${read.noteCount ?? notes.length}${read.notesTruncated ? ', more than shown' : ''}):`)
  notes.forEach((note, at) => {
    const depth = note.length - note.trimStart().length
    const text = note.trim().replace(/\s*\n\s*/g, ' / ')
    const cut = text.length > NOTE_CHARS ? `${text.slice(0, NOTE_CHARS)}… (cut; ${text.length} characters)` : text
    lines.push(`  ${' '.repeat(depth)}${at + 1}. ${cut}`)
  })
  return lines
}

export class ReadQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'read'
  override description = 'Say what a tile holds: its tiles and its notes — here, / for the root, or /<route>'
  override descriptionKey = 'slash.read'
  override options = ['', '/', '/<route>']
  override examples = [
    { input: '/read /dolphin', result: 'The tiles under /dolphin, and its notes' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'read | read / | read /<route>',
    example: 'read /dolphin',
    bare: true,
    reach: 'additive',
    scope: 'local',
  }

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    if (raw && !raw.startsWith('/')) { this.#say('Read: say a route, for example "read /dolphin", or nothing for the tile you stand on'); return }
    const segments = raw
      ? raw.split('/').map(part => part.trim()).filter(Boolean)
      : (get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []).map(String)
    const withheld = get<WithheldLike>('@hypercomb.social/AiWithheld')
    const hidden = (tile: readonly string[]): boolean => !!withheld?.covers?.(tile)
    if (segments.length && hidden(segments)) {
      this.#say(`Read ${routeOf(segments)}: withheld from AI readers — open it to see it`)
      return
    }
    const reader = get<ReaderLike>(HIVE_TREE_READER_IOC_KEY)
    if (!reader?.readNode) { this.#say('Read: the hive reader is not ready yet'); return }
    const read = await reader.readNode(segments, { maxBytes: 64_000, withContent: true })
    for (const line of readLines(segments, read, hidden)) this.#say(line)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '📖' })
  }
}

const _read = new ReadQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ReadQueenBee', _read)
