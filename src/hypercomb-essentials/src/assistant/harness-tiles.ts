// assistant/harness-tiles.ts
//
// A HARNESS AS A TILE (documentation/agent-harness.md, step 4, `harness
// edit`). Hives are our source files: the record a participant wants to
// change is put in front of them as a tile whose note is the record's JSON,
// and editing that note is the save. There is no second structure and no
// mark to keep in step — A NOTE IS A HARNESS WHEN ITS TEXT IS A `harness@1`
// RECORD. The shape is the opt-in, the same way a table is unmistakable by
// its first key. Whenever a tile's notes change, any note of that shape is
// read as a record and brought into the pool under its own signature: HELD,
// like anything `harness import` brings in, until `harness use` or `harness
// here` names it. A record that widens is refused and the refusal is said.

import { EffectBus } from '@hypercomb/core'
import { harness, type HarnessRecord } from './harness.js'
import { childNamesOfStrict, resolveCurrentLayer, type PlacementHistory } from '../history/layer-placement.js'

export const HARNESS_TILE_PREFIX = 'harness-'

/** The shipped record cannot be replaced by name (`default` always answers
 *  it), so a copy opened for editing takes a name of its own. */
export const EDITED_DEFAULT_NAME = 'custom'

type NoteLike = { readonly text?: string; readonly children?: readonly NoteLike[] }

export const harnessNoteText = (record: HarnessRecord): string => JSON.stringify(record, null, 2)

/** Every note text under a tile that is, by its shape, a harness record. */
export const harnessTexts = (notes: readonly NoteLike[]): string[] => {
  const found: string[] = []
  const walk = (list: readonly NoteLike[]): void => {
    for (const note of list) {
      const text = String(note?.text ?? '').trim()
      if (text.startsWith('{') && /"kind"\s*:\s*"harness@1"/.test(straight(text))) found.push(text)
      walk(note?.children ?? [])
    }
  }
  walk(notes)
  return found
}

/** An editor that curls quotes must not turn a record into prose. */
const straight = (text: string): string => text.replace(/[“”]/g, '"')

const readRecord = (text: string): unknown => {
  try { return JSON.parse(text) } catch { return JSON.parse(straight(text)) }
}

export type HarnessTileDeps = {
  /** The page the participant stands on. */
  segments(): readonly string[]
  /** Is the tile on this page? The PAGE answers, by its children — never
   *  the notes, which outlive a tile and are shared by its word. */
  standsHere(parent: readonly string[], tile: string): Promise<boolean>
  notesAt(segments: readonly string[]): Promise<readonly NoteLike[]>
  /** Make the tile on the current page; rejects when it cannot. */
  create(name: string): Promise<void>
  addNote(parent: readonly string[], tile: string, text: string): Promise<void>
  open(tile: string): void
  say(message: string, type: 'success' | 'warning'): void
}

