// presentation/tiles/hole-target.ts
//
// NAMING A HOLE — the other half of a layout, and the half a shape cannot
// state on its own.
//
// `layout-template.ts` gives a hole a KEY (`left`, `top`) and a SHARE of the
// axis. That is enough to draw the arrangement and not enough to publish it:
// a key is a position, and a position tells a stranger nothing about what
// belongs there. `LayoutHole.meaning` is the field that does — a conventional
// name like `site:masthead` — and `meaning-target.ts` turns it into a group
// signature that anybody's artifact can answer.
//
// Nothing has ever written that field. The built-ins ship what they ship and a
// participant could not name a hole at all. This module is the write, and the
// read that makes it worth doing: what a hole ASKS FOR, and what is currently
// ANSWERING it.
//
// ── NAMING A HOLE MAKES A NEW LAYOUT ────────────────────────────────────
//
// A template is a SHARED artifact — N containers reading it are N references
// to one record, which is the whole reason it exists. So a hole's meaning
// cannot be edited in place: that would rename a hole in every container on
// that layout, most of which belong to somebody else and none of which asked.
//
// Naming a hole therefore MINTS A VARIANT and re-points this level at it, the
// same merkle update as moving a measurement: the level re-mints, the chain
// above it re-mints, everything untouched keeps the signature it had, and the
// layout the variant was made from is not altered by a single byte.
//
// The variant is NAMED AFTER THE INTERFACE IT DECLARES — `split` with its
// holes named in the `site` family is `split-site`. The name is a label; the
// SIGNATURE is the identity, exactly as everywhere else here, so two people
// who name holes differently and land on the same label still hold two
// different layouts and neither can shadow the other.
//
// ── WHAT ANSWERS A HOLE COMES FROM THE OTHER SIDE ───────────────────────
//
// A hole names nobody. Two different things fill one:
//
//   • the SEATING — a member of this container's division group whose
//     enrolment order is this hole's slot index (division-render.ts). That is
//     a fact about THIS container and its children.
//   • the INTERFACE — any artifact anywhere declaring the same meaning. That
//     is an invitation, and it is what lets somebody else's artifact land in a
//     layout they have never seen.
//
// Both are reported. Confusing them is the mistake this file exists to avoid:
// the first says what IS there, the second says what COULD be.

import { groupSignature } from '@hypercomb/core'
import {
  artifactKindFor,
  familyOfMeaning,
  nameOfMeaning,
  relationMeaning,
  siteSlug,
  SITE_FAMILY,
} from '../../pheromones/enrollment.js'
import {
  composeLayout,
  nodeAt,
  sanitizeMeaning,
  templateSlug,
  type LayoutHole,
  type LayoutNode,
  type LayoutTemplate,
  type LeafHole,
} from './layout-template.js'

/** The family a hole is named in when nothing else is said. A website is the
 *  general "this names a set" artifact — see SITE_FAMILY. */
export const DEFAULT_HOLE_FAMILY = SITE_FAMILY

/** One hole, as the targets window needs it. */
export interface HoleTarget {
  /** Full path from the root: `left/top`. Selection is by this. */
  readonly path: readonly string[]
  /** The level this hole belongs to — `path` less its last segment. */
  readonly level: readonly string[]
  /** The hole's own key within that level. */
  readonly key: string
  /** Which member seats here — the slot index the composer gave it. A SECTION
   *  has none and says -1: it is filled by the layout nested in it, not by a
   *  member, so it is not a seating position at all. */
  readonly slot: number
  /** A layout is nested in this hole.
   *
   *  It takes no member and it never will, and for a long time that was read as
   *  "so it cannot be named". That is true of a SEAT and false of a NAME: in a
   *  hive the section is the tile the things under it hang from, so a design
   *  whose sections are unnamed can only ever grow one flat row of children.
   *  A named section is a parent; a named leaf is a child; an unnamed section
   *  is transparent and its children hang from whatever is above it. */
  readonly section: boolean
  /** How deep this hole sits — 0 on the root's own template. The window indents
   *  by it, so the list reads as the tree it is. */
  readonly depth: number
  readonly fill: 'fixed' | 'fluid'
  readonly band: boolean
  /** `site:masthead`, or empty when this hole has not been named. */
  readonly meaning: string
  /** `site` / `masthead`, split for the editor. Empty when unnamed. */
  readonly family: string
  readonly name: string
  /** The group signature the composer writes as `data-hc-target`. Empty when
   *  the hole is unnamed — an unnamed hole advertises nothing. */
  readonly target: string
  /** What an artifact must wear to be this kind of thing at all. Guidance, not
   *  enforcement: the hole accepts whatever declares its meaning. */
  readonly artifactKind: string
}

