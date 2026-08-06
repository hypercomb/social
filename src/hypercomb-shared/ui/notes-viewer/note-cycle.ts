// hypercomb-shared/ui/notes-viewer/note-cycle.ts
//
// The two pure decisions behind the notes reader, kept out of the component
// so they can be tested without an Angular harness (repo idiom — see
// presentation/tiles/wave-layout.ts).
//
//   flattenHierarchy — a root note plus its descendants, depth-first. This
//                      IS the reading order, and the order prev/next walks.
//   stepIndex        — where prev/next lands. It WRAPS at both ends: the
//                      cycle has no first and no last, so running off one
//                      end is how you arrive at the other.

/** The shape flattening needs. Deliberately structural — the reader's Note
 *  and the service's Note both satisfy it, and neither has to be imported. */
export type Nested<T> = T & { children: readonly Nested<T>[] }

export type Flattened<T> = {
  readonly note: Nested<T>
  readonly depth: number
}

/** Depth-first: a node, then each of its children in order, recursively. */
export function flattenHierarchy<T>(root: Nested<T> | null | undefined): Flattened<T>[] {
  if (!root) return []
  const out: Flattened<T>[] = []
  const walk = (note: Nested<T>, depth: number): void => {
    out.push({ note, depth })
    for (const child of note.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return out
}

/**
 * Move `from` by `delta` within `length`, WRAPPING in both directions.
 *
 * The double modulo is not decoration: JavaScript's `%` keeps the sign of the
 * left operand, so `-1 % 5` is `-1`, not `4`. Stepping backwards off the front
 * would land on a negative index and render nothing.
 *
 * `from` is clamped rather than trusted — a held focus can outlive the
 * hierarchy it pointed into when a write shortens the tree under it.
 */
export function stepIndex(from: number, delta: number, length: number): number {
  if (length <= 0) return 0
  const start = Math.max(0, Math.min(from, length - 1))
  return ((start + delta) % length + length) % length
}
