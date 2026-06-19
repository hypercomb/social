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


/**
 * Cap on how many selected tiles the multi-select accordion will surface
 * at once. Large selections would otherwise flood the strip; the user's
 * most recent N picks are always the most relevant to current work.
 */
const MAX_VISIBLE_SELECTIONS = 10

// localStorage keys for the slide-resizable panel. Persisted as integer
// pixel strings; missing/non-numeric values fall back to the CSS defaults
// (28rem wide, content-height tall).
const NOTES_STRIP_WIDTH_KEY = 'hc:notes-strip-width'

// Translate delta from the panel's natural (centered) position. Persisted
// across reloads so the strip stays where the user dropped it.
const NOTES_STRIP_OFFSET_KEY = 'hc:notes-strip-offset'

// Owner token for the InputGate lock the strip holds while visible. Owner-
// scoped so it composes with the editor's lock rather than stomping it.
const NOTES_STRIP_LOCK_OWNER = 'notes-strip'

// Dock side — 'right' snaps the strip to a full-height rail on the right
// edge (so it never fights the left-docked control bar); 'float' is the
// free, draggable, centred-baseline mode. Persisted across reloads.
const NOTES_STRIP_DOCK_KEY = 'hc:notes-strip-dock'

// Right-edge snap thresholds (mirror the controls-bar hysteresis): enter
// the dock within SNAP_ZONE of the right edge; only leave it once the
// cursor pulls back past SNAP_EXIT, so the dock doesn't flicker on/off.
const SNAP_ZONE = 72
const SNAP_EXIT = 120

/** Fixed shape set — six CSS-drawn glyphs. The shape is the only
 *  visual category a note carries. Names map 1:1 to .hc-shape-X
 *  classes defined in hypercomb-shared/styles/_notes-shapes.scss. */
export type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

type Note = {
  id: string
  text: string
  shape: ShapeId | null
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
 *  Lives in the cell's `qa` layer slot (or in `__optimization__/` with
 *  kind=qa for the substrate-stored variant) as a content-addressed
 *  JSON: `{ qId, question, askedAt }`. Surfaced into the notes strip
 *  alongside user notes so the conversation reads in one list. */
type QaItem = {
  qId: string
  question: string
}

type HistoryServiceLike = {
  sign(lineageLike: { explorerSegments?: () => readonly string[] }): Promise<string>
  currentLayerAt(locationSig: string): Promise<{ qa?: unknown } | null>
}

type StoreLike = {
  resolve<T = unknown>(value: unknown): Promise<T>
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

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc (shared must never import from modules). The
 *  owner-scoped lock/unlock lets the strip hold its lock without stomping
 *  locks held by the editor or the manual lock button. */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

@Component({
  selector: 'hc-notes-strip',
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet],
  templateUrl: './notes-strip.component.html',
  styleUrls: ['./notes-strip.component.scss'],
})
export class NotesStripComponent implements OnDestroy {

  readonly #activeCell = signal<string | null>(null)
  readonly #selectedCells = signal<readonly string[]>([])
  readonly #capturingFor = signal<string | null>(null)
  readonly #version = signal(0)
  // Which group's section is currently expanded. The two-signal split lets
  // us distinguish three states cleanly: untouched (auto-open the first
  // group with notes on first multi-select), explicitly opened (#openGroup
  // holds the cell name), and explicitly closed (#userClosed = true,
  // suppresses the auto-fallback so all sections stay collapsed).
  readonly #openGroup = signal<string | null>(null)
  readonly #userClosed = signal<boolean>(false)
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

  // Context key captured at the moment the user clicked "hide notes".
  // The strip stays hidden only while the current context still matches —
  // change selection and the equality check fails, so the strip reappears
  // naturally without any explicit reset. Capture mode trumps hide
  // (see `visible`) so authoring always shows the strip.
  readonly #hiddenContext = signal<string | null>(null)

