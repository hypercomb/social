/** The island's and chambers' wand: one shared table of what it touches, what
 * it makes, what stays walkable, and the words it speaks. A completely
 * separate mechanism from the labyrinth's own wand (`cast()` in engine.ts,
 * which conjures/dispels bricks) — this module governs only the island and
 * ChamberModel. Pure data; no DOM, no storage, no behaviour. */

export const WAND_CELLS: ReadonlySet<string> = new Set(['crack', 'rune', 'spring'])
export const WAND_MADE: Readonly<Partial<Record<string, 'rubble' | 'laid' | 'stone'>>> = { crack: 'rubble', rune: 'laid', spring: 'stone' }
export const WAND_WALKABLE: ReadonlySet<string> = new Set(['rubble', 'rune', 'stone'])
export const WAND_WORDS: Readonly<Partial<Record<string, string>>> = {
  rubble: 'The cracked brick crumbles to rubble.',
  crack: 'The wand sets a cracked brick back in its place.',
  laid: 'A brick settles onto the rune plate.',
  rune: 'The brick lifts from the rune plate.',
  stone: 'A stepping stone rises out of the rune spring.',
  spring: 'The stone sinks back into the spring.',
}
export const WAND_REFUSALS = {
  nothing: 'The wand stirs, but only cracked bricks, rune plates and rune springs answer it.',
  standing: 'Step back first: the wand will not close the cell you are standing in.',
  seal: 'Step out of the doorway first: the seal would close on you.',
  block: 'A stone rests there. Move it before you use the wand.',
} as const
export const WAND_SEAL_WORDS = { open: 'Every plate holds a brick. The seal dissolves.', closed: 'A plate is empty again, and the seal closes.' } as const
