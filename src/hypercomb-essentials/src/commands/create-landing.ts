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
// 2. ON A HOLDER. A page linked to a group (`friends` gathering from `people`,
//    attached with `/from <group>` — references/gather/gather-link.ts) is a
//    view of that group. A new tile made there is a new MEMBER of the group:
//    it is made in the group and the holder gathers it as a reference — one
//    `bob`, reachable from both, never a second `bob` only `friends` knows
//    about.
//
// THE LINK IS THE ONLY ANSWER. A page with no link is an ordinary page, however
// many references it carries — the landing is never guessed from them (jwize,
// 2026-09-27: "when you add here you add there", nothing else). The link is
// followed ONE hop: the group's own link is never asked, so linked pages can
// chain or point at each other and a make still terminates.

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
  /** The group `page` is explicitly linked to (its first `gathers` mark), or
   *  null when it wears none. Optional: absent = no page is a holder. */
  groupOf?(page: readonly string[]): Promise<readonly string[] | null>
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

  // THE LINK, when the page wears one, is the answer — and the only one.
  const linked = await read.groupOf?.(route) ?? null
  if (!linked || linked.length === 0 || linked.join('/') === route.join('/')) return plain
  return {
    base: linked,
    parts,
    gather: { name: first, sourceSegments: [...linked, first], parentSegments: route },
  }
}
