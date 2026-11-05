// presentation/tiles/hover-animation.ts
//
// WHICH HOVER ANIMATION A TILE WEARS — the reader for the `hover-animation`
// trait (documentation/hover-animation.md, traits.md). Hover is a gesture the
// renderer answers inside a frame, so this is shaped like the quick menu's
// seat reader (quickmenu/quick-menu.traits.ts) with one more constraint: it
// must cost an ordinary tile NOTHING.
//
//   • the sync gate — `wearsHoverTrait` asks the decoration-kind index (O(1),
//     already hydrated for every visible tile) whether the tile opened any
//     trait at all. Almost none do, and for those nothing below ever loads.
//   • the lazy read — a tile that does is resolved once, by the rungs
//     (fill → child → own), and the answer is kept per place until a
//     decoration changes. The trait reader is imported on that first ask only,
//     so it stays off the boot path.
//
// The answer is an EFFECT ID (hover-effects.ts): the word of the tile that
// fills the trait — its name — folded to a look we ship. 0 is "its own
// version", and it is also what a failed read, a name we do not ship and a
// trait nothing fills all answer. A mark may select a look; it never brings one.

import { TRAIT_WANT_KIND, sameTraitWord } from '@hypercomb/core'
import { hasDecorationKindAt } from '../../commands/decoration-kind-index.js'
import { HOVER_ANIMATION_TRAIT, hoverEffectId } from '../grid/hover-effects.js'

const settled = new Map<string, number>()
const asking = new Map<string, Promise<number>>()
/** Bumped by every forget, so an answer that was in flight when a decoration
 *  changed is not kept as if it described the new state. */
let epoch = 0

const keyOf = (segments: readonly string[]): string => segments.join('\0')

/** Does this tile have any trait at all? Cheap enough to ask on every hover. */
export const wearsHoverTrait = (segments: readonly string[]): boolean =>
  hasDecorationKindAt(segments, TRAIT_WANT_KIND)

/** The kept answer, or undefined when this place has not been read yet. */
export const hoverEffectKnown = (segments: readonly string[]): number | undefined =>
  settled.get(keyOf(segments))

/** A decoration changed somewhere: every kept answer is suspect. Cheap — a
 *  handful of tiles ever wear the trait, and a re-read is one hover away. */
export function forgetHoverEffects(): void {
  epoch++
  settled.clear()
  asking.clear()
}

type HistoryLike = { getLayerBySig?: (sig: string) => Promise<{ name?: string } | null> }

async function ask(segments: readonly string[]): Promise<number> {
  const { resolveTraitsAt, childNamesAt } = await import('../../commands/trait-read.js')
  const mine = (await resolveTraitsAt(segments)).find(r => sameTraitWord(r.word, HOVER_ANIMATION_TRAIT))
  if (!mine) return 0
  if (mine.rung === 'fill') {
    // The filler is the tile whose head is `sig`: its NAME picks the look.
    const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
    return hoverEffectId((await history?.getLayerBySig?.(mine.sig))?.name)
  }
  if (mine.rung === 'child') {
    // The tile made a child called `hover-animation`; the look is the first of
    // ITS children that names one we ship.
    for (const name of await childNamesAt(mine.route)) {
      const id = hoverEffectId(name)
      if (id !== 0) return id
    }
  }
  return 0
}

/** Resolve (once per place, until something changes) which look the tile at
 *  `segments` wears. Never rejects: a failed read is its own version. */
export function readHoverEffect(segments: readonly string[]): Promise<number> {
  const key = keyOf(segments)
  const hit = settled.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  const pending = asking.get(key)
  if (pending) return pending
  const born = epoch
  const next = ask(segments)
    .catch(() => 0)
    .then(id => {
      if (born === epoch) { settled.set(key, id); asking.delete(key) }
      return id
    })
  asking.set(key, next)
  return next
}
