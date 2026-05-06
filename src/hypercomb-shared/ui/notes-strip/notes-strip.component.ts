// hypercomb-shared/ui/notes-strip/notes-strip.component.ts
//
// A slim horizontal strip rendered just below the command line that lists the
// notes for the currently active tile. Click a note to open the centred
// viewer; click the plus to enter capture mode for that tile. Collapses
// entirely when the active tile has no notes.

import { Component, computed, effect, signal, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/**
 * Cap on how many selected tiles the multi-select accordion will surface
 * at once. Large selections would otherwise flood the strip; the user's
 * most recent N picks are always the most relevant to current work.
 */
const MAX_VISIBLE_SELECTIONS = 10

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
  selected: ReadonlySet<string>
  count: number
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
   * Multi-selection mode: more than one tile is selected. Switches the
   * strip into accordion layout — one expandable section per selected
   * cell with its own notes. Stays active even while authoring (capture
   * mode) so the user can click a tab, drop the cursor into the command
   * line, and type a new note without losing the multi-cell view.
   */
  readonly multi = computed<boolean>(() => this.#selectedCells().length > 1)

  /**
   * Per-cell note groups for the accordion — ONLY cells that actually have
   * notes. Reads notes synchronously from NotesService — getNotes warmup at
   * boot already populated the cache; selection signals trigger #version
   * bumps via the notes:changed effect.
   */
  readonly groups = computed<readonly { cell: string; notes: readonly Note[]; expanded: boolean }[]>(() => {
    this.#version()
    const cells = this.#selectedCells()
    if (cells.length <= 1) return []
    const svc = this.#notes
    if (!svc) return []
    // Only the most-recent N selections show in the menu — large
    // selections would otherwise flood the strip and bury the cells the
    // user is actually working with.
    const recent = cells.slice(-MAX_VISIBLE_SELECTIONS)
    const withNotes = recent.filter(c => svc.notesFor(c).length > 0)
    const open = this.#openGroup()
    const closed = this.#userClosed()
    // Resolution order:
    //   1. If user explicitly collapsed everything, honour that — none open.
    //   2. If a specific group was opened and is still in the list, use it.
    //   3. Otherwise auto-pick the first group with notes so first-time
    //      multi-select shows something instead of an all-closed wall.
    const expanded = closed
      ? null
      : (open && withNotes.includes(open))
        ? open
        : withNotes[0] ?? null
    return withNotes.map(c => ({
      cell: c,
      notes: svc.notesFor(c),
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
    this.#version()
    const cells = this.#selectedCells()
    if (cells.length <= 1) return []
    const svc = this.#notes
    if (!svc) return []
    const warmed = this.#warmed()
    const recent = cells.slice(-MAX_VISIBLE_SELECTIONS)
    return recent.filter(c => warmed.has(c) && svc.notesFor(c).length === 0)
  })

  /**
   * The cell whose notes the strip is showing in single-tile mode — capture
   * target wins so the user always sees the strip for the tile they're
   * authoring against, even if they navigate selection away mid-capture.
   */
  readonly cell = computed<string | null>(() => this.#capturingFor() ?? this.#activeCell())

  /**
   * Visible whenever the active cell has notes, or the user is actively
   * authoring one, OR multi-selection has any cells with notes.
   */
  readonly visible = computed<boolean>(() => {
    if (this.#capturingFor()) return true
    if (this.multi()) {
      // Show whenever any selected cell has notes — emptyCells is only ever
      // shown alongside a populated accordion, never on its own.
      return this.groups().length > 0
    }
    return !!this.cell() && (this.notes().length > 0 || !!this.#capturingFor())
  })

  /** True when the strip is shown specifically because a note is being authored. */
  readonly capturing = computed<boolean>(() => !!this.#capturingFor())

  #cleanups: (() => void)[] = []
  #selectionListener: (() => void) | null = null

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
        this.#version.update(v => v + 1)
      }
      lineage.addEventListener('change', onLineage)
      this.#cleanups.push(() => lineage.removeEventListener('change', onLineage))
    }

    const selection = this.#selection
    if (selection) {
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

    this.#cleanups.push(EffectBus.on<{ segments?: readonly string[] }>('notes:changed', async (p) => {
      // HiveParticipant emits with `segments` only — derive the cell
      // label from the last segment. Warmup is already done by
      // NotesService at boot; no async pre-warm needed here.
      const cellLabel = Array.isArray(p?.segments) && p!.segments!.length > 0
        ? String(p!.segments![p!.segments!.length - 1] ?? '').trim()
        : ''
      const svc = this.#notes
      if (svc && cellLabel) await svc.getNotes(cellLabel)
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
      const svc = this.#notes
      if (!svc) return
      const targets = new Set<string>()
      const c = this.cell()
      if (c) targets.add(c)
      // Match the last-N cap that groups() / emptyCells() apply — no
      // point pre-warming cells the strip will never display.
      for (const cell of this.#selectedCells().slice(-MAX_VISIBLE_SELECTIONS)) targets.add(cell)
      if (targets.size === 0) return
      for (const target of targets) {
        if (this.#warmed().has(target)) continue
        void svc.getNotes(target).then(() => {
          this.#warmed.update(prev => {
            if (prev.has(target)) return prev
            const next = new Set(prev)
            next.add(target)
            return next
          })
          this.#version.update(v => v + 1)
        })
      }
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
    EffectBus.emit('note:capture', { cellLabel: cell })
  }

  /**
   * Click an empty-cell pill → start capture for that cell so the user can
   * author the first note. The cell will appear as a tab once the note is
   * committed.
   */
  captureForEmpty(cell: string): void {
    EffectBus.emit('note:capture', { cellLabel: cell })
  }

  /** Open a specific note from within an accordion group. */
  openInGroup(cell: string, noteId: string): void {
    EffectBus.emit('notes:open', { cellLabel: cell, noteId })
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