/** EVERY hole in the arrangement, in document order — sections and seats alike.
 *
 *  It was leaves only, and the reasoning was sound as far as it went: a hole
 *  holding a nested level takes no member, so offering it a slot would be
 *  offering a seat nothing can sit in. But a name is not a seat. A design is a
 *  TREE, and the tree is what a hive is grown from: the sections are its
 *  branches and the leaves are what hangs off them. Withholding the name from
 *  the branches meant every hive a layout could grow was one row deep.
 *
 *  So both are here, a section carrying `slot: -1` so the distinction survives
 *  and nothing can mistake one for a seating position.
 *
 *  THE SLOTS STILL COME FROM `composeLayout`. The walk below is the tree's, but
 *  a leaf's index is looked up from the composer's own numbering rather than
 *  counted again here: an index that disagreed with the composer's would name
 *  the wrong hole, and it would do it silently. */
export async function holeTargetsOf(root: LayoutNode): Promise<readonly HoleTarget[]> {
  const out: HoleTarget[] = []
  const slots = new Map<string, LeafHole>()
  for (const leaf of composeLayout(root).leaves) slots.set(leaf.path.join('/'), leaf)

  interface Raw {
    path: string[]
    key: string
    slot: number
    section: boolean
    depth: number
    fill: 'fixed' | 'fluid'
    band: boolean
    meaning: string
  }
  const raw: Raw[] = []
  const walk = (node: LayoutNode, path: readonly string[], depth: number): void => {
    for (const hole of node.template.holes) {
      const here = [...path, hole.key]
      const child = node.nested[hole.key]
      const leaf = slots.get(here.join('/'))
      // The root's own page is not a hole anybody names: it is where the
      // container's own content goes, and `composeLayout` gives it no slot.
      if (!child && !leaf) continue
      raw.push({
        path: here,
        key: hole.key,
        slot: leaf?.index ?? -1,
        section: !!child,
        depth,
        fill: hole.fill,
        band: hole.band === true,
        meaning: sanitizeMeaning(hole.meaning ?? ''),
      })
      if (child) walk(child, here, depth + 1)
    }
  }
  walk(root, [], 0)

  for (const hole of raw) {
    const meaning = hole.meaning
    out.push({
      path: [...hole.path],
      level: hole.path.slice(0, -1),
      key: hole.key,
      slot: hole.slot,
      section: hole.section,
      depth: hole.depth,
      fill: hole.fill,
      band: hole.band,
      meaning,
      family: meaning ? familyOfMeaning(meaning) : '',
      name: meaning ? nameOfMeaning(meaning) : '',
      target: meaning ? await safeGroupSignature(meaning) : '',
      artifactKind: artifactKindFor(meaning ? familyOfMeaning(meaning) : DEFAULT_HOLE_FAMILY),
    })
  }
  return out
}

/**
 * THE HIVE THIS DESIGN IS ASKING FOR — every named hole as a tile path, in the
 * order the design reads.
 *
 * This is the whole point of naming a section. A named section is a TILE and
 * the things below it hang from it; a named leaf is a tile at whatever level it
 * finds itself; an UNNAMED section is transparent — it is an arrangement
 * decision, not a place, so its named children attach to the nearest named
 * ancestor rather than to a tile nobody asked for.
 *
 * Pure. It says what the hive would be, and nothing here creates anything: what
 * that costs, and whether any of it is already there, is decided by the caller.
 */
export function hiveOutline(root: LayoutNode): readonly (readonly string[])[] {
  const out: string[][] = []
  const walk = (node: LayoutNode, trail: readonly string[], depth: number): void => {
    if (depth > 16) return
    for (const hole of node.template.holes) {
      const meaning = sanitizeMeaning(hole.meaning ?? '')
      const name = meaning ? nameOfMeaning(meaning) : ''
      const child = node.nested[hole.key]
      // A hole that is neither named nor holding anything named contributes
      // nothing — a design half-named grows the half that was named.
      // The root's own page is not a child of itself. Below the root a self
      // hole is an ordinary seat, which is composeLayout's own rule.
      const own = depth === 0 && hole.self === true && !child
      const here = name && !own ? [...trail, name] : [...trail]
      if (name && !own) out.push(here)
      if (child) walk(child, here, depth + 1)
    }
  }
  walk(root, [], 0)
  return out
}

/** A name that will not hash is a name nobody can answer. The hole keeps its
 *  meaning and gets no target — the same degradation meaning-target.ts makes,
 *  for the same reason. */
async function safeGroupSignature(meaning: string): Promise<string> {
  try { return await groupSignature(meaning) } catch { return '' }
}

// ── the write ───────────────────────────────────────────────────────────

