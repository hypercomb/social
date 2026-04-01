// hypercomb-shared/core/array-parser.ts
// Shared array item parser — unified bracket syntax for all command-line behaviors.

export type ArrayItemOp = 'create' | 'delete' | 'tag-add' | 'tag-remove'

export interface ParsedArrayItem {
  /** Path segments (normalized). Last segment is the leaf label. */
  segments: string[]
  /** Operation type. */
  op: ArrayItemOp
  /** Tag name (for tag-add / tag-remove). */
  tag?: string
  /** Tag color, e.g. '#ff0' (for tag-add). */
  tagColor?: string
}

/**
 * Parse comma-separated items from inside brackets into a uniform array.
 *
 * Each item can be:
 *   name              → create
 *   ~name             → delete
 *   parent/child      → create with path
 *   ~parent/child     → delete with path
 *   name:tag          → tag-add
 *   name:tag(#color)  → tag-add with color
 *   ~name:tag         → tag-remove
 *   ~name:tag(#color) → tag-remove (color ignored but parsed)
 *
 * @param raw       The raw string INSIDE brackets (no outer [ ]).
 * @param normalize Normalization function for cell names (CompletionUtility.normalize).
 */
export function parseArrayItems(
  raw: string,
  normalize: (s: string) => string,
): ParsedArrayItem[] {
  const items: ParsedArrayItem[] = []

  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue

    const parsed = parseOneItem(trimmed, normalize)
    if (parsed) items.push(parsed)
  }

  return items
}

/**
 * Parse a single array item (not comma-separated — one token only).
 * Useful for standalone args like `/delete beer` or `/delete ~parent/child`.
 */
export function parseOneItem(
  raw: string,
  normalize: (s: string) => string,
): ParsedArrayItem | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const tilde = trimmed.startsWith('~')
  const body = tilde ? trimmed.slice(1) : trimmed

  // split tag: label:tag or label:tag(#color)
  const colonIdx = body.indexOf(':')
  let pathPart: string
  let tag: string | undefined
  let tagColor: string | undefined

  if (colonIdx > 0) {
    pathPart = body.slice(0, colonIdx)
    const tagPart = body.slice(colonIdx + 1)
    const colorMatch = tagPart.match(/^([^(]+)(?:\(([^)]+)\))?$/)
    if (colorMatch) {
      tag = colorMatch[1].trim()
      tagColor = colorMatch[2]?.trim()
    } else {
      tag = tagPart.trim()
    }
    if (!tag) tag = undefined
  } else {
    pathPart = body
  }

  // split path segments and normalize
  const segments = pathPart
    .split('/')
    .map(s => normalize(s.trim()))
    .filter(Boolean)

  if (segments.length === 0) return null

  let op: ArrayItemOp
  if (tilde && tag) {
    op = 'tag-remove'
  } else if (tilde) {
    op = 'delete'
  } else if (tag) {
    op = 'tag-add'
  } else {
    op = 'create'
  }

  return { segments, op, tag, tagColor }
}
