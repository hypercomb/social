// quickmenu/quick-menu.operands.ts
//
// Which tiles a quick-menu verb acts on.
//
// A verb that works on tiles (remove, hide, shelf, invite…) reads the
// selection, or wants tiles named. The menu is raised over ONE tile, so the two
// have to be reconciled before the verb runs, and the menu has to say which it
// meant:
//
//   the tile is in the selection   the verb acts on the whole selection
//   the tile is not in it          the verb acts on that tile alone
//   no tile (a picked set's ring)  the verb acts on the selection
//
// Reading a selection that does not include the tile the menu is drawn round
// would have the verb quietly act on tiles the participant is not looking at.

import type { QuickMenuDefinition, QuickMenuSlot } from './quick-menu.types.js'

const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'

type SelectionLike = {
  readonly selected?: ReadonlySet<string>
  replace?: (labels: readonly string[], active?: string) => void
}

const selection = (): SelectionLike | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => SelectionLike | undefined } }).ioc?.get?.(SELECTION_KEY)

/** The tiles a verb raised over `subject` acts on. Pure. */
export function operandsOf(subject: string | null | undefined, selected: Iterable<string>): string[] {
  const picked = [...selected]
  if (!subject) return picked
  return picked.includes(subject) ? picked : [subject]
}

/** What the subject's tile says beside its name when the verb will reach more
 *  tiles than it: `+2`. Empty when the tile stands alone. Pure. */
export function operandNote(subject: string | null | undefined, operands: readonly string[]): string {
  if (!subject) return ''
  const others = operands.filter(label => label !== subject).length
  return others > 0 ? `+${others}` : ''
}

/** The operands right now, read from the live selection. */
export function currentOperands(subject?: string | null): string[] {
  return operandsOf(subject, selection()?.selected ?? [])
}

/** Make the operands the selection, so a verb that reads the selection reads
 *  exactly them. Returns them. Announces nothing when the selection is already
 *  that set. */
export function bindOperands(subject?: string | null, alone = false): string[] {
  const operands = alone && subject ? [subject] : currentOperands(subject)
  if (operands.length) selection()?.replace?.(operands, subject && operands.includes(subject) ? subject : undefined)
  return operands
}

/** The menu a swarm's ring is drawn from. While more than one tile is picked
 *  the ring speaks for the swarm, and the tile it was raised over — the badge,
 *  `+N` — becomes one seat that opens that tile's own options. Pure. */
export const TILE_MENU = 'selection:tile'

export function swarmMenu(definition: QuickMenuDefinition, subject: string | null | undefined): QuickMenuDefinition {
  if (!subject || definition.name !== 'selection' || currentOperands(subject).length < 2) return definition
  const badge: QuickMenuSlot = { direction: 'northeast', label: subject, icon: 'hexagon', action: { kind: 'menu', menu: TILE_MENU } }
  return { ...definition, slots: definition.slots.map(slot => (slot.direction === 'northeast' ? badge : slot)) }
}

/** Verbs that take tiles by name and will not read the selection. */
const NAMED_TARGETS: ReadonlySet<string> = new Set(['hide'])

/** The arguments a tile verb runs with: its own when it has them, otherwise the
 *  operands named in the language's list form (`[a, b]`) for a verb that needs
 *  them named. */
export function argsWithOperands(command: string, args: string | undefined, operands: readonly string[]): string {
  if (args) return args
  if (!NAMED_TARGETS.has(command) || operands.length === 0) return ''
  return `[${operands.join(', ')}]`
}
