// presentation/tiles/layout-creations.ts
//
// THE TWO TYPES OF LAYOUT ASSET.
//
// A PIECE is one of the five built-in primitives — `split`, `rail`, `thirds`,
// `bookends`, `measure`. It is a DIVISION of the panel a container already
// has, with nothing in it; it is drawn one way and turned to the other three,
// and it is what you build OUT OF.
//
// A CREATION is what you built. You plug pieces together in the designer,
// nest them, move the measurements until it reads the way you want, and then
// you drag the whole pane onto the shelf. From that moment it is ONE asset:
// drop it on a hole and the entire arrangement — every level, every
// measurement — lands there in one act. It is fixed in the sense that matters:
// it is a thing now, not a session's worth of gestures. It is not frozen — it
// is still an arrangement, so it can be plugged in and edited like any other,
// and saving the edit is another drag.
//
// ── A CREATION IS A REFERENCE, NEVER A COPY ─────────────────────────────
//
// The pool member holds the ROOT PIECE SIGNATURE and a name. The arrangement
// itself is already content-addressed (layout-piece.ts), so N creations built
// on the same shape are N references to one tree, and dropping a creation into
// twenty containers stores nothing twenty times.
//
// The other half of that is REACHABILITY. Until now an arrangement was
// reachable only through the mark on the container that read it: unplug that
// one container and the design was litter to every collector in this system.
// A pool member naming the root sig is what makes a saved design a thing this
// hive HAS, the same way `backgrounds:screen` makes a backdrop one.
//
// The pool is the truth; the map below is a session-cheap index of it.
//
// ── A GROUP IS A MOLECULE, NOT A FOLDER ─────────────────────────────────
//
// Creations gather into groups, and a group is a WORD. `sign(word)` is its
// address — the same address that word has everywhere else in this hive and on
// every other one — so a group is not a container this shelf invented, it is
// the molecule that word already names. Nothing holds the members: each member
// WEARS the word, and the group is what you get by asking which members wear
// it. Rename a group and you have not moved anything; you have marked the
// members with a different word.
//
// Two consequences, both of them the reason it is done this way:
//   · a member belongs to a group without anything owning it, so a group can
//     be emptied, renamed or abandoned and no member is ever orphaned;
//   · the word is an ADDRESS, so a group named here is the same molecule as a
//     group named on somebody else's hive, and the shelves can be unioned
//     without either side agreeing on anything first.
//
// ORDER RIDES THE MEMBER. A group holds no list — a list would be a second
// truth to keep in step with the set. Each member carries `order`, and the
// shelf sorts by it, so two members can never disagree about which of them
// comes first and a member added by another hive simply sorts by what it says.

import { EffectBus, SignatureService, moleculeAddress } from '@hypercomb/core'
import {
  builtinLayout,
  composeLayout,
  configurationVarsOf,
  miniatureVars,
  nodeOf,
  templateSlug,
  type LayoutNode,
} from './layout-template.js'

/** Sig-named members, one per saved arrangement. Colon-scoped, so it can never
 *  collide with a tile slugged `layouts`. */
export const LAYOUT_CREATIONS_POOL = 'layouts:creations'

export const LAYOUT_CREATION_KIND = 'layout-creation@1'

/** Announced whenever the roster changes, so the designer re-reads rather than
 *  keeping a second list that could drift from this one. */
export const CREATIONS_CHANGED = 'layout:creations-changed'

/** One saved arrangement. */
export interface LayoutCreation {
  /** WHAT THIS CREATION IS, across every rewrite of its record.
   *
   *  The name can change, the group can change, the order can change — each of
   *  those mints a new member — so none of them can be the identity. This is
   *  derived once, from the name it was born with and the moment it was made,
   *  and carried through every rewrite. Concealment keys on it: hide a
   *  creation, rename it, and it is still hidden, because renaming a thing is
   *  not the same act as bringing it back. */
  readonly id: string
  /** What the participant calls it. Slugged, unique within the roster. */
  readonly name: string
  /** Resource sig of the root `layout-piece` record — the whole design. */
  readonly pieceSig: string
  /** The WORD this creation is gathered under, or empty for a loose one. It is
   *  a mark the member wears, never a folder holding it — see the header. */
  readonly group: string
  /** Where it sits among the others wearing the same word. Ties break on `at`,
   *  so a creation that has never been moved still has a stable place. */
  readonly order: number
  /** When it was put on the shelf. Ordering only. */
  readonly at: number
}