  /**
   * Display mode — `chips` is the horizontal scrolling chip row, `rows` is
   * the vertical stack (better for long sentence-style rules). Persisted
   * per user; defaults to `rows` so longer note text reads naturally.
   */
  readonly mode = signal<'chips' | 'rows'>(
    (localStorage.getItem('hc:notes-strip-mode') as 'chips' | 'rows' | null) ?? 'rows'
  )

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
  // Note ids currently checked for bulk action. Scoped to the active
  // cell — clears when the cell changes. Drives the toolbar's morph
  // between edit (formatting) and select (bulk-action) modes.
  // Per-cell selection — Map<cellLabel, Set<noteId>>. Tracking which
  // CELL each selected note lives in (instead of a flat note-id set)
  // makes cross-cell selection in see-all / multi-cell mode safe: bulk
  // actions iterate per cell and route each emit to the right
  // cellLabel instead of all going to the single active cell.
  readonly selectedNotes = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map())

  /** Total count of selected notes across all cells. */
  readonly selectionCount = computed<number>(() => {
    let sum = 0
    for (const ids of this.selectedNotes().values()) sum += ids.size
    return sum
  })

  /** Set of selected note ids in the currently-active cell. Kept for
   *  the single-cell template's existing API surface; multi-cell rows
   *  pass their group.cell explicitly. */
  readonly selectedNoteIds = computed<ReadonlySet<string>>(() => {
    const cell = this.cell()
    if (!cell) return new Set<string>()
    return this.selectedNotes().get(cell) ?? new Set<string>()
  })

  /** True when there's at least one note selected — toolbar swaps to
   *  the selection-bar variant and per-row checkboxes pin visible. */
  readonly selectionMode = computed<boolean>(() => this.selectionCount() > 0)

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

  /** Selected cell count — public mirror of the private #selectedCells for
   *  the drag-bar's "N cells" label in multi-cell mode. */
  readonly selectedCellsCount = computed<number>(() => this.#selectedCells().length)

  // ── Comb v2 actions ──────────────────────────────────────

  /** Is the given (cell, noteId) pair currently selected? Cell-aware
   *  so the same note id in two different cells doesn't collide. */
  isNoteSelected(cellLabel: string, noteId: string): boolean {
    return this.selectedNotes().get(cellLabel)?.has(noteId) ?? false
  }

  toggleNoteSelection(cellLabel: string, noteId: string, event?: Event): void {
    event?.stopPropagation()
    this.selectedNotes.update(prev => {
      const next = new Map(prev)
      const existing = new Set(next.get(cellLabel) ?? [])
      if (existing.has(noteId)) existing.delete(noteId)
      else existing.add(noteId)
      if (existing.size === 0) next.delete(cellLabel)
      else next.set(cellLabel, existing)
      return next
    })
  }

  clearNoteSelection(): void {
    this.selectedNotes.set(new Map())
  }

  /** Resolve a (cellLabel, noteId) pair to its current Note record by
   *  reading from #notesByCell + qa-merge, exactly like notes() does.
   *  Used by bulk actions so they can operate on cells the user has
   *  selected via the multi-cell accordion (not just the active cell). */
  #resolveSelectedNote(cellLabel: string, noteId: string): Note | undefined {
    const stored = this.#notesByCell().get(cellLabel) ?? []
    const qa = this.#qaByCell().get(cellLabel) ?? []
    return this.#mergeQaWithNotes(qa, stored).find(n => n.id === noteId)
  }

  /** Bulk-delete every currently selected note, regardless of cell. */
  deleteSelectedNotes(): void {
    const map = this.selectedNotes()
    for (const [cellLabel, ids] of map) {
      for (const id of ids) {
        EffectBus.emit('note:delete', { cellLabel, noteId: id })
      }
    }
    this.clearNoteSelection()
  }

  /** Toggle the `[Q]` question prefix on every currently selected note.
   *  Note ↔ Question. Answer notes (`[A:qId] …`) are skipped — they're
   *  paired with a question and toggling them would orphan the link. */
  toggleSelectionKind(): void {
    for (const [cellLabel, ids] of this.selectedNotes()) {
      for (const id of ids) {
        const note = this.#resolveSelectedNote(cellLabel, id)
        if (!note) continue
        const kind = this.noteKind(note)
        if (kind === 'a') continue
        const trimmed = note.text.replace(/^\s+/, '')
        const stripped = kind === 'q'
          ? trimmed.replace(/^\[Q\]\s?/, '')
          : '[Q] ' + trimmed
        EffectBus.emit('note:commit', { cellLabel, text: stripped, editId: id })
      }
    }
    this.clearNoteSelection()
  }

  /** Copy the text of every selected note to the clipboard, one per
   *  line. Iterates across all cells in the selection so see-all mode
   *  exports notes from every cell the user has checked. */
  async copySelectedNotesText(): Promise<void> {
    if (this.selectionCount() === 0) return
    const lines: string[] = []
    for (const [cellLabel, ids] of this.selectedNotes()) {
      for (const id of ids) {
        const note = this.#resolveSelectedNote(cellLabel, id)
        if (!note) continue
        // noteDisplayText strips [Q]/[A:qId]. Notes are plain text
        // (no line markers anymore), so no further plainification.
        lines.push(this.noteDisplayText(note))
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n\n'))
    } catch { /* permission denied / insecure context — no-op */ }
    this.clearNoteSelection()
  }

  /** Duplicate each selected note in its own cell — emits a fresh
   *  `note:commit` with the same text (no editId), which appends a
   *  new sig to that cell's notes slot. */
  duplicateSelectedNotes(): void {
    for (const [cellLabel, ids] of this.selectedNotes()) {
      for (const id of ids) {
        const note = this.#resolveSelectedNote(cellLabel, id)
        if (!note) continue
        EffectBus.emit('note:commit', { cellLabel, text: note.text })
      }
    }
    this.clearNoteSelection()
  }

  /** Shift indentation on every selected note's text by the given
   *  delta (positive indents, negative outdents). Operates on the
   *  whole stored text — every line shifts together. */
  shiftSelectedIndent(delta: number): void {
    const UNIT = 2
    for (const [cellLabel, ids] of this.selectedNotes()) {
      for (const id of ids) {
        const note = this.#resolveSelectedNote(cellLabel, id)
        if (!note) continue
        const shifted = note.text.split(/\r?\n/).map(line => {
          const m = /^([ \t]*)(.*)$/.exec(line)
          const lead = (m?.[1] ?? '').replace(/\t/g, '  ')
          const rest = m?.[2] ?? line
          const units = Math.floor(lead.length / UNIT)
          const next = Math.max(0, units + delta)
          return ' '.repeat(next * UNIT) + rest
        }).join('\n')
        if (shifted === note.text) continue
        EffectBus.emit('note:commit', { cellLabel, text: shifted, editId: id })
      }
    }
    this.clearNoteSelection()
  }


  /** Indent the current capture-input line one level (two spaces). */
  indent(): void {
    if (!this.capturing()) return
    EffectBus.emit('note-capture:indent', { delta: 1 })
  }

  /** Outdent the current capture-input line one level. */
  outdent(): void {
    if (!this.capturing()) return
    EffectBus.emit('note-capture:indent', { delta: -1 })
  }

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
  nestCandidates(sourceId: string): readonly { id: string; text: string; shape: ShapeId | null; depth: number }[] {
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
    const out: { id: string; text: string; shape: ShapeId | null; depth: number }[] = []
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) {
        if (!forbidden.has(n.id)) {
          out.push({ id: n.id, text: this.noteDisplayText(n), shape: n.shape, depth })
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
    EffectBus.emit('notes:expand-to-index', { cellLabel: this.cell(), fullscreen: this.isFullscreen() })
  }

  /** "See all across the hive" — per the design concept, this should
   *  show notes from every cell in the current layer. We achieve that
   *  by enumerating cell labels via CellSuggestionProvider, treating
   *  them as a virtual multi-cell selection, and rendering through
   *  the existing accordion path. Also activates fullscreen since
   *  there's now more content to display. */
  readonly seeAllInLayer = signal<boolean>(false)
  readonly #layerCellLabels = signal<readonly string[]>([])

  toggleSeeAll(): void {
    const next = !this.seeAllInLayer()
    this.seeAllInLayer.set(next)
    if (next) {
      this.#refreshLayerCellLabels()
    } else {
      this.#layerCellLabels.set([])
    }
    // NOTE: fullscreen is an independent toggle now. Coupling them
    // caused two regressions — drag stopped working in see-all
    // (fullscreen's transform: none override killed panel-offset)
    // and the panel position visibly shifted between modes. The user
    // can expand to fullscreen via the expand button if they want
    // the larger surface; see-all alone keeps the docked layout.
  }

  /** Pull the current layer's cell labels from CellSuggestionProvider
   *  (the same source the command-line autocomplete uses). The provider
   *  refreshes on `synchronize` / `lineage:change`, so we re-poll on
   *  those events while see-all is active. */
  #refreshLayerCellLabels(): void {
    const provider = get<{ suggestions(): readonly string[] }>(
      '@hypercomb.social/CellSuggestionProvider'
    )
    if (!provider) {
      this.#layerCellLabels.set([])
      return
    }
    const labels = provider.suggestions()
    this.#layerCellLabels.set([...labels])
  }

  /** Legacy alias kept for any external callers; routes to the
   *  fullscreen toggle. */
  expandToIndex(): void {
    this.toggleFullscreen()
  }

  /** Click a row's body — in select mode it toggles selection,
   *  otherwise it opens the viewer. Cell-aware so see-all rows
   *  add to the right per-cell bucket. */
  onRowBodyClick(cellLabel: string, noteId: string, event: Event): void {
    if (this.selectionMode()) {
      this.toggleNoteSelection(cellLabel, noteId, event)
      return
    }
    this.open(noteId, cellLabel)
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
    event.preventDefault()
    this.#dragPointerId = event.pointerId
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
    this.#dragPointerId = null
    this.#dragStart = null
    window.removeEventListener('pointermove', this.#onDragMove)
    window.removeEventListener('pointerup', this.#onDragEnd)
    window.removeEventListener('pointercancel', this.#onDragEnd)
    if (this.#dragModeActive) {
      this.#stack()?.pop(this.#notesDragMode.name)
      this.#dragModeActive = false
    }
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

  /** Double-click the grip dots → reset position to centered default. */
  resetPanelOffset(): void {
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
  // Legacy: multi-cell accordion mode still uses an insertion index.
  // Single-cell tree mode uses noteDropTargetId + noteDropMode.
  readonly noteDropIndex = signal<number | null>(null)
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
    // Multi-cell mode still uses the flat index. Find the row's
    // starting index within its OWN cell — see-all accordion may show
    // many cells; the reorder is always per-cell.
    const cellNotes = this.#mergeQaWithNotes(
      this.#qaByCell().get(cellLabel) ?? [],
      this.#notesByCell().get(cellLabel) ?? [],
    )
    this.noteDropIndex.set(cellNotes.findIndex(n => n.id === noteId))
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

    // Multi-cell accordion mode — keep the legacy flat-index logic.
    // Trees only show in single-cell mode for now.
    if (this.multi()) {
      const root = this.#host.nativeElement
      const group = root.querySelector(`[data-cell="${CSS.escape(sourceCell)}"]`)
      const rows = group
        ? (Array.from(group.querySelectorAll('.note-row')) as HTMLElement[])
        : []
      if (rows.length === 0) return
      const y = event.clientY
      let idx = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (y < r.top + r.height / 2) { idx = i; break }
      }
      this.noteDropIndex.set(idx)
      return
    }

    // Single-cell tree mode — detect hovered row + zone (upper third =
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
    const flatIndex = this.noteDropIndex()
    const targetId = this.noteDropTargetId()
    const mode = this.noteDropMode()
    this.#noteDragPointerId = null
    this.noteDragSourceId.set(null)
    this.noteDragSourceCell.set(null)
    this.noteDropIndex.set(null)
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

    // Legacy flat reorder (multi-cell accordion mode).
    if (this.multi() && flatIndex !== null) {
      EffectBus.emit('note:reorder', { cellLabel: sourceCell, sourceId, targetIndex: flatIndex })
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
    if (this.seeAllInLayer()) {
      this.toggleSeeAll()  // also clears layer cells signal
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (this.selectionMode()) {
      this.clearNoteSelection()
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
    const byCell = this.#notesByCell()
    const byQa = this.#qaByCell()
    const cells: string[] = []
    if (this.multi()) {
      cells.push(...this.#effectiveCells().slice(-MAX_VISIBLE_SELECTIONS))
    } else {
      const c = this.cell()
      if (c) cells.push(c)
    }
    for (const c of cells) {
      if ((byQa.get(c)?.length ?? 0) > 0) return true
      const notes = byCell.get(c) ?? []
      if (notes.some(n => this.noteKind(n) === 'q')) return true
    }
    return false
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

  /** Display label for a row's kind affordance — shown in a small header
   *  chip alongside the kind icon at the top of each row. Plain English
   *  for now; i18n keys can layer on later without touching the consumers. */
  noteKindLabel(note: Note): string {
    switch (this.noteKind(note)) {
      case 'q': return 'Question'
      case 'a': return 'Answer'
      default:  return 'Note'
    }
  }

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

  /**
   * Multi-selection mode: more than one tile is selected. Switches the
   * strip into accordion layout — one expandable section per selected
   * cell with its own notes. Stays active even while authoring (capture
   * mode) so the user can click a tab, drop the cursor into the command
   * line, and type a new note without losing the multi-cell view.
   */
  /** Cells the strip should currently display as a multi-cell accordion.
   *  When `seeAllInLayer` is on, we substitute the lineage's full cell
   *  list (via CellSuggestionProvider) — that's the design's
   *  "see all across the hive" behaviour. */
  readonly #effectiveCells = computed<readonly string[]>(() => {
    if (this.seeAllInLayer()) return this.#layerCellLabels()
    return this.#selectedCells()
  })

  readonly multi = computed<boolean>(() => this.#effectiveCells().length > 1)

  /**
   * Per-cell note groups for the accordion — ONLY cells that actually have
   * notes. Reads notes synchronously from NotesService — getNotes warmup at
   * boot already populated the cache; selection signals trigger #version
   * bumps via the notes:changed effect.
   */
  readonly groups = computed<readonly { cell: string; notes: readonly Note[]; expanded: boolean }[]>(() => {
    const cells = this.#effectiveCells()
    if (cells.length <= 1) return []
    const byCell = this.#notesByCell()
    const byQa = this.#qaByCell()
    // Only the most-recent N selections show in the menu — large
    // selections would otherwise flood the strip and bury the cells the
    // user is actually working with.
    const recent = cells.slice(-MAX_VISIBLE_SELECTIONS)
    // Resolve the merged (qa + notes) list per cell once; reuse below
    // for the "has anything" filter and for the rendered groups.
    const mergedByCell = new Map<string, readonly Note[]>()
    for (const c of recent) {
      const merged = this.#mergeQaWithNotes(byQa.get(c) ?? [], byCell.get(c) ?? [])
      mergedByCell.set(c, merged.filter(n => this.#passesFilter(this.noteKind(n))))
    }
    const withContent = recent.filter(c => (mergedByCell.get(c)?.length ?? 0) > 0)
    const open = this.#openGroup()
    const closed = this.#userClosed()
    // Resolution order:
    //   1. If user explicitly collapsed everything, honour that — none open.
    //   2. If a specific group was opened and is still in the list, use it.
    //   3. Otherwise auto-pick the first group with content so first-time
    //      multi-select shows something instead of an all-closed wall.
    const expanded = closed
      ? null
      : (open && withContent.includes(open))
        ? open
        : withContent[0] ?? null
    return withContent.map(c => ({
      cell: c,
      notes: mergedByCell.get(c) ?? [],
      expanded: c === expanded,
    }))
  })

  /**
   * Selected cells that DON'T have any notes — surfaced as a small bottom
   * list so the user can see at a glance which tiles in their selection
   * still need context. Only includes cells we've confirmed warmed (via
   * #warmed) so an unparsed cache doesn't briefly mis-classify a populated
   * cell as empty during the initial warmup window.
   */
  readonly emptyCells = computed<readonly string[]>(() => {
    const cells = this.#effectiveCells()
    if (cells.length <= 1) return []
    const warmed = this.#warmed()
    const byCell = this.#notesByCell()
    const byQa = this.#qaByCell()
    const recent = cells.slice(-MAX_VISIBLE_SELECTIONS)
    // A cell is "empty" only if BOTH sources are empty — a qa-only cell
    // still has Claude-side content the user might want to answer.
    return recent.filter(c => warmed.has(c)
      && (byCell.get(c)?.length ?? 0) === 0
      && (byQa.get(c)?.length ?? 0) === 0)
  })

  /**
   * The cell whose notes the strip is showing in single-tile mode — capture
   * target wins so the user always sees the strip for the tile they're
   * authoring against, even if they navigate selection away mid-capture.
   */
  readonly cell = computed<string | null>(() => this.#capturingFor() ?? this.#activeCell())

  /**
   * Selection identity that "hide notes" is scoped to. The user-clicked-hide
   * signal stores this key; the visible computed compares it against the
   * current key to decide whether hide is still in effect. When selection
   * changes, the key changes and the hidden state lapses automatically.
   */
  readonly #contextKey = computed<string>(() => {
    const cells = this.#selectedCells()
    if (cells.length > 1) return 'multi:' + [...cells].sort().join('|')
    return 'single:' + (this.cell() ?? '')
  })

  /**
   * Visible whenever the active cell has notes, or the user is actively
   * authoring one, OR multi-selection has any cells with notes — unless
   * the user has explicitly hidden the strip for the current selection
   * via the header hide button. Capture mode always trumps hide.
   */
  readonly visible = computed<boolean>(() => {
    if (this.#capturingFor()) return true
    const hidden = this.#hiddenContext()
    if (hidden && hidden === this.#contextKey()) return false
    if (this.multi()) {
      // Show whenever any selected cell has notes — emptyCells is only ever
      // shown alongside a populated accordion, never on its own.
      return this.groups().length > 0
    }
    // Single-cell mode: show as soon as the cell has either confirmed-loaded
    // notes OR is still loading (warmup hasn't resolved yet). Without this
    // mid-warmup gate the strip flashes hidden→visible the instant the user
    // clicks a tile that does have notes, because notesFor() returns [] sync
    // before getNotes() completes. Only hide once we've confirmed the cell
    // truly has zero notes.
    const c = this.cell()
    if (!c) return false
    const warmed = this.#warmed().has(c)
    if (!warmed) return true   // give warmup a chance — strip stays open
    return this.notes().length > 0 || !!this.#capturingFor()
  })

  /** True when the strip is shown specifically because a note is being authored. */
  readonly capturing = computed<boolean>(() => !!this.#capturingFor())

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
        this.#version.update(v => v + 1)
        // Refresh the layer's cell list if see-all is currently active —
        // the user navigated into a new layer and the displayed set of
        // cells just changed.
        if (this.seeAllInLayer()) this.#refreshLayerCellLabels()
      }
      lineage.addEventListener('change', onLineage)
      this.#cleanups.push(() => lineage.removeEventListener('change', onLineage))
    }

    // SelectionService lives in a bee bundle that loads AFTER this Angular
    // component's constructor on hypercomb-web. Synchronous get() returns
    // undefined at construction time, so we'd silently never register the
    // change listener and #activeCell would remain null forever — that's
    // the actual cause of "notes don't show on selection on web". Use
    // window.ioc.whenReady so the wire-up happens whenever the service
    // arrives, before-or-after construction.
    const wireSelection = (selection: SelectionService): void => {
      const sync = (): void => {
        // String signal: primitive equality dedups automatically.
        this.#activeCell.set(selection.active)

        // Array signal: reference equality, so spread-on-every-event would
        // count as a change even when contents are identical, re-triggering
        // every dependent signal/effect on every selection event. Compare
        // contents and only set when actually different.
        //
        // Insertion order is preserved (no sort) so the last-N slice in
        // groups() / emptyCells() reflects the most recently selected
        // tiles — Set iteration follows insertion order in JS.
        const next = [...selection.selected]
        const prev = this.#selectedCells()
        const changed =
          prev.length !== next.length ||
          prev.some((v, i) => v !== next[i])
        if (changed) this.#selectedCells.set(next)
      }
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

    // Reset Comb v2 transient state whenever the active cell switches.
    // Selection / popovers / editing-caret are all cell-scoped — letting
    // them persist across navigation would surface stale ids and confuse
    // the bulk-action paths.
    //
    // Reads must be untracked: if the effect tracks these signals it
    // re-runs every time the popovers open and immediately closes them
    // again — the "palette won't open" bug.
    effect(() => {
      this.cell()  // sole dependency — re-fires on cell change only
      untracked(() => {
        if (this.selectionCount() > 0) this.selectedNotes.set(new Map())
        if (this.kebabOpenId() !== null) this.kebabOpenId.set(null)
        if (this.pickerOpenForId() !== null) this.pickerOpenForId.set(null)
        // See-all is layer-scoped: clicking into a specific cell
        // implies the user wants to focus on that cell, so we
        // collapse out of see-all. Fullscreen is a separate
        // user-controlled toggle and persists across cell changes.
        if (this.seeAllInLayer()) {
          this.seeAllInLayer.set(false)
          this.#layerCellLabels.set([])
        }
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
        const [fresh, qa] = await Promise.all([
          svc.getNotes(cellLabel),
          this.#loadQaFor(cellLabel),
        ])
        this.#notesByCell.update(prev => {
          const next = new Map(prev)
          next.set(cellLabel, fresh.slice())
          return next
        })
        this.#qaByCell.update(prev => {
          const next = new Map(prev)
          next.set(cellLabel, qa)
          return next
        })
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
      if (p.editId) { this.editNote(p.editId, p.cellLabel); return }
      this.#openForm(p.cellLabel, { prefill: p.prefill })
    }))

    // Stale legacy localStorage key — the user's pinned-tools list no
    // longer applies (the tool palette has been removed). One-time wipe
    // on construction keeps the storage tidy across reloads.
    try { localStorage.removeItem('hc:notes-strip-pinned-tools') } catch { /* ignore */ }

    // Mount/teardown the resize observer whenever the panel element appears
    // or its mode changes. Reads `visible/multi/mode` so the effect re-runs
    // on every transition — chips mode tears the observer down and clears
    // any inline dimensions, rows mode restores stored dims and observes.
    effect(() => {
      this.visible()
      this.multi()
      this.mode()
      this.panel()
      // Defer one microtask so Angular has applied the latest classes
      // (mode-chips/mode-rows) before we inspect classList.
      queueMicrotask(() => this.#syncPanelResize())
    })

    // Lock the tile viewport while the strip is showing. The notes strip is
    // a modal-style overlay drawn over the canvas (z-index 60001); per the
    // "modals lock tiles while showing" rule it must pin the hexes beneath
    // it — no pan, pinch, spacebar-pan, wheel-zoom, or drag-select bleeding
    // through. The owner-scoped lock composes with the editor's lock instead
    // of stomping it. The gate is resolved lazily because its bee may
    // register after this component constructs on hypercomb-web; visible()
    // is the tracked dependency, so this re-runs on every show/hide.
    effect(() => {
      const showing = this.visible()
      const gate = this.#gate()
      if (!gate) return
      if (showing) gate.lock(NOTES_STRIP_LOCK_OWNER)
      else gate.unlock(NOTES_STRIP_LOCK_OWNER)
    })

    // Warm the decoded-set cache for every cell the strip might display
    // (active/capture cell in single mode, AND every selected cell in
    // multi mode) so groups() / emptyCells() / notes() classify accurately
    // on first paint.
    //
    // Why this matters: NotesService.notesFor() is synchronous and reads
    // through #cellLocSigCache, which is only populated by the ASYNC
    // #resolveCellLocation() that runs inside getNotes(). Until getNotes
    // completes for a given cellLabel, notesFor() returns [] regardless
    // of how many notes actually exist. This warmup eagerly resolves the
    // cell-loc cache for every cell we're about to display, then bumps
    // #version so the strip's computed signals re-read with the now-warm
    // sync cache and add the cell to #warmed so emptyCells() can trust
    // its empty classification.
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
      // Match the last-N cap that groups() / emptyCells() apply — no
      // point pre-warming cells the strip will never display. Reads
      // through #effectiveCells so see-all-in-layer also warms the
      // lineage's cells, not just the user's selection.
      for (const cell of this.#effectiveCells().slice(-MAX_VISIBLE_SELECTIONS)) targets.add(cell)
      if (targets.size === 0) return
      for (const target of targets) {
        if (this.#warmed().has(target)) continue
        // Warm both sources in parallel so the strip surfaces the full
        // comm transcript (Claude's questions + user notes) in a single
        // render pass, not two.
        void Promise.all([
          svc.getNotes(target),
          this.#loadQaFor(target),
        ]).then(([notes, qa]) => {
          this.#notesByCell.update(prev => {
            const next = new Map(prev)
            next.set(target, notes.slice())
            return next
          })
          this.#qaByCell.update(prev => {
            const next = new Map(prev)
            next.set(target, qa)
            return next
          })
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
  async #loadQaFor(cell: string): Promise<readonly QaItem[]> {
    const history = window.ioc?.get<HistoryServiceLike>('@diamondcoreprocessor.com/HistoryService')
    const store = window.ioc?.get<StoreLike>('@hypercomb.social/Store')
    if (!history || !store) return []
    const lineage = window.ioc?.get<LineageLike>('@hypercomb.social/Lineage')
    const parent = lineage?.explorerSegments?.() ?? []
    const segments = [...parent, cell]
    try {
      const locSig = await history.sign({ explorerSegments: () => segments })
      const layer = await history.currentLayerAt(locSig)
      const raw = layer && (layer as { qa?: unknown }).qa
      if (!Array.isArray(raw)) return []
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
      return items
    } catch {
      return []
    }
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#selectionListener?.()
    // Release the tile lock on teardown — the visibility effect is destroyed
    // with the component and won't run a final unlock, so a strip torn down
    // while visible would otherwise leave the hexes locked.
    this.#gate()?.unlock(NOTES_STRIP_LOCK_OWNER)
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

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); the bee may register after this
   *  component constructs on hypercomb-web, so we look it up lazily on
   *  each use. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
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
    this.#openForm(cell, { editId: noteId, prefill: note.text })
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
  #openForm(cell: string, opts?: { editId?: string | null; prefill?: string }): void {
    if (!cell) return
    this.#capturingFor.set(cell)
    this.#hiddenContext.set(null)             // a fresh open un-hides the strip
    this.editingNoteId.set(opts?.editId ?? null)
    this.draftText.set(opts?.prefill ?? '')
    this.draftKind.set('note')
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
    EffectBus.emit('note:commit', { cellLabel: cell, text: finalText, editId: editId ?? undefined })
    this.draftText.set('')
    this.editingNoteId.set(null)           // editing is one-shot → back to add
    this.#focusForm()
  }

  /** Drop out of edit mode back to a blank add form. */
  cancelEdit(): void {
    this.editingNoteId.set(null)
    this.draftText.set('')
    this.draftKind.set('note')
    this.#focusForm()
  }

  /** Add affordance → focus a fresh add form for the active cell. */
  add(): void {
    const cell = this.cell()
    if (!cell) return
    this.#openForm(cell)
  }

  /** Flip between chips and rows layout; persists the choice. */
  toggleMode(): void {
    const next = this.mode() === 'chips' ? 'rows' : 'chips'
    this.mode.set(next)
    localStorage.setItem('hc:notes-strip-mode', next)
  }

  /** Explicit exit button while the user is authoring a note. */
  cancelCapture(): void {
    EffectBus.emit('notes:cancel', {})
  }

  /** Header "hide" button — collapse the strip for the current selection.
   *  Re-shows automatically when the user selects a different tile (the
   *  context key changes and the saved hidden context no longer matches).
   *  Also cancels any in-progress capture; otherwise the capture-trumps-
   *  hide rule in `visible()` would keep the strip open while authoring. */
  hide(): void {
    // Close any open form locally (the command line is no longer involved)
    // before recording the hidden context, so `visible()` settles to false.
    this.#capturingFor.set(null)
    this.draftText.set('')
    this.editingNoteId.set(null)
    this.#hiddenContext.set(this.#contextKey())
  }

  /** Delete a single note from the active cell's list. */
  remove(noteId: string, event: Event): void {
    event.stopPropagation()
    const cell = this.cell()
    if (!cell || !noteId) return
    EffectBus.emit('note:delete', { cellLabel: cell, noteId })
  }

  /** Truncate a note for display in the strip. */
  preview(text: string): string {
    const trimmed = text.replace(/\s+/g, ' ').trim()
    return trimmed.length > 64 ? trimmed.slice(0, 61) + '…' : trimmed
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
  trackByGroup = (_i: number, g: { cell: string }): string => g.cell

  /**
   * Click an accordion tab → open that cell's section (closing any other)
   * and drop the cursor into the command line in note-capture mode for
   * that cell, so the user can immediately type a new note. Click the
   * already-open tab again to collapse all sections (no capture).
   */
  toggleGroup(cell: string): void {
    const isCurrentlyOpen = this.groups().find(g => g.cell === cell)?.expanded ?? false
    if (isCurrentlyOpen) {
      // Explicit collapse — suppress the auto-fallback so the closed state
      // sticks until the user opens something.
      this.#userClosed.set(true)
      this.#openGroup.set(null)
      return
    }
    this.#userClosed.set(false)
    this.#openGroup.set(cell)
    this.#openForm(cell)
  }

  /**
   * Click an empty-cell pill → start capture for that cell so the user can
   * author the first note. The cell will appear as a tab once the note is
   * committed.
   */
  captureForEmpty(cell: string): void {
    this.#openForm(cell)
  }

  /** Open a specific note from within an accordion group → edit in form. */
  openInGroup(cell: string, noteId: string): void {
    this.editNote(noteId, cell)
  }

  /** Delete a note from within an accordion group. */
  removeInGroup(cell: string, noteId: string, event: Event): void {
    event.stopPropagation()
    EffectBus.emit('note:delete', { cellLabel: cell, noteId })
  }

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
