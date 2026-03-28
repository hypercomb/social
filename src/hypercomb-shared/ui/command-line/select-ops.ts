/**
 * Operation keywords that indicate a select command — used to distinguish
 * bracket-first select syntax `[items]/move(8)` from cut-paste `[items]/dest`.
 */
export const SELECT_OPS = new Set([
  'select', 'cut', 'copy', 'move', 'remove', 'rm',
  'format', 'fmt', 'fp', 'keyword', 'kw', 'tag',
  'opus', 'o', 'sonnet', 's', 'haiku', 'h'
])