/** One group, as a shelf needs it: the word, the address that word derives to,
 *  and how many members wear it. Derived from the members every time — there
 *  is no group record to fall out of step with the set. */
export interface LayoutGroup {
  readonly name: string
  readonly address: string
  readonly count: number
}

const SIG = /^[0-9a-f]{64}$/
const isSignature = (name: string): boolean => SIG.test(String(name ?? '').toLowerCase())

// ── the roster ──────────────────────────────────────────────────────────

/** name → creation. The pool is the truth; this is the read the designer does
 *  on every publish, so it may not be a directory walk. */
const roster = new Map<string, LayoutCreation>()
/** name → the pool member's own file name, so forgetting can remove it. */
const members = new Map<string, string>()

/** Every creation, in shelf order: grouped ones first, in the order the words
 *  were first seen, then the loose ones; within a group, by `order`, and by the
 *  moment it was made where two say the same thing. One comparator, so the
 *  shelf and anything else reading this roster cannot disagree about what
 *  "next" means. */
export const knownCreations = (): readonly LayoutCreation[] => {
  const seen = [...roster.values()]
  const wordAt = new Map<string, number>()
  for (const creation of [...seen].sort((a, b) => a.at - b.at)) {
    if (creation.group && !wordAt.has(creation.group)) wordAt.set(creation.group, wordAt.size)
  }
  const rank = (creation: LayoutCreation): number =>
    creation.group ? (wordAt.get(creation.group) ?? 0) : wordAt.size
  return seen.sort((a, b) =>
    rank(a) - rank(b) || a.order - b.order || a.at - b.at || a.name.localeCompare(b.name))
}

/** The words the shelf is wearing, in the order the shelf shows them. */
export function knownGroups(): readonly LayoutGroup[] {
  const counts = new Map<string, number>()
  for (const creation of knownCreations()) {
    if (creation.group) counts.set(creation.group, (counts.get(creation.group) ?? 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, address: groupAddresses.get(name) ?? '', count }))
}

/** name → `sign(word)`, filled in as the words are seen. The address is what
 *  makes a group the MOLECULE that word names rather than a label this shelf
 *  invented, and it is derived once per word rather than per read. */
const groupAddresses = new Map<string, string>()

const rememberAddress = (word: string): void => {
  if (!word || groupAddresses.has(word)) return
  groupAddresses.set(word, '')
  void moleculeAddress(word)
    .then(address => { groupAddresses.set(word, address); announce() })
    .catch(() => { groupAddresses.delete(word) })
}

export const findCreation = (name: string): LayoutCreation | null =>
  roster.get(templateSlug(name)) ?? null

const announce = (): void => { EffectBus.emit(CREATIONS_CHANGED, { at: Date.now() }) }

/** A name nothing else on the shelf answers to. A creation dropped twice under
 *  the same name would otherwise silently take the first one's place. */
export function freeCreationName(wanted: string): string {
  const base = templateSlug(wanted) || 'layout'
  // The PIECES are named too, and one shelf shows both. A creation called
  // `split` would answer to the name the built-in answers to, and which one a
  // drop meant would depend on lookup order — so it simply never gets it.
  const taken = (name: string): boolean => roster.has(name) || builtinLayout(name) !== null
  if (!taken(base)) return base
  let n = 2
  while (taken(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

// ── the pool ────────────────────────────────────────────────────────────

type DirLike = {
  entries(): AsyncIterable<[string, { kind: string; getFile?: () => Promise<{ size: number; text(): Promise<string> }> }]>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: ArrayBuffer): Promise<void>; close(): Promise<void> }>
  }>
  removeEntry?(name: string): Promise<void>
}

