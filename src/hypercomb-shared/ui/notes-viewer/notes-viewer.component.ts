// hypercomb-shared/ui/notes-viewer/notes-viewer.component.ts
//
// Centred modal that shows one or more notes in a tabbed reader. Each
// tab carries a (cellLabel, noteId) pair; opening a new note appends a
// tab (or activates an existing one). Closing a tab removes it from
// the open set; emptying the set dismisses the whole viewer.
//
// All editing actions delegate back to the command line in capture
// mode — no in-place input here. That keeps every authoring path
// going through one place that knows about gold lighting and history
// commit.

import { Component, computed, effect, signal, type OnDestroy } from '@angular/core'
import { NgTemplateOutlet } from '@angular/common'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

type ShapeId = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'hexagon'

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

/** One open tab. Stored by id rather than by reference so re-resolves
 *  (after a notes:changed cascade) always read fresh content. */
type OpenTab = {
  readonly cellLabel: string
  readonly noteId: string
}

// Owner token for the InputGate lock held while the viewer is open. Owner-
// scoped so it composes with the editor / notes-strip / other overlay locks
// rather than stomping them.
const NOTES_VIEWER_LOCK_OWNER = 'notes-viewer'

/** Structural type for the InputGate — the shared tile-input lock. Resolved
 *  at runtime via window.ioc (shared must never import from modules). */
type InputGateLike = {
  lock(owner?: string): void
  unlock(owner?: string): void
}

@Component({
  selector: 'hc-notes-viewer',
  standalone: true,
  imports: [TranslatePipe, NgTemplateOutlet],
  templateUrl: './notes-viewer.component.html',
  styleUrls: ['./notes-viewer.component.scss'],
})
export class NotesViewerComponent implements OnDestroy {

  readonly openTabs = signal<readonly OpenTab[]>([])
  readonly activeIndex = signal<number>(0)
  readonly #version = signal(0)

  readonly visible = computed<boolean>(() => this.openTabs().length > 0)

  readonly activeTab = computed<OpenTab | null>(() => {
    const tabs = this.openTabs()
    const idx = this.activeIndex()
    return tabs[idx] ?? null
  })

