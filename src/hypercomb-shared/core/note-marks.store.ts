// hypercomb-shared/core/note-marks.store.ts
//
// THE NOTE MARK PALETTE — the user's own set of icons, and what each one
// MEANS.
//
// A mark is `{ icon, name, role }`: a Material icon name, the meaning the
// user gave it ("Decision", "Risk", "Step"), and the role that meaning plays
// in a notes tree. The ROLE LIVES ON THE MARK, not on the note: renaming or
// re-roling an icon restyles every note that carries it, which is the whole
// point of "give an icon meaning".
//
// THE THREE ROLES ARE TWO KINDS. `heading` (a section break) and `list` (an
// item under one) are both CONSTRAINED — a row in either role says one thing
// and says it in a line. `prose` is the unconstrained role: the longer form,
// a paragraph elaborating the point it hangs under.
//
// That split is the vocabulary the notes tree is built on. A note documents
// ONE thing, individually — never a relationship between things, which is
// what pheromones and references are for. A constrained row is therefore a
// POINT (the structure of a document), and a prose row is a NOTE (its body).
// The user says "point" and "note"; the code says `heading`/`list` and
// `prose`, the same way users say tiles and the code says cells.
//
// Consequence: nothing hardcodes which icons are points. A view that wants
// only the structure filters on `roleOf(icon) !== 'prose'`, and the user can
// re-role any icon at any time to change what their document's outline is.
//
// HIVE CONTENT, NOT BROWSER STATE. The palette is stored in the
// sign('notes:marks') pool of meaning as a single content-addressed document
// (Store.putPoolDoc/getPoolDoc), so it survives a browser wipe and travels
// with the hive like any other content. The meaning carries a COLON so its
// address can never collide with a root tile's lineage bag — see the pool
// rules in CLAUDE.md.
//
// Consumers resolve this via window.ioc.get('@hypercomb.social/NoteMarks')
// and listen for 'change'; absence collapses to an empty palette (notes then
// simply carry no mark).

import type { Store } from './store'

// Colon-carrying meaning: unproducible by any tile slug, so collision-proof.
const MARKS_MEANING = 'notes:marks'
const MARKS_SUBKEY = 'v1'

/** What a mark's meaning DOES to the rows that carry it. */
export type MarkRole = 'heading' | 'list' | 'prose'

const ROLES: ReadonlySet<string> = new Set<string>(['heading', 'list', 'prose'])

/** The two KINDS a role falls into — see the header. `point` rows are
 *  constrained to a line and carry the structure; `note` rows are the prose
 *  body. Views group and filter on this, never on a list of icon names. */
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

/** Material symbol names are lowercase words joined by underscores. Anything
 *  else is rejected outright — the icon name is interpolated into a ligature
 *  span, so it must never carry markup or whitespace. */
const ICON_RE = /^[a-z0-9_]{1,48}$/

/** Starter palette, written once on the very first load so the rail isn't an
 *  empty box. Editable and deletable like any other mark — the `seeded` flag
 *  in the document stops them growing back after a user clears them. */
const SEED: readonly NoteMark[] = Object.freeze([
  { icon: 'label', name: '', role: 'heading' },
  { icon: 'check_circle', name: '', role: 'list' },
  { icon: 'bolt', name: '', role: 'list' },
  // One prose mark so the note kind isn't an empty group on a fresh hive.
  // 'notes' is the Material glyph for a written page — the only seed whose
  // icon has to read as "the longer form" at a glance.
  { icon: 'notes', name: '', role: 'prose' },
])

const MAX_MARKS = 64

type MarksDoc = { v?: number; seeded?: boolean; prosed?: boolean; marks?: unknown }

export class NoteMarksStore extends EventTarget {

  #marks: readonly NoteMark[] = []
  #store: Store | undefined
  #loaded = false
  #seeded = false
  /** Whether the one-time prose top-up has run — see `#load`. Separate from
   *  `#seeded` so deleting the prose mark keeps it deleted. */
  #prosed = false

