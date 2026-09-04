// notes/note-classify.ts
//
// THE POINTS / NOTES SPLIT — one definition of "is this root structure or is
// it prose", so every surface that shows a tile's writing splits it the same
// way.
//
// The vocabulary is the mark palette's (hypercomb-shared/core/note-marks.store.ts):
// a mark's ROLE is `heading` | `list` | `prose`, and the two constrained roles
// are POINTS while `prose` is the NOTE. The details window calls the two
// tabs "lists" and "notes"; this module keeps those user words on the outside
// (`lists` / `notes` on the split's result) and the role words on the inside.
//
// Pure — a note tree in, a classification out. The palette is passed in as a
// `roleOf` function because the palette store lives in the shell (resolved via
// IoC at `@hypercomb.social/NoteMarks`) and a module must never import from
// there; absence collapses to "no palette", which is the same answer the strip
// gives when the store has not loaded.

import type { Note } from './note-tree.js'

/** What a mark's meaning does to the row carrying it. Mirrors `MarkRole` in
 *  the shell's palette store — restated here because essentials cannot import
 *  it, and the three words are the vocabulary, not an implementation. */
export type NoteRole = 'heading' | 'list' | 'prose'

/** Resolves a mark icon to its role. Unknown icons fall back to 'list' — a
 *  note keeps its glyph when the palette entry is deleted and simply stops
 *  acting as a heading. */
export type RoleResolver = (icon: string | null | undefined) => NoteRole

/** A note row's conversational kind. `[Q]` / `[A:…]` prefixes are the legacy
 *  markers the ask-gate writes; they are conversation wherever they appear. */
export type NoteKind = 'q' | 'a' | 'note'

export function noteKindOf(note: Pick<Note, 'text'>): NoteKind {
  const trimmed = (note?.text ?? '').trimStart()
  if (trimmed.startsWith('[Q]')) return 'q'
  if (trimmed.startsWith('[A:') || trimmed.startsWith('[A ')) return 'a'
  return 'note'
}

const ANSWER_PREFIX = /^\[A[:\s][^\]]*\]\s*/

/** The text as a reader should see it — the bracket marker is redundant once
 *  the row is styled as a question or an answer. */
export function noteDisplayText(note: Pick<Note, 'text'>): string {
  const raw = note?.text ?? ''
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[Q]')) return trimmed.slice(3).trimStart()
  const answer = ANSWER_PREFIX.exec(trimmed)
  return answer ? trimmed.slice(answer[0].length) : raw
}

/**
 * Does this ROOT belong to the structure (a list) rather than the prose?
 *
 * A point is a root carrying a heading/list mark, or a root with children —
 * a nested tree IS a hierarchical list. Questions and answers are
 * conversation, so they stay prose whatever their shape. An unmarked leaf is
 * a plain note: the mark is read directly here rather than through
 * `roleOf`'s 'list' default, which exists for ROW STYLING.
 *
 * Only roots are classified — a list's prose children belong to their list.
 */
export function isPointRoot(note: Note, roleOf?: RoleResolver): boolean {
  const kind = noteKindOf(note)
  if (kind === 'q' || kind === 'a') return false
  if (note.children.length > 0) return true
  if (!note.mark) return false
  const role = roleOf?.(note.mark) ?? 'list'
  return role === 'heading' || role === 'list'
}

/** The tile's writing, split the way the details window splits it:
 *  `lists` is the structure, `notes` is the prose and the conversation. */
export function splitNoteRoots(
  notes: readonly Note[],
  roleOf?: RoleResolver,
): { lists: Note[]; notes: Note[] } {
  const lists: Note[] = []
  const prose: Note[] = []
  for (const note of notes) (isPointRoot(note, roleOf) ? lists : prose).push(note)
  return { lists, notes: prose }
}

/** The palette's role resolver, or undefined when the shell has not
 *  registered one. Structural: the store lives in the shell and is reached
 *  through IoC, never through an import. */
export function paletteRoleResolver(): RoleResolver | undefined {
  const marks = window.ioc?.get?.('@hypercomb.social/NoteMarks') as
    { roleOf?: RoleResolver } | undefined
  return typeof marks?.roleOf === 'function' ? marks.roleOf : undefined
}
