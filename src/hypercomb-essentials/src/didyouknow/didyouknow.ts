// didyouknow/didyouknow.ts
//
// DID YOU KNOW — the pure half (didyouknow.service.ts is the other).
//
// A meeting exercise played on the notes the swarm already shares. The game is
// a tile named `did you know`; an IDEA is a note on it — something you think
// the others might not know. Ideas are shared WITHOUT NAMES: while the game
// runs, the notes desk shows the words and not who brought them. At the end
// the host REVEALS: one note on the same tile lists every idea with its name,
// and the desk, finding that note, shows names again. A participant COLLECTS
// the ideas worth keeping — the swarm's take, the same signature onto their
// own tile — so each has a list to go back to and learn from.
//
// No store, no swarm, no DOM — the service and the spec share this.

import { moleculeKey } from '@hypercomb/core'

/** The game's name is the word that starts it: `start did you know`. It is
 *  also the game's place: a tile of that name IS the game, and an idea is a
 *  note on it. `sign('did you know')` is the molecule, so one game is one word
 *  on every participant's hive. */
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

/** Is this tile the game? Folded as a molecule folds, so `Did You Know` and
 *  `did-you-know` are the same tile. */
export function isGame(cell: unknown): boolean {
  return moleculeKey(cell) === moleculeKey(GAME_NAME)
}

/** Is this note the host's reveal? */
export function isRevealNote(text: unknown): boolean {
  return String(text ?? '').trimStart().startsWith(REVEAL_MARK)
}

/** Has the game been revealed — is any of these notes the reveal? */
export function isRevealed(texts: readonly unknown[]): boolean {
  return texts.some(isRevealNote)
}

/** THE CONCEALMENT RULE the notes desk asks: on the game tile, until a reveal
 *  note is among its notes (yours or anyone's), show the words, not who. */
export function concealsAuthors(cell: unknown, texts: readonly unknown[]): boolean {
  return isGame(cell) && !isRevealed(texts)
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
