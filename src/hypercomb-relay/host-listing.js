// host-listing.js
//
// WHICH POOLS A HOST LISTS IN PUBLIC — one answer for every host shape (the
// machine relay and the blossom worker both import this file).
//
// THE FLOOR is the host contract: every host lists these, because every client
// derives their addresses and asks every door it follows. They are protocol,
// so they are code, and this is the only copy.
//
// EVERYTHING ELSE IS THE PUBLISHER'S SIGNED WORD. A host lists another pool
// only while its operator's signed index (kind 30564) names the meaning in
// `listed` — `hosts list <meaning>` writes it, `hosts unlist <meaning>`
// withdraws it. No list in code decides it, so a module that mints a pool
// worth offering needs no edit here: its host says so under its own key.
//
// Only colon meanings may be declared. `lineageKey` folds every non-letter or
// digit to `-`, so a colon meaning can never address a history bag or a bare
// word's molecule pool — declaring cannot enumerate what a path holds.

export const HOST_LISTING_FLOOR = Object.freeze(['host:packages', 'host:offerings', 'community:hosts', 'community:offers'])

/** A listing is a curated few, not a dump; past this the rest are ignored. */
export const MAX_LISTED = 32

const MEANING_MAX = 160

/** The meanings one signed index declares, leniently: a malformed entry is
 *  dropped, never the whole index (the index also opens doors). */
export function listedMeanings(content) {
  const raw = content && typeof content === 'object' ? content.listed : undefined
  if (!Array.isArray(raw)) return []
  const out = []
  for (const value of raw) {
    const meaning = typeof value === 'string' ? value.trim() : ''
    if (!meaning || meaning.length > MEANING_MAX || !meaning.includes(':') || /\s/.test(meaning)) continue
    if (!out.includes(meaning)) out.push(meaning)
    if (out.length >= MAX_LISTED) break
  }
  return out
}

/** The floor plus every meaning the given signed index contents declare. */
export function hostListing(contents) {
  const listed = new Set(HOST_LISTING_FLOOR)
  for (const content of contents) for (const meaning of listedMeanings(content)) listed.add(meaning)
  return [...listed]
}
