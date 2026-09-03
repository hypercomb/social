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

import { EffectBus, SignatureService } from '@hypercomb/core'
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
  /** What the participant calls it. Slugged, unique within the roster. */
  readonly name: string
  /** Resource sig of the root `layout-piece` record — the whole design. */
  readonly pieceSig: string
  /** When it was put on the shelf. Ordering only. */
  readonly at: number
}

const SIG = /^[0-9a-f]{64}$/
const isSignature = (name: string): boolean => SIG.test(String(name ?? '').toLowerCase())

// ── the roster ──────────────────────────────────────────────────────────

/** name → creation. The pool is the truth; this is the read the designer does
 *  on every publish, so it may not be a directory walk. */
const roster = new Map<string, LayoutCreation>()
/** name → the pool member's own file name, so forgetting can remove it. */
const members = new Map<string, string>()

export const knownCreations = (): readonly LayoutCreation[] =>
  [...roster.values()].sort((a, b) => a.at - b.at)

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

const parseCreation = (raw: unknown): LayoutCreation | null => {
  const record = raw as Partial<LayoutCreation> | null
  if (!record || typeof record !== 'object') return null
  const name = templateSlug(String(record.name ?? ''))
  const pieceSig = String(record.pieceSig ?? '').toLowerCase()
  if (!name || !isSignature(pieceSig)) return null
  return { name, pieceSig, at: Number(record.at) || 0 }
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
        const creation = parseCreation(JSON.parse(await held.text()))
        if (!creation) continue
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
): Promise<LayoutCreation | null> {
  const sig = String(pieceSig ?? '').toLowerCase()
  if (!isSignature(sig)) return null
  const creation: LayoutCreation = { name: freeCreationName(wanted), pieceSig: sig, at: Date.now() }
  roster.set(creation.name, creation)
  announce()

  const bytes = new TextEncoder().encode(
    JSON.stringify({ kind: LAYOUT_CREATION_KIND, ...creation }, null, 2),
  ).buffer as ArrayBuffer
  const dir = await pool()
  if (!dir) return creation
  try {
    const file = await SignatureService.sign(bytes)
    const handle = await dir.getFileHandle(file, { create: true })
    const writable = await handle.createWritable()
    try { await writable.write(bytes) } finally { await writable.close() }
    members.set(creation.name, file)
  } catch (err) {
    console.warn(`[layout-creations] "${creation.name}" is on the shelf but not persisted:`, err)
  }
  return creation
}

/**
 * Take one off the shelf.
 *
 * The ARRANGEMENT is not deleted and could not be: it is content, other
 * containers may be reading it, and the whole point of a signature is that
 * nobody owns it. Forgetting removes the name and the shelf's claim on it —
 * hide first, delete second.
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