  /** Find a note anywhere in a cell's tree by id (top-level OR
   *  nested). Used by the viewer's tab resolution so opening a child
   *  outline row creates a working tab even when the child only
   *  exists inside a parent's `children`. Returns null when not found
   *  (e.g., the note was deleted under us). */
  #findInTree(cellLabel: string, noteId: string): Note | null {
    const svc = this.#notes
    if (!svc) return null
    const walk = (nodes: readonly Note[]): Note | null => {
      for (const n of nodes) {
        if (n.id === noteId) return n
        const found = walk(n.children)
        if (found) return found
      }
      return null
    }
    return walk(svc.notesFor(cellLabel))
  }

  /** Resolved note for the active tab. Re-reads on every `notes:changed`
   *  cascade via the #version dep. Walks the tree so nested children
   *  (opened via the outline's child-click handler) resolve too. */
  readonly note = computed<Note | null>(() => {
    this.#version()
    const tab = this.activeTab()
    if (!tab) return null
    return this.#findInTree(tab.cellLabel, tab.noteId)
  })

  /** Resolved note text for each tab, for tab-strip previews. Truncated. */
  readonly tabLabels = computed<readonly { cellLabel: string; preview: string }[]>(() => {
    this.#version()
    return this.openTabs().map(tab => {
      const note = this.#findInTree(tab.cellLabel, tab.noteId)
      const raw = (note?.text ?? '').replace(/\s+/g, ' ').trim()
      const preview = raw.length > 28 ? raw.slice(0, 25) + '…' : raw || '(empty)'
      return { cellLabel: tab.cellLabel, preview }
    })
  })

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; noteId: string }>('notes:open', (p) => {
      if (!p?.cellLabel || !p?.noteId) return
      const existing = this.openTabs().findIndex(t =>
        t.cellLabel === p.cellLabel && t.noteId === p.noteId)
      if (existing >= 0) {
        this.activeIndex.set(existing)
      } else {
        const next = [...this.openTabs(), { cellLabel: p.cellLabel, noteId: p.noteId }]
        this.openTabs.set(next)
        this.activeIndex.set(next.length - 1)
      }
      // Announce visibility so the global escape cascade can close us
      // ahead of clearing selection. Without this, Escape falls through
      // to Priority 2 in escape-cascade.ts and the modal stays open.
      EffectBus.emit('notes:viewer', { active: true })
      // Warm the cell's notes cache so the active note's subtree is
      // hydrated when the outline renders. notesFor() reads sync from
      // the cache and would otherwise show only the children already
      // walked by other surfaces.
      const svc = this.#notes
      if (svc) void svc.getNotes(p.cellLabel).then(() => this.#version.update(v => v + 1))
    }))

    // Cascade calls this when Escape lands while the viewer is the
    // top-most dismissable surface. Close ONE tab per Escape — the
    // user can ESC repeatedly to peel notes off the stack. If only
    // one tab is open, closeTab dismisses the viewer entirely.
    this.#cleanups.push(EffectBus.on('notes:viewer-close', () => {
      if (this.visible()) this.closeTab(this.activeIndex())
    }))

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('notes:changed', async (p) => {
      const cellLabel = Array.isArray(p?.segments) && p!.segments!.length > 0
        ? String(p!.segments![p!.segments!.length - 1] ?? '').trim()
        : ''
      const svc = this.#notes
      if (svc && cellLabel) await svc.getNotes(cellLabel)
      this.#version.update(v => v + 1)
      // Drop tabs whose underlying notes were deleted by an external
      // write. Recompute active index so it doesn't dangle past the
      // new length. Tree-aware: a tab whose note moved into another
      // note's children must still resolve. (When a nest happens, the
      // ancestor's sig changes — the moved note keeps its own sig
      // unless its text/shape also changed.)
      const stillThere = this.openTabs().filter(tab => {
        return this.#findInTree(tab.cellLabel, tab.noteId) !== null
      })
      if (stillThere.length !== this.openTabs().length) {
        this.openTabs.set(stillThere)
        if (this.activeIndex() >= stillThere.length) {
          this.activeIndex.set(Math.max(0, stillThere.length - 1))
        }
        if (stillThere.length === 0) {
          EffectBus.emit('notes:viewer', { active: false })
        }
      }
    }))

    // Freeze tile navigation while the viewer is open — it's a centred modal
    // over the canvas, so per the "modals lock tiles while showing" rule no
    // pan/pinch/wheel-zoom/drag-select may bleed through. visible() is the
    // tracked dependency, so this re-runs on every open/close. The gate is
    // resolved lazily because its bee may register after this component
    // constructs on hypercomb-web. The [data-consumes-wheel] panel keeps the
    // note body scrollable.
    effect(() => {
      const gate = this.#gate()
      if (!gate) return
      if (this.visible()) gate.lock(NOTES_VIEWER_LOCK_OWNER)
      else gate.unlock(NOTES_VIEWER_LOCK_OWNER)
    })
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    // Release the tile lock on teardown — the visibility effect won't run a
    // final unlock once destroyed, so a viewer torn down while open would
    // otherwise leave the hexes locked.
    this.#gate()?.unlock(NOTES_VIEWER_LOCK_OWNER)
  }

  /** InputGate — the shared tile-input lock. Resolved at runtime (shared
   *  must never import from modules); returns undefined if its bee hasn't
   *  registered yet. */
  #gate(): InputGateLike | undefined {
    return window.ioc?.get<InputGateLike>('@diamondcoreprocessor.com/InputGate')
  }

  /** Close the entire viewer (all tabs). */
  close(): void {
    this.openTabs.set([])
    this.activeIndex.set(0)
    EffectBus.emit('notes:viewer', { active: false })
  }

  /** Close a single tab. If it's the last one, dismiss the viewer. */
  closeTab(index: number, event?: Event): void {
    event?.stopPropagation()
    const tabs = this.openTabs()
    if (index < 0 || index >= tabs.length) return
    const next = [...tabs.slice(0, index), ...tabs.slice(index + 1)]
    this.openTabs.set(next)
    if (next.length === 0) {
      this.activeIndex.set(0)
      EffectBus.emit('notes:viewer', { active: false })
      return
    }
    // Keep the active index pointing at the same VISUAL position when
    // possible: if we closed before the active tab, shift the index
    // down by one; if we closed the active tab, hold the index (which
    // now points at the next-rightward tab) and clamp.
    let nextIdx = this.activeIndex()
    if (index < nextIdx) nextIdx -= 1
    if (nextIdx >= next.length) nextIdx = next.length - 1
    this.activeIndex.set(Math.max(0, nextIdx))
  }

  setActive(index: number): void {
    if (index < 0 || index >= this.openTabs().length) return
    this.activeIndex.set(index)
  }

  /** Edit the active note — routes to command line in capture mode
   *  with a prefill. Closes the viewer (capture mode owns the UI).
   *  Passes the note's current shape so the strip can stage the
   *  active shape even when its #notesByCell cache hasn't warmed for
   *  the source cell (e.g., editing a note from a different cell's
   *  tab in the viewer's stack). */
  edit(): void {
    const tab = this.activeTab()
    const note = this.note()
    if (!tab || !note) return
    EffectBus.emit('note:capture', {
      cellLabel: tab.cellLabel,
      prefill: note.text,
      editId: note.id,
      shape: note.shape,
    })
    this.close()
  }

  /** Add another note to the active note's cell. */
  addAnother(): void {
    const tab = this.activeTab()
    if (!tab) return
    EffectBus.emit('note:capture', { cellLabel: tab.cellLabel })
    this.close()
  }

  /** Click a child row in the outline → open that child as its own
   *  tab in the viewer. The existing `notes:open` handler dedupes if
   *  the tab is already present. */
  openChild(noteId: string, event: Event): void {
    event.stopPropagation()
    const tab = this.activeTab()
    if (!tab || !noteId) return
    EffectBus.emit('notes:open', { cellLabel: tab.cellLabel, noteId })
  }

  /** Backdrop click → close everything. */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close()
  }

  /** Esc → close the active tab (cascades to close the viewer when
   *  the last tab is dismissed). */
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.closeTab(this.activeIndex())
    }
  }

  trackByTab = (_i: number, t: OpenTab): string => t.cellLabel + ':' + t.noteId

  // ── service resolution ──────────────────────────────────

  get #notes(): NotesService | undefined {
    return get('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
  }

  get i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }
}