const liveDeps = (): HarnessTileDeps | null => {
  const ioc = window.ioc
  const notes = ioc?.get?.('@diamondcoreprocessor.com/NotesService') as {
    getNotesAtSegments?(segments: readonly string[]): Promise<readonly NoteLike[]>
    addAtSegments?(parent: readonly string[], cell: string, text: string): Promise<void>
  } | undefined
  const lineage = ioc?.get?.('@hypercomb.social/Lineage') as
    { explorerSegments?(): readonly string[]; domain?: unknown } | undefined
  if (!notes?.getNotesAtSegments || !notes.addAtSegments) return null
  return {
    segments: () => [...(lineage?.explorerSegments?.() ?? [])],
    standsHere: async (parent, tile) => {
      const history = ioc?.get?.('@diamondcoreprocessor.com/HistoryService') as PlacementHistory | undefined
      if (!history) return false
      // The page's layer the way remove and layout resolve it: the parent
      // chain, then the cursor the renderer warmed for where we stand.
      const cursor = ioc?.get?.('@diamondcoreprocessor.com/HistoryCursorService') as { currentLayerSig?: string } | undefined
      const page = await resolveCurrentLayer(history, lineage?.domain, parent, cursor?.currentLayerSig)
      // A child this read could not see counts as not standing: create links
      // a name that already stands back to its own head, so asking twice is
      // safe and guessing "it is there" is not.
      return (await childNamesOfStrict(history, page)).names.includes(tile)
    },
    notesAt: segments => notes.getNotesAtSegments!(segments),
    create: name => new Promise<void>((resolve, reject) => {
      let accepted = false
      EffectBus.emitTransient('command:create-cells', {
        name,
        accept: () => { accepted = true },
        complete: (error?: unknown) => error === undefined ? resolve() : reject(error),
      })
      if (!accepted) reject(new Error('the command line is unavailable'))
    }),
    addNote: (parent, tile, text) => notes.addAtSegments!(parent, tile, text),
    open: tile => { EffectBus.emit('notes:open', { cellLabel: tile }) },
    say: (message, type) => { EffectBus.emit('toast:show', { type, message }) },
  }
}

export type OpenedHarnessTile =
  | { readonly ok: true; readonly tile: string; readonly name: string; readonly sig: string; readonly made: boolean }
  | { readonly ok: false; readonly error: string }

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Why the tile was not made, in words the participant can act on. The
 *  committer names its refusal of a write made while viewing the past
 *  (history/layer-committer.drone.ts); it is read by that name here, because
 *  a bee is never imported for a value. */
const whyNotMade = (error: unknown): string =>
  (error as { name?: unknown } | null)?.name === 'RewoundCommitError'
    ? 'you are viewing the past, so nothing can be written; step forward, then run harness edit again'
    : `the tile could not be made on this page (${reasonOf(error)})`

// WHAT STOOD ON A TILE AT ITS LAST READ, by where the tile is. A save tells
// which tile changed, never which note: the record that was already there
// was not said again by a save that touched something else, and must not
// take its name back from a later save on another tile. Only a text that
// was not on THIS tile at its last read is the save. A tile not read yet
// this session has no last read, so what it holds is taken as said now.
const stood = new Map<string, Set<string>>()
const whereOf = (segments: readonly string[]): string => segments.join('/')

/**
 * Put a record in front of the participant as a tile on the page they stand
 * on. The tile is made once, and its note is added once: a tile that already
 * carries a harness note is opened as it stands, because what is in it may be
 * newer than the pool.
 *
 * TWO QUESTIONS, ASKED APART. Whether the tile stands is asked of the page;
 * whether it carries a record is asked of the notes. Notes outlive a tile
 * and are shared by its word, so a note found at this address says nothing
 * about the page — a removed tile, or the same word on another page, has the
 * note and no tile.
 */
export const openHarnessTile = async (
  source: HarnessRecord,
  deps: HarnessTileDeps | null = liveDeps(),
): Promise<OpenedHarnessTile> => {
  if (!deps) return { ok: false, error: 'the notes are not loaded' }
  const name = source.name === 'default' ? EDITED_DEFAULT_NAME : source.name
  const record: HarnessRecord = { ...source, name }
  const tile = `${HARNESS_TILE_PREFIX}${name}`
  const parent = [...deps.segments()]
  let made = false
  if (!(await deps.standsHere(parent, tile).catch(() => false))) {
    // A refused create ends it, and says why: no note is ever added for a
    // tile that is not there, and nothing is reported as opened.
    try { await deps.create(tile); made = true } catch (error) { return { ok: false, error: whyNotMade(error) } }
  }
  const standing = harnessTexts(await deps.notesAt([...parent, tile]).catch(() => []))
  stood.set(whereOf([...parent, tile]), new Set(standing))
  let sig = ''
  // THE NAME FOLLOWS THE NOTE. What already stands in the tile is what the
  // participant will read, so it — not the copy that was asked for — is the
  // newest for its name: opening the tile says it again. A note that is
  // refused was said when it was saved.
  for (const text of standing) {
    try { sig = await harness.import(readRecord(text), true) } catch { /* refused; the tile is opened to be mended */ }
  }
  try {
    // No record of the tile's own: the copy is a record in its own right the
    // moment it is opened, and it becomes the note unless one stands. It is
    // not said again here — the note landing is the save, and the read that
    // save wakes (`takeHarnessNotes`) gives it the name.
    if (!sig) sig = await harness.import(record)
    if (!standing.length) await deps.addNote(parent, tile, harnessNoteText(record))
  } catch (error) {
    return { ok: false, error: reasonOf(error) }
  }
  deps.open(tile)
  return { ok: true, tile, name, sig, made }
}

