// commands/create-landing.ts
//
// WHERE A NEW TILE IS MADE — not always the page you are standing on.
//
// Two pages make a tile somewhere else, and both used to write it where you
// stood instead:
//
// 1. BEHIND A DOORWAY. A reference tile is a pointer; what lives "inside" it
//    lives at its target. Standing in one anyway (a deep link, back/forward, a
//    click before the reference index warmed) and making a tile wrote it into
//    the reference's own bag — a husk the target never sees. The route is
//    walked through every reference on it, the way a portal click walks.
//
// 2. ON A HOLDER. A page whose tiles are mostly references gathered from one
//    group (`friends` gathering from `people`) is a view of that group. A new
//    tile made there is a new MEMBER of the group: it is made in the group and
//    the holder gathers it as a reference — one `bob`, reachable from both,
//    never a second `bob` only `friends` knows about.
//
// The group is DERIVED — the most common parent of the routes the holder's
// references already carry (reference-designer.md §7, the same vote the
// references window shows as "Already gathered from"). Nothing is stored.

export type CreateLanding = {
  /** The page the first of `parts` is made on. */
  readonly base: readonly string[]
  /** The nest to make. Only shorter than asked when the walk passed through
   *  an existing doorway (`susan/phone` where `susan` is a reference). */
  readonly parts: readonly string[]
  /** Set on a holder: after the make, the holder gathers the new tile as a
   *  reference — exactly `CanonicalReferenceService.place(gather)`. */
  readonly gather: {
    readonly name: string
    readonly sourceSegments: readonly string[]
    readonly parentSegments: readonly string[]
  } | null
}

export type LandingReader = {
  /** Where the reference at `segments` points, or null when it is not one. */
  targetAt(segments: readonly string[]): Promise<readonly string[] | null>
  /** The names of the tiles listed on `page`. */
  childNames(page: readonly string[]): Promise<readonly string[]>
}

export async function createLanding(
  standing: readonly string[],
  parts: readonly string[],
  read: LandingReader,
): Promise<CreateLanding> {
  // Walk the route through every doorway on it. One segment per step, so a
  // reference pointing back up its own route cannot loop.
  let route: readonly string[] = []
  for (const segment of standing) {
    route = [...route, segment]
    route = (await read.targetAt(route)) ?? route
  }

  const plain: CreateLanding = { base: route, parts, gather: null }
  const [first, ...rest] = parts
  // The hive itself is a store, never a holder.
  if (!first || route.length === 0) return plain

  const names = await read.childNames(route)

  // An existing tile is walked, never re-made: behind a doorway it is the
  // target that gains the nest.
  if (names.includes(first)) {
    const target = rest.length > 0 ? await read.targetAt([...route, first]) : null
    return target ? { base: target, parts: rest, gather: null } : plain
  }

  let references = 0
  const votes = new Map<string, { segments: readonly string[]; count: number }>()
  for (const name of names) {
    const target = await read.targetAt([...route, name])
    if (!target) continue
    references++
    const group = target.slice(0, -1)
    if (group.length === 0) continue
    const key = group.join('/')
    const vote = votes.get(key) ?? { segments: group, count: 0 }
    vote.count++
    votes.set(key, vote)
  }
  // A holder is a page its references outnumber; a page of ordinary tiles
  // that happens to carry one doorway stays an ordinary page.
  if (references * 2 <= names.length) return plain

  let best: { segments: readonly string[]; count: number } | null = null
  for (const vote of votes.values()) if (!best || vote.count > best.count) best = vote
  const group = best?.segments
  // A page gathering its own children is not a holder of anything else.
  if (!group || group.join('/') === route.join('/')) return plain

  return {
    base: group,
    parts,
    gather: { name: first, sourceSegments: [...group, first], parentSegments: route },
  }
}
