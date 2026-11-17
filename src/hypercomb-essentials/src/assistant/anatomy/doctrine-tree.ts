// assistant/anatomy/doctrine-tree.ts
//
// THE DOCTRINE IS A HIERARCHY OF TILES (jwize, 2026-11-16: "The doctrine is a
// hierarchy of tiles like everything else"). The hive's root holds a
// `doctrine` tile; inside it, one tile per tier, whose note is the tier's
// codex header line (`@3 History ~…`); inside each tier, one tile per rule,
// whose note is the rule's codex line (`H2<H1: …`). Read in order, those lines
// ARE the codex: this module reads them back, and the anatomy is composed from
// what it reads. Nothing else holds the doctrine — not the build, not a bag.
//
// Because it is tiles, everything tiles do the doctrine does: it is published
// and adopted as a branch (replication from a host), a rule changes by editing
// its note, a rule leaves by removing its tile, and the tile's own history is
// the doctrine's history.
//
// READ BY EACH TILE'S OWN HEAD (2026-11-16). History is committed per page:
// a change commits only the tile it touched, and a parent's stored child
// signature is a hint that can lag (layer-committer.drone.ts, "LEAF ONLY. No
// cascade"). So no one signature names the whole doctrine. The walk takes
// each tile's NAME from its parent and its truth from its own current head —
// the way the hive tree reader reads every route — and the doctrine is named
// by its HEAD VECTOR: the signature of every doctrine tile's route and head
// layer signature, in a fixed order. The codex is a pure function of those
// heads (notes come from each head layer's own `notes` slot, which travels
// with the layer; a word's notes facet, which can hold other authors' notes,
// is a replica's memory and never read here: M2), so the record
// doctrine-record.ts keeps under that vector can never go stale.
//
// Order is read from the lines, never from where a tile sits: tiers by their
// `@n`, rules by their id's number. The codex is then held to the build's own
// rule (validateCodex): an axiom cites only what came before. A tree that
// breaks it carries NO doctrine, and so does a tree with a tile this device
// does not hold — a model is never taught a partial or disordered doctrine.
// Pure and injected, so a spec hands it a tree.

import { parseCodex, validateCodex, type CodexTier } from './codex.js'

export const DOCTRINE_ROOT: readonly string[] = ['doctrine']

const TIER_LINE = /^@\d+ \S/
const AXIOM_LINE = /^[A-Z]\d+(?:<[A-Z]\d+(?:,[A-Z]\d+)*)?: \S/

/** One tile's current head: its layer signature and its children's names. */
export type DoctrineHead = {
  readonly layerSig: string
  readonly children: readonly string[]
  /** False when a child is named but its head is not on this device. */
  readonly complete: boolean
}

/** The texts of the notes a head layer's own `notes` slot holds. */
export type DoctrineNotes = { readonly notes: readonly string[]; readonly complete: boolean }

export type DoctrineTreeIo = {
  /** The current head of the tile at this route, or null when there is none. */
  head(path: readonly string[]): Promise<DoctrineHead | null>
  /** The notes the layer with this signature holds, or null when it is not held. */
  notes(layerSig: string): Promise<DoctrineNotes | null>
}

export type DoctrineTreeRead =
  | { readonly ok: true; readonly codex: string; readonly tiers: readonly CodexTier[] }
  | { readonly ok: false; readonly reason: 'absent' }
  | { readonly ok: false; readonly reason: 'broken'; readonly problems: readonly string[] }

/** Every doctrine tile's head, root first, tiers then rules in walk order. */
export type DoctrineWalk = {
  readonly ok: true
  readonly tiles: readonly { readonly path: readonly string[]; readonly layerSig: string }[]
  /** The bytes the head vector is signed from: one `route\tlayerSig` line per
   *  tile, sorted by route, so the same heads always give the same name. */
  readonly vector: string
}

const INCOMPLETE = 'a doctrine tile is named but not on this device; adopt the doctrine branch again to fetch it'

/** Walk the doctrine's routes to their heads. Nothing about notes yet: the
 *  head vector alone says whether a recorded codex is still this doctrine. */
