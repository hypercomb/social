// keyboard-desk/parts.ts
//
// WHAT CROSSES BETWEEN THE PARTS, and nothing else (documentation/keyboard-desk.md).
//
// The desk is one behaviour and ten parts. Each part is a folder holding one
// trait word's OWN version; each folder is its own layer with its own signature,
// so a party can work on one part alone at `try-keyboard-<word>.<zone>` and the
// others never move. This file is the interface those parties share, and the
// only file every part may read. A part never imports another part: the desk
// (desk/keyboard-desk.view.ts) pieces them together.
//
// A trait fills in the usual order. Something registered at `partKey(word)` is
// the chosen filler; with nothing there the part's own version runs.

import type { KeyBinding, KeyChord } from '@hypercomb/core'
import type { Press } from '../keyboard/chord-match.js'

export const PART_WORDS = [
  'board', 'legend', 'chord', 'bindings', 'behaviours', 'lineup', 'keycap', 'callouts', 'strip', 'list',
] as const
export type PartWord = (typeof PART_WORDS)[number]

export const partKey = (word: PartWord): string => `@diamondcoreprocessor.com/KeyboardDesk/${word}`

// What a binding's `cmd` can name besides a keymap command. A word keeps its
// name inside the command so a chord survives a reload with nothing else to go
// on; a lineup is named by its signature, so it cannot contain itself.
const WORD_PREFIX = 'word:'
const LINEUP_PREFIX = 'lineup:'
export const LINEUPS_GROUP = 'Lineups'

export const wordCmd = (name: string): string => `${WORD_PREFIX}${name}`
export const wordOf = (cmd: unknown): string | null =>
  typeof cmd === 'string' && cmd.startsWith(WORD_PREFIX) ? cmd.slice(WORD_PREFIX.length) : null
export const lineupCmd = (sig: string): string => `${LINEUP_PREFIX}${sig}`
export const lineupOf = (cmd: unknown): string | null =>
  typeof cmd === 'string' && cmd.startsWith(LINEUP_PREFIX) ? cmd.slice(LINEUP_PREFIX.length) : null

/** A caption, or its plain-English stand-in. */
export type Say = (key: string, fallback: string, params?: Record<string, string | number>) => string

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta'
export type Held = Readonly<Record<Modifier, boolean>>
export const NOTHING_HELD: Held = { ctrl: false, shift: false, alt: false, meta: false }

// ── the board ─────────────────────────────────────────────────────────

/** One key. Lengths are in key widths from the board's corner. */
export interface Cap {
  readonly id: string
  /** The physical key, lowercase: `keyq`, `digit8`, `arrowup`. */
  readonly code: string
  /** What the key sends alone, and with Shift when that differs. */
  readonly key: string
  readonly shiftKey?: string
  readonly label: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** A modifier is a layer of the board, not a key that can be bound. */
  readonly modifier?: Modifier
}

export interface BoardPart {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly caps: readonly Cap[]
}

// ── what a key does ───────────────────────────────────────────────────

export interface Legend {
  readonly cmd: string
  /** `exact`: the binding asks for this layer. `loose`: it fires here only
   *  because it does not look at the modifiers that are down. */
  readonly fit: 'exact' | 'loose'
  /** The participant chose it. */
  readonly mine: boolean
  /** Fits this press, but a chosen binding takes the press from it. */
  readonly shadowed: boolean
  /** More keys follow this one. */
  readonly continues: boolean
}

export interface LegendPart {
  /** What the press would do, strongest first. */
  legendOf(press: Press, bindings: readonly KeyBinding[], mine: ReadonlySet<string>): readonly Legend[]
  /** Every binding that starts on this key, whatever the modifiers. */
  bindingsOn(cap: Cap, bindings: readonly KeyBinding[]): readonly KeyBinding[]
  /** The binding on exactly this chord, the participant's first. */
  bindingOn(chord: Chord, bindings: readonly KeyBinding[], mine: ReadonlySet<string>): KeyBinding | null
  /** The keys one binding's first step lands on, and the layer it asks for. */
  capsOf(binding: KeyBinding, board: BoardPart): readonly { readonly cap: Cap; readonly held: Held }[]
}

// ── chords ────────────────────────────────────────────────────────────

/** Steps pressed in order, one chord each. */
export type Chord = readonly KeyChord[]

export interface ChordPart {
  /** The press this key makes with these modifiers down. */
  pressOfCap(cap: Cap, held: Held): Press
  /** A press written down exactly: every modifier named, on or off. */
  chordOfPress(press: Press): KeyChord
  /** Two written chords that are the same press. */
  sameChord(a: KeyChord, b: KeyChord): boolean
  /** A chord in plain words, step by step: `[['Ctrl','K'],['G']]`. */
  read(chord: Chord): readonly (readonly string[])[]
}

