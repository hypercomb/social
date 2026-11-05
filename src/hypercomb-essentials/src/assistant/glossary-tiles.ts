// assistant/glossary-tiles.ts
//
// THE GLOSSARY AS TILES. `glossary tiles` lays documentation/glossary.md out on
// the page the participant stands on, the way `doctrine tiles` lays out the
// codex: a `glossary` tile, one tile per section inside it, and one tile per
// term inside its section, the term and its definition as the term tile's
// note (a section's own prose is its tile's note). `glossary <term>` then
// answers a term from its tile, at once, with no model asked.
//
// A tile's NOTES are read by its word — two tiles named the same read the same
// notes — so every name here is made to be its own: sections are
// `glossary-<section>` and terms are `glossary-<term>`, never the bare term.
// A bare `hive` or `layer` would share its notes with every other `hive` or
// `layer` tile in the hive, and the glossary's `clipboard` is a reserved pool
// word the create path refuses. Saying it twice is safe — a tile that stands
// is left as it is and a term that already carries a note is not noted again.

import { EffectBus } from '@hypercomb/core'
import { glossarySlug, matchGlossary, type GlossarySection, type GlossaryTerm } from './glossary.js'

export const GLOSSARY_TILE = 'glossary'

type NoteLike = { readonly text?: string }

export type GlossaryTileDeps = {
  /** The page the participant stands on. */
  segments(): readonly string[]
  /** Make the tile (and every level above it) relative to that page. Rejects when it cannot. */
  create(path: string): Promise<void>
  notesAt(segments: readonly string[]): Promise<readonly NoteLike[]>
  addNote(parent: readonly string[], tile: string, text: string): Promise<void>
}

export type GlossaryTileEntry = {
  readonly path: readonly string[]
  readonly note?: string
  /** The glossary heading a term tile stands for; absent on the glossary and section tiles. */
  readonly term?: string
}

/** A section's tile: its own word, so its notes are never another tile's. */
export const sectionTileName = (section: Pick<GlossarySection, 'title'>): string => `${GLOSSARY_TILE}-${glossarySlug(section.title)}`

/** A term's tile: the term's slug under the glossary's own word. */
export const termTileName = (term: string): string => `${GLOSSARY_TILE}-${glossarySlug(term)}`

/** What a term tile's note says: the term as the glossary writes it, then its definition. */
export const termNote = (term: GlossaryTerm): string => term.definition ? `${term.term}: ${term.definition}` : term.term

/** Every tile to lay, parents before the tiles they hold. Notes are read by
 *  word, so a name is unique across the whole glossary, not only within its
 *  section: two that would come out alike are told apart by a number, in the
 *  glossary's order, so the same glossary always lays the same tiles. */
export const glossaryTilePlan = (sections: readonly GlossarySection[]): GlossaryTileEntry[] => {
  const plan: GlossaryTileEntry[] = [{ path: [GLOSSARY_TILE] }]
  const taken = new Set<string>([GLOSSARY_TILE])
  const own = (name: string): string => {
    let unique = name
    for (let next = 2; taken.has(unique); next++) unique = `${name}-${next}`
    taken.add(unique)
    return unique
  }
  for (const section of sections) {
    const sectionName = own(sectionTileName(section))
    plan.push(section.intro ? { path: [GLOSSARY_TILE, sectionName], note: section.intro } : { path: [GLOSSARY_TILE, sectionName] })
    for (const term of section.terms) {
      plan.push({ path: [GLOSSARY_TILE, sectionName, own(termTileName(term.term))], note: termNote(term), term: term.term })
    }
  }
  return plan
}

