// assistant/line-diff.ts
//
// ONE DIFFERENCE AT A TIME (documentation/module-sandbox.md, "The communal
// build"): a source file before and after a change, as the rows a reader
// walks — what was removed, what was added, a little of what stayed around
// each, and the long unchanged stretches folded to a count.
//
// Myers' O((N+M)·D) diff over lines, after the common head and tail are
// trimmed: a draft usually changes a few lines of a long file, so D is small
// and the work is too. A change past `maxEdits` is read as a rewrite — every
// line out, every line in — rather than spending a page's memory on it.
//
// A dependency: it registers nothing.

export type DiffRow =
  | { readonly kind: 'same' | 'add' | 'remove'; readonly text: string }
  | { readonly kind: 'skip'; readonly count: number }

export interface LineDiff {
  readonly rows: readonly DiffRow[]
  readonly added: number
  readonly removed: number
}

type Edit = { readonly kind: 'same' | 'add' | 'remove'; readonly text: string }

const FOLD_MIN = 3

const splitLines = (text: string): string[] => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** The shortest edit script from `a` to `b`, or null past `maxEdits`. */
const myers = (a: readonly string[], b: readonly string[], maxEdits: number): Edit[] | null => {
  const n = a.length, m = b.length, max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  // Each round keeps only the diagonals it could have reached: 2d + 3 cells.
  const trace: Int32Array[] = []
  let done = false
  for (let d = 0; d <= Math.min(max, maxEdits) && !done; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x >= n && y >= m) { done = true; break }
    }
  }
  if (!done) return null

  const edits: Edit[] = []
  let x = n, y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const round = trace[d]!
    const at = (k: number): number => round[k + d + 1]!
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { edits.push({ kind: 'same', text: a[x - 1]! }); x--; y-- }
    if (d > 0) {
      if (x === prevX) edits.push({ kind: 'add', text: b[prevY]! })
      else edits.push({ kind: 'remove', text: a[prevX]! })
    }
    x = prevX; y = prevY
  }
  return edits.reverse()
}

/**
 * The rows a reader walks from `before` to `after`: every change with
 * `context` unchanged lines around it, and each longer unchanged stretch
 * folded to one `skip` row.
 */
export const diffLines = (before: string, after: string, options: { context?: number; maxEdits?: number } = {}): LineDiff => {
  const context = Math.max(0, options.context ?? 3)
  const a = splitLines(before), b = splitLines(after)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tailA = a.length, tailB = b.length
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA--; tailB-- }
  const middleA = a.slice(head, tailA), middleB = b.slice(head, tailB)
  const middle = myers(middleA, middleB, options.maxEdits ?? 2_000)
    ?? [...middleA.map(text => ({ kind: 'remove' as const, text })), ...middleB.map(text => ({ kind: 'add' as const, text }))]
  const edits: Edit[] = [
    ...a.slice(0, head).map(text => ({ kind: 'same' as const, text })),
    ...middle,
    ...a.slice(tailA).map(text => ({ kind: 'same' as const, text })),
  ]

  // Keep an unchanged line only when a change is within `context` of it.
  const near = new Uint8Array(edits.length)
  edits.forEach((edit, i) => {
    if (edit.kind === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(edits.length - 1, i + context); j++) near[j] = 1
  })
  // A fold shorter than FOLD_MIN lines would take as much room as the lines.
  const rows: DiffRow[] = []
  let skipped: Edit[] = []
  const flush = (): void => {
    if (skipped.length >= FOLD_MIN) rows.push({ kind: 'skip', count: skipped.length })
    else rows.push(...skipped)
    skipped = []
  }
  let added = 0, removed = 0
  edits.forEach((edit, i) => {
    if (edit.kind === 'add') added++
    if (edit.kind === 'remove') removed++
    if (edit.kind === 'same' && !near[i]) { skipped.push(edit); return }
    flush()
    rows.push(edit)
  })
  flush()
  return { rows, added, removed }
}
