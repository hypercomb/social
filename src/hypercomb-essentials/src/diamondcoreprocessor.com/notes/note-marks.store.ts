// note-marks.store.ts — THE NOTE MARK PALETTE: the user's own set of icons,
// and what each one MEANS. Renaming or re-roling an icon restyles every note
// that carries it — that is the whole point of "give an icon meaning". The
// vocabulary contract (roles, kinds, guards) lives in core
// (note-marks.types.ts); the doctrine header rides with it there.
//
// HIVE CONTENT, NOT BROWSER STATE. The palette is stored in the
// sign('notes:marks') pool of meaning as a single content-addressed document
// (Store.putPoolDoc/getPoolDoc), so it survives a browser wipe and travels
// with the hive like any other content. The meaning carries a COLON so its
// address can never collide with a root tile's lineage bag.
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1.
// Announces the palette on EffectBus (NOTE_MARKS_CHANGED, at load + every
// change — replay covers chrome that mounts before this module loads);
// consumers hold the instance (NOTE_MARKS_IOC_KEY) only to WRITE. Absence
// collapses to an empty palette — notes then simply carry no mark.

import {
  EffectBus,
  NOTE_MARKS_IOC_KEY,
  NOTE_MARKS_CHANGED,
  isMarkIcon,
  type MarkRole,
  type NoteMark,
  type NoteMarksProvider,
} from '@hypercomb/core'

// Colon-carrying meaning: unproducible by any tile slug, so collision-proof.
const MARKS_MEANING = 'notes:marks'
const MARKS_SUBKEY = 'v1'

const ROLES: ReadonlySet<string> = new Set<string>(['heading', 'list', 'prose'])

/** The slice of Store this palette needs — reached through IoC, never an
 *  import (the store lives in shared until its own Phase 1 move). */
type PoolDocStore = {
  initialize(): Promise<unknown>
  getPool(meaning: string): Promise<unknown>
  putPoolDoc(pool: unknown, bytes: ArrayBuffer, subkey: string): Promise<unknown>
  getPoolDoc(pool: unknown, subkey: string): Promise<ArrayBuffer | null | undefined>
}

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

export class NoteMarksStore extends EventTarget implements NoteMarksProvider {

  #marks: readonly NoteMark[] = []
  #store: PoolDocStore | undefined
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
      this.#store = s as PoolDocStore
      void this.#load()
    })
  }

  /** Add an icon to the palette. No-op when it's already there (the icon IS
   *  the identity) or the name is malformed. */
  public add = (icon: string, role: MarkRole = 'list'): void => {
    const clean = (icon ?? '').trim()
    if (!isMarkIcon(clean)) return
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
    this.#announce()
    void this.#persist()
  }

  #announce(): void {
    this.dispatchEvent(new Event('change'))
    EffectBus.emit(NOTE_MARKS_CHANGED, { marks: this.#marks })
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
    this.#announce()
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
    if (!isMarkIcon(icon) || seen.has(icon)) continue
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

export const noteMarksStore = new NoteMarksStore()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureNoteMarksRegistered = (): void => {
  if (!window.ioc?.has?.(NOTE_MARKS_IOC_KEY)) {
    window.ioc?.register?.(NOTE_MARKS_IOC_KEY, noteMarksStore)
  }
}
ensureNoteMarksRegistered()
