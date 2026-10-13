// presentation/tiles/trait-silhouette.ts
//
// WHERE AN OPEN TRAIT IS DRAWN (documentation/traits.md, "Empty traits are silhouettes").
//
// A trait names the next layer. Until a child by that name exists, the level shows a hexagon
// silhouette where that child would sit: the outline of a tile that is not there yet, labelled with
// the word. A silhouette is never a tile: it is not in the cell list, has no signature, holds nothing.
//
// Pure: which traits are open, and which free slots of the spiral they take.

import { sameWord } from '../../commands/trait.js'

// The tiles barrel re-exports every module here, so a second Axial declaration is an ambiguous export.
import type { Axial } from './wave-layout.js'
export type { Axial }
export interface Silhouette { readonly word: string; readonly q: number; readonly r: number; readonly index: number }

/** The trait words no tile on this level answers yet, in the order the tile opened them. */
export function openTraitWords(words: readonly string[], labels: readonly string[]): string[] {
  return words.filter(word => !labels.some(label => sameWord(label, word)))
}

const key = (q: number, r: number): string => `${q},${r}`

/**
 * Seat each open word in the next free slot of the spiral, walking from slot 0 and skipping every
 * slot a tile already holds. `spiralAt` is the layout's own index → axial map, so a silhouette sits
 * exactly where a tile created by its name would land. Stops quietly when the spiral runs out.
 */
export function silhouetteSlots(
  open: readonly string[],
  occupied: readonly (Axial | null | undefined)[],
  spiralAt: (index: number) => Axial | null | undefined,
  limit = 2000,
): Silhouette[] {
  const taken = new Set<string>()
  for (const c of occupied) if (c) taken.add(key(c.q, c.r))
  const out: Silhouette[] = []
  let index = 0
  for (const word of open) {
    for (; index < limit; index++) {
      const c = spiralAt(index)
      if (!c) return out
      if (taken.has(key(c.q, c.r))) continue
      out.push({ word, q: c.q, r: c.r, index })
      taken.add(key(c.q, c.r))
      index++
      break
    }
  }
  return out
}
