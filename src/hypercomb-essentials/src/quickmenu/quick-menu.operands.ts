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
//   the tile is not in it          the tile JOINS it: the selection and that tile
//   nothing is selected            the verb acts on that tile alone
//   no tile (a picked set's ring)  the verb acts on the selection
//
// A tile held outside a selection used to stand alone, so the set the
// participant had built was quietly dropped the moment alt landed on one more
// tile. Holding alt over a tile is pointing at it; with a set already picked,
// pointing means "and this one too". The tile goes last, so the order the set
// was built in is the order the verbs walk it.
//
// Two or more operands raise the many-tiles ring (`selection:many`) instead of
// the selection ring: its verbs are the ones that make sense for every tile at
// once, and its middle is a stack of tiles with the count, never one tile's
// picture.

import type { QuickMenuDefinition, QuickMenuSlot } from './quick-menu.types.js'

const SELECTION_KEY = '@diamondcoreprocessor.com/SelectionService'

type SelectionLike = {
  readonly selected?: ReadonlySet<string>
  replace?: (labels: readonly string[], active?: string) => void
}

const selection = (): SelectionLike | undefined =>
  (globalThis as { ioc?: { get?: (k: string) => SelectionLike | undefined } }).ioc?.get?.(SELECTION_KEY)

/** The ring for one tile, and the ring for a set of them. */
export const SELECTION_MENU = 'selection'
export const MANY_TILES_MENU = 'selection:many'

/** The tiles a verb raised over `subject` acts on. Pure. */
export function operandsOf(subject: string | null | undefined, selected: Iterable<string>): string[] {
  const picked = [...selected]
  if (!subject) return picked
  return picked.includes(subject) ? picked : [...picked, subject]
}

/** The ring an alt hold raises for these operands: the many-tiles ring once
 *  the verbs will reach two or more, the selection ring for one. Pure. */
export function menuForOperands(operands: readonly string[]): string {
  return operands.length >= 2 ? MANY_TILES_MENU : SELECTION_MENU
}

/** How many tiles the middle of the ring stands for: the count when it is two
 *  or more (the middle is the stack of them), else 0 (the middle is the tile). */
export function manyCount(operands: readonly string[]): number {
  return operands.length >= 2 ? operands.length : 0
}

type I18nLike = { t?: (key: string, params?: Record<string, unknown>) => string }

/** The word the stack in the middle wears: `3 tiles`. */
export function manyTilesWord(count: number): string {
  const i18n = (globalThis as { ioc?: { get?: (k: string) => I18nLike | undefined } }).ioc?.get?.('@hypercomb.social/I18n')
  const key = 'quickmenu.many-tiles'
  const said = i18n?.t?.(key, { count })
  return said && said !== key && !said.startsWith(`${key}.`) ? said : `${count} tiles`
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

/** Whether `subject` is already part of the picked set. */
export function isPicked(subject?: string | null): boolean {
  return !!subject && !!selection()?.selected?.has(subject)
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
 *  `+N` — becomes one seat that opens that tile's own options. On the
 *  selection ring the badge takes northeast; on the many-tiles ring it takes
 *  the seat left free (west), so every verb for the set keeps its place. Pure. */
export const TILE_MENU = 'selection:tile'

export function swarmMenu(definition: QuickMenuDefinition, subject: string | null | undefined): QuickMenuDefinition {
  const many = definition.name === MANY_TILES_MENU
  if (!subject || (!many && definition.name !== SELECTION_MENU) || currentOperands(subject).length < 2) return definition
  const seat = many ? 'west' : 'northeast'
  const badge: QuickMenuSlot = { direction: seat, label: subject, icon: 'hexagon', action: { kind: 'menu', menu: TILE_MENU } }
  return { ...definition, slots: [...definition.slots.filter(slot => slot.direction !== seat), badge] }
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
