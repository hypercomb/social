// note-marks.types.ts — the note-mark palette's module↔shell contract.
//
// A mark is `{ icon, name, role }`: a Material icon name, the meaning the
// user gave it, and the role that meaning plays in a notes tree. The ROLE
// LIVES ON THE MARK, not on the note. The three roles are two KINDS:
// `heading`/`list` rows are constrained POINTS (the structure of a
// document); `prose` rows are NOTES (its body). Views group and filter on
// the kind, never on a list of icon names.
//
// The implementation lives in essentials (notes/note-marks.store.ts) and
// registers under NOTE_MARKS_IOC_KEY. It announces the palette on EffectBus
// as NOTE_MARKS_CHANGED (current marks at load + every change — replay
// covers chrome that mounts before the notes module loads); consumers hold
// the instance only to WRITE. Absence collapses to an empty palette.

export const NOTE_MARKS_IOC_KEY = '@hypercomb.social/NoteMarks'

/** EffectBus effect — emitted with the current palette at load and on every
 *  change. */
export const NOTE_MARKS_CHANGED = 'notes:marks-changed'

/** What a mark's meaning DOES to the rows that carry it. */
export type MarkRole = 'heading' | 'list' | 'prose'

/** The two KINDS a role falls into — see the header. */
export type MarkKind = 'point' | 'note'

export const kindOfRole = (role: MarkRole): MarkKind =>
  role === 'prose' ? 'note' : 'point'

export type NoteMark = {
  /** Material symbol name, e.g. 'flag'. Also the mark's identity. */
  icon: string
  /** The meaning the user gave the icon. May be empty (unnamed but usable). */
  name: string
  role: MarkRole
}

export type NoteMarksChange = { marks: readonly NoteMark[] }

/** Material symbol names are lowercase words joined by underscores. Anything
 *  else is rejected outright — the icon name is interpolated into a ligature
 *  span, so it must never carry markup or whitespace. */
const ICON_RE = /^[a-z0-9_]{1,48}$/

/** Icon-name guard, exported so callers can reject a bad pick before it ever
 *  reaches a note layer. */
export const isMarkIcon = (v: unknown): v is string =>
  typeof v === 'string' && ICON_RE.test(v)

export interface NoteMarksProvider {
  readonly marks: readonly NoteMark[]
  /** True once the pool read has settled — lets a view distinguish "empty
   *  palette" from "not read yet" instead of flashing the empty state. */
  readonly loaded: boolean
  byIcon(icon: string | null | undefined): NoteMark | undefined
  /** Role a note carrying `icon` renders with; unknown icons fall back to
   *  'list'. */
  roleOf(icon: string | null | undefined): MarkRole
  add(icon: string, role?: MarkRole): void
  rename(icon: string, name: string): void
  setRole(icon: string, role: MarkRole): void
  remove(icon: string): void
}