// ── behaviours ────────────────────────────────────────────────────────

/** Something a chord can run: a keymap command, or a word of the language. */
export interface Behaviour {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly group: string
  /** Bound to a key the desk may not move. */
  readonly locked: boolean
}

export interface BehaviourSources {
  readonly bindings: readonly KeyBinding[]
  readonly words: readonly { readonly name: string; readonly description: string; readonly hidden?: boolean }[]
}

export interface BehavioursPart {
  list(sources: BehaviourSources, say: Say): readonly Behaviour[]
}

// ── lineups ───────────────────────────────────────────────────────────

/** One automaton in a lineup: a sentence to say, or a keymap command to fire. */
export type Step = { readonly say: string } | { readonly cmd: string }

export interface LineupPart {
  /** The step that runs this behaviour. */
  stepOf(behaviourId: string): Step
  /** The plain binding these steps are, or null when they need a lineup. */
  commandOf(steps: readonly Step[]): string | null
  /** A script's lines as steps. */
  stepsOfScript(text: string): readonly Step[]
  /** The steps as their own resource, by signature. */
  keep(steps: readonly Step[]): Promise<string | null>
  read(sig: string): Promise<readonly Step[] | null>
}

// ── the participant's bindings ────────────────────────────────────────

/** One choice: run `cmd` on `sequence`. An empty sequence takes a default off. */
export interface Choice {
  readonly cmd: string
  readonly sequence: KeyChord[][]
  readonly description?: string
  readonly category?: string
}

export interface BindingsPart {
  load(): Promise<readonly Choice[]>
  /** The saved document's signature, or null when it could not be saved. */
  save(choices: readonly Choice[]): Promise<string | null>
  /** The choices after binding this behaviour to this chord. */
  assign(choices: readonly Choice[], behaviour: Behaviour, chord: Chord): readonly Choice[]
  /** The choices after taking this command off the keys. */
  unbind(choices: readonly Choice[], cmd: string): readonly Choice[]
  /** The layer the keymap service runs them from. */
  layerOf(choices: readonly Choice[]): { id: string; priority: number; bindings: KeyBinding[] }
}

// ── the parts that draw ───────────────────────────────────────────────

export interface CapPaint {
  readonly legend: Legend | null
  readonly name: string
  readonly selected: boolean
  /** The behaviour in hand, or the one being looked at, lands here. */
  readonly lit: boolean
  readonly down: boolean
}

export interface KeycapPart {
  create(cap: Cap, board: BoardPart): HTMLElement
  paint(el: HTMLElement, cap: Cap, state: CapPaint): void
}

export interface CalloutRow {
  readonly cmd: string
  readonly keys: readonly (readonly string[])[]
  readonly text: string
  readonly mine: boolean
  readonly locked: boolean
}

export interface CalloutsHandle {
  readonly el: HTMLElement
  /** Rows for the chosen key, with leaders to where it sits in `over`. */
  show(rows: readonly CalloutRow[], anchor: HTMLElement | null, over: HTMLElement): void
}

export interface CalloutsPart {
  create(events: { onUnbind(cmd: string): void; onHover(cmd: string | null): void }, say: Say): CalloutsHandle
}

export interface ShownBehaviour {
  readonly behaviour: Behaviour
  readonly keys: readonly string[]
  readonly chosen: boolean
}

export interface StripHandle {
  readonly el: HTMLElement
  /** The lineup in hand, left to right, and the chord it runs on. */
  show(labels: readonly string[], chord: string): void
}

export interface StripPart {
  create(events: {
    onRemove(index: number): void
    onMove(index: number, by: -1 | 1): void
    onScript(text: string): void
  }, say: Say): StripHandle
}

export interface ListHandle {
  readonly el: HTMLElement
  show(tiles: readonly ShownBehaviour[]): void
}

export interface ListPart {
  create(events: {
    onPick(behaviour: Behaviour): void
    onHover(behaviour: Behaviour | null): void
  }, say: Say): ListHandle
}

export interface DeskParts {
  readonly board: BoardPart
  readonly legend: LegendPart
  readonly chord: ChordPart
  readonly bindings: BindingsPart
  readonly behaviours: BehavioursPart
  readonly lineup: LineupPart
  readonly keycap: KeycapPart
  readonly callouts: CalloutsPart
  readonly strip: StripPart
  readonly list: ListPart
}

/** Each word's filler, or its own version. */
export const fillParts = (own: DeskParts, filler: (key: string) => unknown): DeskParts => {
  const parts: Record<string, unknown> = {}
  for (const word of PART_WORDS) parts[word] = filler(partKey(word)) ?? own[word]
  return parts as unknown as DeskParts
}
