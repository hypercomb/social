const SIGNATURE = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/gi
const SIGNATURE_PREFIX_LENGTH = 12

export type ExecutionLinePart = {
  readonly text: string
  /** The complete signature, when this part is its compact display form. */
  readonly signature?: string
}

/** Keep execution grammar readable without changing the line that is run. */
export function executionLineParts(line: string): readonly ExecutionLinePart[] {
  const parts: ExecutionLinePart[] = []
  let cursor = 0

  for (const match of line.matchAll(SIGNATURE)) {
    const signature = match[0]
    const start = match.index
    if (start > cursor) parts.push({ text: line.slice(cursor, start) })
    parts.push({
      text: `${signature.slice(0, SIGNATURE_PREFIX_LENGTH)}…`,
      signature,
    })
    cursor = start + signature.length
  }

  if (cursor < line.length || parts.length === 0) parts.push({ text: line.slice(cursor) })
  return parts
}
