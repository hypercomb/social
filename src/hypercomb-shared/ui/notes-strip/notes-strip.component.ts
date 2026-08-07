// hypercomb-shared/ui/notes-strip/notes-strip.component.ts
//
// A slim horizontal strip rendered just below the command line that lists the
// notes for the currently active tile. Click a note to open the centred
// viewer; click the plus to enter capture mode for that tile. Collapses
// entirely when the active tile has no notes.

import { Component, ElementRef, HostBinding, HostListener, computed, effect, inject, signal, untracked, viewChild, type OnDestroy } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { DockInsetDirective } from '../dock-inset/dock-inset.directive'
// Settings-only: the gear + group chrome every tool window carries. The strip
// keeps its own edge handles and width store (`ownsSize` false) — see the
// directive's header.
import { HcDockedPanelDirective } from '../docked-panel/hc-docked-panel.directive'
import { type WindowSession } from '../window-session'
import { registerShellSurface } from '../../core/shell-surface-registry'
import { fromRuntime } from '../../core/from-runtime'
import {
  NOTE_MARKS_IOC_KEY,
  isMarkIcon,
  kindOfRole,
  type MarkKind,
  type MarkRole,
  type NoteMark,
  type NoteMarksStore,
} from '../../core/note-marks.store'
import { requestIconPick } from '../../core/icon-pick'
// The reading cycle's wrap arithmetic — shared with the standalone reader so
// prev/next behave identically wherever notes are read.
import { stepIndex } from '../notes-viewer/note-cycle'

// Correlation token for this window's requests to the shared icon chooser
// (see core/icon-pick.ts). The chooser also serves the tile-icon override
// flow, whose ids are real element ids, so every requester names itself.
const MARK_PICK_ID = 'notes:mark-palette'

// Participant-local render index: locationSig (or bare label) -> props-resource
// sig, written by the renderer for every tile it paints. Read-only here, and
// O(1) — the identity plate never triggers a cold tree walk to find a picture.
const TILE_PROPS_INDEX_KEY = 'hc:tile-props-index'
const SIG_RE = /^[0-9a-f]{64}$/i

// Panel width (px) at which the identity plate earns its large form: the
// hexagon grows and the tile's details sit beside it. Below it the plate stays
// a single compact line — a narrow dock has no room for a picture.
const PLATE_WIDE_AT = 400

// Hover-list dwell (ms). Long enough that sweeping the pointer across the tile
// navigator doesn't strobe cards, short enough to feel like a peek.
const HOVER_OPEN_DELAY = 180
const HOVER_CLOSE_DELAY = 120

// Rows the navigator's hover list shows before it truncates to "+N more".
const HOVER_LIST_MAX = 10



// localStorage keys for the slide-resizable panel. Persisted as integer
// pixel strings; missing/non-numeric values fall back to the CSS defaults
// (28rem wide, content-height tall).
const NOTES_STRIP_WIDTH_KEY = 'hc:notes-strip-width'

// Translate delta from the panel's natural (centered) position. Persisted
// across reloads so the strip stays where the user dropped it.
const NOTES_STRIP_OFFSET_KEY = 'hc:notes-strip-offset'

// Dock side — 'right' snaps the strip to a full-height rail on the right
// edge (so it never fights the left-docked control bar); 'float' is the
// free, draggable, centred-baseline mode. Persisted across reloads.
const NOTES_STRIP_DOCK_KEY = 'hc:notes-strip-dock'

// Right-edge snap thresholds (mirror the controls-bar hysteresis): enter
// the dock within SNAP_ZONE of the right edge; only leave it once the
// cursor pulls back past SNAP_EXIT, so the dock doesn't flicker on/off.
const SNAP_ZONE = 72
const SNAP_EXIT = 120

// Travel (px) a dragbar press must cover before it counts as a drag. Below it
// the press is still a click: a docked panel must not tear off its rail because
// the pointer twitched a pixel while the user reached for the close button.
const DRAG_THRESHOLD = 6

/** Fixed shape set — six CSS-drawn glyphs. The shape is the only
 *  visual category a note carries. Names map 1:1 to .hc-shape-X
 *  classes defined in hypercomb-shared/styles/_notes-shapes.scss. */
export type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

type Note = {
  id: string
  text: string
  shape: ShapeId | null
  /** Material icon name from the participant's mark palette. Supersedes
   *  `shape`; notes written before marks existed carry only a shape. */
  mark: string | null
  /** Pheromones on the note itself. Older services predate the slot, so
   *  reads go through `readingTags()` rather than touching it directly. */
  tags?: string[]
  children: Note[]
}

type NotesService = {
  notesFor(cellLabel: string): Note[]
  getNotes(cellLabel: string): Promise<Note[]>
}

type SelectionService = EventTarget & {
  active: string | null
  selected: ReadonlySet<string>
  count: number
}

/** Single open question — Claude's side of the comm channel.
 *  Lives in the cell's `qa` layer slot (or in the sign('optimization')
 *  pool with kind=qa for the substrate-stored variant) as a
 *  content-addressed JSON: `{ qId, question, askedAt }`. Surfaced into
 *  the notes strip alongside user notes so the conversation reads in
 *  one list. */
type QaItem = {
  qId: string
  question: string
}

type HistoryServiceLike = {
  sign(lineageLike: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ qa?: unknown; children?: unknown; properties?: unknown } | null>
}

type StoreLike = {
  resolve<T = unknown>(value: unknown): Promise<T>
  getResource?(sig: string): Promise<Blob | null | undefined>
}

/** What one read of a cell's head layer yields beyond its notes: the open
 *  questions, how many child tiles it holds, and the canonical props-resource
 *  sig (hop one of two to the tile's picture). Gathered in ONE `currentLayerAt`
 *  call — the same call the qa slot already needed — so the identity plate and
 *  the navigator's hover list cost no extra layer reads. */
type CellFacts = {
  qa: readonly QaItem[]
  childCount: number
  propsSig: string | null
}

type LineageLike = {
  explorerSegments?: () => readonly string[]
}

/** Structural type for the InputModeStack lookup — avoids a build-time
 *  import from essentials (shared must never import from modules).
 *  Resolved at runtime via window.ioc, falls through cleanly if the
 *  service isn't registered (dev/test environments). */
type InputModeLike = { name: string; mount(): void; unmount(): void }
type InputModeStackLike = {
  push(mode: InputModeLike): void
  pop(name: string): void
  remove(name: string): void
}

@Component({
  selector: 'hc-notes-strip',
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet, DockInsetDirective, HcDockedPanelDirective],
  templateUrl: './notes-strip.component.html',
  styleUrls: ['./notes-strip.component.scss'],
})
export class NotesStripComponent implements OnDestroy {

  readonly #activeCell = signal<string | null>(null)
  readonly #capturingFor = signal<string | null>(null)
  readonly #version = signal(0)
  // Monotonic id source for optimistic (not-yet-persisted) note rows.
  #pendingSeq = 0
  // Cells whose decoded-set cache has been confirmed populated. Without
  // this, cells whose set resource hasn't been parsed yet return [] from
  // notesFor() and would race into the empty-cells footer before their
  // warmup promise resolves. Tracking confirmed-warmed cells lets the
  // empty classifier wait for actual evidence instead of guessing.
  readonly #warmed = signal<ReadonlySet<string>>(new Set())
  // Resolved notes per cell, stored directly from getNotes() so reads
  // don't depend on the sync peek cache. On hypercomb-web the peek cache
  // is populated lazily and may not contain participant layers — sync
  // notesFor() returns [] in that state. By caching the async result of
  // getNotes (which goes through the OPFS-direct path), the strip always
  // shows what the write side would see.
  readonly #notesByCell = signal<ReadonlyMap<string, readonly Note[]>>(new Map())
  // NotesService availability tracked as a signal so the warmup effect
  // re-runs when the bee bundle finally registers. Without this, the
  // effect runs ONCE at construction with `this.#notes` returning
  // undefined (bee not loaded yet on hypercomb-web), early-exits, and
  // never fires again because window.ioc registration isn't a signal —
  // the effect has nothing to react to. cell() changes WOULD cause a
  // re-run, but on web the timing is: constructor → effect runs (svc=undef)
  // → bee loads → user clicks tile → cell() changes → effect re-runs
  // (svc now ok). The re-run path works in theory, but only fires once
  // per selection change. The signal version closes the gap by firing
  // the effect AS SOON AS the service registers, regardless of selection.
  readonly #notesServiceReady = signal<boolean>(false)

  // Per-cell qa items resolved from the layer's `qa` slot. The notes
  // strip surfaces these alongside regular notes so the user sees the
  // full comm transcript: Claude's questions (qa-slot, yellow rows) +
  // user notes (which include the user's answer notes `[A:<qId>] …`).
  // When a question is answered the answer-note appears in the strip
  // and the qa slot is cleared by the editor's submit path — Claude
  // sees the answer-note on its next walk and updates its model.
  readonly #qaByCell = signal<ReadonlyMap<string, readonly QaItem[]>>(new Map())

  // Per-cell facts read off the same head layer as the qa slot — child count
  // and canonical props sig. Feeds the identity plate (which tile am I writing
  // on, what does it look like, what does it hold).
  readonly #factsByCell = signal<ReadonlyMap<string, { childCount: number; propsSig: string | null }>>(new Map())

  // Master open/closed state for the strip. The strip NEVER auto-opens on
  // selection anymore — it shows only when the user explicitly turns it on
  // via the control-bar Notes toggle (which messages `notes:panel`) or when
  // authoring a note (capture mode, which also flips this on). Session-only:
  // defaults closed on every load and is not persisted, so a refresh never
  // brings the strip back on its own. Mirrors the clipboard side panel.
  readonly #open = signal<boolean>(false)

  /**
   * Display mode — `chips` is the horizontal scrolling chip row, `rows` is
   * the vertical stack (better for long sentence-style rules). Persisted
   * per user; defaults to `rows` so longer note text reads naturally.
   */
  readonly mode = signal<'chips' | 'rows'>(
    (localStorage.getItem('hc:notes-strip-mode') as 'chips' | 'rows' | null) ?? 'rows'
  )

  /**
   * Which tab of the ANNOTATIONS WINDOW is showing — `notes` is the editor
   * this strip has always been, `lists` is the embedded aggregate index
   * (Collections & friends). One window, one rail icon; the tab is the only
   * mode switch. Persisted so the window reopens the way it was left.
   */
  readonly tab = signal<'notes' | 'lists'>(
    (localStorage.getItem('hc:annotations-tab') as 'notes' | 'lists' | null) ?? 'notes'
  )

  setTab(next: 'notes' | 'lists'): void {
    if (next === this.tab()) return
    this.tab.set(next)
    // A new tab is a new document — reading starts back at the top of it.
    this.readingIndex.set(0)
    try { localStorage.setItem('hc:annotations-tab', next) } catch { /* ignore */ }
  }

  // ── Reading pane (fullscreen) ─────────────────────────────
  // Fullscreen is the desk: navigator left, tree centre, and THIS on the
  // right — the selected note, big. Clicking a row in the tree focuses it
  // here; prev/next walk the visible tree depth-first and WRAP at both
  // ends (the cycle the standalone reader established — note-cycle.ts).
  // The pane follows the active tab: on `lists` it reads the lists.

  /** Which row of the flattened visible tree the pane is showing. Clamped
   *  on read, never trusted — an edit can shrink the tree under it, and
   *  re-reading by POSITION is what keeps the pane steady across a write
   *  (the note at row 3 is still the note at row 3). */
  readonly readingIndex = signal(0)

