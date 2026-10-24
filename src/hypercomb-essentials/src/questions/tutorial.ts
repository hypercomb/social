// questions/tutorial.ts
//
// The pure half of `start tutorial` (tutorial.drone.ts): what the explanation
// says, and the stops it plays. A page is a tile holding tiles; every tile
// carries a TITLE, the sentence the room reads on the hexagon. Names are the
// addresses — short and plain, each one distinct, so no two pages share a
// molecule.

/** The game's name for the `start` word, whole. */
export const TUTORIAL_NAME = 'tutorial'
/** The hive the Q and A it leads is named for: `hypercomb q and a`. */
export const TUTORIAL_HIVE = 'hypercomb'
/** How long a page lasts; the first waits longer, for the room to tap Join. */
export const TUTORIAL_SECONDS = 45
export const TUTORIAL_FIRST_SECONDS = 90

/** name → [title, the tiles inside]. */
export type TutorialTile = readonly [name: string, title: string, inside?: readonly TutorialTile[]]

export const TUTORIAL: TutorialTile = [TUTORIAL_NAME, 'How it works — the tutorial', [
  ['following', '1 · Following', [
    ['you-go', 'You go where the host goes'],
    ['new-page', 'A new page every 45 seconds'],
    ['ask-any-page', 'Ask on any page: tap Ask'],
    ['leave', 'Tap Leave to stop following'],
  ]],
  ['basics', '2 · The basics', [
    ['one-thing', 'A tile holds one thing'],
    ['go-in', 'Tiles hold tiles: tap to go in'],
    ['notes', 'Notes ride on a tile'],
    ['take', 'Like it? Take it — it is yours'],
  ]],
  ['idea', '3 · The idea', [
    ['people', 'People first, not a platform'],
    ['protocol', 'An open protocol, owned by no one'],
    ['fingerprint', 'Each thing has a fingerprint'],
    ['peers', 'Your peers check it; all serve it'],
    ['sovereign', 'Host your own domain and content'],
  ]],
  ['playing', '4 · Playing', [
    ['ask', 'Ask: tap Ask, type your question'],
    ['answer', 'Answer: tap a question, write'],
    ['pick', 'Take the answers you like'],
    ['best', 'The most-taken answers win'],
    ['then', 'Next: the questions open for all'],
  ]],
]]

/** The pages the explanation plays from `at`: the tutorial's own page, then
 *  each page inside it, depth first — the tiles holding tiles. */
export function tutorialStops(at: readonly string[], tile: TutorialTile = TUTORIAL): string[][] {
  const [name, , inside] = tile
  if (!inside?.length) return []
  const page = [...at, name]
  return [page, ...inside.flatMap(child => tutorialStops(page, child))]
}

/** Every tile the tutorial lays out, parents before children, with the page
 *  it stands on and its title. */
export function tutorialTiles(at: readonly string[], tile: TutorialTile = TUTORIAL): { page: string[]; name: string; title: string }[] {
  const [name, title, inside] = tile
  const page = [...at]
  return [{ page, name, title }, ...(inside ?? []).flatMap(child => tutorialTiles([...at, name], child))]
}
