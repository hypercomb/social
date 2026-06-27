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
  imports: [TranslatePipe, NgTemplateOutlet, DockInsetDirective],
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

  /** Click a row's body — opens the note in the embedded editor. */
  onRowBodyClick(cellLabel: string, noteId: string, _event: Event): void {
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
    if (this.selectedCells().size > 0) {
      this.clearCellSelection()
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

  // ── Tile navigator multi-select ──────────────────────────
  // The bottom navigator is multi-selectable: check several tiles to build a
  // working set you can switch between quickly. Selection is participant-
  // local and session-only — it's view state, never persisted to the layer
  // (the clipboard/selection-locality rule: anything that would skew the
  // lineage signature across peers stays out of the layer). This picks TILES,
  // not notes — notes themselves carry no selection. The active tile (shown in
  // the editor above) is independent — you can switch the active tile without
  // changing the checked set, and clearing the set leaves the active tile open.
  readonly selectedCells = signal<ReadonlySet<string>>(new Set())

  /** How many tiles are checked in the navigator — drives the navigator's
   *  selection status line ("N tiles selected · click to switch"). */
  readonly selectedCellCount = computed<number>(() => this.selectedCells().size)

  /** Is this tile checked in the navigator's working set? */
  isCellSelected(cell: string): boolean {
    return this.selectedCells().has(cell)
  }

  /** Toggle a tile's membership in the navigator's selected set. Stops
   *  propagation so the checkbox click doesn't also fire the row's activate. */
  toggleCellSelection(cell: string, event?: Event): void {
    event?.stopPropagation()
    if (!cell) return
    this.selectedCells.update(prev => {
      const next = new Set(prev)
      if (next.has(cell)) next.delete(cell)
      else next.add(cell)
      return next
    })
  }

  /** Clear the navigator's tile selection. The active tile is untouched —
   *  its notes stay open in the editor above. */
  clearCellSelection(): void {
    if (this.selectedCells().size > 0) this.selectedCells.set(new Set())
  }

  /** Always-on tile navigator: every tile in the current layer, filtered by
   *  the find box. Clicking a row makes that tile active (its notes open in
   *  the editor above); clicking the tile on the canvas activates it here too.
   *  Checked tiles float to the top so the selected working set is grouped and
   *  easy to switch between; layer order (CellSuggestionProvider order) is
   *  preserved within the checked and unchecked groups. */
  readonly tileList = computed<readonly { cell: string; count: number; selected: boolean }[]>(() => {
    const sel = this.selectedCells()
    const rows = this.#layerCellLabels()
      .filter(cell => this.#matchesFilter(cell))
      .map(cell => ({ cell, count: this.#cellCount(cell), selected: sel.has(cell) }))
    // Stable sort: checked tiles first, original order kept within each group.
    return rows.sort((a, b) => (a.selected === b.selected ? 0 : a.selected ? -1 : 1))
  })

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

  /**
   * Visible whenever the strip is explicitly open (via the control-bar Notes
   * toggle) or the user is authoring a note (capture mode). It NEVER opens on
   * its own from selection — passive auto-open was removed; the Notes toggle is
   * the sole on/off control. When open with no active tile, the panel still
   * shows so the always-on tile list is available to find and pick one.
   */
  readonly visible = computed<boolean>(() => this.#open() || !!this.#capturingFor())

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
        // The navigator's checked set names tiles in the layer we just left;
        // those labels are meaningless in the new layer, so drop the selection.
        this.selectedCells.set(new Set())
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

    // Broadcast the toggle's open state so the control-bar Notes button can
    // light up and toggle correctly. Tracks #open (the intent) rather than
    // visible() so the button stays lit while notes mode is on even when no
    // tile is selected. Last-value replayed by EffectBus, so a late-mounting
    // control bar reflects the current state. Mirrors `clipboard:open`.
    effect(() => {
      EffectBus.emit('notes:panel-state', { open: this.#open() })
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
    this.#open.set(true)                       // authoring turns the strip on
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
    // Paint immediately — don't make the user wait for the resource write +
    // leaf→root layer cascade + the notes:changed re-read. The authoritative
    // reconcile lands moments later and replaces this with the persisted note.
    this.#paintOptimistic(cell, finalText, editId ?? null)
    this.draftText.set('')
    this.editingNoteId.set(null)           // editing is one-shot → back to add
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
  #paintOptimistic(cell: string, text: string, editId: string | null): void {
    this.#notesByCell.update(prev => {
      const next = new Map(prev)
      const current = next.get(cell) ?? []
      if (editId) {
        next.set(cell, current.map(n => (n.id === editId ? { ...n, text } : n)))
      } else {
        const pending: Note = { id: `pending-${++this.#pendingSeq}`, text, shape: null, children: [] }
        next.set(cell, [...current, pending])
      }
      return next
    })
    // The cell now has content — mark it warmed so the empty-state classifier
    // doesn't briefly flag it, and bump #version like the reconcile path does.
    this.#warmed.update(prev => { if (prev.has(cell)) return prev; const n = new Set(prev); n.add(cell); return n })
    this.#version.update(v => v + 1)
  }

  /** Drop out of edit mode back to a blank add form. */
  cancelEdit(): void {
    this.editingNoteId.set(null)
    this.draftText.set('')
    this.draftKind.set('note')
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

  /** Delete a single note from the active cell's list. */
  remove(noteId: string, event: Event): void {
    event.stopPropagation()
    const cell = this.cell()
    if (!cell || !noteId) return
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
