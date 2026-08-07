// hypercomb-shared/ui/notes-viewer/notes-viewer.component.ts
//
// THE NOTES READER — one tile's notes, read as hexagons.
//
// The strip is for AUTHORING (a dense tree you edit in place). This is for
// READING: one note at a time, big, with its place in the tree shown around
// it. Three moves, and only three:
//
//   • SIDE TABS pick the HIERARCHY. A hierarchy is one ROOT note plus
//     everything nested under it — a tile with four root notes has four
//     tabs, each its own little document.
//   • PREV / NEXT walk the notes INSIDE that hierarchy, depth-first, and
//     WRAP at both ends. There is no first and no last; the cycle closes.
//     Running off the end is how you get back to the top, not a dead stop.
//   • Clicking any row in the outline jumps the focus straight there.
//
// Pheromones land here by DRAG. Open the Pheromones panel from the header
// and drag a keyword onto any row: the row advertises itself with
// `data-pheromone-note`, the panel's existing drag-out gesture spots it on
// release, and the keyword goes onto the NOTE (not the tile). Notes carry
// their own `tags` slot for exactly this — see notes.drone.ts.
//
// Editing still delegates to the command line in capture mode. This surface
// reads and marks; it never grows its own text input.

import { registerShellSurface } from '../../core/shell-surface-registry'
import { Component, computed, effect, signal, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HcWidgetDirective } from '../widget-zoom/hc-widget.directive'
import { holdWindow, type WindowSession } from '../window-session'
import { flattenHierarchy, stepIndex } from './note-cycle'

type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

type Note = {
  id: string
  text: string
  shape: ShapeId | null
  /** Material icon name from the mark palette; supersedes `shape`. */
  mark: string | null
  /** Pheromones on the note itself. Older services predate the slot, so
   *  every read goes through `tagsOf()` rather than touching it directly. */
  tags?: string[]
  children: Note[]
}

type NotesService = {
  notesFor(cellLabel: string): Note[]
  getNotes(cellLabel: string): Promise<Note[]>
}

/** One row of the flattened hierarchy — the unit prev/next steps through. */
type Row = {
  readonly note: Note
  readonly depth: number
}

@Component({
  selector: 'hc-notes-viewer',
  standalone: true,
  imports: [TranslatePipe, HcWidgetDirective],
  templateUrl: './notes-viewer.component.html',
  styleUrls: ['./notes-viewer.component.scss'],
})
export class NotesViewerComponent implements OnDestroy {

  /** The tile being read. Null = the reader is closed. */
  readonly cell = signal<string | null>(null)
  /** Which root note (= which hierarchy) the side rail has selected. */
  readonly hierarchyIndex = signal(0)
  /** Which row inside that hierarchy the big hexagon is showing. */
  readonly focusIndex = signal(0)
  /** True while the Pheromones panel is open, so the card can step aside
   *  and leave the right-hand dock reachable for a drag. */
  readonly pheromonesOpen = signal(false)

  readonly #version = signal(0)

  readonly visible = computed<boolean>(() => this.cell() !== null)

  /** The tile's ROOT notes. Each one is a hierarchy: itself plus its
   *  descendants. Re-reads on every `notes:changed` cascade. */
  readonly hierarchies = computed<readonly Note[]>(() => {
    this.#version()
    const cell = this.cell()
    if (!cell) return []
    return this.#notes?.notesFor(cell) ?? []
  })

  readonly activeRoot = computed<Note | null>(() => {
    const roots = this.hierarchies()
    if (roots.length === 0) return null
    return roots[Math.min(this.hierarchyIndex(), roots.length - 1)] ?? null
  })

  /** The active hierarchy flattened depth-first — parent, then its
   *  children in order, recursively. This IS the reading order, and the
   *  order prev/next cycles. */
  readonly rows = computed<readonly Row[]>(() => flattenHierarchy(this.activeRoot()))

  /** The note in the big hexagon. Index is clamped rather than trusted:
   *  a cascade can shrink the hierarchy under a held focus. */
  readonly focused = computed<Row | null>(() => {
    const rows = this.rows()
    if (rows.length === 0) return null
    return rows[Math.min(this.focusIndex(), rows.length - 1)] ?? null
  })

  /** 1-based position for the "3 / 11" readout next to prev/next. */
  readonly focusPosition = computed<number>(() => {
    const rows = this.rows()
    return rows.length === 0 ? 0 : Math.min(this.focusIndex(), rows.length - 1) + 1
  })

