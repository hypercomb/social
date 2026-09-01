// notes/note-tree.ts
//
// The note tree algebra — pure, storage-free functions over a hydrated
// note tree, plus the value normalizers that decide what a shape and a
// mark are allowed to be.
//
// Split out of notes.drone.ts so this logic can be tested directly: the
// drone module instantiates NotesService and registers it into
// window.ioc at import time, so importing it from a spec boots a
// service. These functions have no such cost — they take a tree, return
// a new tree, and touch nothing.
//
// Every function here is immutable: input arrays and nodes are never
// mutated, and unchanged subtrees are returned by reference.
//
// That reference-holding is load-bearing for the caller, not a micro-
// optimization. These functions are used by flows that re-materialize
// the whole returned tree from the leaves up; a branch that came back
// as the same object is one the caller can recognize as untouched, and
// the Store dedups it back to its existing sig either way. Each walk
// therefore returns its INPUT array when no descendant changed —
// building a fresh array unconditionally would make the identity check
// at every call site dead code (it was, before `splitInTree`'s spec
// caught it).

/** Allowed shape tag values. Used as a presentation hint by the strip
 *  and viewer; null means "no tag, render as plain text only".
 *  Names are deliberately concrete (no `kind` / `category`) — they map
 *  1:1 to the CSS-drawn shape classes that paint the glyph. */
export type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

const SHAPE_IDS: ReadonlySet<string> = new Set<string>([
  'circle', 'square', 'triangle', 'diamond', 'star', 'hexagon',
])

export function normalizeShape(value: unknown): ShapeId | null {
  return typeof value === 'string' && SHAPE_IDS.has(value) ? (value as ShapeId) : null
}

/** A note's MARK — a Material icon name from the participant's own mark
 *  palette (the sign('notes:marks') pool). The note stores only the icon
 *  name; what it MEANS, and whether it makes the row a heading or a list
 *  item, lives on the palette entry, so re-roling an icon restyles every
 *  note carrying it.
 *
 *  Supersedes `shape` (the fixed six-glyph set) for new notes. `shape` is
 *  kept on the layer so notes written before marks existed still paint. */
const MARK_RE = /^[a-z0-9_]{1,48}$/

export function normalizeMark(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  return MARK_RE.test(clean) ? clean : null
}

/** A note's PHEROMONES. Tile decorations keep tag names free-form, so this
 *  matches them rather than inventing a stricter vocabulary — a keyword must
 *  mean one thing wherever it lands. The only guard is structural: one line,
 *  bounded length. */
const TAG_RE = /^[^\r\n\t]{1,48}$/

export const MAX_NOTE_TAGS = 24

/** Whether a value could be a pheromone name. Exported so the drone can
 *  reject a bad one before it reaches a note layer. */
export const isNoteTag = (v: unknown): v is string =>
  typeof v === 'string' && TAG_RE.test(v.trim())

/**
 * Validate + canonicalise a note's pheromone list. The value comes off disk
 * (or a peer's hive), so nothing is trusted: non-strings are dropped,
 * duplicates collapse, and the result is SORTED — two notes carrying the same
 * set must materialize to the same bytes, which is the whole point of a
 * content-addressed layer.
 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const clean = item.trim()
    if (!TAG_RE.test(clean) || seen.has(clean)) continue
    seen.add(clean)
    if (seen.size >= MAX_NOTE_TAGS) break
  }
  return [...seen].sort()
}

/** Storage shape on disk — the canonical JSON every note blob holds.
 *
 *  `tags` is OPTIONAL and omitted entirely when empty. That is deliberate:
 *  an untagged note must serialize to exactly the bytes it did before
 *  pheromones existed, so re-materializing an untouched subtree (every nest /
 *  mark / split / delete does this) still dedups back to its existing sig
 *  instead of re-signing the whole tree. */
export type NoteLayer = {
  note: string
  shape: ShapeId | null
  mark: string | null
  children: string[]
  tags?: string[]
}

/**
 * Consumer-facing note shape (notes-strip, notes-viewer, etc).
 *
 * `id` is the note's layer signature — stable for the lifetime of those
 * exact bytes. Edit the text → new layer → new sig → consumers will see
 * a different `id` for the edited version. There is no separate
 * "identity across edits" concept; each version is its own entity.
 */
export type Note = {
  id: string
  text: string
  shape: ShapeId | null
  mark: string | null
  /** Pheromones the participant put on this note. Always an array here
   *  (empty when the layer omits the slot) so consumers never branch. */
  tags: string[]
  children: Note[]
}

/**
 * A part handed to `splitInTree` — the text of a sub-note, optionally
 * with the mark it should carry. A bare string is the same thing with
 * no mark.
 *
 * Marks travel with the parts on purpose. A split is the moment the
 * structure of a note becomes visible, and the mark is what carries
 * that structure (heading vs list item lives on the palette entry, not
 * the note); making the caller follow up with one `markAtSegments` per
 * part would mint one layer per mark and bury the split in history.
 */
