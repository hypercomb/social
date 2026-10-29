// sharing/image-collection.ts
//
// When the images button is worth showing, and when the wall has a real
// choice. Pure, so the icon and the wall agree without either importing the
// other.
//
// One picture that is already the one the tile wears is no choice. A picture
// pasted onto the tile under the pointer, which the tile is not wearing yet,
// is a choice of one — the button appears and the wall offers it.

/** Show the images button? `held` is the collection (terminal byte sigs),
 *  `worn` is the picture the tile is wearing now ('' when it has none of its
 *  own), `extra` is pictures other hosts offer that this tile does not hold. */
export function imagesButtonVisible(input: {
  held: readonly string[]
  worn: string
  extra: number
}): boolean {
  const held = input.held.filter(sig => sig.length > 0)
  if (held.length + input.extra > 1) return true
  return held.length === 1 && held[0] !== input.worn
}

/** Open the wall? Two or more pictures, or a single picture that is not the
 *  one already worn. The worn picture alone has nothing to choose. */
export function imageWallHasChoice(entries: readonly { mine: boolean }[]): boolean {
  if (entries.length >= 2) return true
  return entries.some(entry => !entry.mine)
}