  /** Side-rail entries — one per hierarchy, previewed by its root's text. */
  readonly tabs = computed<readonly { mark: string | null; shape: ShapeId | null; preview: string; count: number }[]>(() =>
    this.hierarchies().map(root => ({
      mark: root.mark,
      shape: root.shape,
      preview: preview(root.text),
      count: countNotes(root),
    })),
  )

  #cleanups: (() => void)[] = []

  /** The tile being read, held while the hive is covered by the installer.
   *  The reader's whole visibility is `cell !== null`, so parking is "put the
   *  tile down, remember which one" — and the rail's hierarchy + the row in
   *  the big hexagon come back with it. */
  #parkedCell: string | null = null

  readonly session: WindowSession = {
    park: () => {
      this.#parkedCell = this.cell()
      this.cell.set(null)
      EffectBus.emit('notes:viewer', { active: false })
    },
    unpark: () => {
      const cell = this.#parkedCell
      this.#parkedCell = null
      if (!cell) return
      this.cell.set(cell)
      EffectBus.emit('notes:viewer', { active: true })
    },
  }

  /** In the session's "showing" set exactly while the reader is up. */
  #releaseSession: (() => void) | null = null

  constructor() {
    // Joining and leaving the window session IS opening and closing, and the
    // reader opens from several places (`notes:open`, a landing, a cascade) —
    // so it is tracked off the visibility itself rather than at each door.
    effect(() => {
      const showing = this.visible()
      if (showing && !this.#releaseSession) this.#releaseSession = holdWindow('notes-viewer', this.session)
      else if (!showing && this.#releaseSession) { this.#releaseSession(); this.#releaseSession = null }
    })

    // `noteId` is optional. With one, the reader opens ON that note —
    // selecting the hierarchy that contains it and focusing its row.
    // Without one, it opens on the first note of the first hierarchy.
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; noteId?: string }>('notes:open', (p) => {
      const cellLabel = String(p?.cellLabel ?? '').trim()
      if (!cellLabel) return
      this.cell.set(cellLabel)
      // Announce visibility so the global escape cascade can close us ahead
      // of clearing selection. Without this, Escape falls through to
      // Priority 2 in escape-cascade.ts and the reader stays open.
      EffectBus.emit('notes:viewer', { active: true })
      const svc = this.#notes
      // Warm the cache so the whole subtree is hydrated before we locate
      // the requested note — notesFor() reads sync and would otherwise see
      // only the nodes some other surface happened to have walked.
      const land = (): void => {
        this.#version.update(v => v + 1)
        this.#landOn(p?.noteId)
      }
      if (svc) void svc.getNotes(cellLabel).then(land, land)
      else land()
    }))

    // Cascade calls this when Escape lands while the reader is the top-most
    // dismissable surface.
    this.#cleanups.push(EffectBus.on('notes:viewer-close', () => {
      if (this.visible()) this.close()
    }))

    this.#cleanups.push(EffectBus.on<{ open?: boolean }>('tags:view-state', (p) => {
      this.pheromonesOpen.set(p?.open === true)
    }))

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('notes:changed', async (p) => {
      const cell = this.cell()
      if (!cell) return
      const changed = Array.isArray(p?.segments) && p!.segments!.length > 0
        ? String(p!.segments![p!.segments!.length - 1] ?? '').trim()
        : ''
      // A write ANYWHERE re-reads: a tag drop rewrites the note's sig, so
      // holding the old id would strand the focus on a note that no longer
      // exists. Re-reading by POSITION is what keeps the reader steady
      // across an edit — the note at row 3 is still the note at row 3.
      if (changed && changed !== cell) return
      const svc = this.#notes
      if (svc) await svc.getNotes(cell)
      this.#version.update(v => v + 1)
      // The tile may have lost every note under us.
      if (this.hierarchies().length === 0) this.close()
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  /** Point the rail + focus at `noteId`, or at the very first note when
   *  it isn't given (or has already been rewritten out of existence). */
  #landOn(noteId?: string): void {
    const roots = this.hierarchies()
    if (roots.length === 0) return
    if (noteId) {
      for (let h = 0; h < roots.length; h++) {
        const flat: Note[] = []
        const walk = (n: Note): void => { flat.push(n); n.children.forEach(walk) }
        walk(roots[h]!)
        const idx = flat.findIndex(n => n.id === noteId)
        if (idx >= 0) {
          this.hierarchyIndex.set(h)
          this.focusIndex.set(idx)
          return
        }
      }
    }
    this.hierarchyIndex.set(0)
    this.focusIndex.set(0)
  }

  // ── Navigation ──────────────────────────────────────────

  /** Pick a hierarchy. The focus resets to its root — a new document
   *  starts at the top, not wherever the last one happened to be. */
  selectHierarchy(index: number): void {
    if (index < 0 || index >= this.hierarchies().length) return
    this.hierarchyIndex.set(index)
    this.focusIndex.set(0)
  }

  /** Step the focus. WRAPS in both directions — this is a cycle, not a
   *  list with ends, so `next` on the last note lands on the first and
   *  `prev` on the first lands on the last. Both buttons stay live at
   *  every position; there is nothing to disable. (`stepIndex` is where
   *  the wrap arithmetic and its tests live — note-cycle.ts.) */
  step(delta: number): void {
    const n = this.rows().length
    if (n === 0) return
    this.focusIndex.set(stepIndex(this.focusIndex(), delta, n))
  }

  next(): void { this.step(1) }
  prev(): void { this.step(-1) }

  /** Click a row in the outline → focus it. */
  focusRow(index: number): void {
    if (index < 0 || index >= this.rows().length) return
    this.focusIndex.set(index)
  }

  // ── Pheromones ──────────────────────────────────────────

  /** Notes written before the `tags` slot existed simply have none. */
  tagsOf(note: Note | null | undefined): readonly string[] {
    return Array.isArray(note?.tags) ? note!.tags! : []
  }

  /** Open (or close) the Pheromones panel next to the reader. Dragging a
   *  keyword out of it onto a row is what puts it on a note; the panel's
   *  own drag-out gesture does the work, and the rows advertise
   *  themselves with `data-pheromone-note`. */
  togglePheromones(): void {
    EffectBus.emit(this.pheromonesOpen() ? 'tags:view-close' : 'tags:view-open', {})
  }

  /** Take one pheromone off the focused note (the chip's ×). */
  removeTag(tag: string, event?: Event): void {
    event?.stopPropagation()
    const cellLabel = this.cell()
    const noteId = this.focused()?.note.id
    if (!cellLabel || !noteId) return
    EffectBus.emit('note:tag', { cellLabel, noteId, tag, add: false })
  }

  // ── Editing (delegated) ─────────────────────────────────

  /** Edit the focused note — routes to the command line in capture mode
   *  with a prefill, and closes the reader (capture mode owns the UI). */
  edit(): void {
    const cellLabel = this.cell()
    const note = this.focused()?.note
    if (!cellLabel || !note) return
    EffectBus.emit('note:capture', {
      cellLabel,
      prefill: note.text,
      editId: note.id,
      shape: note.shape,
    })
    this.close()
  }

  /** Add another note to this tile. */
  addAnother(): void {
    const cellLabel = this.cell()
    if (!cellLabel) return
    EffectBus.emit('note:capture', { cellLabel })
    this.close()
  }

  close(): void {
    this.cell.set(null)
    this.hierarchyIndex.set(0)
    this.focusIndex.set(0)
    EffectBus.emit('notes:viewer', { active: false })
  }

  /** Backdrop click → close. */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close()
  }

  /** Arrow keys walk the cycle; Escape closes. Arrows are the reading
   *  gesture here — nothing in this surface takes text. */
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      this.next()
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.prev()
    }
  }

  trackByRow = (index: number, row: Row): string => row.note.id + ':' + index

  // ── service resolution ──────────────────────────────────

  get #notes(): NotesService | undefined {
    return get('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
  }

  get i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }
}

/** One-line preview of a note's text for the side rail. */
function preview(text: string): string {
  const raw = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return '(empty)'
  return raw.length > 34 ? raw.slice(0, 31) + '…' : raw
}

/** How many notes a hierarchy holds, root included — the rail's badge. */
function countNotes(note: Note): number {
  let n = 1
  for (const child of note.children) n += countNotes(child)
  return n
}

// Registry-fed shell surface — mounted by <hc-shell-surfaces>, never by an
// app.html tag (see shell-surface-registry.ts).
registerShellSurface({
  name: 'hc-notes-viewer',
  owner: '@hypercomb.shared/NotesViewerComponent',
  component: NotesViewerComponent,
  order: 100,
})