type StoreLike = {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<DirLike | null>
}

const store = (): StoreLike | undefined =>
  window.ioc?.get?.('@hypercomb.social/Store') as StoreLike | undefined

const pool = async (): Promise<DirLike | null> => {
  const held = store()
  if (!held?.getPool) return null
  try { await held.initialize?.() } catch { /* boot handles its own failure */ }
  try { return await held.getPool(LAYOUT_CREATIONS_POOL) } catch { return null }
}

/** The word a creation is gathered under. Folded the way every other word in
 *  this system is folded, so `Site Chrome` and `site-chrome` are one molecule
 *  rather than two groups that look the same on the shelf. */
export const groupWord = (raw: unknown): string => templateSlug(String(raw ?? ''))

/** A creation's identity, derived rather than stored the first time. It is the
 *  name it was BORN with and the moment it was made — neither of which any
 *  later edit can change — so a record written before this field existed
 *  derives the same id it would have been given. */
const identityOf = async (name: string, at: number): Promise<string> => {
  try {
    return await SignatureService.sign(
      new TextEncoder().encode(`layouts:creation:${name}:${at}`).buffer as ArrayBuffer,
    )
  } catch { return '' }
}

const parseCreation = (raw: unknown): LayoutCreation | null => {
  const record = raw as Partial<LayoutCreation> | null
  if (!record || typeof record !== 'object') return null
  const name = templateSlug(String(record.name ?? ''))
  const pieceSig = String(record.pieceSig ?? '').toLowerCase()
  if (!name || !isSignature(pieceSig)) return null
  const group = groupWord(record.group)
  rememberAddress(group)
  return {
    id: isSignature(String(record.id ?? '')) ? String(record.id).toLowerCase() : '',
    name,
    pieceSig,
    group,
    order: Number.isFinite(Number(record.order)) ? Number(record.order) : 0,
    at: Number(record.at) || 0,
  }
}

/** Register everything the local pool holds. Forgiving per member — one
 *  malformed record must not take the shelf down with it. */
export async function sweepCreationPool(): Promise<readonly LayoutCreation[]> {
  const dir = await pool()
  if (!dir) return knownCreations()
  try {
    for await (const [file, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !isSignature(file) || !handle.getFile) continue
      try {
        const held = await handle.getFile()
        if (!held.size) continue
        const parsed = parseCreation(JSON.parse(await held.text()))
        if (!parsed) continue
        // A record written before identities existed derives the one it would
        // have been given. Nothing is rewritten to add it — the derivation is
        // the same every session, so the field is a cache of an answer the
        // name and the timestamp already hold.
        const creation = parsed.id
          ? parsed
          : { ...parsed, id: await identityOf(parsed.name, parsed.at) }
        roster.set(creation.name, creation)
        members.set(creation.name, file)
      } catch (err) {
        console.warn(`[layout-creations] skipping pool member ${file.slice(0, 12)}...:`, err)
      }
    }
  } catch { /* pool unreadable — the shelf is just the pieces */ }
  announce()
  return knownCreations()
}

/**
 * Put an arrangement on the shelf under a name.
 *
 * Registers first and persists second, on the same reasoning as every other
 * pool writer here: a creation that cannot be written is still the thing you
 * just made, and the shelf must show it. A failed write costs the participant
 * the next session, never this gesture.
 */
export async function saveCreation(
  wanted: string,
  pieceSig: string,
  group = '',
): Promise<LayoutCreation | null> {
  const sig = String(pieceSig ?? '').toLowerCase()
  if (!isSignature(sig)) return null
  const name = freeCreationName(wanted)
  const at = Date.now()
  const word = groupWord(group)
  const creation: LayoutCreation = {
    id: await identityOf(name, at),
    name,
    pieceSig: sig,
    group: word,
    // Last in whatever it joined. A new thing arriving at the top would move
    // everything the participant already arranged.
    order: lastOrderIn(word) + 1,
    at,
  }
  rememberAddress(word)
  roster.set(creation.name, creation)
  announce()
  await writeMember(creation)
  return creation
}

