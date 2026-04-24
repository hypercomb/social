// hypercomb-shared/ui/history-viewer/history-viewer.component.ts
//
// Left-edge panel listing every layer entry for the current location.
// Each row shows:
//  - the index / timestamp
//  - a diff summary describing what changed vs. the previous entry
//  - a category color indicating the dominant kind of change
//
// Clicking a row seeks the HistoryCursor to that entry.

import { AfterViewInit, Component, ElementRef, computed, effect, inject, signal, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus, IconRef, type IconRef as IconRefType } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { HistoryMenuPack } from '../selection-context-menu/history-menu-pack'
import { IconComponent } from '../icon/icon.component'

type CursorState = {
  locationSig: string
  position: number
  total: number
  rewound: boolean
  at: number
}

type LayerEntry = { layerSig: string; at: number; index: number; filename: string }

// Loose shape for the layer content. We only read fields we care about
// and tolerate missing ones — older layers may have been written with a
// sparse canonicaliser.
type Content = {
  cells?: string[]
  hidden?: string[]
  contentByCell?: Record<string, string>
  tagsByCell?: Record<string, string[]>
  notesByCell?: Record<string, string>
  bees?: string[]
  dependencies?: string[]
  layoutSig?: string
  instructionsSig?: string
}

type HistoryService = {
  listLayers(locationSig: string): Promise<LayerEntry[]>
  promoteToHead?(locationSig: string, layerSig: string): Promise<string | null>
  removeEntries?(locationSig: string, filenames: string[]): Promise<number>
  mergeEntries?(locationSig: string, filenames: string[]): Promise<string | null>
  pruneExpiredDeletes?(locationSig: string): Promise<number>
}
type CursorService = {
  state: CursorState
  seek(position: number): void
}
type Store = {
  getResource(sig: string): Promise<Blob | null>
}

type Category = 'cells' | 'content' | 'tags' | 'notes' | 'visibility' | 'system' | 'none'

type Row = {
  index: number
  at: number
  label: string
  when: string
  active: boolean
  summary: string
  category: Category
  filename: string
}

// Category taxonomy, decorated with an optional IconRef. Adding a new
// op-kind is just appending a row here — the renderer pulls the icon
// through <hc-icon> without caring whether it's an inline path or a
// signature-backed resource.
type CategoryDef = {
  readonly id: Category
  readonly color: string
  readonly icon?: IconRefType
}

const HISTORY_CATEGORIES: readonly CategoryDef[] = [
  { id: 'cells',      color: '#6dc077', icon: IconRef.path('M12 2 L21 7 V17 L12 22 L3 17 V7 Z') },
  { id: 'content',    color: '#5f8bd9', icon: IconRef.path('M3 21 V17 L15 5 L19 9 L7 21 Z M16 4 L18 2 L22 6 L20 8 Z') },
  { id: 'tags',       color: '#d9c25f', icon: IconRef.path('M3 3 H12 L21 12 L12 21 L3 12 Z M7 7 a1.5 1.5 0 1 0 0.01 0') },
  { id: 'notes',      color: '#b37dd4', icon: IconRef.path('M4 3 H15 L20 8 V21 H4 Z M15 3 V8 H20') },
  { id: 'visibility', color: '#b1b7c2', icon: IconRef.path('M2 12 C5 6 8 4 12 4 C16 4 19 6 22 12 C19 18 16 20 12 20 C8 20 5 18 2 12 Z M12 8 a4 4 0 1 0 0.01 0') },
  { id: 'system',     color: '#e08c4d', icon: IconRef.path('M10 2 H14 L14.5 5 L17 6 L19 4 L22 7 L20 9.5 L21 12 L22 14.5 L19 17 L17 15 L14.5 16 L14 19 H10 L9.5 16 L7 15 L5 17 L2 14 L4 12 L3 9.5 L2 7 L5 4 L7 6 L9.5 5 Z M12 9 a3 3 0 1 0 0.01 0') },
  { id: 'none',       color: 'rgba(255, 255, 255, 0.18)' },
]

