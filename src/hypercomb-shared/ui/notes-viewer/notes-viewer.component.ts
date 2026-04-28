// hypercomb-shared/ui/notes-viewer/notes-viewer.component.ts
//
// Centred modal that shows one note in full, with affordances for editing
// the text, attaching/detaching tags, and adding another note to the same
// tile. All editing actions delegate back to the command line in capture
// mode — no in-place input here. That keeps every authoring path going
// through one place that knows about gold lighting and history commit.

import { Component, computed, signal, type OnDestroy } from '@angular/core'
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

type TagRegistry = {
  names: string[]
}

@Component({
  selector: 'hc-notes-viewer',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './notes-viewer.component.html',
  styleUrls: ['./notes-viewer.component.scss'],
})
export class NotesViewerComponent implements OnDestroy {

  readonly visible = signal(false)
  readonly cellLabel = signal<string | null>(null)
  readonly noteId = signal<string | null>(null)
  readonly #version = signal(0)
  readonly tagPickerOpen = signal(false)

  readonly note = computed<Note | null>(() => {
    this.#version()
    const cell = this.cellLabel()
    const id = this.noteId()
    if (!cell || !id) return null
    const svc = this.#notes
    return svc?.notesFor(cell).find(n => n.id === id) ?? null
  })

  readonly availableTags = computed<readonly string[]>(() => {
    this.#version()
    const registry = get('@hypercomb.social/TagRegistry') as TagRegistry | undefined
    const all = registry?.names ?? []
    const current = new Set(this.note()?.tags ?? [])
    return all.filter(t => !current.has(t)).sort()
  })

  readonly currentTags = computed<readonly string[]>(() => this.note()?.tags ?? [])

  #cleanups: (() => void)[] = []

  constructor() {
    this.#cleanups.push(EffectBus.on<{ cellLabel: string; noteId: string }>('notes:open', (p) => {
      if (!p?.cellLabel || !p?.noteId) return
      this.cellLabel.set(p.cellLabel)
      this.noteId.set(p.noteId)
      this.tagPickerOpen.set(false)
      this.visible.set(true)
    }))

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('notes:changed', async (p) => {
      const cellLabel = Array.isArray(p?.segments) && p!.segments!.length > 0
        ? String(p!.segments![p!.segments!.length - 1] ?? '').trim()
        : ''
      const svc = this.#notes
      if (svc && cellLabel) await svc.getNotes(cellLabel)
      this.#version.update(v => v + 1)
      // close if the open note was deleted by an external write
      if (this.visible() && !this.note()) this.close()
    }))
  }

  ngOnDestroy(): void {
    for (const c of this.#cleanups) c()
  }

  close(): void {
    this.visible.set(false)
    this.tagPickerOpen.set(false)
    this.cellLabel.set(null)
    this.noteId.set(null)
  }

  /** Edit the open note — routes to command line in capture mode with a prefill. */
  edit(): void {
    const cell = this.cellLabel()
    const note = this.note()
    if (!cell || !note) return
    EffectBus.emit('note:capture', { cellLabel: cell, prefill: note.text, editId: note.id })
    this.close()
  }

  /** Add another note to the same tile. */
  addAnother(): void {
    const cell = this.cellLabel()
    if (!cell) return
    EffectBus.emit('note:capture', { cellLabel: cell })
    this.close()
  }

  toggleTagPicker(): void {
    this.tagPickerOpen.update(v => !v)
  }

  attachTag(tag: string): void {
    const cell = this.cellLabel()
    const note = this.note()
    if (!cell || !note) return
    EffectBus.emit('note:tag', { cellLabel: cell, noteId: note.id, tag })
    this.tagPickerOpen.set(false)
  }

  detachTag(tag: string): void {
    const cell = this.cellLabel()
    const note = this.note()
    if (!cell || !note) return
    EffectBus.emit('note:tag', { cellLabel: cell, noteId: note.id, tag, remove: true })
  }

  /** Backdrop click → close. */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close()
  }

  /** Esc → close. Bound on the modal. */
  onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
    }
  }

  formatDate(ts: number): string {
    try {
      return new Date(ts).toLocaleString()
    } catch {
      return ''
    }
  }

  trackTag = (_i: number, tag: string): string => tag

  // ── service resolution ──────────────────────────────────

  get #notes(): NotesService | undefined {
    return get('@diamondcoreprocessor.com/NotesService') as NotesService | undefined
  }

  get i18n(): I18nProvider | undefined {
    return get('@hypercomb.social/I18n') as I18nProvider | undefined
  }
}
