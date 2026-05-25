// hypercomb-shared/ui/notes-strip/notes-strip.component.ts
//
// A slim horizontal strip rendered just below the command line that lists the
// notes for the currently active tile. Click a note to open the centred
// viewer; click the plus to enter capture mode for that tile. Collapses
// entirely when the active tile has no notes.

import { Component, ElementRef, computed, effect, signal, viewChild, type OnDestroy } from '@angular/core'
import { EffectBus, type I18nProvider } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

// MODULE-LOAD LOG — fires the moment this file is parsed, regardless of
// whether the component is ever rendered. If you don't see this in the
// console after a hard reload, the new bundle isn't being served.
console.log('[notes-strip] MODULE LOADED build=2026-05-05-accordion-update')

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
const NOTES_STRIP_HEIGHT_KEY = 'hc:notes-strip-height'

type Note = {
  id: string
  text: string
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
      cells.push(...this.#selectedCells().slice(-MAX_VISIBLE_SELECTIONS))
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
  readonly multi = computed<boolean>(() => this.#selectedCells().length > 1)

  /**
   * Per-cell note groups for the accordion — ONLY cells that actually have
   * notes. Reads notes synchronously from NotesService — getNotes warmup at
   * boot already populated the cache; selection signals trigger #version
   * bumps via the notes:changed effect.
   */
  readonly groups = computed<readonly { cell: string; notes: readonly Note[]; expanded: boolean }[]>(() => {
    const cells = this.#selectedCells()
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
    const cells = this.#selectedCells()
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
    // Build identification log — if you don't see this in the console after
    // a hard reload, the new bundle isn't running. Bumping the tag below
    // forces a visible signal on every meaningful change to this component.
    console.log('[notes-strip] build=2026-05-05-accordion-update boot')

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
      console.log('[notes-strip] wiring SelectionService, active=', selection.active)
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
    this.#cleanups.push(EffectBus.on<{ mode: string; target: string }>('command:enter-mode', (p) => {
      if (p?.mode === 'note-capture' && p.target) this.#capturingFor.set(p.target)
    }))
    this.#cleanups.push(EffectBus.on<{ mode: string }>('command:exit-mode', (p) => {
      if (p?.mode === 'note-capture') this.#capturingFor.set(null)
    }))

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
      // point pre-warming cells the strip will never display.
      for (const cell of this.#selectedCells().slice(-MAX_VISIBLE_SELECTIONS)) targets.add(cell)
      if (targets.size === 0) return
      for (const target of targets) {
        if (this.#warmed().has(target)) continue
        console.log('[notes-strip] warmup start', target)
        // Warm both sources in parallel so the strip surfaces the full
        // comm transcript (Claude's questions + user notes) in a single
        // render pass, not two.
        void Promise.all([
          svc.getNotes(target),
          this.#loadQaFor(target),
        ]).then(([notes, qa]) => {
          console.log('[notes-strip] warmup done', target, 'notes=', notes.length, 'qa=', qa.length)
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
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#observingEl = null
    // Safety: ensure we never leave a 'notes-hover' mode pushed on the
    // stack if the component is destroyed mid-hover (e.g. selection
    // change triggers re-render while cursor is over the strip).
    this.#popNotesMode()
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
    let width: string | null = null
    let height: string | null = null
    try {
      width = localStorage.getItem(NOTES_STRIP_WIDTH_KEY)
      height = localStorage.getItem(NOTES_STRIP_HEIGHT_KEY)
    } catch { /* private mode / quota — ignore, fall back to CSS defaults */ }
    // Suppress the observer's first-callback so the restoration itself
    // doesn't get re-written to storage (the contentRect after our set
    // matches what we just wrote anyway, but skipping avoids the round-trip).
    this.#applyingDimensions = true
    if (width && /^\d+$/.test(width)) el.style.width = `${width}px`
    if (height && /^\d+$/.test(height)) el.style.height = `${height}px`
    queueMicrotask(() => { this.#applyingDimensions = false })
  }

  #observePanelResize(el: HTMLElement): void {
    let savePending = false
    this.#resizeObserver = new ResizeObserver((entries) => {
      if (this.#applyingDimensions) return
      if (savePending) return
      savePending = true
      requestAnimationFrame(() => {
        savePending = false
        const entry = entries[entries.length - 1]
        if (!entry) return
        const w = Math.round(entry.contentRect.width)
        const h = Math.round(entry.contentRect.height)
        try {
          localStorage.setItem(NOTES_STRIP_WIDTH_KEY, String(w))
          localStorage.setItem(NOTES_STRIP_HEIGHT_KEY, String(h))
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
   */
  open(noteId: string): void {
    const cell = this.#activeCell()
    if (!cell) return
    const note = this.#notesByCell().get(cell)?.find(n => n.id === noteId)
    if (note && this.noteKind(note) === 'q') {
      EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
      return
    }
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

  /** Header "hide" button — collapse the strip for the current selection.
   *  Re-shows automatically when the user selects a different tile (the
   *  context key changes and the saved hidden context no longer matches). */
  hide(): void {
    this.#hiddenContext.set(this.#contextKey())
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
    const note = this.#notesByCell().get(cell)?.find(n => n.id === noteId)
    if (note && this.noteKind(note) === 'q') {
      EffectBus.emit('tile:action', { action: 'edit', label: cell, q: 0, r: 0, index: 0 })
      return
    }
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
