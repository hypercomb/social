// hypercomb-shared/ui/notes-strip/notes-strip.component.ts
//
// A slim horizontal strip rendered just below the command line that lists the
// notes for the currently active tile. Click a note to open the centred
// viewer; click the plus to enter capture mode for that tile. Collapses
// entirely when the active tile has no notes.

import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild, type OnDestroy } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { CommandShellComponent } from '../command-shell/command-shell.component'
// Settings-only: the gear + group chrome every tool window carries. The strip
// keeps its own edge handles and width store (`ownsSize` false) — see the
// directive's header — and hands the directive its width as a `sizeOwner`.
import { HcDockedPanelDirective, type PanelSizeOwner } from '../docked-panel/hc-docked-panel.directive'
import type { SettingRow } from '../docked-panel/panel-settings'
import { type WindowSession, windowsParked } from '../window-session'
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
import { ensureViewportInsetVars } from '../../core/viewport-inset-vars'
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

/** THE TILES RAIL — the hive's one tile list (essentials,
 *  assistant/agent-tiles-rail.ts). Shared may never import a module, so the
 *  rail arrives structurally through the factory it registers in IoC, exactly
 *  as the chat window takes it. The profile is how one list serves two
 *  surfaces; `showLevel` is also the feature test — an essentials build
 *  predating it hands back a rail whose profile is ignored entirely. */
type RailPickLike = { readonly name: string; readonly path: readonly string[]; readonly sig?: string }
type RailRowLike = { readonly name: string; readonly segments: readonly string[] }
type TilesRailLike = {
  onSubjectChanged: (subject: RailPickLike | null) => void
  /** The list WALKED — to this level. Absent on an essentials build that
   *  predates the hook, which is why `walk` is asked for defensively (see
   *  `#bringRail`): a list that could move with nobody following it would
   *  name tiles at a level the desk is not standing at. */
  onLevelChanged?: (segments: readonly string[]) => void
  mount(host: HTMLElement): void
  showLevel?(segments: readonly string[]): void
  showCurrent?(name: string | null): void
  refresh?(): void
  paint?(): void
  dispose(): void
}
type TilesRailFactoryLike = {
  create?: (profile?: {
    walk?: boolean
    chats?: boolean
    choose?: boolean
    badge?: (row: RailRowLike) => number
    admits?: (row: RailRowLike) => boolean
    matches?: (row: RailRowLike, query: string) => boolean
    onHover?: (row: RailRowLike, event: PointerEvent | null) => void
    findLabel?: string
    clickLabel?: string
  }) => TilesRailLike
}



// localStorage keys for the slide-resizable panel. Persisted as integer
// pixel strings; missing/non-numeric values fall back to the CSS defaults
// (28rem wide, content-height tall).
const NOTES_STRIP_WIDTH_KEY = 'hc:notes-strip-width'

// The width the strip docks at when it has no stored one. Also what the
// shared chrome is told to treat as this window's natural size, so the
// gear's AUTO text size means "the size it reads at when docked normally".
const NOTES_STRIP_BASE_WIDTH = 500

// The narrowest the strip goes — matches the `.notes-strip` CSS min-width
// floor, so a stored, dragged or group-adopted width can never render it
// narrower than its own stylesheet allows.
const MIN_PANEL_WIDTH = 256

// ── The reading FACE ──────────────────────────────────────
// The one window in the hive you read and write PROSE in, and until now it
// was set in the same mono the chrome is — which is right for a signature
// and wrong for a paragraph. The face is a participant-local viewing
// preference (like the mode and the width), so it lives in localStorage and
// never enters a layer.
//
// It applies to the prose ONLY — note text, the editor, list lines, the note
// tabs' labels. The chrome around it stays mono, because the chrome is the
// window and the window is not what changed.
const NOTES_STRIP_FACE_KEY = 'hc:notes-face'
const NOTES_FACES = ['mono', 'sans', 'serif'] as const
type NotesFace = typeof NOTES_FACES[number]

/** This window's name in the two owner-counted view modes below. */
const SURFACE_OWNER = 'notes-strip'

/** THE DESK TAKES THE SURFACE, AND LEAVES THE BAR ITS EDGE.
 *
 *  `view:active` means "a view is covering the canvas, put the chrome away".
 *  The desk is a view covering the canvas by any honest reading — it fills the
 *  screen and nothing behind it can be reached — and saying so is what stands
 *  the COMMAND LINE down while notes are open, the same handover the chat
 *  window makes. (A command line over the desk is a second place to type with
 *  none of the note grammar; the desk's own line at the bottom is the one that
 *  writes notes.)
 *
 *  `view:keeps-controls` is the other half. On its own, `view:active` also
 *  hides the CONTROL BAR — right for a full takeover, wrong for this one: the
 *  desk stops at the bar's reservation (see the component SCSS's
 *  `--hc-controls-*` box), so the bar has a place to be, and hiding it would
 *  cost the participant every control on it — on a phone, the whole of the
 *  navigation. Any view that leaves the bar its edge can hold the mode, and
 *  the bar stays while ANY owner does. Claimed and released in lockstep. */
const KEEPS_CONTROLS = 'view:keeps-controls'

const MODE_REGISTRY_IOC_KEY = '@diamondcoreprocessor.com/ModeRegistry'

type ModeRegistryLike = {
  enter(mode: string, owner: string): void
  exit(mode: string, owner: string): void
}

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

/** The shell's navigator — how the desk moves when its tile list walks.
 *  Structural, like every other cross-service lookup here. */