export const walkDoctrine = async (io: DoctrineTreeIo, root: readonly string[] = DOCTRINE_ROOT): Promise<DoctrineWalk | Exclude<DoctrineTreeRead, { ok: true }>> => {
  const top = await io.head(root)
  if (!top) return { ok: false, reason: 'absent' }
  let complete = top.complete
  const tiles: { path: readonly string[]; layerSig: string }[] = [{ path: root, layerSig: top.layerSig }]
  for (const tierName of top.children) {
    const tierPath = [...root, tierName]
    const tier = await io.head(tierPath)
    if (!tier) { complete = false; continue }
    complete &&= tier.complete
    tiles.push({ path: tierPath, layerSig: tier.layerSig })
    for (const ruleName of tier.children) {
      const rulePath = [...tierPath, ruleName]
      const rule = await io.head(rulePath)
      if (!rule) { complete = false; continue }
      complete &&= rule.complete
      tiles.push({ path: rulePath, layerSig: rule.layerSig })
    }
  }
  if (!complete) return { ok: false, reason: 'broken', problems: [INCOMPLETE] }
  const vector = tiles.map(tile => `${tile.path.join('/')}\t${tile.layerSig}`).sort().join('\n')
  return { ok: true, tiles, vector }
}

/** The first note line that is a codex line of this kind. */
const lineIn = (notes: readonly string[], shape: RegExp): string | undefined => {
  for (const note of notes) for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim()
    if (shape.test(line)) return line
  }
  return undefined
}

const tierIndex = (line: string): number => Number(/^@(\d+)/.exec(line)?.[1] ?? NaN)
const axiomNumber = (line: string): number => Number(/^[A-Z](\d+)/.exec(line)?.[1] ?? NaN)

/** The codex the walked heads hold. A tier tile with no header note, or a
 *  rule tile with no rule note, is not part of the doctrine (a tile someone
 *  added to read, a rule being written); a tier with no rule left is reported
 *  by the order check like any codex. */
export const readDoctrineNotes = async (io: DoctrineTreeIo, walk: DoctrineWalk): Promise<DoctrineTreeRead> => {
  const depth = walk.tiles[0]!.path.length
  const tiers = new Map<string, { header: string; rules: string[] }>()
  for (const tile of walk.tiles) {
    if (tile.path.length === depth) continue
    const held = await io.notes(tile.layerSig)
    if (!held || !held.complete) return { ok: false, reason: 'broken', problems: [INCOMPLETE] }
    const tierKey = tile.path.slice(0, depth + 1).join('/')
    if (tile.path.length === depth + 1) {
      const header = lineIn(held.notes, TIER_LINE)
      if (header) tiers.set(tierKey, { header, rules: [] })
      continue
    }
    const line = lineIn(held.notes, AXIOM_LINE)
    if (line) tiers.get(tierKey)?.rules.push(line)
  }
  if (!tiers.size) return { ok: false, reason: 'absent' }
  const ordered = [...tiers.values()].sort((a, b) => tierIndex(a.header) - tierIndex(b.header))
  for (const tier of ordered) tier.rules.sort((a, b) => axiomNumber(a) - axiomNumber(b))
  return fromCodex(ordered.flatMap(tier => [tier.header, ...tier.rules]).join('\n') + '\n')
}

/** Walk and read in one go (no record consulted). */
export const readDoctrineTree = async (io: DoctrineTreeIo, root: readonly string[] = DOCTRINE_ROOT): Promise<DoctrineTreeRead> => {
  const walk = await walkDoctrine(io, root)
  return walk.ok ? readDoctrineNotes(io, walk) : walk
}

/** A codex text as the doctrine: parsed and held to the order rule. The tile
 *  read ends here, and so does a read of the recorded codex. */
export const fromCodex = (codex: string): DoctrineTreeRead => {
  const parsed = parseCodex(codex)
  if (!parsed.length) return { ok: false, reason: 'absent' }
  // The documents a tier names live in the repo, not the hive: the hive holds
  // the rule, the repo the argument. Only the order is the hive's to keep.
  const problems = validateCodex(parsed, () => true)
  return problems.length ? { ok: false, reason: 'broken', problems } : { ok: true, codex, tiers: parsed }
}
