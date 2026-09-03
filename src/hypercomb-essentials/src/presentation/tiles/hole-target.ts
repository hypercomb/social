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
  /** Which member seats here — the slot index the composer gave it. */
  readonly slot: number
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

/** Every hole a part can be seated into, in slot order.
 *
 *  LEAVES ONLY, and that is not a shortcut. A hole holding a nested level is
 *  filled BY THAT LAYOUT — it is a container, not a slot, it takes no member
 *  and it gets no index. Offering it for naming would advertise an interface
 *  nothing can ever answer.
 *
 *  The walk is `composeLayout`'s own, not a second one written to match it: a
 *  slot index that disagreed with the composer's would name the wrong hole,
 *  and it would do it silently. */
export async function holeTargetsOf(root: LayoutNode): Promise<readonly HoleTarget[]> {
  const out: HoleTarget[] = []
  for (const leaf of composeLayout(root).leaves) {
    const meaning = sanitizeMeaning(leaf.meaning ?? '')
    out.push({
      path: [...leaf.path],
      level: leaf.path.slice(0, -1),
      key: leaf.key,
      slot: leaf.index,
      fill: leaf.fill,
      band: leaf.band === true,
      meaning,
      family: meaning ? familyOfMeaning(meaning) : '',
      name: meaning ? nameOfMeaning(meaning) : '',
      target: meaning ? await safeGroupSignature(meaning) : '',
      artifactKind: artifactKindFor(meaning ? familyOfMeaning(meaning) : DEFAULT_HOLE_FAMILY),
    })
  }
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
  // A hole holding a nested level takes no member, so it can ask for nothing.
  if (node.nested[key]) return root

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
