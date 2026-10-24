// didyouknow/didyouknow.ts
//
// DID YOU KNOW — the pure half (didyouknow.service.ts is the other).
//
// A meeting exercise played on the notes the swarm already shares. The game is
// a tile named for its LAYER; an IDEA is a note on it — something you think
// the others might not know. Ideas are shared WITHOUT NAMES: while the game
// runs, the notes desk shows the words and not who brought them. At the end
// the host REVEALS: one note on the same tile lists every idea with its name,
// and the desk, finding that note, shows names again. A participant COLLECTS
// the ideas worth keeping — the swarm's take, the same signature onto their
// own tile — so each has a list to go back to and learn from.
//
// THE DATA IS LAYER-SPECIFIC BECAUSE THE WORD IS. A tile's notes are a facet of
// its WORD (notes/notes-facet.ts): two tiles with one name, anywhere, read one
// list. So the game's tile is not one name everywhere; it is named for the
// layer it is played on (`gameTileName`), which makes each layer its own word,
// its own notes list, its own reveal. The root layer's tile is plain
// `did-you-know`; a deeper layer's is `did-you-know-` and the layer's path.
//
// No store, no swarm, no DOM — the service and the spec share this.

import { canonicalizeLineageSegment, moleculeKey, normalizeCell } from '@hypercomb/core'

/** The game's name is the word that starts it: `start did you know`. The
 *  TILE it makes is named for the layer it is played on (`gameTileName`). */
export const GAME_NAME = 'did you know'
export const DYK_KEY = '@diamondcoreprocessor.com/DidYouKnow'

/** THE TOGGLE. A mark a layer wears to switch the game on for itself and
 *  everything beneath it — one declaration, read by walking up the ancestors
 *  (the root included, so a mark at the root is "everywhere"), never stamped
 *  onto descendants. It is the same shape as the contact and dropbox
 *  behaviours: a container declares, its subtree inherits. */
export const ENABLED_KIND = 'visual:didyouknow:enabled'

/** The reveal note begins with this. Its presence on the game tile — anyone's,
 *  the room's — is what un-conceals the names, and it never counts as an idea. */
export const REVEAL_MARK = 'Revealed ·'

/** An idea is a sentence or two, not an essay: the room reads them aloud. */
export const IDEA_MAX = 600
/** A line of the reveal note keeps this much of an idea. */
export const REVEAL_LINE_MAX = 200

/** The longest a tile's name may be (`normalizeCell` cuts there). */
export const TILE_NAME_MAX = 64

/** FNV-1a, 32 bits, as 8 hex digits. It only tells two layers apart when a
 *  deep path makes the tile's name run past TILE_NAME_MAX: not a signature,
 *  never an address, never stored. */
function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** THE NAME OF THE GAME'S TILE ON A LAYER. The root layer's is the hive's
 *  spelling of the game, `did-you-know`; a deeper layer's is that, a hyphen
 *  and the layer's own path (`did-you-know-lecture`,
 *  `did-you-know-lecture-biology`). Each segment is spelled the way the
 *  lineage identifies a layer (NFC, every run of punctuation and space folded
 *  to one hyphen) and then lower-cased, so everyone standing on one page works
 *  out the same name, whatever their locale, and the room finds one tile. Two
 *  layers never share a name, apart from paths that differ only by where a
 *  hyphen falls (`/a-b` and `/a/b`) or by case (`/Lecture` and `/lecture`: a
 *  tile's name is lower case, and the molecule folds case too). A segment of
 *  nothing but symbols is spelled `x` and a short hash. A path too long for a
 *  tile's name is cut and closed with a short hash of the whole path, so it
 *  stays one name per layer. */
export function gameTileName(page: readonly string[]): string {
  const base = normalizeCell(GAME_NAME)
  const parts = page
    .map(s => String(s ?? '').trim())
    .filter(Boolean)
    .map(s => normalizeCell(canonicalizeLineageSegment(s).toLowerCase()) || `x${shortHash(s)}`)
  if (parts.length === 0) return base
  const name = `${base}-${parts.join('-')}`
  if (name.length <= TILE_NAME_MAX) return name
  // Cut on a whole character: a half surrogate pair never ends the name.
  const cut = name.slice(0, TILE_NAME_MAX - 9).replace(/[\uD800-\uDBFF]$/, '').replace(/-+$/, '')
  return `${cut}-${shortHash(parts.join('/'))}`
}

/** Is `cell` the game's tile ON THIS LAYER? Folded as a molecule folds, so
 *  `Did You Know` and `did-you-know` are one tile. A tile of another layer's
 *  game, or a tile of yours that merely starts like the game's, is not it. */
export function isGameTile(cell: unknown, page: readonly string[]): boolean {
  return moleculeKey(cell) === moleculeKey(gameTileName(page))
}

/** Is this note the host's reveal? */
export function isRevealNote(text: unknown): boolean {
  return String(text ?? '').trimStart().startsWith(REVEAL_MARK)
}

/** Has the game been revealed — is any of these notes the reveal? */
export function isRevealed(texts: readonly unknown[]): boolean {
  return texts.some(isRevealNote)
}

/** THE CONCEALMENT RULE the notes desk asks: on the game's tile of the layer
 *  you stand on, until a reveal note is among its notes (yours or anyone's),
 *  show the words, not who. A reveal on one layer reveals nothing on another:
 *  each layer's tile is its own word, with its own notes. */
export function concealsAuthors(cell: unknown, texts: readonly unknown[], page: readonly string[]): boolean {
  return isGameTile(cell, page) && !isRevealed(texts)
}

/** An idea as typed: whitespace gathered into single spaces. */
export function cleanIdea(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

/** What the word `did-you-know` was asked to do. The toggle words stand alone;
 *  anything longer than one of them is an idea. */
export type Toggle = 'flip' | 'on' | 'off' | 'everywhere'

/** `did-you-know` alone flips the game on or off for this layer and beneath;
 *  `on`, `off` and `everywhere` say which. Anything else is null — an idea. */
export function parseToggle(args: unknown): Toggle | null {
  const word = cleanIdea(args).toLowerCase()
  if (word === '') return 'flip'
  return word === 'on' || word === 'off' || word === 'everywhere' ? word : null
}

/** A layer as the sentences name it: `/` is the hive's root. */
export function routeOf(segments: readonly string[]): string {
  return '/' + segments.map(s => String(s ?? '').trim()).filter(Boolean).join('/')
}

/** One idea as the host's hive knows it: the note's signature, its words, and
 *  the participant who brought it. */
export interface Idea {
  readonly id: string
  readonly text: string
  readonly by: string
}

/** The reveal: one note, every idea with its name. Ideas keep the order they
 *  were given in. Several by one person are each listed under their name. */
export function revealText(ideas: readonly Idea[], labelOf: (pubkey: string) => string): string {
  const flat = (text: string): string => {
    const one = text.replace(/\s+/g, ' ').trim()
    return one.length > REVEAL_LINE_MAX ? one.slice(0, REVEAL_LINE_MAX - 1) + '…' : one
  }
  const lines = ideas.map((idea, i) => `${i + 1}. ${flat(idea.text)} — ${labelOf(idea.by)}`)
  return `${REVEAL_MARK} ${ideas.length} ${ideas.length === 1 ? 'idea' : 'ideas'}\n${lines.join('\n')}`
}

/** Who brought how many — for the line the host is told after a reveal. */
export function bringers(ideas: readonly Idea[]): number {
  return new Set(ideas.map(i => i.by)).size
}