export type NotePart = { text: string; mark?: string | null }

/** Placeholder id for a node that does not exist in storage yet.
 *  Materialization derives the real id from the node's bytes and never
 *  reads this field, so a fresh node carries the empty sig until it is
 *  written. */
const UNWRITTEN = ''

/**
 * Walk `tree` and return a new tree without the first occurrence of
 * `noteId`, alongside the removed node (if any). Operates immutably —
 * input arrays / objects are untouched. Used by tree-mutating flows
 * that re-materialize the modified tree afterwards.
 */
export function removeFromTree(
  tree: readonly Note[],
  noteId: string,
): { tree: readonly Note[]; removed: Note | null } {
  let removed: Note | null = null
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (removed) {
        // Already found the target this walk; just copy the rest.
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        removed = n
        mutated = true
        continue  // drop this node
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, removed }
}

/**
 * Insert `node` among the children of `parentId` at `index` — or among
 * the roots, when `parentId` is null. The index is clamped, so a value
 * past the end appends. Immutable.
 *
 * The ORDERING counterpart of `insertAsChild`, which can only append.
 * Placing a node at a position among its siblings AT ANY DEPTH is what a
 * hierarchical list needs and what neither `insertAsChild` (append) nor
 * the top-level-only reorder of the notes slot could express.
 */
export function insertAtIndex(
  tree: readonly Note[],
  parentId: string | null,
  node: Note,
  index: number,
): { tree: readonly Note[]; placed: boolean } {
  const put = (list: readonly Note[]): Note[] => {
    const at = Math.max(0, Math.min(index, list.length))
    return [...list.slice(0, at), node, ...list.slice(at)]
  }
  if (parentId === null) return { tree: put(tree), placed: true }
  let placed = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (placed) {
        next.push(n)
        continue
      }
      if (n.id === parentId) {
        placed = true
        mutated = true
        next.push({ ...n, children: put(n.children) })
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, placed }
}

/**
 * Insert `node` as the last child of the first occurrence of
 * `targetParentId` in `tree`. Returns the new tree and a flag
 * indicating whether the parent was found. Immutable — input arrays /
 * objects untouched.
 */
export function insertAsChild(
  tree: readonly Note[],
  targetParentId: string,
  node: Note,
): { tree: readonly Note[]; placed: boolean } {
  let placed = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (placed) {
        next.push(n)
        continue
      }
      if (n.id === targetParentId) {
        placed = true
        mutated = true
        next.push({ ...n, children: [...n.children, node] })
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, placed }
}

/**
 * Return a new tree with the first occurrence of `noteId` carrying
 * `mark` (null clears it). `changed` is false when the node isn't in the
 * tree or already carries exactly that mark — the caller skips the commit
 * so a no-op drag doesn't mint a history entry. Immutable.
 */
export function setMarkInTree(
  tree: readonly Note[],
  noteId: string,
  mark: string | null,
): { tree: readonly Note[]; changed: boolean } {
  let changed = false
  let found = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (found) {
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        found = true
        if (n.mark === mark) {
          next.push(n)
        } else {
          changed = true
          mutated = true
          next.push({ ...n, mark })
        }
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, changed }
}

/**
 * Return a new tree with `tag` added to (or removed from) the first
 * occurrence of `noteId` — the pheromone counterpart of `setMarkInTree`,
 * and immutable in the same reference-preserving way.
 *
 * `changed` is false when the node isn't in the tree or already sits in the
 * requested state, so re-dropping a keyword a note already carries is a true
 * no-op rather than a fresh revision. The DIRECTION is the caller's to
 * decide: a second drop must never silently un-tag.
 */
export function setTagInTree(
  tree: readonly Note[],
  noteId: string,
  tag: string,
  add: boolean,
): { tree: readonly Note[]; changed: boolean } {
  let changed = false
  let found = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (found) {
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        found = true
        const has = n.tags.includes(tag)
        if (has === add) {
          next.push(n)
        } else {
          changed = true
          mutated = true
          next.push({
            ...n,
            tags: add ? normalizeTags([...n.tags, tag]) : n.tags.filter(t => t !== tag),
          })
        }
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, changed }
}

/**
 * Return a new tree with the first occurrence of `noteId` carrying `text`
 * (and `mark`, when the caller passes one) — the text counterpart of
 * `setMarkInTree`, immutable in the same reference-preserving way.
 *
 * This is how a note is RETEXTED at any depth. The `note:commit` edit path
 * can only rewrite a TOP-LEVEL entry (it swaps one sig in the cell's root
 * slot and writes a childless layer), so editing a nested note through it
 * silently does nothing and editing a parent drops its children. A list
 * item is nested by definition, so the list interface needs this.
 *
 * `changed` is false when the node isn't in the tree, when the trimmed text
 * is empty (a blank is a delete, and the caller has to say so explicitly),
 * or when nothing about the node would actually differ.
 */
