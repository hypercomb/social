// presentation/tiles/organism-layout.ts
//
// THE ORGANISM — the densest tile in the middle, everything else crowding
// around it, thinning outward until the set runs out.
//
// This is a pure ranking-to-coordinate function, nothing more. It does not
// know what "dense" means: the caller supplies a weight per tile, so the
// same primitive lays out participants-who-hold-it, descendant count,
// visits, recency, or any other ontology. That is the point — one shape,
// many readings.
//
// It is a PROJECTION, never a commit. AxialService.project() swaps the
// slot→coordinate matrix (documentation/mobile-rails-projection.md is the
// precedent: the phone's rails do exactly this). A tile's `index` — its
// canonical arrangement — is untouched, so leaving the mode restores the
// hive exactly and nothing was written. Density is a way of LOOKING at an
// arrangement, not a second arrangement.
//
// Two readings, one function:
//
//   No groups — the single organism. Rank 0 takes the spiral's centre,
//   rank 1 the first ring, and so on outward. One nucleus, one crowd.
//
//   Grouped — the texture. Each group is laid as a CONTIGUOUS RUN of
//   spiral ranks, groups ordered by their own total weight and members
//   ordered by theirs, so every group comes out as a compact blob packed
//   against its neighbours. Contiguity is what makes the texture legible
//   and what makes it cheap: a run of spiral ranks is a connected region,
//   so its perimeter is a boundary walk over AxialService.Adjacents (a
//   cell is on the edge iff one of its six neighbours is outside the run),
//   and a connected region with a known perimeter is exactly what you can
//   bake to one sprite and draw as one quad when zoomed far out.
//
// Ties never scramble. Equal weights fall back to the canonical index, so
// tiles the metric cannot separate stay in the order the participant put
// them in — and `promote` lifts a chosen kind to the front WITHOUT
// disturbing that: promoted tiles keep their relative order, they just
// come first.

/** One tile offered to the layout. `index` is its canonical slot — the
 *  identity the projection maps FROM and never changes. */
export interface OrganismMember {
  readonly index: number
  /** How dense/popular this tile is under the chosen ontology. Higher
   *  sits closer to the centre. Negatives are allowed and simply sort
   *  last; NaN is treated as 0 so a broken metric thins the tile out
   *  rather than throwing the whole layout away. */
  readonly weight: number
  /** Optional nucleus this tile crowds around. Members sharing a group
   *  land in one contiguous run. Omit on every member for a single
   *  organism. */
  readonly group?: string
}

export interface OrganismOptions {
  /** Lift a kind to the top layer. Matching tiles are laid out first —
   *  you see their tiles before anything else — while keeping their
   *  relative canonical/weight order among themselves. Grouped layouts
   *  ignore this: a texture has no single top, and promoting inside it
   *  would tear a group's run in half. */
  readonly promote?: (member: OrganismMember) => boolean
}

/** Slot → coordinate, the shape AxialService.project() consumes. Declared
 *  here rather than imported so this module stays free of the renderer. */
export type SlotMatrix = ReadonlyMap<number, { q: number; r: number }>

const weightOf = (m: OrganismMember): number =>
  Number.isFinite(m.weight) ? m.weight : 0

/** Descending weight, canonical index as the tie-break. */
const byDensity = (a: OrganismMember, b: OrganismMember): number =>
  weightOf(b) - weightOf(a) || a.index - b.index

/** The order tiles take around the nucleus: densest first, outward.
 *  Exported because the ordering is worth reading (and testing) on its
 *  own — a rank strip, a legend, or a "next most popular" walk all want
 *  the sequence without the coordinates. */
export const organismOrder = (
  members: readonly OrganismMember[],
  options: OrganismOptions = {},
): readonly OrganismMember[] => {
  const grouped = members.some(m => typeof m.group === 'string' && m.group.length > 0)

  if (!grouped) {
    const promote = options.promote
    if (!promote) return [...members].sort(byDensity)
    // Two bands, each internally ordered by density. The promoted kind
    // surfaces whole; nothing inside either band is re-shuffled.
    const top: OrganismMember[] = []
    const rest: OrganismMember[] = []
    for (const m of members) (promote(m) ? top : rest).push(m)
    return [...top.sort(byDensity), ...rest.sort(byDensity)]
  }

  // Texture: gather nuclei, order each group's members by density, then
  // order the groups by their own total weight so the heaviest cluster
  // takes the centre and lighter ones pack around it.
  const groups = new Map<string, OrganismMember[]>()
  for (const m of members) {
    const key = typeof m.group === 'string' && m.group.length > 0 ? m.group : ''
    const bag = groups.get(key)
    if (bag) bag.push(m)
    else groups.set(key, [m])
  }

  const ranked = [...groups.entries()].map(([key, bag]) => {
    const sorted = bag.slice().sort(byDensity)
    let total = 0
    for (const m of sorted) total += weightOf(m)
    return { key, sorted, total, first: sorted[0]?.index ?? 0 }
  })
  // Heaviest group first; equal groups fall back to the canonical index of
  // their own densest member, so grouping never invents an order either.
  ranked.sort((a, b) => b.total - a.total || a.first - b.first)

  const out: OrganismMember[] = []
  for (const g of ranked) out.push(...g.sorted)
  return out
}

/** Where each group's run sits in the final order — the input a perimeter
 *  walk or a per-section sprite bake needs. `[start, end)` over ranks. */
export interface OrganismSection {
  readonly group: string
  readonly start: number
  readonly end: number
}

/** The contiguous runs of the grouped layout, in rank order. Empty for a
 *  single organism — one crowd is not sectioned. */
export const organismSections = (
  ordered: readonly OrganismMember[],
): readonly OrganismSection[] => {
  const sections: OrganismSection[] = []
  let start = 0
  for (let i = 1; i <= ordered.length; i++) {
    const prev = ordered[i - 1]?.group ?? ''
    const here = i < ordered.length ? ordered[i]?.group ?? '' : null
    if (here !== prev) {
      if (prev) sections.push({ group: prev, start, end: i })
      start = i
    }
  }
  return sections
}

/** Build the projection matrix: canonical slot → the coordinate that slot's
 *  tile takes in the organism.
 *
 *  `spiral` is the renderer's own slot→coordinate map (AxialService.items
 *  before any projection), read POSITIONALLY: the coordinate at spiral slot
 *  `n` is where rank `n` lands. Reusing the real spiral rather than
 *  re-deriving ring math means the organism inherits the exact grid the
 *  hive already uses — same orientation, same centre, same neighbour
 *  distances — and stays correct if that grid ever changes.
 *
 *  A member with no spiral slot to take (more tiles than the grid holds)
 *  is left out of the matrix rather than stacked on top of another tile. */
export const organismMatrix = (
  members: readonly OrganismMember[],
  spiral: ReadonlyMap<number, { q: number; r: number }>,
  options: OrganismOptions = {},
): SlotMatrix => {
  const ordered = organismOrder(members, options)
  const matrix = new Map<number, { q: number; r: number }>()
  for (let rank = 0; rank < ordered.length; rank++) {
    const member = ordered[rank]
    const coord = spiral.get(rank)
    if (!member || !coord) continue
    matrix.set(member.index, { q: coord.q, r: coord.r })
  }
  return matrix
}
