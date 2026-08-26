// hypercomb-core/src/core/note-cycle.ts
//
// The two pure decisions behind the notes reader, kept out of the view so
// they can be tested without a DOM (repo idiom — see note-tree.ts beside it).
//
//   flattenHierarchy — a root note plus its descendants, depth-first. This
//                      IS the reading order, and the order prev/next walks.
//   stepIndex        — where prev/next lands. It WRAPS at both ends: the
//                      cycle has no first and no last, so running off one
//                      end is how you arrive at the other.
//
// IT LANDED IN CORE, not beside the notes viewer, because TWO surfaces
// read it and they sit on opposite sides of the dependency rule: the
// converted notes-viewer element in essentials, and notes-strip, which is
// still an Angular component in shared — and shared may never import
// essentials. A primitive both kits need is what core is for. No imports
// at all, so it costs either bundle nothing but its bytes.
//
// Second instance of this shape: file-icons.ts moved down for exactly the
// same reason one batch earlier. The tell is that the build breaks on the
// STAYING component's import, never on the port.

// everything-is-a-beehavior Phase 2 pass that turned the notes reader into a
// framework-free custom element. Byte-identical logic; only the header
// comment names the new home. The shared copy stays until notes-strip (which
// imports `stepIndex` for its own reading pane) converts too.

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