type NavigationLike = {
  goRaw?: (segments: readonly string[]) => void
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
  imports: [TranslatePipe, NgTemplateOutlet, HcDockedPanelDirective, CommandShellComponent],
  templateUrl: './notes-strip.component.html',
  // One stylesheet per surface, in the order the rules were always in — the
  // cascade is the concatenation of these, so the order here IS the order in
  // the file this was split out of. Angular compiles each `styleUrls` entry to
  // its own stylesheet, and the `anyComponentStyle` budget measures one
  // stylesheet at a time; as one file the strip sat 2.7 kB under the ceiling
  // and had frozen the deploy pipeline twice. Add a surface, don't grow one.
  styleUrls: [
    './notes-strip.component.scss',
    './notes-strip.frame.scss',
    './notes-strip.tabs.scss',
    './notes-strip.rail.scss',
    './notes-strip.form.scss',
    './notes-strip.tree.scss',
    './notes-strip.navigator.scss',
    './notes-strip.plate.scss',
    './notes-strip.lists.scss',
    './notes-strip.desk.scss',
  ],
})
export class NotesStripComponent implements OnDestroy, PanelSizeOwner {

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
    this.listPathIdx.set([])
    this.newItemDepth.set(0)
    this.disarmListDelete()
    this.cancelItemEdit()
    try { localStorage.setItem('hc:annotations-tab', next) } catch { /* ignore */ }
  }

  // ── Font settings ─────────────────────────────────────────
  // Two of them, and they arrive from different places on purpose:
  //
  //   TEXT SIZE is the ladder every docked tool window has (the gear's
  //   shared zone). The strip used to be withheld from it because it was
  //   typeset in fixed rem/px; every size here is `scaled()` now, so the
  //   window simply joins — nothing to declare, and a group that sets its
  //   size sets this window's too.
  //
  //   The FACE is this window's alone: prose is what the notes window holds
  //   and prose is not what a files list holds, so it is declared here and
  //   drawn in the gear's "This window" zone (`ownSettings` on the shared
  //   directive).

  /** Which face the note prose is set in. Participant-local — a viewing
   *  preference, never content. */
  readonly face = signal<NotesFace>(
    (() => {
      try {
        const stored = localStorage.getItem(NOTES_STRIP_FACE_KEY) as NotesFace | null
        return stored && (NOTES_FACES as readonly string[]).includes(stored) ? stored : 'mono'
      } catch { return 'mono' }
    })()
  )

  setFace(next: NotesFace): void {
    if (next === this.face()) return
    this.face.set(next)
    try { localStorage.setItem(NOTES_STRIP_FACE_KEY, next) } catch { /* ignore */ }
  }

  /** What the gear shows under "This window". A thunk, read at paint time, so
   *  the lit segment is always the face actually in use. Bound as a field so
   *  the directive can call it without a `this` of its own. */
  readonly settingsRows = (): SettingRow[] => [{
    kind: 'choice',
    key: 'notes-face',
    label: this.#t('notes.face.label', 'Note face'),
    value: this.face(),
    options: NOTES_FACES.map(face => ({
      value: face,
      label: this.#t(`notes.face.${face}`, face === 'mono' ? 'Mono' : face === 'sans' ? 'Sans' : 'Serif'),
    })),
    hint: this.#t('notes.face.hint', 'The face notes are read and written in. The window keeps its own.'),
    pick: (value) => { this.setFace(value as NotesFace) },
  }]

  #t(key: string, fallback: string): string {
    const i18n = window.ioc?.get<I18nProvider>('@hypercomb.social/I18n')
    // A missing key comes back AS the key — that is the catalog saying it has
    // nothing, and printing `notes.openTile` at a user is worse than English.
    const value = i18n?.t(key)
    return value && value !== key ? value : fallback
  }

  // ── PanelSizeOwner — the width this window SHARES ─────────
  // The docked width, always. Fullscreen is the desk: the panel's box is the
  // whole screen there, and reporting that would (a) let a group's mates
  // adopt a 1500px width and sit at their maximum, and (b) make the gear's
  // AUTO text size read the desk instead of the dock. Neither is a size the
  // participant set.

  /** The last width the strip was DOCKED at — seeded from the store so the
   *  first read is right even before the observer has fired once. */
  #dockWidth = (() => {
    try {
      const raw = localStorage.getItem(NOTES_STRIP_WIDTH_KEY)
      const n = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(n) && n > 0) return n
    } catch { /* ignore */ }
    return NOTES_STRIP_BASE_WIDTH
  })()

  panelWidth(): number { return this.#dockWidth }

  /** Take a width from the group — a NO-OP for the desk, which owns its whole
   *  geometry. The `sizeOwner` contract is still honoured because the shared
   *  chrome reads `panelWidth()` for the group's auto text size; there is just
   *  no width for the group to give a surface that is always the screen, and
   *  writing one back would record a preference nobody set. */
  setPanelWidth(_width: number): void { /* the desk's size is forced */ }

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

  /** Click a row in the notes column → read it in the pane. */
  selectForReading(noteId: string): void {
    const idx = this.readingRows().findIndex(r => r.note.id === noteId)
    if (idx >= 0) this.readingIndex.set(idx)
  }

  /**
   * CLICK A NOTE, SEE IT IN THE VIEW. The one selection entry point — the
   * pinned card's rows and the desk's tree both come here.
   *
   * Two things used to swallow a click. The card lists EVERY note of the
   * tile while the pane only cycles the rows of the ACTIVE TAB, so a note
   * belonging to the other tab resolved to no index and nothing happened —
   * the tab follows the click now. And on the lists tab the pane is the
   * list interface, not the reader, so "showing" a note there means opening
   * the list it belongs to (or itself, when it IS a list).
   */
  selectNote(noteId: string): void {
    if (!noteId) return
    if (!this.readingRows().some(r => r.note.id === noteId)) {
      this.setTab(this.tab() === 'notes' ? 'lists' : 'notes')
    }
    if (this.tab() === 'lists') {
      const path = this.#pathOf(noteId)
      if (path) this.openListPath(path)
    }
    this.selectForReading(noteId)
    // A PRISTINE add form yields — the click said "show me that one", and a
    // pane still sitting on an empty composer isn't showing it. Anything in
    // flight is kept: a half-written note never loses to a click.
    if (this.paneEditorOpen() && !this.editingNoteId() && !this.draftText().trim()) {
      this.paneEditorOpen.set(false)
    }
  }

  /** Index path of a note within the visible tree, or null when it isn't in
   *  it. Positions, not ids — the same currency the list pane runs on. */
  #pathOf(noteId: string): readonly number[] | null {
    const walk = (nodes: readonly Note[], trail: readonly number[]): readonly number[] | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        if (n.id === noteId) return [...trail, i]
        const found = walk(n.children, [...trail, i])
        if (found) return found
      }
      return null
    }
    return walk(this.visibleNotes(), [])
  }

  /** Bring the row the pane is showing INTO VIEW in the notes column, and
   *  put it at the TOP when it is off-screen. Prev/next walk the whole tree,
   *  so without this the column silently falls out of step with the pane —
   *  you are reading note 14 while the column still shows the first three.
   *  A row already visible is left exactly where it is: scrolling under a
   *  pointer that didn't ask for it is worse than not scrolling. */
  #revealRow(noteId: string): void {
    // The pinned card docked, the tree column on the desk — whichever is the
    // selector in this layout.
    const list = this.#host.nativeElement.querySelector(
      '.cv2-peek.is-pinned .cv2-peek-list, .cv2-list',
    ) as HTMLElement | null
    if (!list) return
    const row = list.querySelector(`[data-note-id="${CSS.escape(noteId)}"]`) as HTMLElement | null
    if (!row) return
    const box = list.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (r.top >= box.top && r.bottom <= box.bottom) return
    list.scrollTop += r.top - box.top
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

  /** True when the pane exists — the form renders THERE, not the centre.
   *
   *  The DOCKED window is now the same shape as the desk, stacked: header,
   *  then the pane (the selected note, read and written in ONE surface,
   *  given the room), then the tree as the selector along the bottom. The
   *  only layout without a pane is NARROW fullscreen, where there isn't
   *  width for one — there the form stays in the column. */
  readonly formInPane = computed<boolean>(() => this.deskWide())

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

  // ── The LISTS interface ───────────────────────────────────
  // Lists are not prose and do not want the prose surface. A list is a
  // title and a column of one-liners, and it is built ONE LINE AT A TIME:
  // type, Enter, type, Enter.
  //
  // The lines make a HIERARCHY, so the pane shows ONE list WHOLE — every
  // depth at once — and the gestures that shape it are the outline
  // gestures: Tab indents the line under the one above it, Shift+Tab moves
  // it back out, and a line dragged by its grip lands wherever it is
  // dropped. Nothing drills down; there is nowhere to go and nothing to
  // come back from.
  //
  // Two things are deliberately NOT in this pane. The list's NAME reads in
  // the window's title bar, right of the tile it is written on — a title
  // belongs with the window's identity, not stacked on top of the lines.
  // And there is no selector row: the pinned card beside the window
  // already lists every line of every list on the tile, and clicking one
  // opens its list (see `selectNote`).
  //
  // WHICH list is addressed BY POSITION, never by id: every write re-signs
  // the note it touched and every ancestor (new bytes, new sig), so an id
  // held across a commit is a dangling id. A position survives the write —
  // the list at position [2] is still the list at position [2].

  /** Index path from the visible roots down to the open list. Empty = the
   *  first list on the tab, so the pane is never blank when there is
   *  something to show. */
  readonly listPathIdx = signal<readonly number[]>([])

  /** The path actually in force — the stored one, or the first list on the
   *  tab when nothing has been picked yet, so the pane is never blank while
   *  there is something to show. */
  readonly listPath = computed<readonly number[]>(() => {
    const stored = this.listPathIdx()
    if (stored.length > 0) return stored
    return this.visibleNotes().length > 0 ? [0] : []
  })

  /** The open list — the note whose children are the lines. Clamped on read:
   *  an edit can shrink the tree under it. */
  readonly listRoot = computed<Note | null>(() => {
    const roots = this.visibleNotes()
    if (roots.length === 0) return null
    let nodes: readonly Note[] = roots
    let node: Note | null = null
    for (const i of this.listPath()) {
      const pick = nodes[Math.min(i, nodes.length - 1)]
      if (!pick) break
      node = pick
      nodes = pick.children
    }
    return node
  })

  /** The open list, FLATTENED — every line at every depth in reading order,
   *  each carrying the depth it sits at, the id of the line it hangs under
   *  and its position among its siblings. This IS the list: one pass over
   *  it renders the whole hierarchy, and the indent gestures read their
   *  neighbours straight off it. Collapsed lines keep their subtree folded
   *  away, the same collapse set the tree column uses. */
  readonly listRows = computed<readonly { note: Note; depth: number; parentId: string; index: number }[]>(() => {
    const root = this.listRoot()
    if (!root) return []
    const out: { note: Note; depth: number; parentId: string; index: number }[] = []
    const walk = (nodes: readonly Note[], depth: number, parentId: string): void => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        out.push({ note: n, depth, parentId, index: i })
        if (n.children.length > 0 && !this.isCollapsed(n.id)) walk(n.children, depth + 1, n.id)
      }
    }
    walk(root.children, 0, root.id)
    return out
  })

  /** Open the list a path lands in. Every path resolves to its ROOT list:
   *  the pane shows one list whole, so a nested line is not a place of its
   *  own to be — it is a line of the list it belongs to. */
  openListPath(path: readonly number[]): void {
    if (path.length === 0) return
    this.listPathIdx.set([path[0]!])
    this.newItemDepth.set(0)
    this.cancelItemEdit()
  }

  /** The new-line input at the foot of the list — the whole write gesture.
   *  It never closes: commit clears it and leaves the caret in it, so the
   *  next line is just more typing. */
  readonly newItemText = signal('')

  /** The open line itself. Held because the field has to be cleared by HAND:
   *  a commit sets the signal back to the value the binding last WROTE (''),
   *  so Angular sees no change and leaves the user's text sitting in the DOM
   *  — the line would appear to have been added twice. */
  readonly newLineInput = viewChild<ElementRef<HTMLInputElement>>('newLineInput')

  #clearNewLine(): void {
    this.newItemText.set('')
    const el = this.newLineInput()?.nativeElement
    if (!el) return
    el.value = ''
    el.focus()
  }

  onNewItemInput(event: Event): void {
    this.newItemText.set((event.target as HTMLInputElement).value)
  }

  onNewItemKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitNewItem()
      return
    }
    // Tab moves the OPEN LINE in and out, before it is anything: the
    // bullet slides across, and that is where the next line lands. It is
    // the same key an outline has always used, and it costs no write —
    // the depth is a property of the gesture, not of the tree.
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation()
      this.stepNewLineDepth(event.shiftKey ? -1 : 1)
      return
    }
    if (event.key === 'Escape' && this.newItemText()) {
      event.preventDefault(); event.stopPropagation()
      this.#clearNewLine()
    }
  }

  /** How deep the next line goes. 0 is a line of the open list itself; 1
   *  hangs it under the last line above it, and so on. Held across commits
   *  so a run of sub-lines is typed without re-indenting each one. */
  readonly newItemDepth = signal(0)

  /** The depth actually in force — never deeper than one step past the
   *  last line, so the open line can't float free of the list while the
   *  lines above it are edited away. */
  readonly newLineDepth = computed<number>(() => {
    const rows = this.listRows()
    const deepest = rows.length === 0 ? -1 : rows[rows.length - 1]!.depth
    return Math.max(0, Math.min(this.newItemDepth(), deepest + 1))
  })

  stepNewLineDepth(delta: number): void {
    const rows = this.listRows()
    const deepest = rows.length === 0 ? -1 : rows[rows.length - 1]!.depth
    this.newItemDepth.set(Math.max(0, Math.min(this.newLineDepth() + delta, deepest + 1)))
  }

  /** Which line the next one hangs under — the last line one step shallower
   *  than the open line, or the list itself at depth 0. */
  #newLineParentId(): string | null {
    const root = this.listRoot()
    if (!root) return null
    const depth = this.newLineDepth()
    if (depth <= 0) return root.id
    const rows = this.listRows()
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]!.depth === depth - 1) return rows[i]!.note.id
    }
    return root.id
  }

  /** Enter on the new-line input — one more line on the open list, at
   *  whatever depth the open line is sitting at. */
  commitNewItem(): void {
    const cellLabel = this.cell()
    const parentId = this.#newLineParentId()
    const text = this.newItemText().trim()
    if (!cellLabel || !parentId || !text) return
    EffectBus.emit('note:add-child', { cellLabel, parentId, text, mark: null })
    this.#paintChildOptimistic(cellLabel, parentId, text)
    this.#clearNewLine()
  }

  // ── Editing one line, in place ────────────────────────────
  // A line is one line: it is corrected where it sits, not in a form
  // somewhere else. Enter saves, Esc reverts, blur saves (the same
  // contract a spreadsheet cell has).

  readonly editingItemId = signal<string | null>(null)
  readonly itemDraft = signal('')

  /** The field a line is corrected in — the line's own input, or the title
   *  bar's when the line being corrected IS the list's name (only one of
   *  the two is ever in the DOM). Held so the caret can be put in it: a
   *  click that opens a field you then have to click again is not an edit
   *  gesture, it is two. */
  readonly lineInput = viewChild<ElementRef<HTMLInputElement>>('lineInput')

  startItemEdit(item: Note, event?: Event): void {
    event?.stopPropagation()
    this.editingItemId.set(item.id)
    this.itemDraft.set(this.noteDisplayText(item))
  }

  onItemInput(event: Event): void {
    this.itemDraft.set((event.target as HTMLInputElement).value)
  }

  onItemKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commitItemEdit()
      return
    }
    // Tab on a line that already exists MOVES it: under the line above
    // (Tab) or back out to its parent's level (Shift+Tab).
    //
    // Text in flight is written FIRST and the move waits for it. A retext
    // and a move both re-sign the note and every ancestor, and the two
    // writes race on the same layer — the later commit reads the same prior
    // and wins, so one of them is silently lost. Nothing typed may be lost
    // to a keypress that means "move", so the indent is held BY POSITION
    // (the currency that survives a write) and applied when the note comes
    // back. With no edit in flight there is no write to wait for.
    if (event.key === 'Tab') {
      event.preventDefault(); event.stopPropagation()
      const delta = event.shiftKey ? -1 : 1
      const noteId = this.editingItemId()
      const note = noteId ? this.listRows().find(r => r.note.id === noteId)?.note ?? null : null
      const draft = this.itemDraft().trim()
      const dirty = !!note && !!draft && draft !== this.noteDisplayText(note)
      const path = note ? this.#linePathOf(note.id) : null
      this.commitItemEdit()
      if (dirty && path) this.#pendingIndent = { path, delta }
      else if (note) this.stepItemDepth(note.id, delta)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      this.cancelItemEdit()
    }
  }

  /** An indent asked for while the line's text was still in flight, held
   *  by POSITION until the text has been written (see `onItemKeydown`). */
  #pendingIndent: { path: readonly number[]; delta: number } | null = null

  /** Index path of a line inside the OPEN LIST — indices into the list
   *  root's children, then that line's children, and so on. Collapse plays
   *  no part: this is the tree, not what is on screen. */
  #linePathOf(noteId: string): readonly number[] | null {
    const root = this.listRoot()
    if (!root) return null
    const walk = (nodes: readonly Note[], trail: readonly number[]): readonly number[] | null => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!
        if (n.id === noteId) return [...trail, i]
        const found = walk(n.children, [...trail, i])
        if (found) return found
      }
      return null
    }
    return walk(root.children, [])
  }

  #lineAtPath(path: readonly number[]): Note | null {
    const root = this.listRoot()
    if (!root) return null
    let nodes: readonly Note[] = root.children
    let node: Note | null = null
    for (const i of path) {
      const pick = nodes[i]
      if (!pick) return null
      node = pick
      nodes = pick.children
    }
    return node
  }

  /** The reconcile came back — the line the participant asked to indent is
   *  at the same POSITION under a fresh id, so the move can go now. */
  #applyPendingIndent(): void {
    const pending = this.#pendingIndent
    if (!pending) return
    this.#pendingIndent = null
    const note = this.#lineAtPath(pending.path)
    if (note) this.stepItemDepth(note.id, pending.delta)
  }

  /** Indent (+1) or outdent (-1) one line of the open list.
   *
   *  Indent hangs the line under the sibling ABOVE it — the outline rule,
   *  and the only unambiguous parent a line has. A first line has none, so
   *  it stays put. Outdent puts it back among its parent's siblings, just
   *  after the parent; a line of the list itself has nowhere further out
   *  to go (that would take it off the list and onto the tile). */
  stepItemDepth(noteId: string, delta: number): void {
    const cellLabel = this.cell()
    const root = this.listRoot()
    if (!cellLabel || !root) return
    const rows = this.listRows()
    const at = rows.findIndex(r => r.note.id === noteId)
    if (at === -1) return
    const row = rows[at]!
    if (delta > 0) {
      if (row.index === 0) return  // no sibling above to hang under
      const above = rows.slice(0, at).reverse()
        .find(r => r.parentId === row.parentId)
      if (!above) return
      EffectBus.emit('note:move', {
        cellLabel, sourceId: noteId,
        parentId: above.note.id, index: above.note.children.length,
      })
      return
    }
    if (row.parentId === root.id) return  // already a line of the list
    const parent = rows.find(r => r.note.id === row.parentId)
    if (!parent) return
    EffectBus.emit('note:move', {
      cellLabel, sourceId: noteId,
      parentId: parent.parentId, index: parent.index + 1,
    })
  }

  /** Save the line. Routed through `note:retext`, NOT the note form's
   *  commit: a line is nested by definition, and the commit path can only
   *  rewrite a cell's top-level entry. */
  commitItemEdit(): void {
    const cellLabel = this.cell()
    const noteId = this.editingItemId()
    const text = this.itemDraft().trim()
    if (!cellLabel || !noteId) return
    if (!text) { this.cancelItemEdit(); return }
    EffectBus.emit('note:retext', { cellLabel, noteId, text })
    this.#paintTextOptimistic(cellLabel, noteId, text)
    this.cancelItemEdit()
  }

  cancelItemEdit(): void {
    this.editingItemId.set(null)
    this.itemDraft.set('')
  }

  /** Rename the open list itself — same in-place gesture as a line. */
  startListRename(event?: Event): void {
    const root = this.listRoot()
    if (root) this.startItemEdit(root, event)
  }

  /** "+ new list" — a fresh empty list at the top level. It has to be born
   *  carrying a list-role mark: classification reads the mark (or children,
   *  and a new list has none), so an unmarked new list would be filed on the
   *  notes tab and vanish from the tab that made it. */
  newList(): void {
    const cellLabel = this.cell()
    if (!cellLabel) return
    const i18n = this.i18n
    const title = i18n?.t('notes.lists.newTitle') ?? 'new list'
    const mark = this.#listMark()
    EffectBus.emit('note:commit', { cellLabel, text: title, mark })
    this.#paintOptimistic(cellLabel, title, null, mark)
    // The optimistic root is appended last, so the new list is the last
    // entry of the tab — open it and put the caret on its first line.
    this.listPathIdx.set([Math.max(0, this.visibleNotes().length - 1)])
    this.newItemDepth.set(0)
    this.disarmListDelete()
    this.cancelItemEdit()
  }

  /** Take the whole list away — the list note and every line under it.
   *
   *  TWO CLICKS, no dialogue. The first arms the button (it says so, in
   *  the same red it will act in), the second acts; anything else — four
   *  seconds, or opening another list — disarms it. A modal for this is
   *  more ceremony than the act deserves, and a bare one-click delete next
   *  to the line the user was typing is a trap. */
  readonly listDeleteArmed = signal(false)
  #listDeleteTimer: ReturnType<typeof setTimeout> | null = null

  deleteList(event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.cell()
    const root = this.listRoot()
    if (!cellLabel || !root) return
    if (!this.listDeleteArmed()) {
      this.listDeleteArmed.set(true)
      if (this.#listDeleteTimer) clearTimeout(this.#listDeleteTimer)
      this.#listDeleteTimer = setTimeout(() => this.disarmListDelete(), 4000)
      return
    }
    this.disarmListDelete()
    this.remove(root.id, event ?? new Event('click'))
    // The list under this one takes its place — the pane is never left
    // pointing at something that isn't there.
    this.listPathIdx.set([])
    this.newItemDepth.set(0)
    this.cancelItemEdit()
  }

  disarmListDelete(): void {
    if (this.#listDeleteTimer) { clearTimeout(this.#listDeleteTimer); this.#listDeleteTimer = null }
    if (this.listDeleteArmed()) this.listDeleteArmed.set(false)
  }

  /** A mark whose ROLE is list (or heading), minting one into the palette
   *  if the participant has emptied it. Never a hardcoded per-feature icon:
   *  whatever they have said means "list" is what a new list carries. */
  #listMark(): string | null {
    const marks = this.marks()
    const listy = marks.find(m => m.role === 'list') ?? marks.find(m => m.role === 'heading')
    if (listy) return listy.icon
    const store = this.#markStore
    if (!store) return null
    store.add('checklist', 'list')
    return 'checklist'
  }

  /** Paint a just-added line immediately — same contract as
   *  `#paintOptimistic`: the reconcile that follows replaces it. */
  #paintChildOptimistic(cell: string, parentId: string, text: string): void {
    const pending: Note = { id: `pending-${++this.#pendingSeq}`, text, shape: null, mark: null, children: [] }
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === parentId
        ? { ...n, children: [...n.children, pending] }
        : { ...n, children: walk(n.children) }))
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      next.set(cell, walk(next.get(cell) ?? []))
      return next
    })
    this.#version.update(v => v + 1)
  }

  /** Paint a just-saved line immediately, at any depth. */
  #paintTextOptimistic(cell: string, noteId: string, text: string): void {
    const walk = (nodes: readonly Note[]): Note[] =>
      nodes.map(n => (n.id === noteId ? { ...n, text } : { ...n, children: walk(n.children) }))
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      next.set(cell, walk(next.get(cell) ?? []))
      return next
    })
    this.#version.update(v => v + 1)
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
    if (this.#noteDragPointerId !== null) return
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

  /** Note id under a viewport point, or null.
   *
   *  The rail belongs to the WINDOW, so a dragged icon has to land on
   *  whatever the pointer is actually over — a row of the tree below, a
   *  LINE of the open list, or the NOTE being read in the pane. Each of
   *  those advertises its own id; they are checked small-to-large so a line
   *  inside the pane wins over the pane itself. */
  #noteRowIdAt(x: number, y: number): string | null {
    const hit = (selector: string, attr: string): string | null => {
      const rows = Array.from(this.#host.nativeElement.querySelectorAll(selector)) as HTMLElement[]
      for (const row of rows) {
        const r = row.getBoundingClientRect()
        if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) continue
        return row.getAttribute(attr)
      }
      return null
    }
    return hit('article.cv2-note[data-note-id]', 'data-note-id')
      ?? hit('.cv2-peek-row[data-note-id]', 'data-note-id')
      ?? hit('.cv2-line[data-pheromone-note]', 'data-pheromone-note')
      ?? hit('.cv2-reading-scroll[data-pheromone-note]', 'data-pheromone-note')
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


  // Every tile in the current layer, sourced from CellSuggestionProvider's
  // ROSTER — core's `levelRoster`, the same read the chat window's tiles rail
  // and the command-line autocomplete make, in the parent's own order. One row
  // per NAME: a superseded revision sitting beside its replacement is one tile,
  // not two, and this list used to show it twice. Maintained continuously
  // (boot + lineage change + synchronize), not gated behind a see-all toggle.
  readonly #layerCellLabels = signal<readonly string[]>([])

  /** The labels the canvas actually painted on the last pass (`render:cell-count`).
   *  Only consulted while a page filter is on — otherwise the layer's own list
   *  is the truth, and a mid-navigation empty pass must not blank the list. */
  readonly #renderedCellLabels = signal<readonly string[]>([])
  readonly #tagFilterActive = signal(false)
  readonly #searchFilterActive = signal(false)
  /** Is the page showing a narrowed view right now? */
  readonly pageFiltered = computed(() =>
    this.#tagFilterActive() || this.#searchFilterActive())

  /** The tiles the navigator may list: the page's surviving tiles while a
   *  filter is on, else every tile in the layer.
   *
   *  Always intersected with the LAYER's own tiles, in the order the page
   *  painted them. A flattening filter (tag scope 'children'/'global') draws
   *  in tiles that live on pages below; the strip resolves a tile's notes from
   *  its NAME against the current location, so listing a foreign tile here
   *  would open some other tile's notes — or an empty set — under its name.
   *  The page keeps showing them; the navigator stays honest about what it
   *  can actually write on. */
  readonly #navigatorCellLabels = computed<readonly string[]>(() => {
    const layer = this.#layerCellLabels()
    if (!this.pageFiltered()) return layer
    const here = new Set(layer)
    return this.#renderedCellLabels().filter(label => here.has(label))
  })

  /** Re-poll the current layer's cell labels. Called on construct, on lineage
   *  change, and on `synchronize` so the navigator always reflects the tiles
   *  actually present in this layer (added / removed / renamed). */
  #refreshLayerCellLabels(): void {
    const provider = get<{ roster?(): readonly { name: string }[]; suggestions(): readonly string[] }>(
      '@hypercomb.social/CellSuggestionProvider'
    )
    if (!provider) { this.#layerCellLabels.set([]); return }
    // The roster is the rail's list. `suggestions()` is the same tiles sorted
    // for autocomplete — the fallback while an older provider is registered.
    const roster = provider.roster?.()
    this.#layerCellLabels.set(roster ? roster.map(row => row.name) : [...provider.suggestions()])
    // The rail walks the same level for itself; this is the poll that says
    // WHEN — the panel already hears every event that can move the layer.
    this.#syncRail()
    this.#rail?.refresh?.()
  }

  /** Click a row's body. Wherever the pane exists — docked and on the desk
   *  alike — the click SELECTS: the note lands in the pane, and editing is
   *  the pane's own affordance. Narrow fullscreen has no pane, so there the
   *  click opens the embedded editor as it always has. */
  onRowBodyClick(cellLabel: string, noteId: string, _event: Event, path?: readonly number[]): void {
    // The lists tab has its own pane — a row click there picks WHICH LIST
    // (or which list an item belongs to), never the prose editor.
    if (this.tab() === 'lists' && path) {
      this.openListPath(path)
      return
    }
    if (this.formInPane()) {
      this.selectNote(noteId)
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

  /** The surface the drag started on (`[data-note-drag-scope]` — the tree
   *  column or the list pane). Rows are hit-tested WITHIN it: the desk
   *  shows the same notes in two columns at the same heights, and a
   *  hit-test over the whole panel would answer with whichever copy came
   *  first in the DOM. */
  #noteDragScope: HTMLElement | null = null

  onNoteGripPointerDown(cellLabel: string, noteId: string, event: PointerEvent): void {
    // Primary mouse button / pen / touch primary only. Don't initiate
    // if the user is already mid-panel-drag.
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const from = event.currentTarget as HTMLElement | null
    this.#noteDragScope = from?.closest<HTMLElement>('[data-note-drag-scope]') ?? null
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
    const root = this.#noteDragScope ?? this.#host.nativeElement
    const rows = Array.from(root.querySelectorAll('[data-note-row][data-note-id]')) as HTMLElement[]
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
    const scope = this.#noteDragScope
    this.#noteDragScope = null
    if (!sourceId || !sourceCell) return

    // WHERE a drop lands is one question — which parent, which position —
    // and `note:move` is the one op that answers it, at any depth. (The
    // top-level-only `note:reorder` this used to fire could not put a line
    // among its siblings inside a list.)
    const inList = scope?.dataset['noteDragScope'] === 'list'
    const listRootId = inList ? (this.listRoot()?.id ?? null) : null

    if (mode === 'into' && targetId) {
      EffectBus.emit('note:move', { cellLabel: sourceCell, sourceId, parentId: targetId })
      return
    }
    if (mode === 'root') {
      // Dropped past the last row. On a list that means the last line OF
      // THE LIST; on the tree it means out from under every parent.
      EffectBus.emit('note:move', { cellLabel: sourceCell, sourceId, parentId: listRootId })
      return
    }
    // 'before' / 'after' → the target's parent, at the target's position.
    // The index is read against the siblings with the source already taken
    // out, which is the order the drone performs the move in.
    if ((mode === 'before' || mode === 'after') && targetId) {
      const place = this.#placeOf(sourceCell, targetId)
      if (!place) return
      const siblings = place.siblings.filter(n => n.id !== sourceId)
      const targetPos = siblings.findIndex(n => n.id === targetId)
      if (targetPos === -1) return
      EffectBus.emit('note:move', {
        cellLabel: sourceCell,
        sourceId,
        parentId: place.parentId,
        index: mode === 'after' ? targetPos + 1 : targetPos,
      })
    }
  }

  /** Where a note sits in its cell's tree: the id of the note it hangs
   *  under (null at the top level) and the siblings it sits among. */
  #placeOf(cell: string, noteId: string): { parentId: string | null; siblings: readonly Note[] } | null {
    const walk = (nodes: readonly Note[], parentId: string | null): { parentId: string | null; siblings: readonly Note[] } | null => {
      for (const n of nodes) {
        if (n.id === noteId) return { parentId, siblings: nodes }
        const found = walk(n.children, n.id)
        if (found) return found
      }
      return null
    }
    return walk(this.#allForCell(cell), null)
  }

  // ── ESC cascade + click-outside dismissal ────────────────
  // Host ElementRef so click-outside can decide whether the click
  // hit our panel or somewhere else in the document.
  readonly #host = inject(ElementRef<HTMLElement>)

  /** One level back per press: the icon picker, then the kebab, then
   *  fullscreen. False = nothing of ours was open, and the shell cascade
   *  carries on past us.
   *
   *  This was a `document:keydown.escape` HostListener whose comment claimed it
   *  stopped the global cascade for a handled press. It could not: the keymap
   *  listens on the WINDOW in the capture phase, so by the time a document
   *  bubble listener ran the cascade had already been asked to run. Escape has
   *  one owner now and this is how the strip takes part in it. */
  dismiss(): boolean {
    if (!this.visible()) return false
    if (this.pickerOpenForId() !== null) { this.closePicker(); return true }
    if (this.kebabOpenId() !== null) { this.closeKebab(); return true }
    return false
  }

  /** Enter / leave the two view modes as one gesture — see KEEPS_CONTROLS.
   *  Both are owner-counted, so releasing ours never stands another view's
   *  claim down. */
  #claimSurface(active: boolean): void {
    this.#surfaceWanted = active
    // AND SAY WHERE THE DESK'S TOP EDGE IS, for exactly as long as it holds
    // the surface. The desk covers the header bar (`top: 0` — the bar has
    // nothing in it while a view is up); the pheromone panel it pairs with is
    // a normal toolwindow anchored UNDER that bar, so without this the two
    // halves meet at a 42px step with a stripe of hive above the panel.
    // Unset again on release, so the panel is back on the shared anchor the
    // moment it is on its own.
    const root = document.documentElement.style
    if (active) root.setProperty('--hc-desk-top', '0px')
    else root.removeProperty('--hc-desk-top')
    const modes = get<ModeRegistryLike>(MODE_REGISTRY_IOC_KEY)
    if (!modes) {
      // The registry is an essentials bee and the desk can boot open before it
      // lands. Claim on the SETTLED intent when it arrives, never on the intent
      // that was current when this call was made.
      if (active) {
        (globalThis as { ioc?: { whenReady?: (k: string, cb: (v: unknown) => void) => void } }).ioc
          ?.whenReady?.(MODE_REGISTRY_IOC_KEY, value => {
            if (!this.#surfaceWanted) return
            const late = value as ModeRegistryLike
            late.enter('view:active', SURFACE_OWNER)
            late.enter(KEEPS_CONTROLS, SURFACE_OWNER)
          })
      }
      return
    }
    if (active) {
      modes.enter('view:active', SURFACE_OWNER)
      modes.enter(KEEPS_CONTROLS, SURFACE_OWNER)
    } else {
      modes.exit('view:active', SURFACE_OWNER)
      modes.exit(KEEPS_CONTROLS, SURFACE_OWNER)
    }
  }

  /** Is the surface claimed, as far as this window is concerned. */
  #surfaceWanted = false

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

  /** The active tile's note tree — split by the writing tabs (prose and
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
    return this.#matchesText(cell, this.filterText())
  }

  /** Does `cell` match `query` — by NAME, or by anything written on it? The
   *  rail's find box searches names on its own; this is the half only the
   *  notes panel can answer, handed to it as the profile's `matches`. */
  #matchesText(cell: string, query: string): boolean {
    const q = query.trim().toLowerCase()
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
   *  the find box, in the parent layer's own order (the roster's order — the
   *  same order the canvas lays the hexagons out and the chat window's rail
   *  lists them). Clicking a
   *  row makes that tile active and its notes fill the column on the left.
   *  A plain list — the count rides in a badge and every row is one size;
   *  the weighted tag cloud this used to be made a wall of jumbled type. */
  readonly tileList = computed<readonly { cell: string; count: number }[]>(() => {
    return this.#navigatorCellLabels()
      .filter(cell => this.#matchesFilter(cell))
      .map(cell => ({ cell, count: this.#cellCount(cell) }))
  })

  // ── The tile list IS the hive's tile list ─────────────────
  // Not a list of its own: the very same component the chat window's sidebar
  // mounts (essentials, assistant/agent-tiles-rail.ts), reached structurally
  // through IoC because shared may never import a module. Same rows, same
  // SQUARE PICTURES, same search box, same collapse by name — the notes panel
  // used to draw letter hexagons off its own read and drifted from the rail in
  // both looks and content.
  //
  // What differs is a PROFILE, not a second list: it has no chats, so no › and
  // no bee counts; its badge counts NOTES; and its find box searches what is
  // written on a tile as well as what it is called.
  //
  // It WALKS, like the chat window's. The difference is what the walk means:
  // the chat rail walks the hive while the participant stays put, because it
  // is only naming a subject to talk about. This desk WRITES on the tiles of
  // the place it is standing at, so going inside a tile in the list takes the
  // desk inside it too (`#followRailLevel`). The list and the place it names
  // are one thing.

  readonly railHost = viewChild<ElementRef<HTMLElement>>('railHost')
  /** True once the rail is mounted — until then (and on a shell whose
   *  essentials build predates the profile) the panel's own chips stand in. */
  readonly railMounted = signal(false)
  #rail: TilesRailLike | null = null

  /** Ask for the rail, and WAIT for it if essentials has not landed yet.
   *  The web shell loads its bees from OPFS, so the desk can be on screen
   *  before the factory registers — a single synchronous miss used to leave
   *  the tile list as the fallback chips for the rest of the session, which is
   *  exactly the list the rail was brought in to replace. The chat window has
   *  waited on this key from the start; this is the same wait. */
  #mountRail(host: HTMLElement): void {
    if (this.#rail || this.#railPending) return
    const key = '@diamondcoreprocessor.com/AgentTilesRailFactory'
    const now = get<TilesRailFactoryLike>(key)
    if (now) { this.#bringRail(now, host); return }
    this.#railPending = true
    window.ioc?.whenReady?.<TilesRailFactoryLike>(key, factory => {
      this.#railPending = false
      // The host captured above may have been replaced by the time a late
      // factory lands (the panel rebuilds its DOM) — mount into whatever is
      // on screen NOW.
      const live = this.railHost()?.nativeElement
      if (live) this.#bringRail(factory, live)
    })
  }

  /** True between asking for a late factory and its arrival — without it every
   *  re-run of the mount effect would queue another `whenReady`. */
  #railPending = false

  #bringRail(factory: TilesRailFactoryLike | undefined, host: HTMLElement): void {
    if (this.#rail) return
    // THE LIST WALKS, AND THE DESK WALKS WITH IT. This panel resolves a
    // tile's notes by NAME against the location it stands at, so a list that
    // moved on its own would name cells the desk cannot honestly write on —
    // which is why the list used to be pinned to one level. It is not pinned
    // any more: `onLevelChanged` moves the DESK to whatever level the list
    // walks to (see `#followRailLevel`), so the two can never disagree.
    //
    // That makes the hook load-bearing. An essentials build that predates it
    // hands back a list that walks with nobody following, so the capability
    // test below refuses that rail and the panel's own chips stand in — the
    // same refusal `walk: false` used to buy, now on the thing that is
    // actually missing.
    const rail = factory?.create?.({
      walk: true,
      chats: false,
      choose: false,
      badge: row => this.#cellCount(row.name),
      // Only ever a NARROWING: while the page shows a filtered set, the list
      // says so too. Unfiltered, the rail's own walk is the truth — gating it
      // on the panel's separately-refreshed labels would blank the list for
      // as long as that read lagged.
      admits: row => !this.pageFiltered() || this.#navigatorCellLabels().includes(row.name),
      matches: (row, query) => this.#matchesText(row.name, query),
      findLabel: this.#t('notes.filterPlaceholder', 'find a tile…'),
      clickLabel: this.#t('notes.openTile', 'open this tile’s notes'),
      onHover: (row, event) => {
        if (event) this.onChipEnter(row.name, event)
        else this.onChipLeave()
      },
    })
    if (!rail || typeof rail.showLevel !== 'function' || !('onLevelChanged' in rail)) return
    this.#rail = rail
    rail.onSubjectChanged = subject => {
      if (subject?.name) this.activateCell(subject.name)
    }
    rail.onLevelChanged = segments => this.#followRailLevel(segments)
    rail.mount(host)
    rail.showLevel?.(this.platePath())
    rail.showCurrent?.(this.cell())
    this.railMounted.set(true)
    this.#cleanups.push(() => { this.#rail?.dispose(); this.#rail = null })
  }

  /** Put the rail on the level the panel is standing at, and re-read it. The
   *  panel's own polls already run on lineage change and `synchronize`.
   *
   *  Safe to call straight after the rail's OWN walk: `showLevel` on the level
   *  already in hand is a refresh, not a re-seat, so the round trip through
   *  navigation lands as a no-op rather than a fight. */
  #syncRail(): void {
    const rail = this.#rail
    if (!rail) return
    rail.showLevel?.(this.platePath())
    rail.showCurrent?.(this.cell())
  }

  /** THE LIST WALKED — take the desk with it.
   *
   *  Going inside a tile in the list is going inside it, full stop: the desk
   *  writes on the tiles of the place it is standing at, so the place has to
   *  move or the rows below name tiles the desk would open the wrong notes
   *  for. `goRaw` pushes, so the browser's (and the phone's) Back walks the
   *  excursion out the way it walked in, and closing the desk leaves the
   *  participant where they actually went rather than snapping them back to
   *  somewhere they have stopped thinking about.
   *
   *  The active tile does NOT survive the move — a name resolves per level, so
   *  carrying it across would open a different tile's notes under the name you
   *  were just reading. */
  #followRailLevel(segments: readonly string[]): void {
    const next = [...segments].map(s => String(s ?? '').trim()).filter(Boolean)
    const here = [...this.platePath()].map(s => String(s ?? '').trim()).filter(Boolean)
    if (next.length === here.length && next.every((s, i) => s === here[i])) return
    this.#clearSubject()
    this.#activeCell.set(null)
    get<NavigationLike>('@hypercomb.social/Navigation')?.goRaw?.(next)
  }

  /** First letter of a tile's name, for the hexagon on its row. Mirrors the
   *  identity plate's fallback, so a tile reads the same in both places. */
  initialOf(cell: string): string {
    return (cell ?? '').trim().charAt(0).toUpperCase() || '·'
  }

  /** Make `cell` the active tile — its notes open in the editor above the
   *  list. Clears any in-progress edit so switching tiles starts clean. The
   *  list-click counterpart to clicking the tile on the canvas. */
  activateCell(cell: string): void {
    if (!cell) return
    this.#clearSubject()
    this.#activeCell.set(cell)
  }

  /** Put down whatever tile is in hand, and everything that was only true
   *  ABOUT that tile. A different tile is a different document: back to its
   *  first list, its first note, and no half-typed line carried across.
   *  Shared with `#followRailLevel`, where the tile is not being swapped for
   *  another but let go of entirely — a name resolves per level, so it cannot
   *  travel. */
  #clearSubject(): void {
    this.#capturingFor.set(null)
    this.editingNoteId.set(null)
    this.draftText.set('')
    this.listPathIdx.set([])
    this.readingIndex.set(0)
    this.newItemDepth.set(0)
    this.disarmListDelete()
    this.cancelItemEdit()
    this.#clearNewLine()
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
  /**
   * WHICH tile the card is showing. Hover wins while the pointer is over
   * another tile's row (a peek at what you have not picked); otherwise it is
   * the SELECTED tile's card, and that one is PINNED — it stays put, and its
   * rows are how you pick a note.
   *
   * A card you can only reach by holding the pointer still is a card you
   * cannot click a row in: the moment you set off towards it you have left
   * the row that opened it. So selection pins it.
   */
  readonly peekCell = computed<string | null>(() => this.hoverCell())

  /** The card is NEVER pinned. It was pinned only for the docked strip, whose
   *  narrow column had no room to list a tile's notes — the desk shows the
   *  whole tree in its own column, so a card of the same notes floating over
   *  it is a second copy of the answer. What survives is the HOVER peek: a
   *  look at a tile you have NOT selected, which the desk has no other way to
   *  give you. Hover-only means capped rows, no pointer events, no selection.
   *  Kept as a method so the template reads the same as the other flags. */
  peekPinned(): boolean { return false }

  readonly hoverNotes = computed<readonly { id: string; text: string; kind: 'q' | 'a' | 'note'; mark: string | null; depth: number }[]>(() => {
    const cell = this.peekCell()
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

  /** Rows actually rendered, and how many were left off. The PINNED card
   *  shows every note — it is the selector, and a selector that hides rows
   *  behind "+3 more" cannot select them. A hover peek stays capped. */
  readonly hoverVisible = computed(() =>
    this.peekPinned() ? this.hoverNotes() : this.hoverNotes().slice(0, HOVER_LIST_MAX))
  readonly hoverOverflow = computed(() =>
    this.peekPinned() ? 0 : Math.max(0, this.hoverNotes().length - HOVER_LIST_MAX))

  /** Click a row of the pinned card — that note goes in the view. */
  selectPeekNote(noteId: string, event?: Event): void {
    event?.stopPropagation()
    if (!this.peekPinned()) return
    this.selectNote(noteId)
  }

  /** Anchor the pinned card beside the active tile's row, or — when that row
   *  isn't on screen (the filter scrolled it away, or the tile was picked on
   *  the canvas) — beside the panel itself. Runs whenever the selection
   *  changes, so the card never sits where the last hover left it. */
  #anchorPinnedCard(): void {
    const host = this.#host.nativeElement
    const active = host.querySelector('.cv2-tilechip.is-active') as HTMLElement | null
    const panel = this.panel()?.nativeElement
    const rect = active?.getBoundingClientRect() ?? panel?.getBoundingClientRect()
    if (!rect) return
    const width = this.#peekWidth()
    if (rect.left - width - 10 >= 8) {
      this.hoverRight.set(Math.round(window.innerWidth - rect.left + 10))
      this.hoverLeft.set(null)
    } else {
      this.hoverLeft.set(Math.round(Math.min(rect.right + 10, window.innerWidth - width - 8)))
      this.hoverRight.set(null)
    }
    const rows = this.#flatCount(this.#allForCell(this.cell()))
    const estimated = 52 + Math.min(rows, 18) * 22
    this.hoverTop.set(Math.round(Math.max(8, Math.min(rect.top - 6, window.innerHeight - estimated - 12))))
  }

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

  /** The pointer reached the CARD. Drop any hover instantly, so the pinned
   *  card is what is under the pointer.
   *
   *  Without this the card is unreachable in practice: the trip from a tile
   *  row to the card crosses other tile rows, each of which opens its own
   *  peek — the contents change under you mid-reach and the row you were
   *  going to click is a different tile's note by the time you get there. */
  onPeekEnter(): void {
    this.#clearHoverTimers()
    if (this.hoverCell() !== null) this.hoverCell.set(null)
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
    dismiss: () => this.dismiss(),
    close: () => this.hide(),
  }

  /** Turn the strip on. Every open path goes through here, because `#open` is
   *  only half of `visible` — the park flag sits OVER it, and until the lane
   *  existed the only thing that ever set that flag was the installer, which
   *  always unparks on the way home. The lane parks too, and nothing unparks
   *  THAT: without this, one displaced strip is a Notes toggle that does
   *  nothing for the rest of the session.
   *
   *  Asking for the window is the participant taking the shell's decision
   *  back, so an explicit open OVERRULES a lane park. The INSTALLER park still
   *  stands — a strip that reappeared there would float over somebody else's
   *  page with nothing left to put it away again (window-session.ts). */
  #show(): void {
    if (!windowsParked()) this.#parked.set(false)
    this.#open.set(true)
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
    // The fullscreen desk consumes `--hc-inset-right` (its right edge yields
    // to a docked toolwindow — the pheromones window opens BESIDE the desk).
    // The singleton is normally started by shell bootstrap; calling it here
    // too costs nothing and keeps the desk correct even if that ordering
    // ever changes (same belt-and-braces as youtube-viewer).
    ensureViewportInsetVars()
    // A different tile is a different document — the reading pane starts
    // back at its top. `untracked` so the write never joins the read graph.
    effect(() => {
      this.cell()
      untracked(() => this.readingIndex.set(0))
    })

    // Keep the notes column in step with the pane: whatever the pane is
    // showing gets driven into view (to the top when it is off-screen).
    // The row has to exist first, hence the microtask.
    effect(() => {
      const id = this.readingRow()?.note.id
      if (!id) return
      untracked(() => queueMicrotask(() => this.#revealRow(id)))
    })

    // The pinned card follows the selection — re-anchored once the active
    // row has rendered, so it opens beside the tile you just picked.
    effect(() => {
      const cell = this.cell()
      if (!cell) return
      untracked(() => queueMicrotask(() => this.#anchorPinnedCard()))
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

    // ── The page's filter is the navigator's filter ───────────
    // When the participant narrows the page (a tag filter, a find keyword, a
    // saved filter view), the tiles on screen ARE the working set — the
    // navigator must not keep offering the ones the page just put away.
    // The filter's own effects say WHETHER a filter is on; `render:cell-count`
    // says WHICH tiles survived it (including tiles a flattening filter drew
    // in from pages below). Both are last-value-replayed, so a panel opened
    // after the filter was set still lands on the filtered list.
    this.#cleanups.push(EffectBus.on<{ labels?: readonly string[] }>('render:cell-count', (p) => {
      this.#renderedCellLabels.set(Array.isArray(p?.labels) ? [...p!.labels!] : [])
    }))
    this.#cleanups.push(EffectBus.on<{ active?: readonly string[] }>('tags:filter', (p) => {
      this.#tagFilterActive.set((p?.active?.length ?? 0) > 0)
    }))
    this.#cleanups.push(EffectBus.on<{ keyword?: string }>('search:filter', (p) => {
      this.#searchFilterActive.set(!!(p?.keyword ?? '').trim())
    }))

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

    // Mount the hive's tile list as soon as its host is in the DOM (the panel
    // rebuilds its DOM on fullscreen and on re-dock, so this re-runs).
    effect(() => {
      const host = this.railHost()?.nativeElement
      if (host) untracked(() => this.#mountRail(host))
    })

    // The rail reads the panel's own facts through its profile — which tiles
    // the page's filter leaves standing, and how many notes each row holds.
    // Those move without the hive moving, so say when: a repaint, not a walk.
    effect(() => {
      this.#navigatorCellLabels()
      this.#notesByCell()
      this.#qaByCell()
      untracked(() => this.#rail?.paint?.())
    })

    // The row that is lit is the tile whose notes are open — whether it was
    // clicked in the list, on the canvas, or set by a capture.
    effect(() => {
      const cell = this.cell()
      untracked(() => this.#rail?.showCurrent?.(cell))
    })

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

    // Put the caret in the line being corrected, once it has rendered.
    // Reading the viewChild makes this re-run when the field appears.
    effect(() => {
      const editing = this.editingItemId()
      const el = this.lineInput()?.nativeElement
      if (!editing || !el) return
      untracked(() => {
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
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
      // A line indented mid-edit waits here for its text to land.
      this.#applyPendingIndent()
      // …and so does a composer line whose parent was still optimistic. This
      // reconcile is what just gave that parent its real id.
      this.#drainComposer()
    }))

    // Track command-line capture state so the strip pops in for the target
    // tile while authoring — even when that tile has no notes yet.
    this.#cleanups.push(EffectBus.on<{ mode: string; target: string; editId?: string }>('command:enter-mode', (p) => {
      if (p?.mode !== 'note-capture' || !p.target) return
      this.#capturingFor.set(p.target)
      this.#show()           // authoring turns the strip on (and lights the toggle)
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
      // The header toggle is the participant asking for the window by name —
      // the one gesture that must always be able to bring it back.
      if (next) this.#show()
      else this.#open.set(false)
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

    // The surface claim follows what is ON SCREEN, not the intent: a parked
    // desk is covered by the installer and holds nothing, and a desk waiting
    // on a tile is still the desk. `visible()` is exactly that reading.
    effect(() => this.#claimSurface(this.visible()))

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
    // A leaked enter() strands `view:active` on forever — the canvas and the
    // command line would never come back. Release both on the way out.
    this.#claimSurface(false)
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
      if (savePending) return
      savePending = true
      requestAnimationFrame(() => {
        savePending = false
        const entry = entries[entries.length - 1]
        if (!entry) return
        const w = Math.round(entry.contentRect.width)
        // Width only — see #applyStoredDimensions for why height is not
        // persisted (it would lock the float panel to a full-height box).
        // This is also the DOCKED width the shared chrome shares with the
        // window's group and reads its auto text size off (`panelWidth`),
        // which is why it is recorded here — past the fullscreen guard —
        // and not off the raw box.
        this.#dockWidth = w
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
    this.#show()                               // authoring turns the strip on
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

  // ── THE COMPOSER: the command line, at the foot of the desk ────────────
  //
  // Writing a note is TYPING A LINE, so the thing you type it into is the
  // line the participant already types everything into — `hc-command-shell`,
  // the same component the shell's own command line is built from, not a
  // second input that looks like it and behaves differently. Notes owns the
  // grammar; the shell owns the box, the caret, the ghost and the keys.
  //
  // THE GRAMMAR — hyphens go deeper, Escape comes back out:
  //
  //     milk                 → a note at the top
  //     - semi-skimmed       → one level under it; the cursor is now depth 1
  //     - whole              → a sibling of it (no hyphens needed again)
  //     -- from the farm     → one deeper still
  //     <Escape>             → back out one level
  //
  // The depth is a CURSOR, not a per-line decoration: hyphens SET it, and it
  // stays where they left it, so a list is typed as a list instead of retyped
  // as a prefix every line. Escape on an empty line walks it back out; at the
  // top it is not ours and falls through to the shell's own cascade.
  //
  // WHY A QUEUE. A nested line needs its parent's SIGNATURE-BACKED id, and a
  // line committed a moment ago is still an optimistic `pending-…` row until
  // the write, the layer cascade and the `notes:changed` re-read have landed.
  // Typing does not wait for storage, so lines are queued and drained one at
  // a time: each drain resolves the parent from the live tree and stops if it
  // is still pending, and the reconcile that replaces it kicks the drain
  // again. Type six lines as fast as you like — they land in order, at the
  // depths you gave them.

  /** What is in the composer right now (mirrored for the submit affordance). */
  readonly composerText = signal('')

  /** The depth the next un-prefixed line lands at. */
  readonly composerDepth = signal(0)

  /** Lines accepted but not yet written, oldest first. */
  readonly #composerQueue = signal<readonly { text: string; depth: number; mark: string | null }[]>([])

  /** True while a line is waiting on its parent to become real. */
  readonly composerPending = computed<boolean>(() => this.#composerQueue().length > 0)

  /** The composer's own view of the shell, so a commit can clear it. */
  readonly composerShell = viewChild<CommandShellComponent>('composer')

  /** Read a typed line: a leading run of hyphens is the depth it asks for,
   *  and everything after the first space is the note. No hyphens = the
   *  cursor's current depth. A line of nothing but hyphens is not a note. */
  #readComposerLine(raw: string): { depth: number; text: string } | null {
    const line = raw.trim()
    if (!line) return null
    const run = /^(-+)\s+(.*)$/.exec(line)
    if (!run) return { depth: this.composerDepth(), text: line }
    const text = run[2].trim()
    if (!text) return null
    return { depth: run[1].length, text }
  }

  /** Enter in the composer. */
  commitComposer(raw: string): void {
    const cell = this.cell()
    if (!cell) return
    const line = this.#readComposerLine(raw)
    if (!line) return
    // Never skip a level: a depth with no parent above it becomes the
    // deepest depth that HAS one. Typing `--- x` into an empty tile writes
    // a top-level note rather than nothing at all.
    const depth = Math.min(line.depth, this.#deepestComposerDepth() + 1)
    this.composerDepth.set(depth)
    // FOLLOW WHAT YOU WROTE. A note that has children IS a list here
    // (`#isListRoot`), so the moment a line goes under one the root it hangs
    // from leaves the notes tab for the lists tab — and the participant, still
    // looking at notes, watches the thing they are building disappear. Going
    // deeper is the gesture that says "this is a list"; the tab follows it.
    if (depth > 0) this.setTab('lists')
    this.#composerQueue.update(q => [...q, { text: line.text, depth, mark: this.draftMark() }])
    this.composerText.set('')
    this.composerShell()?.clear()
    this.#drainComposer()
  }

  /** Keys the shell did not consume. Escape is the only one we want: it walks
   *  the depth cursor back out. Stopping propagation on a press we HANDLED is
   *  what keeps the shell's own escape cascade (blur, then the global
   *  show-the-hexagons sweep) from firing on the same press and taking the
   *  desk away mid-list. */
  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    if (!this.composerEscape()) return
    event.preventDefault()
    event.stopPropagation()
  }

  /** Escape in the composer — one level back out. Answers whether it was
   *  ours to take, so the caller can let the shell have it otherwise. */
  composerEscape(): boolean {
    if (this.composerText().trim()) return false
    if (this.composerDepth() === 0) return false
    this.composerDepth.update(d => Math.max(0, d - 1))
    return true
  }

  /** How deep the tile's tree actually goes right now (-1 = no notes). */
  #deepestComposerDepth(): number {
    let deepest = -1
    const walk = (nodes: readonly Note[], depth: number): void => {
      for (const n of nodes) {
        if (depth > deepest) deepest = depth
        walk(n.children, depth + 1)
      }
    }
    walk(this.#allForCell(this.cell()), 0)
    return deepest
  }

  /** The note a line at `depth` hangs under: the LAST node at `depth - 1` in
   *  document order, which is the one the participant just wrote. Null at
   *  depth 0 (nothing to hang under) and when the tree has no such row. */
  #composerParentAt(depth: number): Note | null {
    if (depth <= 0) return null
    let found: Note | null = null
    const walk = (nodes: readonly Note[], d: number): void => {
      for (const n of nodes) {
        if (d === depth - 1) found = n
        else if (d < depth - 1) walk(n.children, d + 1)
      }
    }
    walk(this.#allForCell(this.cell()), 0)
    return found
  }

  /** Write the head of the queue, if its parent is real. One line per pass:
   *  the write it makes is what un-blocks the next. */
  #drainComposer(): void {
    const cell = this.cell()
    const head = this.#composerQueue()[0]
    if (!cell || !head) return
    if (head.depth === 0) {
      EffectBus.emit('note:commit', { cellLabel: cell, text: head.text, mark: head.mark })
      this.#paintOptimistic(cell, head.text, null, head.mark)
      this.#composerQueue.update(q => q.slice(1))
      return
    }
    const parent = this.#composerParentAt(head.depth)
    // No parent yet, or a parent that is still this session's optimistic row:
    // hold the line. The reconcile that gives it a real id calls back here.
    if (!parent || parent.id.startsWith('pending-')) return
    EffectBus.emit('note:add-child', { cellLabel: cell, parentId: parent.id, text: head.text, mark: head.mark })
    this.#paintChildOptimistic(cell, parent.id, head.text)
    this.#composerQueue.update(q => q.slice(1))
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
