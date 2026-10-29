// sharing/image-collection.ts
//
// When the images button is worth showing, and when the wall has a real
// choice. Pure, so the icon and the wall agree without either importing the
// other.
//
// One picture that is already the one the tile wears is no choice. A picture
// the tile is not wearing — one it holds, one a host publishes for the name,
// or one someone in the swarm is showing — is a choice of one. The button
// appears and the wall offers it.

/** Pictures offered by a host or by someone in the swarm, excluding the one
 *  the tile wears and any it already holds. Each signature counts once. */
export function offeredPictureCount(
  worn: string,
  held: ReadonlySet<string> | undefined,
  sigs: readonly string[],
): number {
  const seen = new Set<string>()
  for (const sig of sigs) {
    if (!sig || sig === worn || held?.has(sig)) continue
    seen.add(sig)
  }
  return seen.size
}

/** Show the images button? `held` is the collection (terminal byte sigs),
 *  `worn` is the picture the tile is wearing now ('' when it has none of its
 *  own), `extra` is pictures from a host or the swarm that this tile does
 *  not hold and is not wearing. One of those is already a choice. */
export function imagesButtonVisible(input: {
  held: readonly string[]
  worn: string
  extra: number
}): boolean {
  const held = input.held.filter(sig => sig.length > 0)
  if (input.extra > 0) return true
  if (held.length > 1) return true
  return held.length === 1 && held[0] !== input.worn
}

/** Open the wall? Two or more pictures, or a single picture that is not the
 *  one already worn. The worn picture alone has nothing to choose. */
export function imageWallHasChoice(entries: readonly { mine: boolean }[]): boolean {
  if (entries.length >= 2) return true
  return entries.some(entry => !entry.mine)
}