export function setTextInTree(
  tree: readonly Note[],
  noteId: string,
  text: string,
  mark?: string | null,
): { tree: readonly Note[]; changed: boolean } {
  const clean = String(text ?? '').trim()
  if (!clean) return { tree, changed: false }
  const nextMark = mark === undefined ? undefined : normalizeMark(mark)
  let changed = false
  let found = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (found) {
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        found = true
        const sameText = n.text === clean
        const sameMark = nextMark === undefined || n.mark === nextMark
        if (sameText && sameMark) {
          next.push(n)
        } else {
          changed = true
          mutated = true
          next.push({ ...n, text: clean, mark: nextMark === undefined ? n.mark : nextMark })
        }
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, changed }
}

/**
 * Append a BRAND NEW child under the first occurrence of `parentId` — the
 * one-line-at-a-time gesture the list interface is built on.
 *
 * `insertAsChild` moves an EXISTING node; this one mints a node that has no
 * bytes yet (empty `id`, like `splitInTree`'s parts — the caller's
 * materialization walk derives the real signature when it writes it).
 *
 * `changed` is false when the parent isn't in the tree or the text trims to
 * nothing, so an accidental Enter on an empty line never mints a revision.
 */
export function addChildInTree(
  tree: readonly Note[],
  parentId: string,
  text: string,
  mark?: string | null,
): { tree: readonly Note[]; changed: boolean } {
  const clean = String(text ?? '').trim()
  if (!clean || !parentId) return { tree, changed: false }
  const node: Note = {
    id: UNWRITTEN,
    text: clean,
    shape: null,
    mark: normalizeMark(mark),
    tags: [],
    children: [],
  }
  const { tree: nextTree, placed } = insertAsChild(tree, parentId, node)
  return { tree: nextTree, changed: placed }
}

/**
 * Break the first occurrence of `noteId` into a one-line head plus one
 * sub-note per part, IN PLACE.
 *
 * The node keeps its position in its parent's list, its mark, its legacy
 * shape, and every child it already had — the new parts are prepended to
 * those children, so a note that was already a small tree grows rather
 * than being flattened. Only `text` is replaced, by `head`.
 *
 * In place is the whole point. Expressed with the existing add / nest /
 * delete calls, a split costs one layer per part plus one for the
 * delete, loses the note's position in the list, and drops its mark.
 * Here it is one node swap, so the caller's single commit is one layer
 * for the whole split — which is what makes a bulk breakdown pass
 * produce readable history.
 *
 * `changed` is false — and the tree returned unmodified — when:
 *   - `noteId` isn't in the tree,
 *   - `head` is blank (a head is EXTRACTED from the note, never invented;
 *     a caller with nothing to promote should leave the note alone), or
 *   - no part survives trimming (a split into nothing is a no-op, not a
 *     way to retitle a note — `note:commit` with an editId does that).
 *
 * Part nodes come back with an empty `id`: they have no bytes yet, so
 * they have no signature. The caller's materialization walk derives the
 * real ids when it writes them.
 */
export function splitInTree(
  tree: readonly Note[],
  noteId: string,
  head: string,
  parts: readonly (string | NotePart)[],
): { tree: readonly Note[]; changed: boolean } {
  const cleanHead = String(head ?? '').trim()
  const partNodes: Note[] = []
  for (const part of parts ?? []) {
    const raw = typeof part === 'string' ? { text: part } : part
    const text = String(raw?.text ?? '').trim()
    if (!text) continue
    partNodes.push({
      id: UNWRITTEN,
      text,
      shape: null,
      mark: normalizeMark(raw?.mark),
      // Parts start unpheromoned. The HEAD keeps whatever the note carried
      // (it is spread below, so its tags travel) — the head IS the note
      // continuing, while a part is new material nobody has marked yet.
      tags: [],
      children: [],
    })
  }
  if (!cleanHead || partNodes.length === 0) return { tree, changed: false }

  let changed = false
  const walk = (nodes: readonly Note[]): readonly Note[] => {
    let mutated = false
    const next: Note[] = []
    for (const n of nodes) {
      if (changed) {
        next.push(n)
        continue
      }
      if (n.id === noteId) {
        changed = true
        mutated = true
        next.push({ ...n, text: cleanHead, children: [...partNodes, ...n.children] })
        continue
      }
      const newChildren = walk(n.children)
      if (newChildren !== n.children) {
        mutated = true
        next.push({ ...n, children: newChildren as Note[] })
      } else {
        next.push(n)
      }
    }
    return mutated ? next : nodes
  }
  const nextTree = walk(tree)
  return { tree: nextTree, changed }
}

/**
 * Whether `node` or any of its descendants has id `targetId`. Used to
 * reject nest operations that would create a cycle (moving a parent
 * underneath one of its own descendants).
 */
export function subtreeContains(node: Note, targetId: string): boolean {
  if (node.id === targetId) return true
  for (const child of node.children) {
    if (subtreeContains(child, targetId)) return true
  }
  return false
}
