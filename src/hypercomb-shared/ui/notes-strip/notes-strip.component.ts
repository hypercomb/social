// hypercomb-shared/ui/notes-strip/notes-strip.component.ts
//
// A slim horizontal strip rendered just below the command line that lists the
// notes for the currently active tile. Click a note to open the centred
// viewer; click the plus to enter capture mode for that tile. Collapses
// entirely when the active tile has no notes.

import { Component, computed, effect, signal, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

type Note = {
  id: string
  text: string
  createdAt: number
  updatedAt?: number
  tags?: string[]
}

type NotesService = {
  notesFor(cellLabel: string): Note[]
  getNotes(cellLabel: string): Promise<Note[]>
}

type SelectionService = EventTarget & {
  active: string | null
}

@Component({
  selector: 'hc-notes-strip',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './notes-strip.component.html',
  styleUrls: ['./notes-strip.component.scss'],
})
export class NotesStripComponent implements OnDestroy {

  readonly #activeCell = signal<string | null>(null)
  readonly #capturingFor = signal<string | null>(null)
  readonly #version = signal(0)

  /**
   * Display mode — `chips` is the horizontal scrolling chip row, `rows` is
   * the vertical stack (better for long sentence-style rules). Persisted
   * per user; defaults to `rows` so longer note text reads naturally.
   */
  readonly mode = signal<'chips' | 'rows'>(
    (localStorage.getItem('hc:notes-strip-mode') as 'chips' | 'rows' | null) ?? 'rows'
  )

  readonly notes = computed<readonly Note[]>(() => {
    this.#version()
    const cell = this.cell()
    if (!cell) return []
    const svc = this.#notes
    if (!svc) return []
    return svc.notesFor(cell)
  })

  /**
   * The cell whose notes the strip is showing — capture target wins so the
   * user always sees the strip for the tile they're authoring against, even
   * if they navigate selection away mid-capture.
   */
  readonly cell = computed<string | null>(() => this.#capturingFor() ?? this.#activeCell())

  /**
   * Visible whenever the active cell has notes, or the user is actively
   * authoring one against that cell. An empty list with no capture in
   * progress stays hidden — nothing useful to show yet.
   */
  readonly visible = computed<boolean>(() =>
    !!this.cell() && (this.notes().length > 0 || !!this.#capturingFor())
  )

  /** True when the strip is shown specifically because a note is being authored. */
  readonly capturing = computed<boolean>(() => !!this.#capturingFor())

  #cleanups: (() => void)[] = []
  #selectionListener: (() => void) | null = null

  constructor() {
    const selection = this.#selection
    if (selection) {
      this.#activeCell.set(selection.active)
      const handler = (): void => this.#activeCell.set(selection.active)
      selection.addEventListener('change', handler)
      this.#selectionListener = () => selection.removeEventListener('change', handler)
    }

    this.#cleanups.push(EffectBus.on<{ cellLabel: string }>('notes:changed', async (p) => {
      // ensure the warm cache is populated before bumping the version signal
      const svc = this.#notes
      if (svc && p?.cellLabel) await svc.getNotes(p.cellLabel)
      this.#version.update(v => v + 1)
    }))

    // Track command-line capture state so the strip pops in for the target
    // tile while authoring — even when that tile has no notes yet.
    this.#cleanups.push(EffectBus.on<{ mode: string; target: string }>('command:enter-mode', (p) => {
      if (p?.mode === 'note-capture' && p.target) this.#capturingFor.set(p.target)
    }))
    this.#cleanups.push(EffectBus.on<{ mode: string }>('command:exit-mode', (p) => {
      if (p?.mode === 'note-capture') this.#capturingFor.set(null)
    }))

    // Warm the decoded-set cache whenever the tracked cell changes so the
    // list shows its existing notes on first open (cache is empty until the
    // set resource is actually parsed).
    effect(() => {
      const c = this.cell()
      if (!c) return
      const svc = this.#notes
      if (!svc) return
      void svc.getNotes(c).then(() => this.#version.update(v => v + 1))
    })
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
    this.#selectionListener?.()
  }

  /** Click a note row → open the viewer modal centred on this note. */
  open(noteId: string): void {
    const cell = this.#activeCell()
    if (!cell) return
    EffectBus.emit('notes:open', { cellLabel: cell, noteId })
  }

  /** Plus button → enter capture mode in the command line. */
  add(): void {
    const cell = this.cell()
    if (!cell) return
    EffectBus.emit('note:capture', { cellLabel: cell })
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

  /** Delete a single note from the active cell's list. */
  remove(noteId: string, event: Event): void {
    console.log('[notes-strip] × clicked', { noteId, cell: this.cell() })
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