/** One past the last order in a group, so a newcomer lands at the end of it. */
const lastOrderIn = (group: string): number =>
  [...roster.values()]
    .filter(creation => creation.group === group)
    .reduce((high, creation) => Math.max(high, creation.order), -1)

/**
 * Put the record in the pool, replacing whatever member held it before.
 *
 * A member is named by its own bytes, so every edit is a REMOVE AND WRITE
 * rather than an edit in place — the same act concealment makes when a state
 * changes. Written second, on the same reasoning as every other pool writer
 * here: the roster already shows what you just did, and a failed write costs
 * the next session, never this gesture.
 */
async function writeMember(creation: LayoutCreation): Promise<void> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ kind: LAYOUT_CREATION_KIND, ...creation }, null, 2),
  ).buffer as ArrayBuffer
  const dir = await pool()
  if (!dir) return
  const was = members.get(creation.name)
  try {
    const file = await SignatureService.sign(bytes)
    const handle = await dir.getFileHandle(file, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
    members.set(creation.name, file)
    // Only once the replacement is safely down. A remove that ran first would
    // lose the creation outright if the write then failed.
    if (was && was !== file) {
      try { await dir.removeEntry?.(was) } catch { /* the new member stands */ }
    }
  } catch (err) {
    console.warn(`[layout-creations] "${creation.name}" is on the shelf but not persisted:`, err)
  }
}

/** The same creation, saying something different. Registers first, writes
 *  second, announces once — every mutator below goes through here, so there is
 *  one place a shelf edit can be wrong. */
async function restate(
  name: string,
  change: (creation: LayoutCreation) => LayoutCreation,
): Promise<LayoutCreation | null> {
  const current = findCreation(name)
  if (!current) return null
  const next = change(current)
  if (next === current) return current
  if (next.name !== current.name) {
    roster.delete(current.name)
    const file = members.get(current.name)
    members.delete(current.name)
    if (file) members.set(next.name, file)
  }
  roster.set(next.name, next)
  rememberAddress(next.group)
  announce()
  await writeMember(next)
  return next
}

/**
 * Call it something else.
 *
 * The ARRANGEMENT is not touched — it is content, addressed by its bytes, and
 * a name was never part of it. This changes what the shelf calls the reference.
 * The IDENTITY does not move, so anything keyed on it — what you have hidden,
 * above all — still means this creation afterwards.
 */
export const renameCreation = (name: string, wanted: string): Promise<LayoutCreation | null> =>
  restate(name, creation => {
    const slug = templateSlug(wanted)
    if (!slug || slug === creation.name) return creation
    // A rename onto a name the shelf already answers to would silently take the
    // other one's place; it gets the free neighbour instead.
    return { ...creation, name: freeCreationName(slug) }
  })

/**
 * Gather it under a word, or set it loose again with an empty one.
 *
 * Nothing is moved and nothing is created: the member wears a different word,
 * and the group is whatever wears it. A word nothing wears any more stops
 * existing, which is correct for a molecule and would be a bug for a folder.
 */
export const groupCreation = (name: string, group: string): Promise<LayoutCreation | null> =>
  restate(name, creation => {
    const word = groupWord(group)
    if (word === creation.group) return creation
    return { ...creation, group: word, order: lastOrderIn(word) + 1 }
  })

/**
 * One place earlier or later among the creations wearing the same word.
 *
 * The pair swap ranks rather than the shelf renumbering, so a move rewrites two
 * members and never all of them.
 */
