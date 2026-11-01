// assistant/doctrine-tiles.ts
//
// THE DOCTRINE AS TILES, to read. `doctrine tiles` lays the codex out on the
// page the participant stands on: a `doctrine` tile, one tile per tier inside
// it, and one tile per rule inside its tier, the rule's text as its note. It is
// a way to BROWSE the rules with the hive's own gestures — open one, read it,
// follow what it rests on — not a second source: what every model is sent is
// still the doctrine bag, chosen in the viewer.
//
// A tile's NOTES are read by its word, so every name here is made to be its
// own: tiers are `doctrine-<tier>` and a rule is named from its own opening
// words, never a bare common word that another tile of the hive might share.
// Saying it twice is safe — a tile that stands is left as it is and a rule that
// already carries its note is not noted again.

import { EffectBus } from '@hypercomb/core'
import type { CodexTier } from './anatomy/codex.js'

export const DOCTRINE_TILE = 'doctrine'
const RULE_WORDS = 6

type NoteLike = { readonly text?: string }

export type DoctrineTileDeps = {
  /** The page the participant stands on. */
  segments(): readonly string[]
  /** Make the tile (and every level above it) relative to that page. Rejects when it cannot. */
  create(path: string): Promise<void>
  notesAt(segments: readonly string[]): Promise<readonly NoteLike[]>
  addNote(parent: readonly string[], tile: string, text: string): Promise<void>
}

export type DoctrineTileEntry = { readonly path: readonly string[]; readonly note?: string }

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** A tier's tile: its own word, so its notes are never another tile's. */
export const tierTileName = (tier: CodexTier): string => `${DOCTRINE_TILE}-${words(tier.title).join('-')}`

/** A rule's tile, named from how the rule opens. */
export const ruleTileName = (rule: string): string => words(rule).slice(0, RULE_WORDS).join('-')

/** Every tile to lay, parents before the tiles they hold. Two rules that open
 *  alike are told apart by their id, which is already unique. */
export const doctrineTilePlan = (tiers: readonly CodexTier[]): DoctrineTileEntry[] => {
  const plan: DoctrineTileEntry[] = [{ path: [DOCTRINE_TILE] }]
  const taken = new Set<string>()
  for (const tier of tiers) {
    const tierName = tierTileName(tier)
    plan.push({ path: [DOCTRINE_TILE, tierName] })
    for (const axiom of tier.axioms) {
      const opening = ruleTileName(axiom.rule)
      const name = taken.has(`${tierName}/${opening}`) ? `${opening}-${axiom.id.toLowerCase()}` : opening
      taken.add(`${tierName}/${name}`)
      const rests = axiom.needs.length ? `\nRests on ${axiom.needs.join(', ')}.` : ''
      plan.push({ path: [DOCTRINE_TILE, tierName, name], note: `${axiom.id}: ${axiom.rule}${rests}` })
    }
  }
  return plan
}

export type DoctrineTilesOutcome =
  | { readonly ok: true; readonly made: number; readonly kept: number }
  | { readonly ok: false; readonly error: string }

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const makeDoctrineTiles = async (tiers: readonly CodexTier[], deps: DoctrineTileDeps | null = liveDeps()): Promise<DoctrineTilesOutcome> => {
  if (!deps) return { ok: false, error: 'the notes are not loaded' }
  const here = [...deps.segments()]
  let made = 0
  let kept = 0
  for (const entry of doctrineTilePlan(tiers)) {
    try { await deps.create(entry.path.join('/')) } catch (error) {
      return { ok: false, error: (error as { name?: unknown } | null)?.name === 'RewoundCommitError'
        ? 'you are viewing the past, so nothing can be written; step forward, then say doctrine tiles again'
        : `the tile ${entry.path.join('/')} could not be made (${reasonOf(error)})` }
    }
    if (entry.note === undefined) continue
    const tile = entry.path[entry.path.length - 1]!
    const parent = [...here, ...entry.path.slice(0, -1)]
    try {
      if ((await deps.notesAt([...parent, tile]).catch(() => [])).length) { kept++; continue }
      await deps.addNote(parent, tile, entry.note)
      made++
    } catch (error) { return { ok: false, error: reasonOf(error) } }
  }
  return { ok: true, made, kept }
}

function liveDeps(): DoctrineTileDeps | null {
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