export type GlossaryTilesOutcome =
  | { readonly ok: true; readonly made: number; readonly kept: number }
  | { readonly ok: false; readonly reason: 'unloaded' }
  | { readonly ok: false; readonly reason: 'rewound' }
  | { readonly ok: false; readonly reason: 'refused'; readonly path: string; readonly detail: string }
  | { readonly ok: false; readonly reason: 'note'; readonly path: string; readonly detail: string }

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const makeGlossaryTiles = async (sections: readonly GlossarySection[], deps: GlossaryTileDeps | null = liveDeps()): Promise<GlossaryTilesOutcome> => {
  if (!deps) return { ok: false, reason: 'unloaded' }
  const here = [...deps.segments()]
  let made = 0
  let kept = 0
  for (const entry of glossaryTilePlan(sections)) {
    const path = entry.path.join('/')
    try { await deps.create(path) } catch (error) {
      return (error as { name?: unknown } | null)?.name === 'RewoundCommitError'
        ? { ok: false, reason: 'rewound' }
        : { ok: false, reason: 'refused', path, detail: reasonOf(error) }
    }
    if (entry.note === undefined) continue
    const tile = entry.path[entry.path.length - 1]!
    const parent = [...here, ...entry.path.slice(0, -1)]
    try {
      if ((await deps.notesAt([...parent, tile]).catch(() => [])).length) { kept++; continue }
      await deps.addNote(parent, tile, entry.note)
      made++
    } catch (error) { return { ok: false, reason: 'note', path, detail: reasonOf(error) } }
  }
  return { ok: true, made, kept }
}

export type GlossaryAnswer = {
  readonly term: string
  /** `tile` when the term's tile answered (its notes, the participant's own
   *  included); `glossary` when no tile of the term stands where it was looked
   *  for, and the glossary this build ships answered instead. */
  readonly from: 'tile' | 'glossary'
  readonly notes: readonly string[]
  /** Where the answering tile stands, when a tile answered. */
  readonly at?: readonly string[]
}

export type GlossaryReply = {
  readonly answers: readonly GlossaryAnswer[]
  /** When no term is named by the word: the terms whose words hold it. */
  readonly near: readonly string[]
}

/** The places a term's tile may stand, seen from where the participant
 *  stands: laid on this page or on any page above it, nearest first, the
 *  root last. A read writes nothing, so looking costs only the reads. */
export const termTileCandidates = (here: readonly string[], path: readonly string[]): string[][] => {
  const candidates: string[][] = []
  for (let depth = here.length; depth >= 0; depth--) candidates.push([...here.slice(0, depth), ...path])
  return candidates
}

/** A term answered: from its tile when one stands here or above, else from the
 *  glossary itself. Never asks a model. */
export const answerGlossary = async (
  sections: readonly GlossarySection[],
  typed: string,
  deps: GlossaryTileDeps | null = liveDeps(),
): Promise<GlossaryReply> => {
  const match = matchGlossary(sections, typed)
  const plan = glossaryTilePlan(sections)
  const here = deps ? [...deps.segments()] : []
  const answers: GlossaryAnswer[] = []
  for (const term of match.exact) {
    const entry = plan.find(candidate => candidate.term === term.term)!
    let answer: GlossaryAnswer | null = null
    for (const at of deps ? termTileCandidates(here, entry.path) : []) {
      const notes = (await deps!.notesAt(at).catch(() => []))
        .map(note => String(note.text ?? '').trim())
        .filter(Boolean)
      if (notes.length) { answer = { term: term.term, from: 'tile', notes, at }; break }
    }
    answers.push(answer ?? { term: term.term, from: 'glossary', notes: [termNote(term)] })
  }
  return { answers, near: match.near.map(term => term.term) }
}

function liveDeps(): GlossaryTileDeps | null {
  const ioc = window.ioc
  const notes = ioc?.get?.('@diamondcoreprocessor.com/NotesService') as {
    getNotesAtSegments?(segments: readonly string[]): Promise<readonly NoteLike[]>
    addAtSegments?(parent: readonly string[], cell: string, text: string): Promise<void>
  } | undefined
  const lineage = ioc?.get?.('@hypercomb.social/Lineage') as { explorerSegments?(): readonly string[] } | undefined
  if (!notes?.getNotesAtSegments || !notes.addAtSegments) return null
  return {
    segments: () => [...(lineage?.explorerSegments?.() ?? [])],
    create: path => new Promise<void>((resolve, reject) => {
      let accepted = false
      EffectBus.emitTransient('command:create-cells', {
        name: path,
        accept: () => { accepted = true },
        complete: (error?: unknown) => error === undefined ? resolve() : reject(error),
      })
      if (!accepted) reject(new Error('the command line is unavailable'))
    }),
    notesAt: segments => notes.getNotesAtSegments!(segments),
    addNote: (parent, tile, text) => notes.addAtSegments!(parent, tile, text),
  }
}