const CATEGORY_BY_ID: ReadonlyMap<Category, CategoryDef> = new Map(
  HISTORY_CATEGORIES.map(def => [def.id, def]),
)

const FILTERS_STORAGE_KEY = 'hc:history-filters'

// Stored shape is a list of *disabled* categories. That way adding a
// new category to the taxonomy later defaults to visible rather than
// silently hidden for existing users.
function loadDisabledFilters(): ReadonlySet<Category> {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as { disabled?: Category[] } | null
    return new Set(parsed?.disabled ?? [])
  } catch {
    return new Set()
  }
}

function saveDisabledFilters(disabled: ReadonlySet<Category>): void {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ disabled: [...disabled] }))
  } catch { /* storage unavailable */ }
}

// Panel width is global, not per-location: the user resizes once and
// the same width applies everywhere. Null = untouched (CSS default
// takes over — panel grows to fit content). A number = sticky pixel
// width set by the user via drag.
const WIDTH_STORAGE_KEY = 'hc:history-viewer-width'

function loadCustomWidth(): number | null {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (!raw) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function saveCustomWidth(width: number | null): void {
  try {
    if (width == null) localStorage.removeItem(WIDTH_STORAGE_KEY)
    else localStorage.setItem(WIDTH_STORAGE_KEY, String(width))
  } catch { /* storage unavailable */ }
}

@Component({
  selector: 'hc-history-viewer',
  standalone: true,
  imports: [TranslatePipe, IconComponent],
  templateUrl: './history-viewer.component.html',
  styleUrls: ['./history-viewer.component.scss'],
})
export class HistoryViewerComponent implements OnInit, OnDestroy, AfterViewInit {

  #entries = signal<readonly LayerEntry[]>([])
  #contents = signal<ReadonlyMap<string, Content>>(new Map())
  #position = signal(0)
  #total = signal(0)
  #locationSig = signal('')

  readonly visible = HistoryMenuPack.visible
  readonly total = this.#total.asReadonly()
  readonly position = this.#position.asReadonly()

  // Sticky category filter. Stores *disabled* categories so a new
  // category added to the taxonomy later defaults to visible for
  // existing users. Persisted to localStorage.
  #disabledFilters = signal<ReadonlySet<Category>>(loadDisabledFilters())

  readonly categoryDef = (category: Category): CategoryDef =>
    CATEGORY_BY_ID.get(category) ?? HISTORY_CATEGORIES[HISTORY_CATEGORIES.length - 1]

  readonly isCategoryEnabled = (category: Category): boolean =>
    !this.#disabledFilters().has(category)

  readonly toggleCategory = (category: Category): void => {
    const next = new Set(this.#disabledFilters())
    if (next.has(category)) next.delete(category)
    else next.add(category)
    this.#disabledFilters.set(next)
    saveDisabledFilters(next)
  }

  // Layer-slice inspector modal. When non-null, a centered overlay is
  // rendered showing the selected layer entry. `lines` is the raw JSON
  // split into line-level diff rows vs the previous entry's JSON:
  // status=`same` lines render plain, `add` lines highlight green,
  // `remove` lines red with a strikethrough. The very first entry has
  // no previous so every line lands as `add`.
  #sliceOpen = signal<{
    label: string
    lines: ReadonlyArray<{ text: string; status: 'same' | 'add' | 'remove' }>
  } | null>(null)
  readonly sliceOpen = this.#sliceOpen.asReadonly()

  // Multi-select — set of entry filenames the user has checked via
  // Cmd/Ctrl-click (toggle) or Shift-click (range). Non-empty set
  // reveals the merge / make-head action buttons on the filter bar
  // right side. Bare click still seeks the cursor; only modifier
  // clicks participate in selection, so the default navigation flow
  // is untouched.
  #selected = signal<ReadonlySet<string>>(new Set())
  readonly selected = this.#selected.asReadonly()
  readonly selectedCount = computed(() => this.#selected().size)
  readonly isRowSelected = (filename: string): boolean => this.#selected().has(filename)

  // Last-clicked filename powers shift-click range selection — the
  // selection extends from this anchor to the newly-clicked row.
  #lastSelectionAnchor: string | null = null

  // All rows in the current layer, categorised. This is the authoritative
  // list; the visible rows (post-filter) and the filter bar entries are
  // both derived from it.
  readonly #allRows = computed<readonly Row[]>(() => {
    const entries = this.#entries()
    const contents = this.#contents()
    const position = this.#position()

    const rows: Row[] = []
    let previousContent: Content | undefined = undefined
    entries.forEach((entry, i) => {
      const content = contents.get(entry.layerSig)
      if (!content) return
      const { summary, category } = summarise(previousContent, content)
      previousContent = content
      rows.push({
        index: i,
        at: entry.at,
        label: `#${i + 1}`,
        when: new Date(entry.at).toLocaleTimeString(),
        active: position - 1 === i,
        summary,
        category,
        filename: entry.filename,
      })
    })
    return rows
  })

  readonly rows = computed<readonly Row[]>(() => {
    const all = this.#allRows()
    const disabled = this.#disabledFilters()
    const filtered = disabled.size === 0
      ? all.slice()
      : all.filter(row => !disabled.has(row.category))
    return filtered.reverse() // newest first
  })

  // Filter bar is data-driven: one toggle per distinct category that
  // actually appears in this layer's rows. New op-kinds in the layer
  // surface as new icons in the menu; pruning the layer prunes the
  // menu. Order follows the taxonomy in HISTORY_CATEGORIES so the bar
  // stays stable across mutations.
  readonly filterCategories = computed<readonly CategoryDef[]>(() => {
    const present = new Set<Category>()
    for (const row of this.#allRows()) present.add(row.category)
    return HISTORY_CATEGORIES.filter(def => def.icon && present.has(def.id))
  })

  #unsub: (() => void) | null = null
  #loadSeq = 0
  readonly #el: ElementRef<HTMLElement> = inject(ElementRef)
  #resizeObserver: ResizeObserver | null = null

  // User-chosen width in px, sticky across locations. Null = auto (panel
  // grows to fit content on first open). Persisted in localStorage so
  // resizing once keeps the preference across reloads. Applied as an
  // explicit inline style only when non-null so the CSS `width: max-content`
  // default can still take over for users who've never resized.
  #customWidth = signal<number | null>(loadCustomWidth())
  readonly customWidth = this.#customWidth.asReadonly()
  #resizing: { startX: number; startWidth: number } | null = null

  constructor() {
    // When the panel becomes visible, refresh entries + contents. Done
    // as an effect rather than a simple ngOnInit call so the panel
    // re-hydrates on re-activation (user hides then re-enters history).
    // Also toggles the body-level `hc-history-mode` class — the global
    // stylesheet (installed in ngAfterViewInit) uses that class to
    // shift the canvas/main UI rightward so the viewer has a dedicated
    // column on the left instead of overlapping the stage.
    effect(() => {
      const body = document.body
      if (this.visible()) {
        body.classList.add('hc-history-mode')
        void this.#reload()
      } else {
        body.classList.remove('hc-history-mode')
      }
    })

    // Whenever the cursor position changes (undo/redo/seek), scroll
    // the newly-active row into view so the user always sees where
    // they are in the list.
    effect(() => {
      // Read the signal so the effect re-runs when it changes.
      const _p = this.#position()
      void _p
      queueMicrotask(() => {
        const host = this.#el.nativeElement as HTMLElement
        const active = host.querySelector('.row.active') as HTMLElement | null
        active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    })

    // Keep the --hc-history-column-width CSS variable in lockstep
    // with the panel's actual rendered width so #pixi-host narrows
    // (and the canvas re-sizes via its ResizeObserver) to match the
    // sidebar exactly. The aside lives inside `@if (visible())` —
    // it's torn down and re-created on every show/hide — so the
    // observer is reattached here every time visibility flips true.
    // queueMicrotask defers past the DOM commit for this tick.
    effect(() => {
      if (!this.visible()) return
      queueMicrotask(() => {
        const host = this.#el.nativeElement as HTMLElement
        const aside = host.querySelector('.history-viewer') as HTMLElement | null
        if (!aside) return
        this.#resizeObserver?.disconnect()
        if ('ResizeObserver' in window) {
          this.#resizeObserver = new ResizeObserver(() => {
            const w = Math.max(aside.offsetWidth, 0)
            document.body.style.setProperty('--hc-history-column-width', `${w}px`)
          })
          this.#resizeObserver.observe(aside)
        }
        // Prime the variable immediately so the canvas shift lands
        // on the first paint, not one ResizeObserver tick later.
        document.body.style.setProperty('--hc-history-column-width', `${aside.offsetWidth}px`)
      })
    })
  }

  ngAfterViewInit(): void {
    // Portal the host element directly to document.body. This escapes
    // every ancestor stacking context in <app-root>'s subtree — the
    // viewer must sit in the top-level stacking order regardless of
    // how the rest of the app arranges its overlays. Done in
    // ngAfterViewInit (not ngOnInit) so the host DOM node exists
    // before we try to move it.
    const host = this.#el.nativeElement as HTMLElement
    if (host && host.parentNode !== document.body) {
      document.body.appendChild(host)
    }
    // Inject the one-off stylesheet that gives the viewer its own
    // column by shifting the canvas and main UI rightward while
    // history mode is active. Everything stays fully interactive —
    // we're reshaping the layout, not intercepting events.
    installHistoryColumnStylesheet()
  }

  ngOnInit(): void {
    this.#unsub = EffectBus.on<CursorState>('history:cursor-changed', (s) => {
      if (!s) return
      const locationChanged = s.locationSig !== this.#locationSig()
      // A new layer was appended at head while the viewer is open —
      // the cursor reports a larger total than we have rows for. Reload
      // so the new entry appears instead of only the count bumping.
      const entriesGrew = s.total !== this.#entries().length
      this.#position.set(s.position)
      this.#total.set(s.total)
      if (locationChanged) this.#locationSig.set(s.locationSig)
      if ((locationChanged || entriesGrew) && this.visible()) void this.#reload()
    })
  }

  ngOnDestroy(): void {
    this.#unsub?.()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    // Best-effort: if the host was portaled, remove it from body so we
    // don't leave a dangling node behind after the component tears down.
    const host = this.#el.nativeElement
    if (host && host.parentNode === document.body) {
      document.body.removeChild(host)
    }
  }

  /**
   * Row click: with no modifier the cursor seeks, as before. Cmd/Ctrl
   * toggles the row's presence in the selection set. Shift selects
   * the range between the last-anchored row and this one. Plain
   * seek clears the selection so navigation after an accidental
   * multi-select feels natural.
   */
  readonly onRowClick = (row: Row, event: MouseEvent): void => {
    if (event.shiftKey && this.#lastSelectionAnchor !== null) {
      this.#selectRange(this.#lastSelectionAnchor, row.filename)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      this.#toggleSelection(row.filename)
      this.#lastSelectionAnchor = row.filename
      return
    }
    // bare click: navigate + reset selection
    if (this.#selected().size > 0) this.#selected.set(new Set())
    this.#lastSelectionAnchor = row.filename
    this.seek(row.index)
  }

  readonly seek = (index: number): void => {
    const cursor = this.#cursor()
    if (!cursor) return
    cursor.seek(index + 1) // cursor positions are 1-based
  }

  #toggleSelection(filename: string): void {
    const next = new Set(this.#selected())
    if (next.has(filename)) next.delete(filename)
    else next.add(filename)
    this.#selected.set(next)
  }

  #selectRange(fromFilename: string, toFilename: string): void {
    // Use the current #allRows ordering (oldest → newest) so shift-click
    // spans match the semantic order regardless of the display reverse.
    const all = this.#allRows()
    const a = all.findIndex(r => r.filename === fromFilename)
    const b = all.findIndex(r => r.filename === toFilename)
    if (a < 0 || b < 0) return
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    const next = new Set(this.#selected())
    for (let i = lo; i <= hi; i++) next.add(all[i].filename)
    this.#selected.set(next)
  }

  /**
   * Fold selected layers' content into a new head entry (the latest
   * selected layer's content becomes the new head), leaving sources
   * intact. No deletion. Clears selection on success.
   */
  readonly makeHeadSelection = async (): Promise<void> => {
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.promoteToHead || !cursor) return
    const sel = this.#selected()
    if (sel.size === 0) return
    // pick the chronologically newest selected row's layerSig
    const all = this.#allRows()
    let newestFilename: string | null = null
    let newestAt = -Infinity
    for (const row of all) {
      if (!sel.has(row.filename)) continue
      if (row.at > newestAt) { newestAt = row.at; newestFilename = row.filename }
    }
    if (!newestFilename) return
    const entry = this.#entries().find(e => e.filename === newestFilename)
    if (!entry) return
    await history.promoteToHead(cursor.state.locationSig, entry.layerSig)
    this.#selected.set(new Set())
    this.#lastSelectionAnchor = null
    await this.#reload()
    cursor.seek(this.#total())
  }

  /**
   * Merge: same as makeHeadSelection, but also soft-deletes all the
   * selected source entries. Net effect: one new row at top, selected
   * sources disappear from the active list (still restorable from
   * __deleted__ for 30 days).
   */
  readonly mergeSelection = async (): Promise<void> => {
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.mergeEntries || !cursor) return
    const sel = this.#selected()
    if (sel.size === 0) return
    await history.mergeEntries(cursor.state.locationSig, [...sel])
    this.#selected.set(new Set())
    this.#lastSelectionAnchor = null
    await this.#reload()
    cursor.seek(this.#total())
  }

  readonly openSlice = (index: number, event: Event): void => {
    event.stopPropagation()
    const entries = this.#entries()
    const entry = entries[index]
    if (!entry) return
    const contents = this.#contents()
    const content = contents.get(entry.layerSig)
    if (!content) return

    // Diff vs the previous entry (chronologically just before this one)
    // so the inspector shows what actually changed at this step. The
    // first entry has no predecessor — all lines highlight as `add`.
    const prevEntry = index > 0 ? entries[index - 1] : null
    const prevContent = prevEntry ? contents.get(prevEntry.layerSig) : null
    const nextJson = JSON.stringify(content, Object.keys(content).sort(), 2)
    const prevJson = prevContent ? JSON.stringify(prevContent, Object.keys(prevContent).sort(), 2) : ''
    const lines = diffLines(prevJson.split('\n'), nextJson.split('\n'))

    const when = new Date(entry.at).toLocaleString()
    this.#sliceOpen.set({
      label: `#${index + 1} · ${when} · ${entry.layerSig.slice(0, 12)}…`,
      lines,
    })
  }

  readonly closeSlice = (): void => {
    this.#sliceOpen.set(null)
  }

  readonly hide = (): void => {
    HistoryMenuPack.onHide()
  }

  /**
   * Begin a drag-resize of the panel from its right edge. The handle
   * captures the pointer so the drag follows even when the cursor
   * leaves the handle bounds. Width is clamped to [MIN, viewport - 60]
   * so a runaway drag can't hide the canvas entirely.
   */
  readonly startResize = (event: PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const aside = (event.currentTarget as HTMLElement).parentElement as HTMLElement | null
    if (!aside) return
    const startWidth = aside.offsetWidth
    this.#resizing = { startX: event.clientX, startWidth }
    const target = event.currentTarget as HTMLElement
    try { target.setPointerCapture(event.pointerId) } catch { /* best effort */ }

    const onMove = (e: PointerEvent): void => {
      if (!this.#resizing) return
      const dx = e.clientX - this.#resizing.startX
      const next = Math.round(this.#resizing.startWidth + dx)
      const max = Math.max(HISTORY_COLUMN_MIN, window.innerWidth - 60)
      const clamped = Math.max(HISTORY_COLUMN_MIN, Math.min(max, next))
      this.#customWidth.set(clamped)
    }
    const onUp = (e: PointerEvent): void => {
      try { target.releasePointerCapture(e.pointerId) } catch { /* best effort */ }
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      // Persist only on release — not on every pixel of movement — so
      // localStorage writes don't thrash during a drag.
      saveCustomWidth(this.#customWidth())
      this.#resizing = null
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  /**
   * Per-row "make head" — append a new entry at the top that points at
   * this row's layer, without touching the rest of the list. The cursor
   * follows to the new head so the canvas reflects the promoted state.
   */
  readonly promoteRow = async (index: number, event: Event): Promise<void> => {
    event.stopPropagation()
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.promoteToHead || !cursor) return
    const entry = this.#entries()[index]
    if (!entry) return
    await history.promoteToHead(cursor.state.locationSig, entry.layerSig)
    await this.#reload()
    cursor.seek(this.#total())
  }

  /**
   * Per-row delete — soft-delete a single entry into __deleted__/. The
   * entry is restorable from there for 30 days. If the cursor was
   * pointing at the removed entry, we nudge it to the nearest neighbour
   * so the canvas doesn't freeze on a dead position.
   */
  readonly deleteRow = async (index: number, event: Event): Promise<void> => {
    event.stopPropagation()
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.removeEntries || !cursor) return
    const entry = this.#entries()[index]
    if (!entry) return
    await history.removeEntries(cursor.state.locationSig, [entry.filename])
    await this.#reload()
    const nextTotal = this.#total()
    if (cursor.state.position > nextTotal) cursor.seek(nextTotal)
  }

  #cursor(): CursorService | null {
    return window.ioc.get<CursorService>('@diamondcoreprocessor.com/HistoryCursorService') ?? null
  }
  #history(): HistoryService | null {
    return window.ioc.get<HistoryService>('@diamondcoreprocessor.com/HistoryService') ?? null
  }
  #store(): Store | null {
    return window.ioc.get<Store>('@hypercomb.social/Store') ?? null
  }

  async #reload(): Promise<void> {
    const seq = ++this.#loadSeq
    const cursor = this.#cursor()
    const history = this.#history()
    const store = this.#store()
    if (!cursor || !history || !store) return

    const locationSig = cursor.state.locationSig
    this.#locationSig.set(locationSig)
    const entries = await history.listLayers(locationSig)
    if (seq !== this.#loadSeq) return

    // Layer content is signature-addressed, so once a sig is resolved
    // the content is immutable for the session — reuse the existing
    // cache and only fetch sigs we haven't loaded yet.
    const existing = this.#contents()
    const unknown = Array.from(new Set(
      entries.map(e => e.layerSig).filter(sig => !existing.has(sig)),
    ))

    let nextContents: ReadonlyMap<string, Content> = existing
    if (unknown.length > 0) {
      const pairs = await Promise.all(unknown.map(async (sig) => {
        try {
          const blob = await store.getResource(sig)
          if (!blob) return [sig, null] as const
          const parsed = JSON.parse(await blob.text()) as Content
          return [sig, parsed] as const
        } catch {
          return [sig, null] as const
        }
      }))
      if (seq !== this.#loadSeq) return

      const merged = new Map(existing)
      for (const [sig, content] of pairs) {
        if (content) merged.set(sig, content)
      }
      nextContents = merged
    }

    // Commit all signals together after contents are ready so rows
    // never render with (loading) placeholders for entries that only
    // just appeared in the list.
    this.#contents.set(nextContents)
    this.#entries.set(entries)
    this.#position.set(cursor.state.position)
    this.#total.set(cursor.state.total)
  }
}

// ─────────────────────────────────────────────────────────────────────
// Inject a one-off stylesheet that reserves a 216px column on the
// left for the history viewer while `body.hc-history-mode` is set,
// and shifts the Pixi stage + main UI bars out of its way. The viewer
// itself stays position:fixed in that column — this just keeps the
// rest of the app from overlapping it.
// ─────────────────────────────────────────────────────────────────────

const HISTORY_COLUMN_MIN = 240
let columnStyleInjected = false
function installHistoryColumnStylesheet(): void {
  if (columnStyleInjected) return
  columnStyleInjected = true
  const style = document.createElement('style')
  style.setAttribute('data-hc-history-column', '')
  style.textContent = `
    body {
      --hc-history-column-width: ${HISTORY_COLUMN_MIN}px;
    }
    body.hc-history-mode #pixi-host {
      left: var(--hc-history-column-width) !important;
      width: calc(100% - var(--hc-history-column-width)) !important;
    }
    /* header-bar intentionally NOT shifted — it lives above the
       sidebar (which starts below it via top: 3.2rem), so the
       command line stays full-width at the top left instead of
       getting pushed right by the sidebar column. */
  `
  document.head.appendChild(style)
}

// ─────────────────────────────────────────────────────────────────────
// Line-level diff for the slice inspector.
//
// Classic LCS over the two line arrays — O(m*n) time and space. Layer
// JSON is typically a few dozen lines so this is effectively free and
// produces the readable visual expected for add/remove highlighting
// (interleaved in original order, not added-then-removed).
// ─────────────────────────────────────────────────────────────────────

function diffLines(
  a: readonly string[],
  b: readonly string[],
): Array<{ text: string; status: 'same' | 'add' | 'remove' }> {
  const m = a.length, n = b.length
  // dp[i][j] = LCS length of a[0..i] and b[0..j]
  const dp: number[][] = new Array(m + 1)
  for (let i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const out: Array<{ text: string; status: 'same' | 'add' | 'remove' }> = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.unshift({ text: a[i - 1], status: 'same' }); i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.unshift({ text: a[i - 1], status: 'remove' }); i--
    } else {
      out.unshift({ text: b[j - 1], status: 'add' }); j--
    }
  }
  while (i > 0) { out.unshift({ text: a[i - 1], status: 'remove' }); i-- }
  while (j > 0) { out.unshift({ text: b[j - 1], status: 'add' }); j-- }
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Diff summariser. Kept local to this component so the shared UI has
// no runtime dependency on essentials. Categorises the dominant kind
// of change between two layers so the viewer can color-code the row.
// ─────────────────────────────────────────────────────────────────────

function summarise(prev: Content | undefined, next: Content | undefined): { summary: string; category: Category } {
  if (!next) return { summary: '(loading)', category: 'none' }
  const p: Required<Content> = normalise(prev)
  const n: Required<Content> = normalise(next)

  // cells: track set diff and reorder (same set, different order)
  const cellAdded = difference(n.cells, p.cells)
  const cellRemoved = difference(p.cells, n.cells)
  const cellReordered =
    cellAdded.length === 0 &&
    cellRemoved.length === 0 &&
    !sequenceEqual(n.cells, p.cells)
  const hiddenChanged = xorSet(n.hidden, p.hidden).size > 0
  const contentChanged = !recordEqual(n.contentByCell, p.contentByCell)
  const tagsChanged = !recordArrayEqual(n.tagsByCell, p.tagsByCell)
  const notesChanged = !recordEqual(n.notesByCell, p.notesByCell)
  const beesChanged = xorSet(new Set(n.bees), new Set(p.bees)).size > 0
  const depsChanged = xorSet(new Set(n.dependencies), new Set(p.dependencies)).size > 0
  const layoutChanged = n.layoutSig !== p.layoutSig
  const instructionsChanged = n.instructionsSig !== p.instructionsSig

  const parts: string[] = []
  let category: Category = 'none'

  if (cellAdded.length) {
    parts.push(cellAdded.length === 1 ? `+${cellAdded[0]}` : `+${cellAdded.length} tiles`)
    category = 'cells'
  }
  if (cellRemoved.length) {
    parts.push(cellRemoved.length === 1 ? `-${cellRemoved[0]}` : `-${cellRemoved.length} tiles`)
    category = 'cells'
  }
  if (cellReordered) {
    parts.push(describeReorder(p.cells, n.cells))
    if (category === 'none') category = 'cells'
  }
  if (contentChanged) {
    parts.push(describeRecordChange('edit', p.contentByCell, n.contentByCell))
    if (category === 'none') category = 'content'
  }
  if (tagsChanged) {
    parts.push(describeRecordChange('tags', p.tagsByCell, n.tagsByCell))
    if (category === 'none') category = 'tags'
  }
  if (notesChanged) {
    parts.push(describeRecordChange('notes', p.notesByCell, n.notesByCell))
    if (category === 'none') category = 'notes'
  }
  if (hiddenChanged) {
    parts.push(describeHiddenChange(p.hidden, n.hidden))
    if (category === 'none') category = 'visibility'
  }
  if (layoutChanged) { parts.push('layout'); if (category === 'none') category = 'system' }
  if (instructionsChanged) { parts.push('instructions'); if (category === 'none') category = 'system' }
  if (beesChanged || depsChanged) { parts.push(beesChanged && depsChanged ? 'bees+deps' : beesChanged ? 'bees' : 'deps'); if (category === 'none') category = 'system' }

  if (parts.length === 0) return { summary: '(no change)', category: 'none' }
  return { summary: parts.join(' · '), category }
}

function describeRecordChange(
  verb: string,
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): string {
  const changed = new Set<string>()
  for (const key of Object.keys(next)) {
    if (!recordValueEqual(previous[key], next[key])) changed.add(key)
  }
  for (const key of Object.keys(previous)) {
    if (!(key in next)) changed.add(key)
  }
  const labels = [...changed]
  if (labels.length === 0) return verb
  if (labels.length === 1) return `${verb} ${labels[0]}`
  if (labels.length <= 3) return `${verb} ${labels.join(', ')}`
  return `${verb} ${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

function describeHiddenChange(previous: readonly string[], next: readonly string[]): string {
  const added = difference(next, previous)
  const removed = difference(previous, next)
  if (added.length && !removed.length) return added.length === 1 ? `hide ${added[0]}` : `hide ${added.length} tiles`
  if (removed.length && !added.length) return removed.length === 1 ? `show ${removed[0]}` : `show ${removed.length} tiles`
  return 'visibility'
}

function describeReorder(previous: readonly string[], next: readonly string[]): string {
  const moved: string[] = []
  for (let i = 0; i < next.length; i++) {
    if (previous[i] !== next[i]) moved.push(next[i])
  }
  if (moved.length === 0) return 'reorder'
  if (moved.length === 1) return `move ${moved[0]}`
  return `reorder (${moved.length} tiles)`
}

function recordValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  return false
}

function normalise(c: Content | undefined): Required<Content> {
  return {
    cells: c?.cells ?? [],
    hidden: c?.hidden ?? [],
    contentByCell: c?.contentByCell ?? {},
    tagsByCell: c?.tagsByCell ?? {},
    notesByCell: c?.notesByCell ?? {},
    bees: c?.bees ?? [],
    dependencies: c?.dependencies ?? [],
    layoutSig: c?.layoutSig ?? '',
    instructionsSig: c?.instructionsSig ?? '',
  }
}

function difference<T>(a: readonly T[], b: readonly T[]): T[] {
  const bs = new Set(b)
  return a.filter(x => !bs.has(x))
}

function sequenceEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function xorSet<T>(a: ReadonlySet<T> | readonly T[], b: ReadonlySet<T> | readonly T[]): Set<T> {
  const aSet = a instanceof Set ? a : new Set(a)
  const bSet = b instanceof Set ? b : new Set(b)
  const out = new Set<T>()
  for (const v of aSet) if (!bSet.has(v)) out.add(v)
  for (const v of bSet) if (!aSet.has(v)) out.add(v)
  return out
}

function recordEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) if (a[k] !== b[k]) return false
  return true
}

function recordArrayEqual(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    const av = a[k]
    const bv = b[k]
    if (!bv || av.length !== bv.length) return false
    for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false
  }
  return true
}