export async function moveCreation(name: string, by: number): Promise<boolean> {
  const creation = findCreation(name)
  if (!creation || !by) return false
  const peers = knownCreations().filter(other => other.group === creation.group)
  const at = peers.findIndex(other => other.name === creation.name)
  if (at < 0) return false
  const swap = peers[at + (by < 0 ? -1 : 1)]
  if (!swap) return false
  // Two members that have never been moved both say 0, and swapping equal
  // ranks moves nothing. Restating them from their row is the same answer when
  // the ranks differ and the right one when they do not.
  const equal = swap.order === creation.order
  const mine = equal ? at + (by < 0 ? -1 : 1) : swap.order
  const theirs = equal ? at : creation.order
  await restate(creation.name, held => ({ ...held, order: mine }))
  await restate(swap.name, held => ({ ...held, order: theirs }))
  return true
}

/**
 * Take one off the shelf for good.
 *
 * The ARRANGEMENT is not deleted and could not be: it is content, other
 * containers may be reading it, and the whole point of a signature is that
 * nobody owns it. Forgetting removes the name and the shelf's claim on it.
 *
 * IT IS NOT WHAT A LIST OFFERS. Hiding is — a hidden creation is still here and
 * comes back. This is the second act, reached from the delete area, and the
 * shelf never puts it next to anything.
 */
export async function forgetCreation(name: string): Promise<boolean> {
  const slug = templateSlug(name)
  if (!roster.delete(slug)) return false
  announce()
  const file = members.get(slug)
  members.delete(slug)
  if (!file) return true
  try { await (await pool())?.removeEntry?.(file) } catch { /* the roster already forgot it */ }
  return true
}

// ── the picture ─────────────────────────────────────────────────────────

/**
 * A chip-scale drawing of a whole arrangement.
 *
 * EVERY level is redressed at miniature scale, not only the root: a nested
 * rail measured in `14rem` inside a 40px chip IS the chip, and the creation
 * would then advertise a shape it does not make. The drawing comes from the
 * same pure composer as the real container, which is the only thing that makes
 * a chip trustworthy.
 *
 * THE MEASUREMENTS ARE REPLACED, THE CONFIGURATION IS KEPT. They are the two
 * halves of a level's variables and they answer different questions: a measure
 * is a length, and a length that made sense on a page is nonsense in a chip;
 * a configuration is which WAY the container runs, and that is the shape
 * itself. Dropping it drew every turned level as the row it was drawn from —
 * a creation built by turning a `split` on its side advertised a `split`, and
 * two creations that look identical on the shelf plant different designs.
 */
export function creationGlyph(node: LayoutNode): string {
  const shrink = (level: LayoutNode): LayoutNode => nodeOf(
    level.template,
    { ...miniatureVars(level.template), ...configurationVarsOf(level.vars) },
    Object.fromEntries(
      Object.entries(level.nested).map(([key, child]) => [key, shrink(child)]),
    ),
  )
  return composeLayout(shrink(node)).html
}

/**
 * How many holes an arrangement still OFFERS — its own, less the ones a nested
 * level already fills. What is left is what a part can be seated into, which is
 * the only number worth putting on a chip.
 *
 * THE SELF HOLE IS ONLY A PAGE AT THE ROOT, and this walk has to say so.
 * `composeLayout` treats `self` as the container's own page at depth 0 and
 * IGNORES it at every level below — there is one page here and it belongs to
 * the container — so a nested level's self hole is an ordinary seat. Skipping
 * it at every depth undercounted by one for each nested `rail`, `thirds`,
 * `bookends` or `measure`, which is four of the five primitives.
 *
 * The predicate is therefore the exact complement of the one `composeLayout`
 * uses to NOT push a leaf, and the two numbers agree by construction — which
 * is the property the spec pins rather than the arithmetic.
 */
export function openHoles(node: LayoutNode): number {
  let count = 0
  const walk = (level: LayoutNode, depth: number): void => {
    for (const hole of level.template.holes) {
      const child = level.nested[hole.key]
      if (child) walk(child, depth + 1)
      else if (!hole.self || depth > 0) count += 1
    }
  }
  walk(node, 0)
  return count
}