/**
 * The arrangement with the hole at `path` asking for `meaning` — or, with an
 * empty meaning, asking for nothing again.
 *
 * Pure tree surgery, like `withNodeAt` and `withVarAt`: no store, no
 * signatures, no IoC. What it costs to keep is decided afterwards by
 * layout-piece.ts walking the result, which keeps "what the participant just
 * did" and "what that costs" in separate functions that can each be wrong on
 * their own.
 *
 * A path naming a hole that is not there is refused rather than invented — you
 * cannot name a hole that is not on the screen.
 */
export function withMeaningAt(
  root: LayoutNode,
  path: readonly string[],
  meaning: string,
): LayoutNode {
  if (path.length === 0) return root
  const level = path.slice(0, -1)
  const key = path[path.length - 1]
  const node = nodeAt(root, level)
  if (!node || !node.template.holes.some(hole => hole.key === key)) return root
  // A hole holding a nested level takes no MEMBER. It is still named: it is the
  // section, and in a hive the section is the tile everything under it hangs
  // from. See holeTargetsOf.

  const clean = sanitizeMeaning(meaning)
  const holes: LayoutHole[] = node.template.holes.map((hole): LayoutHole => {
    if (hole.key !== key) return hole
    // The field is DROPPED, not emptied: `{ meaning: '' }` would survive the
    // round trip as a hole that asks for nothing by name, which is not the
    // same record as a hole that was never named.
    const { meaning: _dropped, ...rest } = hole
    return clean ? { ...rest, meaning: clean } : rest
  })
  // Nothing actually moved — do not re-mint a level and every level above it
  // to store the arrangement that is already stored.
  if (holes.every((hole, at) => hole.meaning === node.template.holes[at]?.meaning)) return root

  const variant: LayoutTemplate = {
    ...node.template,
    name: interfaceName(node.template.name, holes, node.template.holes),
    holes,
  }
  return replaceLevel(root, level, { ...node, template: variant })
}

/** The same level, put back where it came from. */
function replaceLevel(
  root: LayoutNode,
  level: readonly string[],
  next: LayoutNode,
): LayoutNode {
  if (level.length === 0) return next
  const [head, ...rest] = level
  const existing = root.nested[head]
  if (!existing) return root
  return { ...root, nested: { ...root.nested, [head]: replaceLevel(existing, rest, next) } }
}

/**
 * What to call a layout whose holes have been named.
 *
 * A variant is named after the INTERFACE it declares, because that is what
 * distinguishes it from the shape it was made from — `split` whose holes are
 * named in the `site` family is `split-site`. Holes named across several
 * families make it `<base>-interface`: a layout serving two audiences has no
 * one family to be named for, and picking the alphabetically-first would be an
 * arbitrary answer dressed as a considered one.
 *
 * `was` is the hole set BEFORE this edit, and it is what makes the name stable
 * under repeated naming: the suffix this function last added is stripped from
 * the stem before a new one goes on, so a third hole named in the same family
 * gives `split-site` again rather than `split-site-site`, and unnaming the last
 * one gives `split` back.
 *
 * It only ever strips a suffix IT COULD HAVE WRITTEN — `interface`, or a family
 * the layout was actually declaring a moment ago. A built-in whose own name
 * ends in a word (`two-thirds`) is never quietly shortened to `two`, because
 * nothing here ever named a `thirds` family.
 */
export function interfaceName(
  base: string,
  holes: readonly { readonly meaning?: string }[],
  was: readonly { readonly meaning?: string }[] = [],
): string {
  const stem = baseName(base, familiesOf(was))
  const families = familiesOf(holes)
  if (families.size === 0) return stem
  if (families.size === 1) return templateSlug(`${stem}-${[...families][0]}`)
  return templateSlug(`${stem}-interface`)
}

const familiesOf = (holes: readonly { readonly meaning?: string }[]): Set<string> =>
  new Set(holes.map(hole => familyOfMeaning(String(hole.meaning ?? ''))).filter(Boolean))

/** The stem a variant was made from. */
function baseName(name: string, wore: ReadonlySet<string>): string {
  const slug = templateSlug(name)
  const at = slug.lastIndexOf('-')
  if (at <= 0) return slug
  const suffix = slug.slice(at + 1)
  if (suffix !== 'interface' && !wore.has(suffix)) return slug
  return slug.slice(0, at) || slug
}

/** `site` + `masthead` → `site:masthead`, folded exactly the way every other
 *  meaning in this system is folded, so two people who type it differently
 *  still name the same interface. */
export const holeMeaning = (family: string, name: string): string =>
  relationMeaning(siteSlug(family) || DEFAULT_HOLE_FAMILY, name)