// A note is SAID once per text: the same bytes say the same thing, and a
// refusal repeated on every keystroke elsewhere on the tile is noise. It
// quiets the toast only — the record is brought in every time, and whether
// it takes its name is `stood`'s to answer, tile by tile.
const read = new Set<string>()

export type TakenHarnessNotes = {
  readonly imported: readonly { readonly name: string; readonly sig: string }[]
  readonly refused: readonly string[]
}

/**
 * Read the harness notes on one tile and bring each record in, held.
 *
 * THE NAME FOLLOWS THE LATEST SAVE. Every save of the tile brings its
 * records in again, and the text that was not on the tile at its last read
 * is brought in as SAID AGAIN (`HarnessStore.import`), the newest for its
 * name — so a note put back to what it read before is the named one again,
 * though nothing new is minted and nothing is said. Skipping a text already
 * read left `harness use <name>` running the edit the note no longer showed.
 * A record that was already on the tile is brought in without that: a save
 * that touched another note is not a saying of it.
 */
export const takeHarnessNotes = async (
  segments: readonly string[],
  deps: Pick<HarnessTileDeps, 'notesAt' | 'say'> | null = liveDeps(),
): Promise<TakenHarnessNotes> => {
  const imported: { name: string; sig: string }[] = []
  const refused: string[] = []
  if (!deps || !segments.length) return { imported, refused }
  const texts = harnessTexts(await deps.notesAt(segments).catch(() => []))
  const before = stood.get(whereOf(segments))
  stood.set(whereOf(segments), new Set(texts))
  const saved = (text: string): boolean => !before?.has(text)
  // The text that was not here before is the save that woke this read. It
  // goes last, so a tile keeping an older copy of the same name beside it
  // still answers the edit.
  const ordered = [...texts.filter(text => !saved(text)), ...texts.filter(saved)]
  for (const text of ordered) {
    const said = read.has(text)
    read.add(text)
    const held = new Set(harness.list().map(entry => entry.sig))
    try {
      const sig = await harness.import(readRecord(text), saved(text))
      if (held.has(sig) || sig === harness.defaultSig) continue
      const name = harness.find(sig)?.record.name ?? 'the record'
      imported.push({ name, sig })
      if (!said) deps.say(`${name} (${sig.slice(0, 12)}) is in the pool under its new signature; harness use ${name} or harness here ${name} runs it.`, 'success')
    } catch (error) {
      const reason = reasonOf(error)
      refused.push(reason)
      if (!said) deps.say(`That harness note was refused: ${reason}`, 'warning')
    }
  }
  return { imported, refused }
}

let stop: (() => void) | null = null

/** Listen for edited notes — the bee wires it (chat.drone). */
export const startHarnessTiles = (): void => {
  if (stop) return
  stop = EffectBus.on<{ segments?: readonly string[] }>('notes:changed', payload => {
    const segments = (payload?.segments ?? []).map(part => String(part ?? '').trim()).filter(Boolean)
    if (segments.length) void takeHarnessNotes(segments)
  })
}

export const stopHarnessTiles = (): void => { stop?.(); stop = null; read.clear(); stood.clear() }
