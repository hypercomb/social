// assistant/unfile.queen.ts
//
// `unfile on /<route>: <first words>` — take a note off a tile: the twin of
// `file on /<route>: <text>`. A note is named by how it starts, the way a
// person remembers it, never by its signature; the words must fit exactly one
// note on that tile, or nothing is taken. It is a list change, never a
// deletion: the note's bytes stay and the tile's history holds the list it
// left, so undo puts it back. Until 2026-10-15 a session could only do this
// through a private bridge op (`note-delete`, by 64-hex id) — retired for
// this word ("retire the bridge and fix the dialect whenever we reach for the
// bridge").

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'

type NoteLike = { readonly id: string; readonly text: string; readonly children?: readonly NoteLike[] }
type NotesLike = {
  getNotesAtSegments?: (segments: readonly string[]) => Promise<readonly NoteLike[]>
  deleteAtSegments?: (parent: readonly string[], cell: string, noteId: string) => Promise<void>
}

const get = <T,>(key: string): T | undefined =>
  (window as unknown as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

/** Case and spacing never decide which note is meant. */
const folded = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** Every note on the tile, replies included. */
const everyNote = (notes: readonly NoteLike[]): NoteLike[] =>
  notes.flatMap(note => [note, ...everyNote(note.children ?? [])])

/** The notes the words could mean. Pure. */
export const notesStartingWith = (notes: readonly NoteLike[], words: string): NoteLike[] => {
  const start = folded(words)
  return start ? everyNote(notes).filter(note => folded(note.text).startsWith(start)) : []
}

export class UnfileQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'unfile'
  override description = 'Take a note off a tile, named by how it starts: unfile on /<route>: <first words>'
  override descriptionKey = 'slash.unfile'
  override options = ['on /<route>: <first words of the note>']
  override examples = [
    { input: '/unfile on /printers: call the company', result: 'The note that starts that way leaves /printers; history keeps it' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'on /<route>: <first words of the note>',
    example: 'unfile on /printers: call the company',
    reach: 'editing',
    scope: 'hive',
  }

  protected async execute(args: string): Promise<void> {
    const said = /^on\s+(\/\S*)\s*:\s+([\s\S]+)$/i.exec(args.trim())
    if (!said) { this.#refuse('Unfile: say the tile and how the note starts, for example "unfile on /printers: call the company"') }
    const segments = said![1].split('/').map(part => part.trim()).filter(Boolean)
    const route = `/${segments.join('/')}`
    if (!segments.length) this.#refuse('Unfile: the root holds no notes; say a tile')
    const notes = get<NotesLike>('@diamondcoreprocessor.com/NotesService')
    if (!notes?.getNotesAtSegments || !notes.deleteAtSegments) this.#refuse('Unfile: notes are not available here')
    const matches = notesStartingWith(await notes!.getNotesAtSegments!(segments), said![2])
    if (!matches.length) this.#refuse(`Unfile: no note on ${route} starts with "${said![2].trim()}"`)
    if (matches.length > 1) this.#refuse(`Unfile: ${matches.length} notes on ${route} start that way; say more of it`)
    const note = matches[0]
    await notes!.deleteAtSegments!(segments.slice(0, -1), segments[segments.length - 1], note.id)
    const shown = note.text.replace(/\s+/g, ' ').trim()
    this.#say(`Unfiled from ${route}: "${shown.length > 80 ? `${shown.slice(0, 80)}…` : shown}" — history keeps it`)
  }

  /** Said aloud AND thrown: a clean return earns a machine a "ran" receipt
   *  for a note that was never taken off. */
  #refuse(message: string): never {
    this.#say(message)
    throw new Error(message)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '🗒' })
  }
}

const _unfile = new UnfileQueenBee()
window.ioc.register('@diamondcoreprocessor.com/UnfileQueenBee', _unfile)