  /** The active tab's tree, flattened depth-first — parent, then its
   *  children in order, recursively. This IS the reading order. Collapse
   *  state is deliberately ignored: reading sees the whole document. */
  readonly readingRows = computed<readonly { note: Note; depth: number }[]>(() => {
    const out: { note: Note; depth: number }[] = []
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) { out.push({ note: n, depth }); walk(n.children, depth + 1) }
    }
    walk(this.visibleNotes(), 0)
    return out
  })

  /** The note under the big glyph. Null only when the tab is empty. */
  readonly readingRow = computed<{ note: Note; depth: number } | null>(() => {
    const rows = this.readingRows()
    if (rows.length === 0) return null
    return rows[Math.min(this.readingIndex(), rows.length - 1)] ?? null
  })

  /** 1-based position for the "3 / 11" readout between prev/next. */
  readonly readingPosition = computed<number>(() => {
    const rows = this.readingRows()
    return rows.length === 0 ? 0 : Math.min(this.readingIndex(), rows.length - 1) + 1
  })

  /** Ancestor texts of the reading note — the breadcrumb that says WHERE
   *  in the hierarchy the big note sits. Empty for roots. */
  readonly readingPath = computed<readonly string[]>(() => {
    const target = this.readingRow()?.note.id
    if (!target) return []
    const walk = (nodes: readonly Note[], trail: readonly string[]): readonly string[] | null => {
      for (const n of nodes) {
        if (n.id === target) return trail
        const found = walk(n.children, [...trail, this.noteDisplayText(n)])
        if (found) return found
      }
      return null
    }
    return walk(this.visibleNotes(), []) ?? []
  })

  /** Click a tree row while fullscreen → read it here. */
  selectForReading(noteId: string): void {
    const idx = this.readingRows().findIndex(r => r.note.id === noteId)
    if (idx >= 0) this.readingIndex.set(idx)
  }

  // ── Editing IN the pane ───────────────────────────────────
  // On the desk, the pane is where notes are big — so it is where they are
  // WRITTEN. The one embedded form (state, kind toggle, mark staging,
  // commit path — all unchanged) renders in the pane instead of the centre
  // column whenever the pane exists; `paneEditorOpen` flips the pane
  // between reading and that editor. Narrow fullscreen has no pane (the
  // SCSS hides it), so the form stays in the centre there — `deskWide`
  // tracks the same 1024px break the grid uses.

  /** Mirrors the desk's CSS breakpoint ($bp-tablet-land). */
  readonly deskWide = signal<boolean>(window.matchMedia('(min-width: 1024px)').matches)

  /** True when the pane exists — the form renders THERE, not the centre. */
  readonly formInPane = computed<boolean>(() => this.isFullscreen() && this.deskWide())

  /** Pane mode: false = reading, true = the editor fills the pane. */
  readonly paneEditorOpen = signal(false)

  /** The pane's add button — a fresh note, written large. */
  paneAdd(): void {
    const cell = this.cell()
    if (cell) this.#openForm(cell)
  }

  /** Step the pane. WRAPS in both directions — a cycle, not a list with
   *  ends, so neither button ever disables. */
  stepReading(delta: number): void {
    const n = this.readingRows().length
    if (n === 0) return
    this.readingIndex.set(stepIndex(this.readingIndex(), delta, n))
  }

  /** Pheromones on a note. Notes written before the slot existed simply
   *  have none. */
  readingTags(note: Note | null | undefined): readonly string[] {
    return Array.isArray(note?.tags) ? note!.tags! : []
  }

  /** Take one pheromone off the reading note (its chip's ×). */
  removeReadingTag(tag: string, event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.cell()
    const noteId = this.readingRow()?.note.id
    if (!cellLabel || !noteId) return
    EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: false })
  }

  /** Edit the reading note — loads it into the embedded form in the
   *  centre column (questions route to the tile editor, as everywhere). */
  editReading(): void {
    const cell = this.cell()
    const noteId = this.readingRow()?.note.id
    if (!cell || !noteId) return
    this.editNote(noteId, cell)
  }

  /**
   * Kind filter — `all` (default) shows every entry, `q` only open questions,
   * `note` only real notes (answered Qs included since "resolved-Q notes are
   * just notes"). Selection persists in localStorage so the user's view
   * survives navigation and reloads. The chip-style toggle row sits above
   * the list; clicking a chip swaps the active filter.
   */
  readonly kindFilter = signal<'all' | 'q' | 'note'>(
    (localStorage.getItem('hc:notes-strip-kind-filter') as 'all' | 'q' | 'note' | null) ?? 'all'
  )

  setKindFilter(filter: 'all' | 'q' | 'note'): void {
    if (filter === this.kindFilter()) return
    this.kindFilter.set(filter)
    try { localStorage.setItem('hc:notes-strip-kind-filter', filter) } catch { /* ignore */ }
  }

  // ── Comb v2 editor state ─────────────────────────────────
  // Notes themselves carry no selection — a note is just text. (Bulk
  // multi-note selection was removed; tile selection lives on the bottom
  // navigator as `selectedCells`, a separate concern.)

  /** Which note the embedded form is currently editing. Null = the form
   *  is in "add" mode (a fresh note); a note id = "edit" mode (the form
   *  is prefilled with that note and commit replaces it). */
  readonly editingNoteId = signal<string | null>(null)

  /** The embedded note-form's working text. Committed via `note:commit`
   *  (with `editId` when editing). This is the single authoring surface —
   *  the command-line capture path is reserved for a future quick-note
   *  syntax and no longer drives the tile note button. */
  readonly draftText = signal('')

  /** The form's textarea, focused when the panel opens via the tile note
   *  button or an add/edit affordance. */
  readonly formInput = viewChild<ElementRef<HTMLTextAreaElement>>('formInput')

  /** Kind of the note currently being authored in the form — `note`
   *  (default) or `q` (question). On commit, `q` prepends the `[Q] `
   *  marker the rest of the strip already understands (noteKind, kind
   *  filter, question styling). Resets to `note` each time the form
   *  opens for a fresh add or an edit. */
  readonly draftKind = signal<'note' | 'q'>('note')

  /** Flip the in-progress entry between note and question (the leading
   *  pill in the form input row). */
  toggleDraftKind(): void {
    this.draftKind.update(k => (k === 'q' ? 'note' : 'q'))
  }

  // ── Mark palette (the icon rail) ──────────────────────────
  // The rail sits at the top of the editor column: the participant's own
  // icons, each carrying a meaning THEY gave it and a role that decides how
  // rows using it render (heading vs list item). The palette is hive
  // content (sign('notes:marks') pool) — see core/note-marks.store.ts.

  readonly #markStore = window.ioc?.get?.<NoteMarksStore>(NOTE_MARKS_IOC_KEY)

  /** Live palette. Empty when the store is absent (marks simply don't
   *  render) or before the pool read settles. */
  readonly marks = fromRuntime(this.#markStore, () => this.#markStore?.marks ?? [])

  /** The rail, split into its two KINDS — points (the constrained roles,
   *  `heading` and `list`) and notes (the `prose` role).
   *
   *  The grouping is derived from each mark's role, never from a list of
   *  icon names here: the user can re-role any icon at any time and the rail
   *  has to follow. An empty group is dropped rather than rendered as a bare
   *  label, so a palette with no prose mark looks exactly as it did before
   *  the kind existed. */
  readonly markGroups = computed(() => {
    const all = this.marks()
    const groups: { kind: MarkKind; marks: NoteMark[] }[] = [
      { kind: 'point', marks: [] },
      { kind: 'note', marks: [] },
    ]
    for (const m of all) {
      const kind = kindOfRole(m.role)
      groups[kind === 'point' ? 0 : 1].marks.push(m)
    }
    return groups.filter(g => g.marks.length > 0)
  })

  /** True once BOTH kinds are present. The kind labels only earn their space
   *  when there is something to tell apart — with one kind in the palette the
   *  rail stays the flat strip of icons it has always been. */
  readonly showKindLabels = computed(() => this.markGroups().length > 1)

  /** The kind a note row currently reads as, for the row's own styling.
   *  Resolves through the palette, so an unmarked row (or one whose mark was
   *  deleted) reads as a point — the constrained default. */
  kindOfNote(note: Note): MarkKind {
    const role = this.#markStore?.roleOf(note.mark)
    return role ? kindOfRole(role) : 'point'
  }

  /** The rail's current pick — the mark the next commit writes onto the
   *  note. Null = no mark. Staged to the drone via `notes:active-mark` as
   *  well as sent on the commit payload, so either path works. */
  readonly draftMark = signal<string | null>(null)

  /** Palette edit mode — flips the compact icon rail into a list where each
   *  mark shows its name, its role and a remove button. */
  readonly paletteEditing = signal(false)

  togglePaletteEdit(): void { this.paletteEditing.update(v => !v) }

  /** Click a rail icon: pick it for the draft, or clear it by picking the
   *  one already active. Swallowed when the press was really the start of
   *  a drag onto a note row (see the mark-drag block below). */
  pickMark(icon: string): void {
    if (this.#markDragMoved) { this.#markDragMoved = false; return }
    const next = this.draftMark() === icon ? null : icon
    this.draftMark.set(next)
    EffectBus.emit('notes:active-mark', { mark: next })
  }

  // ── Mark drag — rail icon onto a note row ─────────────────
  // The rail is the palette; dragging one of its icons onto a row is how an
  // EXISTING note gets (or loses) its mark, without going through the edit
  // form. Pointer-based like the row-reorder drag further down, for the same
  // reason: full control over the ghost and the drop highlight, and no fight
  // with the dataTransfer mime the palette pin gesture already owns.

  /** Icon currently riding the pointer, or null when no drag is live. */
  readonly markDragIcon = signal<string | null>(null)
  /** Row the icon is hovering — highlighted as the drop target. */
  readonly markDropTargetId = signal<string | null>(null)
  /** Viewport position of the drag ghost. */
  readonly markGhostX = signal(0)
  readonly markGhostY = signal(0)

  #markDragPointerId: number | null = null
  #markDragOrigin: { x: number; y: number; icon: string } | null = null
  /** True once a press has travelled far enough to count as a drag, so the
   *  click that follows pointerup doesn't ALSO toggle the rail pick. Cleared
   *  by the next press, so a drag that ends without a click can't eat it. */
  #markDragMoved = false

  onMarkPointerDown(icon: string, event: PointerEvent): void {
    if (event.button !== 0) return
    if (this.#dragPointerId !== null || this.#noteDragPointerId !== null) return
    this.#markDragPointerId = event.pointerId
    this.#markDragOrigin = { x: event.clientX, y: event.clientY, icon }
    this.#markDragMoved = false
    window.addEventListener('pointermove', this.#onMarkDragMove)
    window.addEventListener('pointerup', this.#onMarkDragEnd)
    window.addEventListener('pointercancel', this.#onMarkDragEnd)
  }

  #onMarkDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#markDragPointerId) return
    const origin = this.#markDragOrigin
    if (!origin) return
    if (!this.#markDragMoved) {
      // Below the threshold the press is still a click-to-pick.
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 4) return
      this.#markDragMoved = true
      this.markDragIcon.set(origin.icon)
    }
    event.preventDefault()
    this.markGhostX.set(event.clientX)
    this.markGhostY.set(event.clientY)
    this.markDropTargetId.set(this.#noteRowIdAt(event.clientX, event.clientY))
  }

  #onMarkDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#markDragPointerId) return
    const icon = this.#markDragOrigin?.icon ?? null
    const targetId = this.markDropTargetId()
    const dragged = this.#markDragMoved
    const cellLabel = this.cell()
    this.#markDragPointerId = null
    this.#markDragOrigin = null
    this.markDragIcon.set(null)
    this.markDropTargetId.set(null)
    window.removeEventListener('pointermove', this.#onMarkDragMove)
    window.removeEventListener('pointerup', this.#onMarkDragEnd)
    window.removeEventListener('pointercancel', this.#onMarkDragEnd)
    if (!dragged || !icon || !targetId || !cellLabel) return
    // Dropping the icon a note already carries CLEARS it — the same toggle
    // the rail pick uses, so one gesture both marks and unmarks.
    const current = this.#findNote(cellLabel, targetId)?.mark ?? null
    const next = current === icon ? null : icon
    EffectBus.emit('note:mark', { cellLabel, noteId: targetId, mark: next })
    this.#paintMarkOptimistic(cellLabel, targetId, next)
  }

  /** Paint the dropped mark immediately, at any depth, so the row responds
   *  to the gesture instead of waiting for the resource write + leaf→root
   *  cascade. The `notes:changed` re-read is the authoritative reconcile
   *  (and it brings the node's NEW sig, since the bytes changed). */
  #paintMarkOptimistic(cell: string, noteId: string, mark: string | null): void {
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === noteId ? { ...n, mark } : { ...n, children: walk(n.children) }))
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      next.set(cell, walk(next.get(cell) ?? []))
      return next
    })
    this.#version.update(v => v + 1)
  }

  /** Note id of the row under a viewport point, or null. Rows carry
   *  `data-note-id`; the tree renders them all through one template. */
  #noteRowIdAt(x: number, y: number): string | null {
    const rows = Array.from(
      this.#host.nativeElement.querySelectorAll('article.cv2-note[data-note-id]'),
    ) as HTMLElement[]
    for (const row of rows) {
      const r = row.getBoundingClientRect()
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue
      return row.getAttribute('data-note-id')
    }
    return null
  }

  /** "+" on the rail — borrow the shared Material icon chooser. `store: false`
   *  means nothing is written as an icon override: the name comes back here
   *  and becomes palette content instead. Null = the user cancelled. */
  async addMarkIcon(): Promise<void> {
    const i18n = window.ioc?.get?.<I18nProvider>('@hypercomb.social/I18n')
    const name = await requestIconPick({
      id: MARK_PICK_ID,
      store: false,
      title: i18n?.t('notes.addMark'),
    })
    if (!isMarkIcon(name)) return
    this.#markStore?.add(name)
    this.draftMark.set(name)
    EffectBus.emit('notes:active-mark', { mark: name })
  }

  renameMark(icon: string, event: Event): void {
    this.#markStore?.rename(icon, (event.target as HTMLInputElement)?.value ?? '')
  }

  setMarkRole(icon: string, role: MarkRole): void {
    this.#markStore?.setRole(icon, role)
  }

  removeMark(icon: string): void {
    this.#markStore?.remove(icon)
    if (this.draftMark() === icon) this.pickMark(icon)   // clears the draft pick
  }

  /** The icon a note row paints — its mark. Notes written before marks
   *  existed carry a legacy `shape` instead, which the row still renders
   *  through the CSS shape glyph. */
  markOf(note: Note): string | null { return note.mark ?? null }

  /** Role the row renders with. Lives on the PALETTE, not the note, so
   *  re-roling an icon restyles every note that carries it. */
  roleOf(note: Note): MarkRole {
    return note.mark ? (this.#markStore?.roleOf(note.mark) ?? 'list') : 'list'
  }

  /** Human meaning of a mark, for tooltips. Falls back to the icon name so
   *  an unnamed mark still says something. */
  markLabel(icon: string): string {
    const mark = this.#markStore?.byIcon(icon)
    return mark?.name?.trim() || icon.replace(/_/g, ' ')
  }

  /** Set of note ids whose subtree is currently collapsed. State is
   *  in-memory only — resets on reload. Keys are note ids, not paths,
   *  so two distinct notes with the same id (impossible since ids are
   *  signatures) would conflict, which they can't.
   *
   *  A note is rendered expanded by default. Toggle adds / removes it
   *  from this set. Notes that aren't keyed render their children. */
  readonly collapsed = signal<ReadonlySet<string>>(new Set())

  /** Note id whose kebab popover is currently open, or null. Only one
   *  kebab can be open at a time. ESC and click-outside close it. */
  readonly kebabOpenId = signal<string | null>(null)

  /** Note id whose "Nest under…" picker is currently open, or null.
   *  Opened by clicking the kebab's Nest entry. Same close semantics
   *  as the kebab (ESC, click-outside). */
  readonly pickerOpenForId = signal<string | null>(null)


  // ── Tree (children) — collapse / kebab / picker / nest / promote ──

  /** Is this note's subtree currently collapsed? */
  isCollapsed(noteId: string): boolean {
    return this.collapsed().has(noteId)
  }

  /** Toggle collapsed state for a note. No-op when called on a leaf. */
  toggleCollapse(noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.collapsed.update(prev => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }

  /** Open the kebab popover for a note (closing any other). */
  openKebab(noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.pickerOpenForId.set(null)
    this.kebabOpenId.set(this.kebabOpenId() === noteId ? null : noteId)
  }

  closeKebab(): void {
    if (this.kebabOpenId() !== null) this.kebabOpenId.set(null)
  }

  /** Open the "Nest under…" picker for a note (closes the kebab). */
  openPicker(noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.kebabOpenId.set(null)
    this.pickerOpenForId.set(noteId)
  }

  closePicker(): void {
    if (this.pickerOpenForId() !== null) this.pickerOpenForId.set(null)
  }

  /** Whether a note is currently nested (has any ancestor). Used by the
   *  kebab to decide whether to surface the "Promote" entry. */
  isNested(noteId: string): boolean {
    const cell = this.cell()
    if (!cell) return false
    const tree = this.#notesByCell().get(cell) ?? []
    // A note is nested iff it isn't a top-level entry of the tree.
    return !tree.some(n => n.id === noteId)
  }

  /** Nest `sourceId` under `targetParentId`. Emits to the drone which
   *  performs the tree rewrite + cascade. Closes the picker. */
  nestUnder(sourceId: string, targetParentId: string): void {
    const cell = this.cell()
    if (!cell || !sourceId || !targetParentId || sourceId === targetParentId) {
      this.closePicker()
      return
    }
    EffectBus.emit('note:nest', { cellLabel: cell, sourceId, targetParentId })
    this.closePicker()
    this.closeKebab()
  }

  /** Promote a nested note back to the cell's top level. */
  promote(sourceId: string): void {
    const cell = this.cell()
    if (!cell || !sourceId) return
    EffectBus.emit('note:unnest', { cellLabel: cell, sourceId })
    this.closeKebab()
  }

  /** Build the list of valid nest targets for `sourceId`:
   *  - all notes in the cell's tree (any depth)
   *  - minus `sourceId` itself
   *  - minus every descendant of `sourceId` (cycle prevention)
   *  - minus the source's current direct parent (no-op nest)
   *
   *  Returns a flat list of { id, text, shape, depth } so the picker
   *  can render a single scrollable list with visual depth hints. */
  nestCandidates(sourceId: string): readonly { id: string; text: string; shape: ShapeId | null; mark: string | null; depth: number }[] {
    const cell = this.cell()
    if (!cell) return []
    const tree = this.#notesByCell().get(cell) ?? []
    const forbidden = new Set<string>([sourceId])
    // Walk source's subtree to collect descendant ids.
    const collectDescendants = (nodes: readonly Note[]): void => {
      for (const n of nodes) {
        if (n.id === sourceId) {
          const drainDesc = (sub: readonly Note[]): void => {
            for (const c of sub) {
              forbidden.add(c.id)
              drainDesc(c.children)
            }
          }
          drainDesc(n.children)
          return
        }
        collectDescendants(n.children)
      }
    }
    collectDescendants(tree)
    // Walk the whole tree and emit all non-forbidden notes.
    const out: { id: string; text: string; shape: ShapeId | null; mark: string | null; depth: number }[] = []
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) {
        if (!forbidden.has(n.id)) {
          out.push({ id: n.id, text: this.noteDisplayText(n), shape: n.shape, mark: n.mark, depth })
        }
        walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }

  /** Fullscreen toggle — sets `isFullscreen`; the HostBinding adds
   *  `is-fullscreen` to the host element and the SCSS releases the
   *  width cap + panel-offset transform so the strip fills the
   *  canvas area between the header and the controls-bar pill. */
  readonly isFullscreen = signal<boolean>(false)

  @HostBinding('class.is-fullscreen')
  get fullscreenClass(): boolean { return this.isFullscreen() }

  toggleFullscreen(): void {
    this.isFullscreen.update(v => !v)
    // Entering with an edit in flight carries it into the pane, big — that
    // is the whole point of the desk. Leaving always closes the pane editor;
    // docked, the centre form is back and always visible.
    this.paneEditorOpen.set(this.isFullscreen() && !!this.editingNoteId())
    EffectBus.emit('notes:expand-to-index', { cellLabel: this.cell(), fullscreen: this.isFullscreen() })
    // Fullscreen changes the panel width by the largest jump there is —
    // re-measure once the class has landed so the plate follows immediately.
    queueMicrotask(() => this.#measurePanel())
  }

  // Every tile in the current layer, sourced from CellSuggestionProvider (the
  // same list the command-line autocomplete uses). Drives the always-on tile
  // navigator — maintained continuously (boot + lineage change + synchronize),
  // no longer gated behind a see-all toggle.
  readonly #layerCellLabels = signal<readonly string[]>([])

  /** Re-poll the current layer's cell labels. Called on construct, on lineage
   *  change, and on `synchronize` so the navigator always reflects the tiles
   *  actually present in this layer (added / removed / renamed). */
  #refreshLayerCellLabels(): void {
    const provider = get<{ suggestions(): readonly string[] }>(
      '@hypercomb.social/CellSuggestionProvider'
    )
    this.#layerCellLabels.set(provider ? [...provider.suggestions()] : [])
  }

  /** Click a row's body. Fullscreen, the click SELECTS — the note lands in
   *  the reading pane, and editing is the pane's explicit affordance.
   *  Docked, there is no pane, so the click opens the embedded editor as
   *  it always has. */
  onRowBodyClick(cellLabel: string, noteId: string, _event: Event): void {
    if (this.isFullscreen()) {
      this.selectForReading(noteId)
      // A PRISTINE pane editor (add mode, nothing typed) yields to reading —
      // the click says "show me that one". Anything in flight is kept: a
      // half-written note never loses to a stray click.
      if (this.paneEditorOpen() && !this.editingNoteId() && !this.draftText().trim()) {
        this.paneEditorOpen.set(false)
      }
      return
    }
    this.open(noteId, cellLabel)
  }

  /** Open the READER on the active tile. Two surfaces, two jobs: this strip
   *  authors (dense tree, edit in place), the reader reads (one note at a
   *  time, big, its hierarchy around it). Nothing else emits `notes:open`,
   *  so this is how the reader is reached. */
  openReader(): void {
    const cellLabel = this.cell()
    if (!cellLabel) return
    EffectBus.emit('notes:open', { cellLabel })
  }

  // ── Panel drag-to-reposition ─────────────────────────────
  // Translate delta from the natural centered baseline. {0,0} = the
  // CSS-default position; any non-zero delta is a user drag we persist.
  // The transform sits on top of `:host { justify-content: center }` so
  // we never have to reach for absolute positioning math.

  readonly panelOffset = signal<{ x: number; y: number }>(((): { x: number; y: number } => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_OFFSET_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return { x: parsed.x, y: parsed.y }
        }
      }
    } catch { /* corrupt entry — fall through */ }
    return { x: 0, y: 0 }
  })())

  readonly panelTransform = computed<string>(() => {
    const { x, y } = this.panelOffset()
    return `translate(${x}px, ${y}px)`
  })

  /** Dock side — 'right' = snapped to the right-edge rail, null = floating.
   *  Defaults to the right rail (notes belong opposite the left control
   *  bar). Restored from / persisted to localStorage. */
  readonly dockSide = signal<'right' | null>(((): 'right' | null => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_DOCK_KEY)
      if (raw === 'float') return null
      if (raw === 'right') return 'right'
    } catch { /* corrupt entry — fall through */ }
    return 'right'
  })())

  /** Transform binding — suppressed while docked (the rail is laid out by
   *  CSS, not the float offset). */
  readonly panelTransformActive = computed<string | null>(() =>
    this.dockSide() ? null : this.panelTransform()
  )

  #persistDock(): void {
    try { localStorage.setItem(NOTES_STRIP_DOCK_KEY, this.dockSide() ?? 'float') } catch { /* ignore */ }
  }

  // Drag bookkeeping — pointerId guards against a second finger
  // hijacking the active drag; #dragStart captures the pixel offset
  // between cursor and panel-baseline so the delta math is stable
  // even when the cursor sweeps far from the grip element.
  #dragPointerId: number | null = null
  #dragStart: { px: number; py: number; ox: number; oy: number } | null = null
  /** True once a press has travelled past DRAG_THRESHOLD. Until then no dock
   *  change and no offset write happens, so a click on the header is a click. */
  #dragMoved = false

  // Input mode pushed during the drag — suspends the underlying
  // zoom/pan listeners just like 'notes-hover' does. Empty mount/
  // unmount because the suspension is purely structural (top-of-stack
  // wins). Mirrors the #notesHoverMode template above.
  readonly #notesDragMode = {
    name: 'notes-drag',
    mount: (): void => { /* no listeners — suspension is structural */ },
    unmount: (): void => { /* nothing to tear down */ },
  }
  #dragModeActive = false

  onDragStart(event: PointerEvent): void {
    // Don't initiate drag from mini-buttons (expand / hide) — they
    // share the dragbar element. The buttons themselves stop
    // propagation, but a primary-button-down on a button still fires
    // the dragbar's pointerdown handler.
    const tgt = event.target as HTMLElement | null
    if (tgt && tgt.closest('button, [role="button"]')) return
    // Only primary mouse button or pen/touch primary.
    if (event.button !== 0) return
    if (this.isFullscreen()) return  // position is forced; no-op
    event.preventDefault()
    this.#dragPointerId = event.pointerId
    this.#dragMoved = false
    const offset = this.panelOffset()
    this.#dragStart = {
      px: event.clientX,
      py: event.clientY,
      ox: offset.x,
      oy: offset.y,
    }
    window.addEventListener('pointermove', this.#onDragMove)
    window.addEventListener('pointerup', this.#onDragEnd)
    window.addEventListener('pointercancel', this.#onDragEnd)
    const stack = this.#stack()
    if (stack && !this.#dragModeActive) {
      stack.push(this.#notesDragMode)
      this.#dragModeActive = true
    }
  }

  #onDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId) return
    const start = this.#dragStart
    if (!start) return
    if (!this.#dragMoved) {
      if (Math.hypot(event.clientX - start.px, event.clientY - start.py) < DRAG_THRESHOLD) return
      this.#dragMoved = true
    }
    const vw = window.innerWidth
    const docked = this.dockSide() === 'right'

    // Right-edge snap with hysteresis.
    if (event.clientX >= vw - SNAP_ZONE) {
      if (!docked) this.dockSide.set('right')
      return                                   // docked layout is CSS-driven
    }
    if (docked && event.clientX > vw - SNAP_EXIT) return   // hysteresis band

    if (docked) {
      // Leaving the rail → float. Re-baseline so the panel keeps its
      // current right-flush position instead of jumping to the stale float
      // offset, then tracks the cursor from here.
      const rebaseX = this.#rightDockOffsetX()
      this.dockSide.set(null)
      this.panelOffset.set({ x: rebaseX, y: 0 })
      start.px = event.clientX
      start.py = event.clientY
      start.ox = rebaseX
      start.oy = 0
      return
    }

    // Compute the candidate offset, then clamp it against the current
    // viewport BEFORE writing the signal. Clamping live (vs. on release)
    // is what prevents the panel from flying off-screen mid-drag.
    const candidate = {
      x: start.ox + (event.clientX - start.px),
      y: start.oy + (event.clientY - start.py),
    }
    this.panelOffset.set(this.#clampOffsetCandidate(candidate))
  }

  /** Float-offset X that reproduces the docked (right-flush) position — used
   *  to hand off smoothly from rail → float. The host centres the panel, so
   *  flush-right sits (hostContentWidth - panelWidth)/2 right of centre. */
  #rightDockOffsetX(): number {
    const host = this.#host.nativeElement
    const el = this.panel()?.nativeElement
    if (!el) return 0
    const cs = getComputedStyle(host)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const hostContentW = host.clientWidth - padL - padR
    const panelW = el.getBoundingClientRect().width
    return Math.max(0, (hostContentW - panelW) / 2)
  }

  #onDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#dragPointerId) return
    const moved = this.#dragMoved
    this.#dragPointerId = null
    this.#dragStart = null
    this.#dragMoved = false
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
    window.removeEventListener('pointercancel', this.#onDragEnd)
    if (this.#dragModeActive) {
      this.#stack()?.pop(this.#notesDragMode.name)
      this.#dragModeActive = false
    }
    // A press that never crossed the threshold changed nothing — don't rewrite
    // the stores (and don't let a header click count as a reposition).
    if (!moved) return
    // Persist final position + dock side. Offset already clamped during drag.
    const off = this.panelOffset()
    try {
      localStorage.setItem(NOTES_STRIP_OFFSET_KEY, JSON.stringify(off))
    } catch { /* ignore */ }
    this.#persistDock()
  }

  /** Given a candidate offset, return the closest offset that keeps the
   *  ENTIRE panel inside the viewport (with a small margin). Previously
   *  this only enforced a tiny visible corner, which let the footer slip
   *  below the viewport when the dragbar was dragged downward — the
   *  user couldn't see (or click) the footer anymore.
   *
   *  If the panel is larger than the viewport in either axis, the top-
   *  left edges take priority — the user can still scroll the list
   *  body (overflow-y: auto) to see the rest of the strip. */
  #clampOffsetCandidate(candidate: { x: number; y: number }): { x: number; y: number } {
    const el = this.panel()?.nativeElement
    if (!el) return candidate
    const rect = el.getBoundingClientRect()
    const current = this.panelOffset()

    // Resolve the panel's "natural" top-left (at zero offset) by
    // backing the current offset out of the rendered rect.
    const panelWidth  = rect.right  - rect.left
    const panelHeight = rect.bottom - rect.top
    const naturalLeft = rect.left - current.x
    const naturalTop  = rect.top  - current.y

    // Apply the candidate offset to that natural rect.
    const newLeft = naturalLeft + candidate.x
    const newTop  = naturalTop  + candidate.y

    // Clamp within the HOST's box, not the raw viewport. The host already
    // starts below the header bar and ends above the controls pill, so
    // confining the panel to it stops a float-drag from sliding up into the
    // header / command line or down into the controls. maxX/Y are floored at
    // minX/Y so an oversized panel pins to the top-left instead of inverting.
    const host = this.#host.nativeElement.getBoundingClientRect()
    const margin = 8

    const minLeft = host.left + margin
    const maxLeft = Math.max(minLeft, host.right - margin - panelWidth)
    const allowedLeft = Math.max(minLeft, Math.min(maxLeft, newLeft))

    // No top/bottom margin: the host already clears the header (top) and the
    // controls pill (bottom), so the float panel should reach flush against
    // the command line and the bottom, matching the docked rail's extent.
    const minTop = host.top
    const maxTop = Math.max(minTop, host.bottom - panelHeight)
    const allowedTop = Math.max(minTop, Math.min(maxTop, newTop))

    return {
      x: candidate.x + (allowedLeft - newLeft),
      y: candidate.y + (allowedTop  - newTop),
    }
  }

  /** Double-click the dragbar → reset a float back to the centered default.
   *  Ignores double-clicks that land on the bar's buttons (fullscreen/close)
   *  and does nothing while docked (the rail is CSS-laid-out). */
  resetPanelOffset(event?: Event): void {
    const tgt = event?.target as HTMLElement | null
    if (tgt?.closest('button, [role="button"]')) return
    if (this.dockSide()) return
    this.panelOffset.set({ x: 0, y: 0 })
    try { localStorage.removeItem(NOTES_STRIP_OFFSET_KEY) } catch { /* ignore */ }
  }

  // ── Custom corner-resize handle ──────────────────────────
  // The browser-native `resize: both` is ignored when overflow is
  // visible (which we need so the palette popover can overhang
  // below the strip). This custom handle gives us the same UX
  // independent of overflow + persists via the existing
  // ResizeObserver path.
  #resizePointerId: number | null = null
  #resizeStart: { px: number; py: number; w: number; h: number } | null = null
  // Which edge the active resize was started from. 'corner' = bottom-right
  // (w+h), 'left' = width only (the live edge when docked right), 'bottom'
  // = height only.
  #resizeEdge: 'corner' | 'left' | 'bottom' = 'corner'

  onResizeStart(event: PointerEvent, edge: 'corner' | 'left' | 'bottom' = 'corner'): void {
    if (event.button !== 0) return
    if (this.#dragPointerId !== null || this.#noteDragPointerId !== null) return
    if (this.isFullscreen()) return  // size is forced; no-op
    event.preventDefault()
    event.stopPropagation()
    const el = this.panel()?.nativeElement
    if (!el) return
    const rect = el.getBoundingClientRect()
    this.#resizePointerId = event.pointerId
    this.#resizeEdge = edge
    this.#resizeStart = {
      px: event.clientX,
      py: event.clientY,
      w: rect.width,
      h: rect.height,
    }
    window.addEventListener('pointermove', this.#onResizeMove)
    window.addEventListener('pointerup', this.#onResizeEnd)
    window.addEventListener('pointercancel', this.#onResizeEnd)
  }

  #onResizeMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#resizePointerId) return
    const start = this.#resizeStart
    const el = this.panel()?.nativeElement
    if (!start || !el) return
    // Clamp to the host's available area so the user can't drag
    // the strip past its dock bounds.
    const host = this.#host.nativeElement
    const hostRect = host.getBoundingClientRect()
    const minW = 256  // ~16rem — matches the .notes-strip CSS min-width floor
    const minH = 80   // ~5rem
    const maxW = Math.max(minW, hostRect.width - 16)
    const maxH = Math.max(minH, hostRect.height - 4)
    const dx = event.clientX - start.px
    const dy = event.clientY - start.py
    const edge = this.#resizeEdge
    // 'left' grows width as the cursor moves left (toward the panel's
    // interior the right edge is pinned when docked, so only the left moves).
    let w = edge === 'left' ? start.w - dx : start.w + dx
    let h = start.h + dy
    w = Math.max(minW, Math.min(maxW, w))
    h = Math.max(minH, Math.min(maxH, h))
    if (edge !== 'bottom') el.style.width = `${Math.round(w)}px`
    if (edge !== 'left') el.style.height = `${Math.round(h)}px`
    // Publish the new width as the drag happens, so the identity plate grows
    // and shrinks under the user's hand rather than a frame later.
    this.#measurePanel()
  }

  #onResizeEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#resizePointerId) return
    this.#resizePointerId = null
    this.#resizeStart = null
    window.removeEventListener('pointermove', this.#onResizeMove)
    window.removeEventListener('pointerup', this.#onResizeEnd)
    window.removeEventListener('pointercancel', this.#onResizeEnd)
    // The ResizeObserver in #observePanelResize will catch the
    // final size and persist it; no extra work here.
  }

  // ── Note-row drag-reorder ─────────────────────────────────
  // Pointer-based (not HTML5 DnD) so we keep tight control over the
  // visual ghost + drop indicator and don't have to fight the
  // existing dataTransfer mime used by the palette pin gesture.

  readonly noteDragSourceId = signal<string | null>(null)
  readonly noteDragSourceCell = signal<string | null>(null)
  // Tree drag uses noteDropTargetId + noteDropMode (hovered row + zone).
  readonly noteDropTargetId = signal<string | null>(null)
  readonly noteDropMode = signal<'before' | 'into' | 'after' | 'root' | null>(null)
  #noteDragPointerId: number | null = null

  onNoteGripPointerDown(cellLabel: string, noteId: string, event: PointerEvent): void {
    // Primary mouse button / pen / touch primary only. Don't initiate
    // if the user is already mid-panel-drag.
    if (event.button !== 0) return
    if (this.#dragPointerId !== null) return
    event.preventDefault()
    event.stopPropagation()
    this.#noteDragPointerId = event.pointerId
    this.noteDragSourceId.set(noteId)
    this.noteDragSourceCell.set(cellLabel)
    this.noteDropTargetId.set(null)
    this.noteDropMode.set(null)
    window.addEventListener('pointermove', this.#onNoteDragMove)
    window.addEventListener('pointerup', this.#onNoteDragEnd)
    window.addEventListener('pointercancel', this.#onNoteDragEnd)
  }

  #onNoteDragMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#noteDragPointerId) return
    const sourceCell = this.noteDragSourceCell()
    if (!sourceCell) return

    // Tree mode — detect hovered row + zone (upper third =
    // before, middle = into, lower = after). Pointer below all rows =
    // root drop (promote to top level).
    const root = this.#host.nativeElement
    const rows = Array.from(root.querySelectorAll('article.cv2-note[data-note-id]')) as HTMLElement[]
    if (rows.length === 0) {
      this.noteDropTargetId.set(null)
      this.noteDropMode.set(null)
      return
    }

    const sourceId = this.noteDragSourceId()
    const y = event.clientY
    let hovered: HTMLElement | null = null
    let mode: 'before' | 'into' | 'after' | null = null

    for (const row of rows) {
      const r = row.getBoundingClientRect()
      if (y < r.top || y >= r.bottom) continue
      hovered = row
      const within = (y - r.top) / r.height
      if (within < 0.33) mode = 'before'
      else if (within < 0.67) mode = 'into'
      else mode = 'after'
      break
    }

    if (!hovered || !mode) {
      // Past the last row → root drop (un-nest to top level), but
      // only if the source isn't already at the top level (in that
      // case it's a no-op and the indicator confuses the user).
      const lastRect = rows[rows.length - 1].getBoundingClientRect()
      if (y >= lastRect.bottom) {
        this.noteDropTargetId.set(null)
        this.noteDropMode.set(this.isNested(sourceId ?? '') ? 'root' : null)
      } else {
        this.noteDropTargetId.set(null)
        this.noteDropMode.set(null)
      }
      return
    }

    const targetId = hovered.getAttribute('data-note-id')
    if (!targetId || targetId === sourceId) {
      // Hovering over self — no valid drop here.
      this.noteDropTargetId.set(null)
      this.noteDropMode.set(null)
      return
    }
    this.noteDropTargetId.set(targetId)
    this.noteDropMode.set(mode)
  }

  #onNoteDragEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#noteDragPointerId) return
    const sourceId = this.noteDragSourceId()
    const sourceCell = this.noteDragSourceCell()
    const targetId = this.noteDropTargetId()
    const mode = this.noteDropMode()
    this.#noteDragPointerId = null
    this.noteDragSourceId.set(null)
    this.noteDragSourceCell.set(null)
    this.noteDropTargetId.set(null)
    this.noteDropMode.set(null)
    window.removeEventListener('pointermove', this.#onNoteDragMove)
    window.removeEventListener('pointerup', this.#onNoteDragEnd)
    window.removeEventListener('pointercancel', this.#onNoteDragEnd)
    if (!sourceId || !sourceCell) return

    // Tree-mode drops take precedence — they only fire in single-cell
    // mode where data-note-id is set on each row.
    if (mode === 'into' && targetId) {
      EffectBus.emit('note:nest', { cellLabel: sourceCell, sourceId, targetParentId: targetId })
      return
    }
    if (mode === 'root') {
      EffectBus.emit('note:unnest', { cellLabel: sourceCell, sourceId })
      return
    }
    // 'before' / 'after' in tree mode → reorder among the cell's TOP-LEVEL
    // notes (the slot the drone's note:reorder permutes). Compute the insert
    // index against the array with the source removed, so dropping just
    // above/below the target lands exactly there. Nested source/target fall
    // through to a no-op (the drone ignores a sig not in the top-level slot);
    // sibling-within-parent reorder would need a dedicated drone op.
    if ((mode === 'before' || mode === 'after') && targetId) {
      const top = (this.#notesByCell().get(sourceCell) ?? []).map(n => n.id)
      const sourcePos = top.indexOf(sourceId)
      const targetPos = top.indexOf(targetId)
      if (sourcePos !== -1 && targetPos !== -1) {
        const withoutTargetIdx = targetPos > sourcePos ? targetPos - 1 : targetPos
        const targetIndex = mode === 'after' ? withoutTargetIdx + 1 : withoutTargetIdx
        EffectBus.emit('note:reorder', { cellLabel: sourceCell, sourceId, targetIndex })
      }
      return
    }

  }

  // ── ESC cascade + click-outside dismissal ────────────────
  // Host ElementRef so click-outside can decide whether the click
  // hit our panel or somewhere else in the document.
  readonly #host = inject(ElementRef<HTMLElement>)

  /** ESC cascades through the popovers and selection in priority order
   *  so the user can "back out" of nested state without having to find
   *  the right close button. Falls through to the global escape-cascade
   *  (notes-viewer, command-line, etc.) if nothing here is dismissable. */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.visible()) return
    // Cascade — most local / transient state first, broader state
    // last. Stop propagation once we've handled one level so the
    // global escape-cascade doesn't ALSO fire for the same press.
    if (this.pickerOpenForId() !== null) {
      this.closePicker()
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (this.kebabOpenId() !== null) {
      this.closeKebab()
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (this.isFullscreen()) {
      this.isFullscreen.set(false)
      event.stopPropagation()
      event.preventDefault()
      return
    }
    // Otherwise: leave the event alone so the surrounding escape-
    // cascade (notes-viewer dismissal, command-line clear, etc.)
    // keeps running. We're a non-modal panel — escape is shared.
  }

  /** Click anywhere outside the strip closes the kebab popover and
   *  picker. Clicks inside the strip itself are handled by the buttons'
   *  own stopPropagation so opening doesn't immediately close. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.kebabOpenId() === null && this.pickerOpenForId() === null) return
    const root = this.#host.nativeElement
    const target = event.target as Node | null
    if (target && root.contains(target)) return
    this.closeKebab()
    this.closePicker()
  }

  /**
   * True when any visible cell carries an unanswered Claude question — either
   * a live qa-slot entry or a legacy `[Q] …` note. Only Claude authors
   * questions, so a notes view with none can drop the kind-filter row
   * entirely; "All" and "Notes" would be identical tabs otherwise.
   */
  readonly hasQuestions = computed<boolean>(() => {
    const c = this.cell()
    if (!c) return false
    if ((this.#qaByCell().get(c)?.length ?? 0) > 0) return true
    return (this.#notesByCell().get(c) ?? []).some(n => this.noteKind(n) === 'q')
  })

  /** Effective filter: a saved `'q'` preference falls through to `'all'`
   *  when there are no questions to filter — otherwise hiding the filter
   *  row would silently strand the user with an empty list. The saved
   *  preference is untouched so it snaps back to `'q'` once Claude asks
   *  the next question. */
  readonly #effectiveFilter = computed<'all' | 'q' | 'note'>(() => {
    const f = this.kindFilter()
    return (f === 'q' && !this.hasQuestions()) ? 'all' : f
  })

  /** True if a row of `kind` should render under the current filter. */
  #passesFilter(kind: 'q' | 'a' | 'note'): boolean {
    const f = this.#effectiveFilter()
    if (f === 'all') return true
    if (f === 'q') return kind === 'q'
    // f === 'note' — surface every non-question entry (answers count as
    // notes per the "resolved-Q notes are just notes" rule).
    return kind !== 'q'
  }

  readonly notes = computed<readonly Note[]>(() => {
    const cell = this.cell()
    if (!cell) return []
    const stored = this.#notesByCell().get(cell) ?? []
    const qa = this.#qaByCell().get(cell) ?? []
    const merged = this.#mergeQaWithNotes(qa, stored)
    return merged.filter(n => this.#passesFilter(this.noteKind(n)))
  })

  // ── Notes search (within the active tile) ─────────────────
  // Free-text filter over the active tile's notes. The list stays a TREE —
  // a node survives if it matches OR any descendant matches, so matches keep
  // their ancestors for context. Empty query = the full tree.
  readonly noteQuery = signal('')

  setNoteQuery(event: Event): void {
    this.noteQuery.set((event.target as HTMLInputElement).value)
  }
  clearNoteQuery(): void { this.noteQuery.set('') }

  /** Does this root belong on the LISTS tab? A list is STRUCTURE: a root
   *  carrying a heading/list mark, or a root with children (a tree IS a
   *  hierarchical list). Questions and answers are conversation, so they stay
   *  with the notes tab whatever their shape. Unmarked leaves are plain
   *  notes — `roleOf()` defaults unmarked rows to 'list' for ROW STYLING, so
   *  the mark is read directly here instead of through that default. */
  #isListRoot(note: Note): boolean {
    const kind = this.noteKind(note)
    if (kind === 'q' || kind === 'a') return false
    if (note.children.length > 0) return true
    if (!note.mark) return false
    // Unknown icons fall back to 'list', matching the row renderer.
    const role = this.#markStore?.roleOf(note.mark) ?? 'list'
    return role === 'heading' || role === 'list'
  }

  /** The active tile's note tree — split by the annotations tab (prose and
   *  conversation on `notes`, structured lists on `lists`), then pruned to
   *  the search query. Each surviving node is a shallow copy with its
   *  children likewise pruned, so the recursive row template renders the
   *  filtered tree without mutating the source. Only ROOTS are classified:
   *  a list's prose children belong to their list, not to the other tab. */
  readonly visibleNotes = computed<readonly Note[]>(() => {
    const q = this.noteQuery().trim().toLowerCase()
    const wantLists = this.tab() === 'lists'
    const all = this.notes().filter(n => this.#isListRoot(n) === wantLists)
    if (!q) return all
    const prune = (nodes: readonly Note[]): Note[] => {
      const out: Note[] = []
      for (const n of nodes) {
        const kids = prune(n.children)
        const selfMatch = this.noteDisplayText(n).toLowerCase().includes(q)
        if (selfMatch || kids.length > 0) out.push({ ...n, children: kids })
      }
      return out
    }
    return prune(all)
  })

  /** Merge open qa-slot questions with the cell's notes into a single
   *  display list. Logic:
   *   - qa items appear FIRST as synthetic notes (`id = 'qa:<qId>'`,
   *     `text = '[Q] …'` so the existing `noteKind` / styling pick
   *     them up as yellow Q rows automatically).
   *   - Any legacy `[Q] …` note whose question text matches a qa-slot
   *     entry is DROPPED — the qa slot is canonical; the legacy note
   *     was a pre-migration artifact and surfacing both clutters the
   *     comm channel with the same question repeated.
   *   - Plain notes (and `[A:<qId>] …` answer notes) pass through
   *     unchanged in their original order.
   */
  #mergeQaWithNotes(qa: readonly QaItem[], notes: readonly Note[]): readonly Note[] {
    const qaTexts = new Set(qa.map(q => q.question.trim()))
    const synthetic: Note[] = qa.map(q => ({
      id: 'qa:' + q.qId,
      text: '[Q] ' + q.question,
      shape: null,
      mark: null,
      children: [],
    }))
    const filtered = notes.filter(n => {
      const t = (n.text ?? '').trimStart()
      if (!t.startsWith('[Q]')) return true
      const body = t.slice(3).trim()
      return !qaTexts.has(body)
    })
    return [...synthetic, ...filtered]
  }

  // ── filter (find a tile by name or note text) ─────────────
  // Free-text filter over the always-on tile navigator at the bottom of the
  // panel. Matches a cell's NAME or the text of any of its notes/questions, so
  // a tile can be found either by what it's called or by what's written in it.
  // Empty filter = every tile in the layer.
  readonly filterText = signal('')

  setFilter(event: Event): void {
    this.filterText.set((event.target as HTMLInputElement).value)
  }
  clearFilter(): void { this.filterText.set('') }

  /** Does `cell` match the current filter (by name or any note/question text)? */
  #matchesFilter(cell: string): boolean {
    const q = this.filterText().trim().toLowerCase()
    if (!q) return true
    if (cell.toLowerCase().includes(q)) return true
    const walk = (ns: readonly Note[]): boolean =>
      ns.some(n => this.noteDisplayText(n).toLowerCase().includes(q) || walk(n.children))
    if (walk(this.#notesByCell().get(cell) ?? [])) return true
    return (this.#qaByCell().get(cell) ?? []).some(item => item.question.toLowerCase().includes(q))
  }

  /** Count of a cell's notes + open questions, for the navigator badge. */
  #cellCount(cell: string): number {
    return this.#mergeQaWithNotes(
      this.#qaByCell().get(cell) ?? [],
      this.#notesByCell().get(cell) ?? [],
    ).length
  }

  // ── Tile navigator (one-of) ───────────────────────────────
  // The bottom navigator is a single-selection ("one of") list: clicking a
  // row makes that tile the active one whose notes the editor above manages.
  // There is no multi-tile working set — picking a tile here is equivalent to
  // clicking it on the canvas.

  /** Always-on tile navigator: every tile in the current layer, filtered by
   *  the find box, in layer order (CellSuggestionProvider order). Clicking a
   *  chip makes that tile active (its notes open in the editor above). Each
   *  chip carries a `size` (rem) weighted by note count — the tag-cloud look
   *  where busier tiles render larger. */
  readonly tileList = computed<readonly { cell: string; count: number; size: number }[]>(() => {
    const rows = this.#layerCellLabels()
      .filter(cell => this.#matchesFilter(cell))
      .map(cell => ({ cell, count: this.#cellCount(cell) }))
    const max = rows.reduce((m, r) => Math.max(m, r.count), 0)
    return rows.map(r => ({ ...r, size: this.#chipSize(r.count, max) }))
  })

  /** Tag-cloud weighting: map a tile's note count to a chip font-size (rem).
   *  Sqrt scale so the busiest tiles read as larger without dwarfing the rest;
   *  tiles with no notes sit at the floor. */
  #chipSize(count: number, max: number): number {
    const MIN = 0.78, MAX = 1.32
    if (max <= 0 || count <= 0) return MIN
    const t = Math.sqrt(count) / Math.sqrt(max)
    return +(MIN + (MAX - MIN) * t).toFixed(3)
  }

  /** Make `cell` the active tile — its notes open in the editor above the
   *  list. Clears any in-progress edit so switching tiles starts clean. The
   *  list-click counterpart to clicking the tile on the canvas. */
  activateCell(cell: string): void {
    if (!cell) return
    this.#capturingFor.set(null)
    this.editingNoteId.set(null)
    this.draftText.set('')
    this.#activeCell.set(cell)
  }

  /**
   * The active cell whose notes the editor shows — the capture target wins
   * (so authoring always targets the right tile), else the cell the user last
   * activated by clicking it on the canvas or in the tile list.
   */
  readonly cell = computed<string | null>(() => this.#capturingFor() ?? this.#activeCell())

  // ── Identity plate (which tile am I writing on) ───────────
  // A panel of notes with nothing but a name at the top reads as anonymous —
  // the user has to remember which tile the list belongs to. The plate answers
  // it visually: the tile's own hexagon (its picture, the same bytes the canvas
  // paints), its name, where it sits, and what it holds. Below PLATE_WIDE_AT
  // it collapses to one compact line so a narrow dock loses no list space.

  /** Live panel width. Fed by the panel's ResizeObserver, and ALSO measured
   *  directly at every moment the width can change by hand (edge drag,
   *  fullscreen toggle, viewport resize) — the observer is the general case,
   *  but it only delivers while the document is rendering, so the plate must
   *  not depend on it exclusively. Seeded from the panel's own box. */
  readonly #panelWidth = signal<number>(500)

  /** Measure the panel now and publish it. Cheap (one layout read) and safe to
   *  call from any of the width-changing paths. */
  #measurePanel(): void {
    const el = this.panel()?.nativeElement
    if (!el) return
    const w = Math.round(el.getBoundingClientRect().width)
    if (w > 0 && w !== this.#panelWidth()) this.#panelWidth.set(w)
  }

  /** Does the plate get its large form? Panel width is the honest measure —
   *  the strip can be a 260px rail on a 4K screen or a full-screen sheet on a
   *  laptop, and it's the PANEL the plate has to fit inside. */
  readonly plateWide = computed<boolean>(() => this.#panelWidth() >= PLATE_WIDE_AT)

  /** Where the active tile sits, as the explorer reads it. Empty at the root
   *  (the plate simply drops the line). */
  readonly platePath = computed<readonly string[]>(() => {
    this.#version()   // re-read after navigation
    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    return lineage?.explorerSegments?.() ?? []
  })

  /** Object-URL of the active tile's picture, or null (glyph fallback). */
  readonly plateImage = signal<string | null>(null)
  #plateImageUrl: string | null = null
  #plateImageCell: string | null = null
  #plateToken = 0

  /** First letter of the tile's name — what the hexagon carries when the tile
   *  has no picture. A blank hexagon reads as "broken"; an initial reads as
   *  "this tile, no picture yet". */
  readonly plateInitial = computed<string>(() => (this.cell() ?? '').trim().charAt(0).toUpperCase() || '·')

  /** The active tile's full entry list — UNFILTERED, unlike notes(). The
   *  plate's counts describe the tile, not the current filter. */
  #allForCell(cell: string | null): readonly Note[] {
    if (!cell) return []
    return this.#mergeQaWithNotes(this.#qaByCell().get(cell) ?? [], this.#notesByCell().get(cell) ?? [])
  }

  /** Counts for the plate: notes / open questions / answers / child tiles.
   *  Questions and answers are only surfaced when non-zero (the template
   *  drops the pill), so an ordinary tile shows two numbers, not four. */
  readonly plateCounts = computed<{ notes: number; questions: number; answers: number; children: number }>(() => {
    const cell = this.cell()
    const all = this.#allForCell(cell)
    let notes = 0, questions = 0, answers = 0
    const countIn = (list: readonly Note[]): void => {
      for (const n of list) {
        const kind = this.noteKind(n)
        if (kind === 'q') questions++
        else if (kind === 'a') answers++
        else notes++
        countIn(n.children)
      }
    }
    countIn(all)
    return { notes, questions, answers, children: (cell && this.#factsByCell().get(cell)?.childCount) || 0 }
  })

  /** Resolve the active tile's picture the same way the renderer does:
   *  props sig → props blob → `small.image` sig → bytes → object URL. The
   *  canonical sig from the head layer is preferred (it is correct even for a
   *  tile this client has never painted); the participant-local render index
   *  is the fallback. A miss is normal — the hexagon shows the initial. */
  async #syncPlateImage(cell: string | null): Promise<void> {
    if (cell === this.#plateImageCell) return
    const token = ++this.#plateToken
    this.#plateImageCell = cell
    this.#revokePlateImage()
    if (!cell) return
    const url = await this.#resolveTileImage(cell).catch(() => null)
    if (token !== this.#plateToken) { if (url) URL.revokeObjectURL(url); return }
    this.#plateImageUrl = url
    this.plateImage.set(url)
  }

  async #resolveTileImage(cell: string): Promise<string | null> {
    const store = window.ioc?.get<StoreLike>('@hypercomb.social/Store')
    if (!store?.getResource) return null
    let propsSig = this.#factsByCell().get(cell)?.propsSig ?? null
    if (!propsSig) propsSig = await this.#indexedPropsSig(cell)
    if (!propsSig) return null
    const propsBlob = await store.getResource(propsSig)
    if (!propsBlob) return null
    let props: { small?: { image?: unknown }; flat?: { small?: { image?: unknown } } }
    try { props = JSON.parse(await propsBlob.text()) } catch { return null }
    const raw = props?.small?.image ?? props?.flat?.small?.image
    if (typeof raw !== 'string' || !SIG_RE.test(raw)) return null
    const bytes = await store.getResource(raw)
    return bytes ? URL.createObjectURL(bytes) : null
  }

  /** Props sig from the participant-local render index — O(1) localStorage,
   *  keyed by locationSig with a bare-label fallback. Never a tree walk. */
  async #indexedPropsSig(cell: string): Promise<string | null> {
    let locSig = ''
    const history = window.ioc?.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const lineage = window.ioc?.get<LineageLike>('@hypercomb.social/Lineage')
    if (history?.sign) {
      const segments = [...(lineage?.explorerSegments?.() ?? []), cell]
      try { locSig = await history.sign({ explorerSegments: () => segments }) } catch { /* cold */ }
    }
    try {
      const idx = JSON.parse(localStorage.getItem(TILE_PROPS_INDEX_KEY) ?? '{}') as Record<string, string>
      const v = (locSig && idx[locSig]) || idx[cell]
      return (typeof v === 'string' && SIG_RE.test(v)) ? v : null
    } catch { return null }
  }

  #revokePlateImage(): void {
    if (this.#plateImageUrl) URL.revokeObjectURL(this.#plateImageUrl)
    this.#plateImageUrl = null
    this.plateImage.set(null)
  }

  // ── Navigator hover list ──────────────────────────────────
  // Hovering a tile in the navigator peeks at what's written on it, without
  // leaving the tile you're working on. The notes are already in hand — the
  // warmup effect resolves every tile in the layer — so the card is a pure
  // read of state that's already there: no fetch, no spinner.

  /** Tile whose hover card is showing, or null. */
  readonly hoverCell = signal<string | null>(null)
  /** Viewport anchor of the card. Exactly ONE of left/right is set (the other
   *  is null, which removes the binding): the card opens on whichever side of
   *  the hovered chip has room, so it never covers the navigator row the
   *  pointer is on — docked right it swings left, and in fullscreen (where the
   *  navigator is the left column) it swings right. */
  readonly hoverLeft = signal<number | null>(null)
  readonly hoverRight = signal<number | null>(null)
  readonly hoverTop = signal(0)

  /** Card width used for the fits-on-this-side test. Mirrors the SCSS
   *  `width: min(360px, 46vw)`. */
  #peekWidth(): number { return Math.min(360, window.innerWidth * 0.46) }

  #hoverOpenTimer: ReturnType<typeof setTimeout> | null = null
  #hoverCloseTimer: ReturnType<typeof setTimeout> | null = null

  /** Flattened preview of a hovered tile's entries, depth-tagged so nesting
   *  still reads, capped at HOVER_LIST_MAX rows. */
  readonly hoverNotes = computed<readonly { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[]>(() => {
    const cell = this.hoverCell()
    if (!cell) return []
    const out: { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[] = []
    const walk = (list: readonly Note[], depth: number): void => {
      for (const n of list) {
        out.push({ id: n.id, text: this.noteDisplayText(n), kind: this.noteKind(n), mark: n.mark, depth })
        walk(n.children, depth + 1)
      }
    }
    walk(this.#allForCell(cell), 0)
    return out
  })

  /** Rows actually rendered, and how many were left off. */
  readonly hoverVisible = computed(() => this.hoverNotes().slice(0, HOVER_LIST_MAX))
  readonly hoverOverflow = computed(() => Math.max(0, this.hoverNotes().length - HOVER_LIST_MAX))

  /** Has the hovered tile been read yet? An unwarmed tile shows "reading…"
   *  rather than an empty card that lies about the tile being empty. */
  readonly hoverWarmed = computed<boolean>(() => {
    const cell = this.hoverCell()
    return !!cell && this.#warmed().has(cell)
  })

  onChipEnter(cell: string, event: PointerEvent): void {
    // Touch/pen taps activate the tile — a hover card would just sit in the
    // way with no pointer to dismiss it.
    if (event.pointerType && event.pointerType !== 'mouse') return
    this.#clearHoverTimers()
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    this.#hoverOpenTimer = setTimeout(() => {
      if (rect) {
        // Side: prefer left of the chip (the strip docks right), but flip to
        // the right when there isn't room — that's the fullscreen layout,
        // where the navigator is the left column.
        const width = this.#peekWidth()
        if (rect.left - width - 10 >= 8) {
          this.hoverRight.set(Math.round(window.innerWidth - rect.left + 10))
          this.hoverLeft.set(null)
        } else {
          this.hoverLeft.set(Math.round(Math.min(rect.right + 10, window.innerWidth - width - 8)))
          this.hoverRight.set(null)
        }
        // Anchor to the chip's row, then lift the card so a long list stays
        // on screen instead of running off the bottom. Counts the FLATTENED
        // tree — nested notes are rows in the card too.
        const rows = Math.min(this.#flatCount(this.#allForCell(cell)), HOVER_LIST_MAX)
        const estimated = 52 + rows * 22
        this.hoverTop.set(Math.round(Math.max(8, Math.min(rect.top - 6, window.innerHeight - estimated - 12))))
      }
      this.hoverCell.set(cell)
    }, HOVER_OPEN_DELAY)
  }

  onChipLeave(): void {
    this.#clearHoverTimers()
    this.#hoverCloseTimer = setTimeout(() => this.hoverCell.set(null), HOVER_CLOSE_DELAY)
  }

  /** Rows a note tree renders as — every node at every depth. */
  #flatCount(list: readonly Note[]): number {
    let n = 0
    for (const note of list) n += 1 + this.#flatCount(note.children)
    return n
  }

  #clearHoverTimers(): void {
    if (this.#hoverOpenTimer) { clearTimeout(this.#hoverOpenTimer); this.#hoverOpenTimer = null }
    if (this.#hoverCloseTimer) { clearTimeout(this.#hoverCloseTimer); this.#hoverCloseTimer = null }
  }

  /**
   * Visible whenever the strip is explicitly open (via the control-bar Notes
   * toggle) or the user is authoring a note (capture mode). It NEVER opens on
   * its own from selection — passive auto-open was removed; the Notes toggle is
   * the sole on/off control. When open with no active tile, the panel still
   * shows so the always-on tile list is available to find and pick one.
   */
  readonly visible = computed<boolean>(() => !this.#parked() && (this.#open() || !!this.#capturingFor()))

  /** Put away while the hive is covered (the installer). A flag OVER the
   *  visibility rather than a write to `#open`: the strip also shows while
   *  authoring, so clearing the toggle alone would leave a half-typed note
   *  floating on top of the installer — and the draft is exactly what has to
   *  survive the round trip. */
  readonly #parked = signal<boolean>(false)

  readonly session: WindowSession = {
    park: () => this.#parked.set(true),
    unpark: () => this.#parked.set(false),
  }

  #cleanups: (() => void)[] = []
  #selectionListener: (() => void) | null = null

  // ── slide-resizable panel state ───────────────────────────
  // The panel exposes the browser's native bottom-right resize grip
  // (`resize: both` in the SCSS). On mount we restore the user's last
  // width/height from localStorage; a ResizeObserver mirrors subsequent
  // drags back into storage so the size persists across reloads. Only
  // engages on `mode-rows` — chips mode is a fixed-height horizontal
  // strip where resize would conflict with the flex stretch.
  readonly panel = viewChild<ElementRef<HTMLElement>>('panel')
  #resizeObserver: ResizeObserver | null = null
  #observingEl: HTMLElement | null = null
  #applyingDimensions = false

  // Input-mode stack participation. When the user hovers the notes strip,
  // we push a 'notes-hover' mode that mechanically unmounts the hex grid's
  // wheel-zoom listener — so scrolling the notes never bleeds into zooming
  // the underlying hexagons. The mode itself mounts no listeners; its
  // presence on top of the stack is what suspends what's below.
  readonly #notesHoverMode = {
    name: 'notes-hover',
    mount: (): void => { /* no listeners — suspension is structural */ },
    unmount: (): void => { /* nothing to tear down */ },
  }
  #hoverActive = false

  constructor() {
    // A different tile is a different document — the reading pane starts
    // back at its top. `untracked` so the write never joins the read graph.
    effect(() => {
      this.cell()
      untracked(() => this.readingIndex.set(0))
    })

    // Track the desk's breakpoint so the form renders where the layout
    // actually is: shrinking below it mid-session moves the form back to
    // the centre column (and the pane, hidden by CSS, drops its editor).
    const deskQuery = window.matchMedia('(min-width: 1024px)')
    const onDesk = (): void => {
      this.deskWide.set(deskQuery.matches)
      if (!deskQuery.matches) this.paneEditorOpen.set(false)
    }
    deskQuery.addEventListener('change', onDesk)
    this.#cleanups.push(() => deskQuery.removeEventListener('change', onDesk))

    // Folder navigation invalidates NotesService's cell-locationSig cache
    // (the same label resolves differently per folder), so notesFor() will
    // start returning [] for previously-warmed cells until getNotes runs
    // again. Clear our #warmed set in lockstep so empty-cells classification
    // doesn't treat the now-cold cache as authoritative, and bump #version
    // so dependent computeds re-read.
    const lineage = get<EventTarget>('@hypercomb.social/Lineage') as unknown as EventTarget | undefined
    if (lineage?.addEventListener) {
      const onLineage = (): void => {
        this.#warmed.set(new Set())
        this.#notesByCell.set(new Map())
        this.#qaByCell.set(new Map())
        this.#factsByCell.set(new Map())
        this.hoverCell.set(null)
        // The active cell / capture target belong to the layer we just LEFT —
        // the same label resolves to a different location (or nothing) here.
        // Keeping them would pin the editor to a stale context and make the
        // strip look frozen after navigation; dropping them hands the panel
        // back to the new layer's tile navigator. Selection's change event
        // re-establishes an active cell if one is selected in the new layer.
        this.#activeCell.set(null)
        this.#capturingFor.set(null)
        this.editingNoteId.set(null)
        this.draftText.set('')
        this.#version.update(v => v + 1)
        // Re-poll the layer's tile list — navigation changed which cells exist.
        this.#refreshLayerCellLabels()
      }
      lineage.addEventListener('change', onLineage)
      this.#cleanups.push(() => lineage.removeEventListener('change', onLineage))
    }

    // The tile navigator lists every cell in the current layer. Poll once now,
    // then re-poll on `synchronize` (the processor's coalesced post-update tick)
    // so cells added/removed within a layer keep the list current. Lineage
    // 'change' (above) covers navigation between layers.
    this.#refreshLayerCellLabels()
    const onSync = (): void => this.#refreshLayerCellLabels()
    window.addEventListener('synchronize', onSync)
    this.#cleanups.push(() => window.removeEventListener('synchronize', onSync))

    // A viewport resize moves the panel's own box (max-width, and fullscreen
    // where it IS the viewport) — re-measure so the plate's form follows, and
    // drop any open hover card, whose viewport anchor is now stale.
    const onViewportResize = (): void => {
      this.#measurePanel()
      if (this.hoverCell()) { this.#clearHoverTimers(); this.hoverCell.set(null) }
    }
    window.addEventListener('resize', onViewportResize)
    this.#cleanups.push(() => window.removeEventListener('resize', onViewportResize))

    // The polls above race the provider: CellSuggestionProvider refreshes its
    // names ASYNCHRONOUSLY after the same lineage-change / synchronize events,
    // so a synchronous suggestions() read at event time still returns the
    // PREVIOUS layer's names — the navigator would go stale exactly when the
    // user navigates. Subscribing to the provider's own 'change' event (fired
    // once its refresh lands) delivers the fresh list the moment it exists,
    // keeping the strip in lock-step with the current layer. whenReady covers
    // the provider registering after this component constructs.
    window.ioc.whenReady<EventTarget>('@hypercomb.social/CellSuggestionProvider', (provider) => {
      const onProviderChange = (): void => this.#refreshLayerCellLabels()
      provider.addEventListener('change', onProviderChange)
      this.#cleanups.push(() => provider.removeEventListener('change', onProviderChange))
      this.#refreshLayerCellLabels()
    })

    // SelectionService lives in a bee bundle that loads AFTER this Angular
    // component's constructor on hypercomb-web. Synchronous get() returns
    // undefined at construction time, so we'd silently never register the
    // change listener and #activeCell would remain null forever — that's
    // the actual cause of "notes don't show on selection on web". Use
    // window.ioc.whenReady so the wire-up happens whenever the service
    // arrives, before-or-after construction.
    const wireSelection = (selection: SelectionService): void => {
      // Selection no longer drives WHAT the strip shows — the list is the whole
      // layer now. A tile click just marks that tile active so its notes open
      // in the editor above the list (the auxiliary "click the tile on screen"
      // path; hidden tiles aren't clickable, so the filter is the primary way).
      const sync = (): void => { this.#activeCell.set(selection.active) }
      sync()
      selection.addEventListener('change', sync)
      this.#selectionListener = () => selection.removeEventListener('change', sync)
    }

    const synchronouslyResolved = this.#selection
    if (synchronouslyResolved) {
      wireSelection(synchronouslyResolved)
    } else {
      // Wait for the bee to register. whenReady fires synchronously if the
      // service is already there (covers a race where the bee registers
      // between our constructor's two reads), else queues the callback.
      window.ioc.whenReady<SelectionService>(
        '@diamondcoreprocessor.com/SelectionService',
        wireSelection,
      )
    }

    // Track NotesService availability so the warmup effect re-runs the
    // moment the bee registers — see comment on #notesServiceReady.
    if (this.#notes) {
      this.#notesServiceReady.set(true)
    } else {
      window.ioc.whenReady('@diamondcoreprocessor.com/NotesService', () => {
        this.#notesServiceReady.set(true)
      })
    }

    // The identity plate's picture follows the active tile. Tracks the facts
    // map too, so a tile whose canonical props sig lands AFTER the switch
    // (the warmup read is async) gets its hexagon filled in when it arrives
    // rather than staying on the initial forever.
    effect(() => {
      const cell = this.cell()
      const propsSig = cell ? (this.#factsByCell().get(cell)?.propsSig ?? null) : null
      untracked(() => {
        // A fresh props sig for the SAME cell (the tile's picture changed, or
        // the first read landed) has to re-resolve, so drop the memo first.
        if (cell === this.#plateImageCell && propsSig && !this.plateImage()) this.#plateImageCell = null
        void this.#syncPlateImage(cell)
      })
    })

    // Reset Comb v2 transient state whenever the active cell switches.
    // The popovers are cell-scoped — letting them persist across navigation
    // would surface stale note ids.
    //
    // Reads must be untracked: if the effect tracks these signals it
    // re-runs every time the popovers open and immediately closes them
    // again — the "palette won't open" bug.
    effect(() => {
      this.cell()  // sole dependency — re-fires on cell change only
      untracked(() => {
        if (this.kebabOpenId() !== null) this.kebabOpenId.set(null)
        if (this.pickerOpenForId() !== null) this.pickerOpenForId.set(null)
      })
    })

    // Focus the form's textarea once it has rendered, whenever a focus is
    // requested (#openForm / cancelEdit). Reading formInput() makes the
    // effect re-run when the viewChild resolves post-render, so the first
    // open focuses even though the textarea isn't in the DOM at call time.
    effect(() => {
      this.#focusTick()
      const el = this.formInput()?.nativeElement
      if (!el) return
      untracked(() => {
        if (this.#focusTick() === 0) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
      })
    })

    // Navigating to a DIFFERENT real tile closes any open form and clears
    // its transient state. Tracks #activeCell (not cell(), which the form's
    // own capture target perturbs) so opening / editing in the form never
    // trips this reset. Null active cell is left alone — the form may be
    // open against a capture target with no live selection.
    effect(() => {
      const ac = this.#activeCell()
      untracked(() => {
        if (!ac) return
        if (this.#capturingFor() && this.#capturingFor() !== ac) this.#capturingFor.set(null)
        if (this.editingNoteId() !== null) this.editingNoteId.set(null)
        if (this.draftText() !== '') this.draftText.set('')
      })
    })

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('notes:changed', async (p) => {
      // HiveParticipant emits with `segments` only — derive the cell
      // label from the last segment. Refresh both notes AND qa caches
      // so a freshly-committed `[A:<qId>] …` answer note immediately
      // surfaces AND any qa-slot mutation in the same cascade is
      // picked up. Same single trigger keeps both halves of the comm
      // channel in lock-step.
      const cellLabel = Array.isArray(p?.segments) && p!.segments!.length > 0
        ? String(p!.segments![p!.segments!.length - 1] ?? '').trim()
        : ''
      const svc = this.#notes
      if (svc && cellLabel) {
        const [fresh, facts] = await Promise.all([
          svc.getNotes(cellLabel),
          this.#loadCellFacts(cellLabel),
        ])
        this.#notesByCell.update(prev => {
          const next = new Map(prev)
          next.set(cellLabel, fresh.slice())
          return next
        })
        this.#qaByCell.update(prev => {
          const next = new Map(prev)
          next.set(cellLabel, facts.qa)
          return next
        })
        this.#rememberFacts(cellLabel, facts)
        this.#warmed.update(prev => {
          if (prev.has(cellLabel)) return prev
          const next = new Set(prev)
          next.add(cellLabel)
          return next
        })
      }
      this.#version.update(v => v + 1)
    }))

    // Track command-line capture state so the strip pops in for the target
    // tile while authoring — even when that tile has no notes yet.
    this.#cleanups.push(EffectBus.on<{ mode: string; target: string; editId?: string }>('command:enter-mode', (p) => {
      if (p?.mode !== 'note-capture' || !p.target) return
      this.#capturingFor.set(p.target)
      this.#open.set(true)   // authoring turns the strip on (and lights the toggle)
    }))
    this.#cleanups.push(EffectBus.on<{ mode: string }>('command:exit-mode', (p) => {
      if (p?.mode !== 'note-capture') return
      this.#capturingFor.set(null)
    }))

    // The tile note button (and other external add affordances) emit
    // `note:capture`. The strip now OWNS this: open the in-panel form for
    // that cell instead of routing into the command line. The notes drone
    // no longer turns note:capture into a command-line capture — the command
    // line stays free for a future quick-note syntax.
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; prefill?: string; editId?: string }>('note:capture', (p) => {
      if (!p?.cellLabel) return
      // External capture affordances mean "write a NOTE" — land on the notes
      // tab so the row just written is in front of the participant (a prose
      // commit made from the lists tab would vanish into the other tab).
      this.setTab('notes')
      if (p.editId) { this.editNote(p.editId, p.cellLabel); return }
      this.#openForm(p.cellLabel, { prefill: p.prefill })
    }))

    // Control-bar Notes toggle drives the strip's open state. The button
    // messages `notes:panel { visible }`; we mirror it into #open. This is
    // the SOLE on/off control now that passive auto-open is gone. Mirrors
    // the clipboard side panel's `clipboard:panel` command channel.
    this.#cleanups.push(EffectBus.on<{ visible?: boolean }>('notes:panel', (p) => {
      const next = !!p?.visible
      if (!next) {
        // Closing must also drop any in-progress capture, or the
        // capture-keeps-it-open rule in visible() would override the close.
        this.#capturingFor.set(null)
        this.draftText.set('')
        this.editingNoteId.set(null)
      }
      this.#open.set(next)
    }))

    // Stale legacy localStorage key — the user's pinned-tools list no
    // longer applies (the tool palette has been removed). One-time wipe
    // on construction keeps the storage tidy across reloads.
    try { localStorage.removeItem('hc:notes-strip-pinned-tools') } catch { /* ignore */ }

    // Mount/teardown the resize observer whenever the panel element appears
    // or its mode changes. Reads `visible/mode` so the effect re-runs
    // on every transition — chips mode tears the observer down and clears
    // any inline dimensions, rows mode restores stored dims and observes.
    effect(() => {
      this.visible()
      this.mode()
      this.panel()
      // Defer one microtask so Angular has applied the latest classes
      // (mode-chips/mode-rows) before we inspect classList.
      queueMicrotask(() => this.#syncPanelResize())
    })

    // The strip does NOT lock tile input. It is a docked side rail, not a
    // centred modal — the hive must stay fully navigable (pan, zoom, tile
    // click) while notes are showing, and the strip adapts in real time to
    // wherever the user goes (lineage + selection listeners above). Wheel
    // bleed while the cursor is OVER the strip is already handled by the
    // 'notes-hover' input mode; the host's pointer-events:none lets every
    // click outside the panel reach the canvas.

    // Broadcast the toggle's open state so the control-bar Notes button can
    // light up and toggle correctly. Tracks #open (the intent) rather than
    // visible() so the button stays lit while notes mode is on even when no
    // tile is selected. Last-value replayed by EffectBus, so a late-mounting
    // control bar reflects the current state. Mirrors `clipboard:open`.
    effect(() => {
      // Parked (the installer is covering the hive) reads as shut here too, so
      // the button doesn't sit lit for a strip that isn't on screen.
      EffectBus.emit('notes:panel-state', { open: this.#open() && !this.#parked() })
    })

    // Warm the decoded-set cache for the active cell AND every tile in the
    // layer (the navigator lists them all) so notes(), the navigator counts,
    // and the name-or-text filter classify accurately on first paint.
    //
    // Why this matters: NotesService.notesFor() is synchronous and reads
    // through #cellLocSigCache, which is only populated by the ASYNC
    // #resolveCellLocation() that runs inside getNotes(). Until getNotes
    // completes for a given cellLabel, notesFor() returns [] regardless
    // of how many notes actually exist. This warmup eagerly resolves the
    // cell-loc cache for every cell we're about to display, then bumps
    // #version so the strip's computed signals re-read with the now-warm
    // sync cache and add the cell to #warmed.
    //
    // Per-cell promise tracking (vs Promise.all) so each cell flips into
    // #warmed independently — fast cells don't have to wait on slow ones.
    effect(() => {
      // Read the readiness signal so the effect re-runs the moment
      // NotesService registers. Without this, an effect that runs once
      // before the bee loads (svc undefined → early return) won't auto-
      // re-fire when the service later arrives.
      this.#notesServiceReady()
      const svc = this.#notes
      if (!svc) return
      const targets = new Set<string>()
      const c = this.cell()
      if (c) targets.add(c)
      // Warm every tile in the layer so the navigator's note counts and the
      // name-or-text filter are accurate, and any tile is instant when activated.
      for (const cell of this.#layerCellLabels()) targets.add(cell)
      if (targets.size === 0) return
      for (const target of targets) {
        if (this.#warmed().has(target)) continue
        // Warm both sources in parallel so the strip surfaces the full
        // comm transcript (Claude's questions + user notes) in a single
        // render pass, not two.
        void Promise.all([
          svc.getNotes(target),
          this.#loadCellFacts(target),
        ]).then(([notes, facts]) => {
          this.#notesByCell.update(prev => {
            const next = new Map(prev)
            next.set(target, notes.slice())
            return next
          })
          this.#qaByCell.update(prev => {
            const next = new Map(prev)
            next.set(target, facts.qa)
            return next
          })
          this.#rememberFacts(target, facts)
          this.#warmed.update(prev => {
            if (prev.has(target)) return prev
            const next = new Set(prev)
            next.add(target)
            return next
          })
          this.#version.update(v => v + 1)
        }).catch(err => {
          console.error('[notes-strip] warmup failed', target, err)
        })
      }
    })
  }

  /** Resolve the `qa` slot of a cell's current layer and return the
   *  decoded questions. The strip uses this to surface Claude's open
   *  questions alongside user notes — same list, same row affordance.
   *  Each entry's underlying resource is a `{ qId, question, askedAt }`
   *  JSON; inflate returns the parsed object for sig values. Failures
   *  silently return `[]` — the strip degrades to showing notes only
   *  rather than throwing on a missing service. */
  /** Store the structural half of a facts read (the qa half goes to its own
   *  map, which the merge path already owns). */
  #rememberFacts(cell: string, facts: CellFacts): void {
    this.#factsByCell.update(prev => {
      const next = new Map(prev)
      next.set(cell, { childCount: facts.childCount, propsSig: facts.propsSig })
      return next
    })
  }

  async #loadCellFacts(cell: string): Promise<CellFacts> {
    const empty: CellFacts = { qa: [], childCount: 0, propsSig: null }
    const history = window.ioc?.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreLike>('@hypercomb.social/Store')
    if (!history || !store) return empty
    const lineage = window.ioc?.get<LineageLike>('@hypercomb.social/Lineage')
    const parent = lineage?.explorerSegments?.() ?? []
    const segments = [...parent, cell]
    try {
      const locSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locSig)
      if (!layer) return empty
      // Structure + picture, straight off the layer already in hand.
      const children = (layer as { children?: unknown }).children
      const childCount = Array.isArray(children) ? children.length : 0
      const properties = (layer as { properties?: unknown }).properties
      const head = Array.isArray(properties) ? properties[0] : undefined
      const propsSig = (typeof head === 'string' && SIG_RE.test(head)) ? head : null

      const raw = (layer as { qa?: unknown }).qa
      if (!Array.isArray(raw)) return { qa: [], childCount, propsSig }
      const items: QaItem[] = []
      for (const sig of raw) {
        if (typeof sig !== 'string') continue
        try {
          const resolved = await store.resolve<{ qId?: string; question?: string }>(sig)
          if (resolved && typeof resolved.question === 'string') {
            items.push({
              qId: String(resolved.qId || sig.slice(0, 16)),
              question: resolved.question.trim(),
            })
          }
        } catch { /* skip bad resource */ }
      }
      return { qa: items, childCount, propsSig }
    } catch {
      return empty
    }
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#selectionListener?.()
    // Object-URLs and pending hover timers are ours to release — a remount
    // otherwise leaks a blob per tile visited and can pop a card into a
    // torn-down view.
    this.#plateToken++
    this.#revokePlateImage()
    this.#clearHoverTimers()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#observingEl = null
    // Safety: ensure we never leave a 'notes-hover' mode pushed on the
    // stack if the component is destroyed mid-hover (e.g. selection
    // change triggers re-render while cursor is over the strip).
    this.#popNotesMode()
    // Same safety for an interrupted drag — release the window listeners
    // and pop the drag mode so we don't leak handlers across remounts.
    if (this.#dragPointerId !== null) {
      window.removeEventListener('pointermove', this.#onDragMove)
      window.removeEventListener('pointerup', this.#onDragEnd)
      window.removeEventListener('pointercancel', this.#onDragEnd)
      this.#dragPointerId = null
      this.#dragStart = null
    }
    if (this.#dragModeActive) {
      this.#stack()?.pop(this.#notesDragMode.name)
      this.#dragModeActive = false
    }
  }

  // ── resize wiring ─────────────────────────────────────────
  // Single sync point for the slide-panel: attach the observer when a
  // mode-rows element is in the DOM, detach (and clear inline dims) when
  // it isn't. Keeping all transitions in one method avoids the half-state
  // bug where a mode toggle leaves a stale observer pointed at a
  // detached element.
  #syncPanelResize(): void {
    const el = this.panel()?.nativeElement ?? null
    const isResizable = !!el && el.classList.contains('mode-rows')
    if (!isResizable) {
      if (this.#observingEl) {
        this.#resizeObserver?.disconnect()
        // Strip inline dimensions so chips mode (or hide) renders cleanly
        // — leftover width/height would override the flex layout.
        this.#observingEl.style.width = ''
        this.#observingEl.style.height = ''
        this.#observingEl = null
      }
      return
    }
    if (this.#observingEl === el) return
    this.#resizeObserver?.disconnect()
    this.#observingEl = el!
    this.#applyStoredDimensions(el!)
    // Seed the width before the first observer callback so the plate's first
    // paint is measured, not guessed.
    this.#measurePanel()
    this.#observePanelResize(el!)
  }

  #applyStoredDimensions(el: HTMLElement): void {
    // Width only. Height is intentionally NOT restored: the float panel is
    // content-height (so it stays freely draggable) and the docked rail is
    // full height — a persisted height (which, before, captured the docked
    // full height) would force the float full and lock it to a horizontal
    // drag line.
    let width: string | null = null
    try {
      width = localStorage.getItem(NOTES_STRIP_WIDTH_KEY)
    } catch { /* private mode / quota — ignore, fall back to CSS defaults */ }
    this.#applyingDimensions = true
    if (width && /^\d+$/.test(width)) el.style.width = `${width}px`
    queueMicrotask(() => { this.#applyingDimensions = false })
  }

  #observePanelResize(el: HTMLElement): void {
    let savePending = false
    this.#resizeObserver = new ResizeObserver((entries) => {
      // Width tracking runs BEFORE every persistence guard below: the identity
      // plate has to follow the panel even while dimensions are being applied
      // and while fullscreen (where the panel is widest and the plate matters
      // most, but nothing may be written to the user's stored size).
      const last = entries[entries.length - 1]
      if (last) this.#panelWidth.set(Math.round(last.contentRect.width))
      if (this.#applyingDimensions) return
      // Never persist while fullscreen — the size is forced by the
      // !important rules, not the user's docked preference, and
      // writing it would clobber their last-set docked dimensions.
      if (this.isFullscreen()) return
      if (savePending) return
      savePending = true
      requestAnimationFrame(() => {
        savePending = false
        const entry = entries[entries.length - 1]
        if (!entry) return
        const w = Math.round(entry.contentRect.width)
        // Width only — see #applyStoredDimensions for why height is not
        // persisted (it would lock the float panel to a full-height box).
        try {
          localStorage.setItem(NOTES_STRIP_WIDTH_KEY, String(w))
        } catch { /* ignore */ }
      })
    })
    this.#resizeObserver.observe(el)
  }

  // ── input-mode stack handlers ────────────────────────────
  // Wired from the template via (pointerenter) / (pointerleave) on the
  // notes-strip root. Pointer events cover both mouse and pen/touch.

  onNotesEnter(): void {
    if (this.#hoverActive) return
    const stack = this.#stack()
    if (!stack) return
    stack.push(this.#notesHoverMode)
    this.#hoverActive = true
  }

  onNotesLeave(): void {
    this.#popNotesMode()
  }

  #popNotesMode(): void {
    if (!this.#hoverActive) return
    this.#stack()?.pop(this.#notesHoverMode.name)
    this.#hoverActive = false
  }

  #stack(): InputModeStackLike | undefined {
    return window.ioc?.get<InputModeStackLike>('@diamondcoreprocessor.com/InputModeStack')
  }

  /** Click a note row → open the viewer modal centred on this note.
   *  Question rows (`[Q] …` prefix) shortcut to the tile editor instead
   *  so the Q&A panel is immediately available — that's the only
   *  surface with the answer composer + Done button. One click goes
   *  from "I see a question on this tile" to "I'm typing the answer."
   *
   *  Takes `cellLabel` from the template (`cell()`, which falls back
   *  through capture target before active cell) instead of re-reading
   *  `#activeCell()` — the strip is visible whenever `cell()` resolves,
   *  so the click handler must use the same source of truth or it'll
   *  silently bail when active cell is null but capture target is set,
   *  or when the strip stays open from cached notes after a tile
   *  deselect. Falls back to `cell()` for callers that don't pass one. */
  open(noteId: string, cellLabel?: string): void {
    // Back-compat alias — reading now happens inline in the panel form.
    this.editNote(noteId, cellLabel)
  }

  /** Open a note for editing in the embedded form. Plain notes load into
   *  the form (prefilled with their RAW text so any legacy [A:] marker
   *  round-trips); questions still route to the tile editor, where
   *  Claude's Q/A flow lives. Cell-aware for multi-cell. */
  editNote(noteId: string, cellLabel?: string): void {
    const cell = cellLabel ?? this.cell()
    if (!cell) return
    const note = this.#findNote(cell, noteId)
    if (!note) return
    if (this.noteKind(note) === 'q') {
      EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
      return
    }
    this.#openForm(cell, { editId: noteId, prefill: note.text, mark: note.mark })
  }

  /** Walk a cell's note tree (top-level or nested) to resolve a note id. */
  #findNote(cell: string, noteId: string): Note | undefined {
    const walk = (nodes: readonly Note[]): Note | undefined => {
      for (const n of nodes) {
        if (n.id === noteId) return n
        const found = walk(n.children)
        if (found) return found
      }
      return undefined
    }
    return walk(this.#notesByCell().get(cell) ?? [])
  }

  // ── Embedded note form ────────────────────────────────────
  // The form lives at the top of the panel. Opening it sets the capture
  // target (so the panel shows even for a cell with no notes yet) and
  // focuses the textarea. Commit routes through the same `note:commit`
  // event the drone already handles — no new write path.

  /** Open / focus the form for `cell`. `editId` set ⇒ edit mode. */
  #openForm(cell: string, opts?: { editId?: string | null; prefill?: string; mark?: string | null }): void {
    if (!cell) return
    this.#capturingFor.set(cell)
    this.#open.set(true)                       // authoring turns the strip on
    this.editingNoteId.set(opts?.editId ?? null)
    this.draftText.set(opts?.prefill ?? '')
    this.draftKind.set('note')
    // Add mode starts unmarked; edit mode inherits the note's own mark so
    // saving round-trips it instead of silently stripping it.
    const mark = opts?.mark ?? null
    this.draftMark.set(mark)
    EffectBus.emit('notes:active-mark', { mark })
    // On the desk the form lives in the pane — opening it flips the pane
    // from reading to writing.
    if (this.formInPane()) this.paneEditorOpen.set(true)
    this.#focusForm()
  }

  /** Bump to request focusing the form input. An effect (constructor) does
   *  the actual focus once the textarea has rendered — so the first open,
   *  when the form isn't in the DOM yet at call time, still focuses. */
  readonly #focusTick = signal(0)
  #focusForm(): void { this.#focusTick.update(v => v + 1) }

  /** Textarea input → mirror into the draft signal. */
  onFormInput(event: Event): void {
    this.draftText.set((event.target as HTMLTextAreaElement).value)
  }

  /** Enter (no shift) commits; Esc cancels an edit or clears the draft,
   *  otherwise falls through to the panel's escape cascade. */
  onFormKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      this.commitForm()
      return
    }
    if (event.key === 'Escape') {
      if (this.editingNoteId()) {
        event.preventDefault(); event.stopPropagation()
        this.cancelEdit()
      } else if (this.draftText().trim()) {
        event.preventDefault(); event.stopPropagation()
        this.draftText.set('')
      } else if (this.paneEditorOpen()) {
        // Empty add form in the pane — Esc puts the reader back.
        event.preventDefault(); event.stopPropagation()
        this.paneEditorOpen.set(false)
      }
    }
  }

  /** Commit the form — append (add mode) or replace (edit mode) via the
   *  drone's `note:commit` handler, carrying the staged shape. Keeps the
   *  panel open and refocuses so the user can keep adding. */
  commitForm(): void {
    const cell = this.cell()
    if (!cell) return
    const text = this.draftText().trim()
    if (!text) { this.cancelEdit(); return }
    const editId = this.editingNoteId()
    // A question is just a note carrying the `[Q] ` marker the rest of the
    // strip already keys off (noteKind, kind filter, question styling).
    const finalText = this.draftKind() === 'q' && !/^\[Q\]\s/i.test(text)
      ? `[Q] ${text}`
      : text
    const mark = this.draftMark()
    EffectBus.emit('note:commit', { cellLabel: cell, text: finalText, mark, editId: editId ?? undefined })
    // Paint immediately — don't make the user wait for the resource write +
    // leaf→root layer cascade + the notes:changed re-read. The authoritative
    // reconcile lands moments later and replaces this with the persisted note.
    this.#paintOptimistic(cell, finalText, editId ?? null, mark)
    this.draftText.set('')
    this.editingNoteId.set(null)           // editing is one-shot → back to add
    // In the pane, saving an EDIT returns to reading (you were reading; the
    // note you fixed is under the glass). Saving an ADD keeps the editor up,
    // focused — the "keep adding" flow the docked form has always had.
    if (this.formInPane() && editId) {
      this.paneEditorOpen.set(false)
      return
    }
    this.#focusForm()
  }

  /** Optimistically reflect a just-committed note in the local display so the
   *  strip paints the instant the user hits Enter — instead of waiting for the
   *  resource write + leaf→root layer cascade + the `notes:changed` re-read.
   *  Persistence is untouched (the drone still runs the real commit); the
   *  authoritative `notes:changed` handler replaces this entry with the
   *  persisted note a moment later — same text + position, so the swap is
   *  seamless. On edit we mutate text in place (keeping id/children) so the
   *  row doesn't flicker. */
  #paintOptimistic(cell: string, text: string, editId: string | null, mark: string | null = null): void {
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      const current = next.get(cell) ?? []
      if (editId) {
        next.set(cell, current.map(n => (n.id === editId ? { ...n, text, mark } : n)))
      } else {
        const pending: Note = { id: `pending-${++this.#pendingSeq}`, text, shape: null, mark, children: [] }
        next.set(cell, [...current, pending])
      }
      return next
    })
    // The cell now has content — mark it warmed so the empty-state classifier
    // doesn't briefly flag it, and bump #version like the reconcile path does.
    this.#warmed.update(prev => { if (prev.has(cell)) return prev; const n = new Set(prev); n.add(cell); return n })
    this.#version.update(v => v + 1)
  }

  /** Drop out of edit mode back to a blank add form — and, in the pane,
   *  back to reading. */
  cancelEdit(): void {
    this.editingNoteId.set(null)
    this.draftText.set('')
    this.draftKind.set('note')
    this.draftMark.set(null)
    EffectBus.emit('notes:active-mark', { mark: null })
    if (this.formInPane()) {
      this.paneEditorOpen.set(false)
      return
    }
    this.#focusForm()
  }

  /** Header "hide" button — turns the strip off. Stays off until the user
   *  explicitly re-opens it via the control-bar Notes toggle (or starts
   *  authoring a note); selecting another tile no longer reopens it. Also
   *  cancels any in-progress capture so `visible()` settles to false. */
  hide(): void {
    // Close any open form locally (the command line is no longer involved)
    // so capture mode doesn't keep the strip open after it's turned off.
    this.#capturingFor.set(null)
    this.draftText.set('')
    this.editingNoteId.set(null)
    this.#open.set(false)
  }

  /** Delete a single note from the active cell's list. Optimistic like
   *  commitForm: the row vanishes on click; the drone's tree rewrite +
   *  cascade + `notes:changed` re-read is the authoritative reconcile. */
  remove(noteId: string, event: Event): void {
    event.stopPropagation()
    const cell = this.cell()
    if (!cell || !noteId) return
    const prune = (list: readonly Note[]): Note[] =>
      list.filter(n => n.id !== noteId)
        .map(n => n.children.length ? { ...n, children: prune(n.children) } : n)
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      next.set(cell, prune(next.get(cell) ?? []))
      return next
    })
    this.#version.update(v => v + 1)
    EffectBus.emit('note:delete', { cellLabel: cell, noteId })
  }

  /** Classify a note by its legacy text prefix. `[Q] …` is a question
   *  carried over from the pre-qa-slot era; `[A:<qId>] …` is its paired
   *  answer. Anything else is a plain user note. The strip styles each
   *  kind with a distinct background card so the user can scan a cell
   *  and immediately see what's a question, what's an answer, and what
   *  is their own context. */
  noteKind(note: Note): 'q' | 'a' | 'note' {
    const t = (note?.text ?? '').trimStart()
    if (t.startsWith('[Q]')) return 'q'
    if (t.startsWith('[A:') || t.startsWith('[A ')) return 'a'
    return 'note'
  }

  /** Strip the legacy `[Q]` / `[A:<qId>]` prefix from the displayed text.
   *  The kind-styling already signals what the row is, so the bracket
   *  marker is redundant noise to the reader. The raw text is kept for
   *  tooltips / inspector flows. */
  noteDisplayText(note: Note): string {
    const t = (note?.text ?? '')
    const trimmed = t.trimStart()
    if (trimmed.startsWith('[Q]')) return trimmed.slice(3).trimStart()
    const aMatch = /^\[A:[^\]]*\]\s*/.exec(trimmed) || /^\[A\s[^\]]*\]\s*/.exec(trimmed)
    if (aMatch) return trimmed.slice(aMatch[0].length)
    return t
  }

  trackById = (_i: number, n: Note): string => n.id

  // ── service resolution ──────────────────────────────────

  get #notes(): NotesService | undefined {
    return get('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
  }

  get #selection(): SelectionService | undefined {
    return get('@diamondcoreprocessor.com/SelectionService') as SelectionService | undefined
  }

  get i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }
}

// ── shell-surface contribution ──────────────────────────────────────────────
// The strip mounts itself through the ShellSurfaceRegistry rather than being
// hand-placed in app.html. <hc-shell-surfaces> renders whatever is registered;
// stop loading this module (or call registry.remove) and the strip cascades out
// of the DOM — nothing left behind. This is the vertical-pipeline `interface`
// stage: the surface owns where it appears.
registerShellSurface({
  name: 'hc-notes-strip',
  owner: '@hypercomb.shared/NotesStripComponent',
  component: NotesStripComponent,
  order: 10,
})