  public get marks(): readonly NoteMark[] { return this.#marks }

  /** True once the pool read has settled — lets a view distinguish "empty
   *  palette" from "not read yet" instead of flashing the empty state. */
  public get loaded(): boolean { return this.#loaded }

  public byIcon = (icon: string | null | undefined): NoteMark | undefined =>
    icon ? this.#marks.find(m => m.icon === icon) : undefined

  /** Role a note carrying `icon` renders with. Unknown icons (a mark deleted
   *  after notes were written with it) fall back to 'list' — the note keeps
   *  its glyph and simply stops acting as a heading. */
  public roleOf = (icon: string | null | undefined): MarkRole =>
    this.byIcon(icon)?.role ?? 'list'

  constructor() {
    super()
    window.ioc?.whenReady?.('@hypercomb.social/Store', (s: unknown) => {
      this.#store = s as Store
      void this.#load()
    })
  }

  /** Add an icon to the palette. No-op when it's already there (the icon IS
   *  the identity) or the name is malformed. */
  public add = (icon: string, role: MarkRole = 'list'): void => {
    const clean = (icon ?? '').trim()
    if (!ICON_RE.test(clean)) return
    if (this.#marks.some(m => m.icon === clean)) return
    if (this.#marks.length >= MAX_MARKS) return
    this.#commit([...this.#marks, { icon: clean, name: '', role }])
  }

  public rename = (icon: string, name: string): void => {
    const clean = (name ?? '').trim().slice(0, 40)
    this.#commit(this.#marks.map(m => (m.icon === icon ? { ...m, name: clean } : m)))
  }

  public setRole = (icon: string, role: MarkRole): void => {
    this.#commit(this.#marks.map(m => (m.icon === icon ? { ...m, role } : m)))
  }

  public remove = (icon: string): void => {
    const next = this.#marks.filter(m => m.icon !== icon)
    if (next.length === this.#marks.length) return
    this.#commit(next)
  }

  #commit(next: readonly NoteMark[]): void {
    this.#marks = Object.freeze(next.slice())
    this.dispatchEvent(new Event('change'))
    void this.#persist()
  }

  async #persist(): Promise<void> {
    // Never write before the initial read has merged, or a slow pool read
    // would be clobbered by an empty in-memory palette.
    if (!this.#store || !this.#loaded) return
    try {
      // Store registers in IoC BEFORE its OPFS root resolves; without this
      // await, the very first write (the seed) lands while getPool() still
      // returns null and is silently dropped. initialize() is memoised, so
      // this is a no-op on every later call.
      await this.#store.initialize()
      const pool = await this.#store.getPool(MARKS_MEANING)
      if (!pool) return
      const doc: MarksDoc = { v: 1, seeded: this.#seeded, prosed: this.#prosed, marks: this.#marks }
      const bytes = new TextEncoder().encode(JSON.stringify(doc))
      await this.#store.putPoolDoc(pool, bytes.buffer as ArrayBuffer, MARKS_SUBKEY)
    } catch { /* palette is a preference layer — a failed write is non-fatal */ }
  }

  async #load(): Promise<void> {
    try {
      await this.#store!.initialize()
      const pool = await this.#store!.getPool(MARKS_MEANING)
      const buf = await this.#store!.getPoolDoc(pool ?? undefined, MARKS_SUBKEY)
      if (buf) {
        const parsed = JSON.parse(new TextDecoder().decode(buf)) as MarksDoc
        this.#seeded = parsed?.seeded === true
        this.#prosed = parsed?.prosed === true
        this.#marks = Object.freeze(normalizeMarks(parsed?.marks))
      }
    } catch { /* absent or unreadable — fall through to the seed */ }
    this.#loaded = true
    let dirty = false
    if (!this.#seeded) {
      this.#seeded = true
      this.#marks = Object.freeze(this.#marks.length ? this.#marks.slice() : SEED.slice())
      dirty = true
    }
    if (!this.#prosed) {
      // One-time top-up for palettes seeded before the prose role existed.
      // Without it the note kind is an empty group on every hive that
      // already had a palette — the feature would look broken on exactly
      // the hives that use notes most. It carries its OWN flag rather than
      // riding `seeded`, so a user who deletes the prose mark never sees it
      // grow back — same contract the original seed makes.
      this.#prosed = true
      if (!this.#marks.some(m => m.role === 'prose') && this.#marks.length < MAX_MARKS) {
        this.#marks = Object.freeze([...this.#marks, ...SEED.filter(m => m.role === 'prose')])
      }
      dirty = true
    }
    if (dirty) void this.#persist()
    this.dispatchEvent(new Event('change'))
  }
}

/** Parse the stored array defensively — the pool is content the user (or a
 *  peer) could have written, so every field is validated and anything
 *  unrecognised is dropped rather than trusted. */
function normalizeMarks(raw: unknown): NoteMark[] {
  if (!Array.isArray(raw)) return []
  const out: NoteMark[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const rec = item as Partial<NoteMark> | null
    const icon = typeof rec?.icon === 'string' ? rec.icon.trim() : ''
    if (!ICON_RE.test(icon) || seen.has(icon)) continue
    seen.add(icon)
    out.push({
      icon,
      name: typeof rec?.name === 'string' ? rec.name.trim().slice(0, 40) : '',
      // Unknown / absent roles fall back to 'list' — the safe default, since
      // a list row is the least opinionated thing a mark can make a note.
      role: typeof rec?.role === 'string' && ROLES.has(rec.role) ? rec.role as MarkRole : 'list',
    })
    if (out.length >= MAX_MARKS) break
  }
  return out
}

/** Icon-name guard, exported so the strip can reject a bad pick before it
 *  ever reaches a note layer. */
export const isMarkIcon = (v: unknown): v is string =>
  typeof v === 'string' && ICON_RE.test(v)

export const NOTE_MARKS_IOC_KEY = '@hypercomb.social/NoteMarks'

register(NOTE_MARKS_IOC_KEY, new NoteMarksStore())
