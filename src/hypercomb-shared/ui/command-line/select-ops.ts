/**
 * Is `[items]/xxx` an OPERATION on the selection, or a cut-paste DESTINATION?
 *
 * The registry answers first. `SlashBehaviourDrone.has()` knows every
 * behaviour and every alias, live, so a new command works in bracket form the
 * moment it registers — nothing to remember, nothing to keep in sync.
 *
 * This used to be a frozen list, and the failure was silent in the worst
 * direction: `[a, b]/atomize` did not error, it parsed `atomize` as a
 * DESTINATION and tried to move the tiles into it. A command the list had
 * never heard of became a move. Any list that has to be updated from three
 * projects away will drift, and this one drifts into data movement.
 *
 * The literal set below is only the ops that are NOT slash behaviours —
 * command-line built-ins with no provider to ask about. It may shrink as
 * those migrate; it should never grow to cover a behaviour.
 */
const BUILTIN_SELECT_OPS = new Set([
  'select', 'cut', 'copy', 'move', 'fp',
])

type SlashRegistry = { has?: (name: string) => boolean }

export const isSelectOp = (op: string): boolean => {
  const name = String(op ?? '').toLowerCase().trim()
  if (!name) return false
  if (BUILTIN_SELECT_OPS.has(name)) return true
  const slash = (globalThis as { ioc?: { get?: (k: string) => unknown } }).ioc
    ?.get?.('@diamondcoreprocessor.com/SlashBehaviourDrone') as SlashRegistry | undefined
  return slash?.has?.(name) ?? false
}

/** @deprecated Ask {@link isSelectOp} — it consults the live behaviour
 *  registry. Kept only so a caller mid-migration still compiles. */
export const SELECT_OPS = BUILTIN_SELECT_OPS
