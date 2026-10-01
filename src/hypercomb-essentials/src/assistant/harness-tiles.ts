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
  const lineage = ioc?.get?.('@hypercomb.social/Lineage') as { explorerSegments?(): readonly string[] } | undefined
  if (!notes?.getNotesAtSegments || !notes.addAtSegments) return null
  return {
    segments: () => [...(lineage?.explorerSegments?.() ?? [])],
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

/**
 * Put a record in front of the participant as a tile on the page they stand
 * on. The tile is made once: a tile that already carries a harness note is
 * opened as it stands, because what is in it may be newer than the pool.
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
  const standing = harnessTexts(await deps.notesAt([...parent, tile]).catch(() => []))
  let made = false
  let sig: string
  try {
    // The copy is a record in its own right the moment it is opened.
    sig = await harness.import(record)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!standing.length) {
    // A tile of that name may already stand here without a record in it;
    // the note is what makes it a harness, so a refused create is not fatal.
    try { await deps.create(tile); made = true } catch { /* it stands already, or the note says so below */ }
    try {
      await deps.addNote(parent, tile, harnessNoteText(record))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  deps.open(tile)
  return { ok: true, tile, name, sig, made }
}

// A note is read once per text: the same bytes say the same thing, and a
// refusal repeated on every keystroke elsewhere on the tile is noise.
const read = new Set<string>()

export type TakenHarnessNotes = {
  readonly imported: readonly { readonly name: string; readonly sig: string }[]
  readonly refused: readonly string[]
}

/** Read the harness notes on one tile and bring each new record in, held. */
export const takeHarnessNotes = async (
  segments: readonly string[],
  deps: Pick<HarnessTileDeps, 'notesAt' | 'say'> | null = liveDeps(),
): Promise<TakenHarnessNotes> => {
  const imported: { name: string; sig: string }[] = []
  const refused: string[] = []
  if (!deps || !segments.length) return { imported, refused }
  const texts = harnessTexts(await deps.notesAt(segments).catch(() => []))
  for (const text of texts) {
    if (read.has(text)) continue
    read.add(text)
    const held = new Set(harness.list().map(entry => entry.sig))
    try {
      const sig = await harness.import(readRecord(text))
      if (held.has(sig) || sig === harness.defaultSig) continue
      const name = harness.find(sig)?.record.name ?? 'the record'
      imported.push({ name, sig })
      deps.say(`${name} (${sig.slice(0, 12)}) is in the pool under its new signature; harness use ${name} or harness here ${name} runs it.`, 'success')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      refused.push(reason)
      deps.say(`That harness note was refused: ${reason}`, 'warning')
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

export const stopHarnessTiles = (): void => { stop?.(); stop = null; read.clear() }
