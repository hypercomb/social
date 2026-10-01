/**
 * Is `[items]/xxx` an OPERATION on the selection, or a cut-paste DESTINATION?
 *
 * The registry answers first. `SlashBehaviourDrone.has()` knows every
 * behaviour and every alias, live, so a new command works in bracket form the
 * moment it registers — nothing to remember, nothing to keep in sync.
 *
 * This used to be a frozen list, and the failure was silent in the worst
 * direction: `[a, b]/break-apart` did not error, it parsed `break-apart` as a
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

/**
 * Brackets `[…]` are THE selection grouping primitive — the one canonical form.
 * `[a,b]` selects; `[a,b]/cut` selects then cuts; `~[a,b]` removes; `[a,b]:tag`
 * tags. Legacy `/select[…]`, `/format[…]`, `/fmt[…]`, `/fp[…]` are still accepted
 * as INPUT (old URLs, muscle memory) but are rewritten to the bare bracket and
 * are never echoed or suggested back.
 *
 * Here rather than in the component so the remote door reads a bracket line
 * through the SAME normaliser the dispatch does (remote-verbs.ts) — a second
 * copy would be a second parser.
 */
export const BRACKET_CMD_RE = /^\/(select|format|fmt|fp)\[/i
/** Normalise any selection-input form to the canonical bare-bracket `[…]`. */
export function normalizeSelectInput(v: string): string {
  // Already canonical.
  if (v.startsWith('[')) return v

  // Legacy `/select[…]` → drop the prefix, keep the bracket + any tail.
  const sel = v.match(/^\/select(\[.*)$/i)
  if (sel) return sel[1]

  // Legacy `/format[…]` | `/fmt[…]` | `/fp[…]` → `[items]/format`.
  const m = v.match(/^\/(format|fmt|fp)\[/i)
  if (!m) return v
  const rest = v.slice(m[0].length) // everything after the opening bracket
  const bracketClose = rest.indexOf(']')
  if (bracketClose < 0) return '[' + rest // bracket still open
  return '[' + rest.slice(0, bracketClose) + ']/format' + rest.slice(bracketClose + 1)
}

/** @deprecated Ask {@link isSelectOp} — it consults the live behaviour
 *  registry. Kept only so a caller mid-migration still compiles. */
export const SELECT_OPS = BUILTIN_SELECT_OPS
