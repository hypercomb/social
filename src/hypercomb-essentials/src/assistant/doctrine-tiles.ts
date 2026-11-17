// assistant/doctrine-tiles.ts
//
// THE DOCTRINE IS TILES (jwize, 2026-11-16: "The doctrine is a hierarchy of
// tiles like everything else"). `doctrine tiles` lays a codex out at the hive's
// root: a `doctrine` tile, one tile per tier inside it whose note is the tier's
// header line, and one tile per rule inside its tier whose note is the rule's
// codex line. Those notes are what every model is taught from
// (anatomy/doctrine-tree.ts reads them back into a codex), so each note is the
// line EXACTLY — the codex can always be rebuilt from the tiles.
//
// The codex laid here is the build's copy, and laying it is the participant's
// word: the other way a hive gets its doctrine is adopting a host's `doctrine`
// branch, like any branch.
//
// A tile's NOTES are read by its word, so every name here is made to be its
// own: tiers are `doctrine-<tier>` and a rule is named from its own opening
// words, never a bare common word that another tile of the hive might share.
//
// SAYING IT AGAIN ADDS ONLY WHAT IS MISSING (2026-11-17). The plan is laid
// against what the doctrine tiles hold now, by TIER NUMBER and RULE ID, never
// by a tile's name: a rule this hive already holds is left exactly as it reads
// here (the hive's wording wins over the package's), and a rule the package
// added since is laid into the tier that carries its number. So a package
// update's new rules reach an existing doctrine by this word, and saying it
// can never give the tree one id twice — which the order rule would refuse,
// leaving the hive with no doctrine at all.

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

/** A doctrine tile as the hive holds it now, and the codex line its note carries. */
export type DoctrineHeldLine = { readonly path: readonly string[]; readonly kind: 'tier' | 'rule'; readonly line: string }

const tierNumber = (line: string): string => /^@(\d+)/.exec(line)?.[1] ?? ''
const ruleId = (line: string): string => /^[A-Z]\d+/.exec(line)?.[0] ?? ''

export type DoctrineReconcile = {
  /** Every tile still to lay, parents before the tiles they hold. */
  readonly plan: DoctrineTileEntry[]
  /** Lines the hive already holds (by tier number or rule id), left as they are. */
  readonly held: number
  /** Of those, the ones that read differently here than in the codex laid. */
  readonly differs: readonly string[]
  /** The rules the codex has and the hive does not, by id. */
  readonly missing: readonly string[]
}

/** The codex against what the doctrine tiles hold now. A tier the hive holds
 *  keeps its own tile, whatever it is named; a rule the hive holds is not
 *  laid. Two new rules that open alike, or a new rule whose opening names a
 *  tile that already stands, are told apart by their id, which is unique. */
export const reconcileDoctrine = (tiers: readonly CodexTier[], heldLines: readonly DoctrineHeldLine[] = []): DoctrineReconcile => {
  const tierTile = new Map<string, DoctrineHeldLine>()
  const rules = new Map<string, DoctrineHeldLine>()
  const taken = new Set<string>()
  for (const held of heldLines) {
    taken.add(held.path.slice(1).join('/'))
    if (held.kind === 'tier') { if (!tierTile.has(tierNumber(held.line))) tierTile.set(tierNumber(held.line), held) }
    else if (!rules.has(ruleId(held.line))) rules.set(ruleId(held.line), held)
  }
  const plan: DoctrineTileEntry[] = [{ path: [DOCTRINE_TILE] }]
  const differs: string[] = []
  const missing: string[] = []
  let held = 0
  for (const tier of tiers) {
    const standing = tierTile.get(String(tier.index))
    const tierName = standing ? standing.path[standing.path.length - 1]! : tierTileName(tier)
    if (standing) { held++; if (standing.line !== tier.line) differs.push(`@${tier.index}`) }
    else plan.push({ path: [DOCTRINE_TILE, tierName], note: tier.line })
    for (const axiom of tier.axioms) {
      const has = rules.get(axiom.id)
      if (has) { held++; if (has.line !== axiom.line) differs.push(axiom.id); continue }
      missing.push(axiom.id)
      const opening = ruleTileName(axiom.rule)
      const name = taken.has(`${tierName}/${opening}`) ? `${opening}-${axiom.id.toLowerCase()}` : opening
      taken.add(`${tierName}/${name}`)
      plan.push({ path: [DOCTRINE_TILE, tierName, name], note: axiom.line })
    }
  }
  return { plan, held, differs, missing }
}

/** Every tile to lay in a hive that holds no doctrine yet. */
export const doctrineTilePlan = (tiers: readonly CodexTier[]): DoctrineTileEntry[] => reconcileDoctrine(tiers).plan

export type DoctrineTilesOutcome =
  | { readonly ok: true; readonly made: number; readonly kept: number; readonly differs: readonly string[] }
  | { readonly ok: false; readonly error: string }

const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const makeDoctrineTiles = async (tiers: readonly CodexTier[], deps: DoctrineTileDeps | null = liveDeps(), heldLines: readonly DoctrineHeldLine[] = []): Promise<DoctrineTilesOutcome> => {
  if (!deps) return { ok: false, error: 'the notes are not loaded' }
  const here = [...deps.segments()]
  // The doctrine is read at the hive's root, so it is laid there and nowhere else.
  if (here.length) return { ok: false, error: 'the doctrine lives at the root of the hive: go to the root, then say doctrine tiles again' }
  const reconciled = reconcileDoctrine(tiers, heldLines)
  let made = 0
  let kept = reconciled.held
  for (const entry of reconciled.plan) {
    try { await deps.create(entry.path.join('/')) } catch (error) {
      return { ok: false, error: (error as { name?: unknown } | null)?.name === 'RewoundCommitError'
        ? 'you are viewing the past, so nothing can be written; step forward, then say doctrine tiles again'
        : `the tile ${entry.path.join('/')} could not be made (${reasonOf(error)})` }
    }
    if (entry.note === undefined) continue
    const tile = entry.path[entry.path.length - 1]!
    const parent = entry.path.slice(0, -1)
    try {
      // A tile that already says this line is left alone. One that stands
      // with other notes (a rule being written) is given the line too: the
      // doctrine reads the first codex line a tile holds.
      const standing = await deps.notesAt([...parent, tile]).catch(() => [] as readonly NoteLike[])
      if (standing.some(note => (note.text ?? '').split(/\r?\n/).some(line => line.trim() === entry.note))) { kept++; continue }
      await deps.addNote(parent, tile, entry.note)
      made++
    } catch (error) { return { ok: false, error: reasonOf(error) } }
  }
  return { ok: true, made, kept, differs: reconciled.differs }
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
