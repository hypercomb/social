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
  groupStepEnabled?: boolean
}

type LayerEntry = { layerSig: string; at: number; index: number; filename: string }

// Layer shape: `name` (intrinsic) plus an open bag of slots, each
// holding an array of sigs or inline payloads. The viewer is slot-
// agnostic — it renders every non-empty slot the layer carries
// (children, notes, tags, future participants).
type Content = {
  name?: string
  [slot: string]: unknown
}

type HistoryService = {
  /** Cheap list of marker filenames in the bag — names only, no parse.
   *  Reflection contract: this is the canonical "what files exist right
   *  now in __history__/<SB>/" view. Called fresh on every reload. */
  listMarkerFilenames?(locationSig: string): Promise<readonly string[]>
  /** Resolve one marker by filename — bytes, parsed JSON (or null if
   *  unparseable), and sig. Cached at the viewer by filename, so this
   *  fires at most once per (bag, filename) pair per session. */
  readMarker?(locationSig: string, filename: string): Promise<{
    bytes: ArrayBuffer
    parsed: Content | null
    layerSig: string
    at: number
    rawText: string
  } | null>
  /** Legacy path — kept for back-compat callers. Viewer prefers
   *  listMarkerFilenames + readMarker. */
  listLayers(locationSig: string): Promise<LayerEntry[]>
  getLayerContent?(locationSig: string, layerSig: string): Promise<Content | null>
  /** Cross-bag layer lookup by content sig. Hits the parsed-/preloader-/
   *  optimized-bytes caches in O(1); falls back to preloadAllBags on a
   *  cold miss. The drill-down click uses this so the user can walk into
   *  any layer the system has minted, not just same-bag siblings of the
   *  origin slice. */
  getLayerBySig?(layerSig: string): Promise<Content | null>
  promoteToHead?(locationSig: string, layerSig: string): Promise<string | null>
  removeEntries?(locationSig: string, filenames: string[]): Promise<number>
  mergeEntries?(locationSig: string, filenames: string[]): Promise<string | null>
  /** Compute the projected merged layer for preview without writing. */
  projectMerge?(locationSig: string, filenames: string[]): Promise<Content | null>
  pruneExpiredDeletes?(locationSig: string): Promise<number>
}
type CursorService = {
  state: CursorState
  seek(position: number): void
  setGroupStepEnabled?(on: boolean): void
  // Bag-mutating ops in this viewer (promote / merge / remove) bypass
  // LayerCommitter, so the cursor never hears about the new/dropped
  // marker on its own. Without a refresh, cursor.state.total stays
  // stale and a follow-up seek(total) is a no-op (same position →
  // early return → no synchronize → canvas doesn't repaint).
  refreshForLocation?(locationSig: string): Promise<void>
  onNewLayer?(): Promise<void>
}
type Store = {
  getResource(sig: string): Promise<Blob | null>
}

type Category = 'cells' | 'content' | 'tags' | 'notes' | 'visibility' | 'system' | 'none'

type Slice = {
  label: string
  lines: ReadonlyArray<{ text: string; status: 'same' | 'add' | 'remove' }>
  /** Raw JSON of the layer at this slice — copy button source. */
  json: string
}

type Row = {
  index: number
  at: number
  label: string
  when: string
  active: boolean
  summary: string
  category: Category
  filename: string
  // A cascade row is a layer entry whose only delta is a 1-for-1 child
  // sig swap on a single slot — the structural fingerprint of lineage
  // pull-up (a downstream change rippling into this layer). User-
  // originated entries are pure adds, removes, or content edits and so
  // never produce this shape on a parent layer. Used to collapse
  // contiguous cascade runs in the viewer.
  isCascade: boolean
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

// No persistence. Every time the panel becomes visible the disabled
// filter set is reset to empty — the user always lands on "show
// every marker in the bag" first. Persisting "what I hid last time"
// silently hides rows from the bag, which violates the "panel is a
// perfect reflection of the sigbag" contract: the user reopens the
// panel, header says "history 5", but 4 rows are gone because a
// stale filter from last session is still active. Starting clean
// every session removes that failure mode entirely. Filters during
// a session still work — they just don't persist across visibility
// toggles.

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
  // Filename-keyed cache: `${locationSig}:${filename}` → resolved
  // marker content (parsed JSON, bytes, sig, timestamp). Markers are
  // immutable once written, so cache entries never need invalidation
  // — once you've read a (bag, filename) pair, that result stays
  // valid for the session. Re-listing the bag picks up new filenames
  // without re-reading the ones you already have.
  #contentByFilename = signal<ReadonlyMap<string, {
    bytes: ArrayBuffer
    parsed: Content | null
    layerSig: string
    at: number
    rawText: string
  } | null>>(new Map())
  #position = signal(0)
  #total = signal(0)
  #locationSig = signal('')
  #groupStepEnabled = signal(false)

  readonly visible = HistoryMenuPack.visible
  readonly total = this.#total.asReadonly()
  readonly position = this.#position.asReadonly()
  readonly groupStepEnabled = this.#groupStepEnabled.asReadonly()

  readonly toggleGroupStep = (): void => {
    const cursor = this.#cursor()
    if (!cursor?.setGroupStepEnabled) return
    cursor.setGroupStepEnabled(!this.#groupStepEnabled())
    // Cursor emits via EffectBus; the subscriber below picks it up.
  }

  // Disabled-filter set. Reset to empty every time the panel becomes
  // visible — no persistence. User can toggle categories off during a
  // session; the next time they open the panel they start fresh with
  // every marker visible. See the comment block above
  // FILTERS_STORAGE_KEY for the rationale.
  #disabledFilters = signal<ReadonlySet<Category>>(new Set())

  readonly categoryDef = (category: Category): CategoryDef =>
    CATEGORY_BY_ID.get(category) ?? HISTORY_CATEGORIES[HISTORY_CATEGORIES.length - 1]

  readonly isCategoryEnabled = (category: Category): boolean =>
    !this.#disabledFilters().has(category)

  readonly toggleCategory = (category: Category): void => {
    const next = new Set(this.#disabledFilters())
    if (next.has(category)) next.delete(category)
    else next.add(category)
    this.#disabledFilters.set(next)
  }

  // Layer-slice inspector modal. The stack lets the user drill into
  // sig references found inside a layer's JSON without losing the
  // history-row context they came from. The TOP of the stack is what
  // renders; a back button (visible when length > 1) pops one level.
  // Closing the modal clears the stack entirely.
  //
  // Each slice carries:
  //  - label: short header text identifying the layer or resource
  //  - lines: line-level diff rows (vs the prior entry for the root
  //           slice, all `add` for drilled-in slices since there's no
  //           prior to compare against in the new lineage)
  //  - json:  raw JSON at this slice — copy-button source
  //
  // The stack-based design fixes the user-visible disconnect where an
  // undo's effect lived in a child layer the row didn't reflect: now
  // they can click any sig in the diff and walk into it.
  #sliceStack = signal<readonly Slice[]>([])
  readonly sliceStack = this.#sliceStack.asReadonly()
  readonly sliceCurrent = computed(() => this.#sliceStack().at(-1) ?? null)
  readonly canSliceBack = computed(() => this.#sliceStack().length > 1)
  /** Briefly true after a successful copy so the button can flash feedback. */
  readonly sliceCopied = signal(false)

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
      const { summary, category, isCascade } = summarise(previousContent, content)
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
        isCascade,
      })
    })
    return rows
  })

  readonly rows = computed<readonly Row[]>(() => {
    const all = this.#allRows()
    const disabled = this.#disabledFilters()
    // Cascade rows are hidden by default — they're 1-for-1 sig swaps
    // produced by lineage pull-up (a child layer's bytes changed, the
    // ancestor re-commits with the new sig in its `children` slot).
    // They aren't user-initiated actions and don't carry meaning the
    // user wants in the timeline; they just show "the merkle tree
    // rippled." Filtering them out leaves only the edits that came
    // from user intent. The bag itself still holds every marker —
    // hiding cascades is a display-layer concern, not a write-side
    // one. To see every marker (including cascades) inspect the bag
    // directly via the dev tooling.
    const withoutCascades = all.filter(row => !row.isCascade)
    const filtered = disabled.size === 0
      ? withoutCascades
      : withoutCascades.filter(row => !disabled.has(row.category))
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
        // Reset filters every time the panel opens. A persisted
        // disabled set could silently hide rows that ARE in the bag,
        // which violates the "perfect reflection" contract. Always
        // start from "show every marker."
        this.#disabledFilters.set(new Set())
        // Clear any stale localStorage key from older builds that
        // persisted filters across sessions. One-time cleanup; the
        // current code never writes this key. Wrap in try because
        // localStorage may be unavailable in some contexts.
        try { localStorage.removeItem('hc:history-filters') } catch { /* ignore */ }
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
      this.#groupStepEnabled.set(!!s.groupStepEnabled)
      if (locationChanged) this.#locationSig.set(s.locationSig)
      if ((locationChanged || entriesGrew) && this.visible()) void this.#reload()
    })
    // Prime the signal from the cursor's current state — the EffectBus
    // subscription above replays the last-emitted value, but only if
    // the cursor has emitted at least once. On first open, read directly.
    const cursor = this.#cursor()
    if (cursor) this.#groupStepEnabled.set(!!cursor.state.groupStepEnabled)
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
    await this.#refreshCursor(cursor)
    this.#selected.set(new Set())
    this.#lastSelectionAnchor = null
    await this.#reload()
    cursor.seek(this.#total())
  }

  // Merge preview state — populated by openMergePreview, cleared by
  // closeMergePreview / commitMergePreview. While non-null the modal
  // renders. `sourceCount` lets the modal label "X selected".
  #mergePreview = signal<{
    lines: ReadonlyArray<{ text: string; status: 'add' }>
    sourceCount: number
  } | null>(null)
  readonly mergePreview = this.#mergePreview.asReadonly()
  /** True while the merge commit is in flight — disables the button. */
  readonly mergeCommitting = signal(false)

  /**
   * Compute the projected merged layer for the current selection and
   * open the preview modal. Triggered from the header when N ≥ 2 rows
   * are selected. Read-only — no marker is written until the user
   * clicks commit.
   */
  readonly openMergePreview = async (): Promise<void> => {
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.projectMerge || !cursor) return
    const sel = this.#selected()
    if (sel.size < 2) return
    const projected = await history.projectMerge(cursor.state.locationSig, [...sel])
    if (!projected) return
    const lines = layerToDiffableLines(projected).map(text => ({ text, status: 'add' as const }))
    this.#mergePreview.set({ lines, sourceCount: sel.size })
  }

  readonly closeMergePreview = (): void => {
    this.#mergePreview.set(null)
    this.mergeCommitting.set(false)
  }

  /**
   * Commit the projected merge. Calls mergeEntries to write the unioned
   * layer as a fresh head marker (sources are preserved — cherry-pick
   * semantics). Closes the preview, clears selection, and seeks the
   * cursor to the new head so the canvas reflects the merged state.
   */
  readonly commitMergePreview = async (): Promise<void> => {
    const history = this.#history()
    const cursor = this.#cursor()
    if (!history?.mergeEntries || !cursor) return
    const sel = this.#selected()
    if (sel.size < 2) return
    this.mergeCommitting.set(true)
    try {
      await history.mergeEntries(cursor.state.locationSig, [...sel])
      await this.#refreshCursor(cursor)
      this.#selected.set(new Set())
      this.#lastSelectionAnchor = null
      this.#mergePreview.set(null)
      await this.#reload()
      cursor.seek(this.#total())
    } finally {
      this.mergeCommitting.set(false)
    }
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
    //
    // Critical: the diff is SET-BASED for children, not position-based.
    // When a sibling moves from last to middle in the array its JSON
    // line text changes (`"sig"` → `"sig",`) under naive line-diff,
    // making a verbatim-preserved sibling look like a remove+add. We
    // serialise to a normalised format where each sig is its own
    // sortable line with no trailing-comma artefacts, so unchanged
    // siblings always align as `same` regardless of position changes.
    const prevEntry = index > 0 ? entries[index - 1] : null
    const prevContent = prevEntry ? contents.get(prevEntry.layerSig) : null
    const nextJson = JSON.stringify(content, Object.keys(content).sort(), 2)
    const prevLines = prevContent ? layerToDiffableLines(prevContent) : []
    const nextLines = layerToDiffableLines(content)
    const lines = diffLines(prevLines, nextLines)

    const when = new Date(entry.at).toLocaleString()
    this.#sliceStack.set([{
      label: `#${index + 1} · ${when} · ${entry.layerSig.slice(0, 12)}…`,
      lines,
      json: nextJson,
    }])
    this.sliceCopied.set(false)
  }

  readonly closeSlice = (): void => {
    this.#sliceStack.set([])
    this.sliceCopied.set(false)
  }

  /**
   * Pop the top slice off the stack so the previous one re-appears.
   * No-op when the stack has 0 or 1 entries (back is hidden in that
   * state anyway, but we guard here too in case the call comes via
   * keyboard or programmatic source).
   */
  readonly sliceBack = (): void => {
    const stack = this.#sliceStack()
    if (stack.length <= 1) return
    this.#sliceStack.set(stack.slice(0, -1))
    this.sliceCopied.set(false)
  }

  /**
   * Detect whether a diff line is a clickable sig reference. A sig is
   * a 64-char lowercase hex string; the line may have leading spaces
   * (the layerToDiffableLines indents children sigs with 4 spaces) and
   * an optional trailing comma. Returns the bare sig if the line
   * matches the shape, null otherwise. Template uses this to decide
   * whether to render the line as an interactive `<span>`.
   */
  readonly lineSig = (text: string): string | null => {
    const trimmed = text.trim().replace(/,$/, '')
    return /^[0-9a-f]{64}$/.test(trimmed) ? trimmed : null
  }

  /**
   * Resolve a sig and push a new slice for it onto the stack. The
   * drilled slice has no diff context (there's no adjacent-entry
   * comparison to make), so every line renders as `add` — visually
   * "this is what's in here".
   *
   * Resolution chain:
   *  1. history.getLayerContent(currentLocationSig, sig) — covers
   *     child-cell sigs that live in the current lineage's bag.
   *     This is the typical case: a layer's `children` array holds
   *     sibling-layer sigs in the same bag, and that's what users
   *     want to walk into. Tried first because pure resource lookup
   *     wouldn't find them — they're inside __history__/{loc}/, not
   *     __resources__/.
   *  2. store.getResource(sig) — covers content-addressed resources
   *     like notes, tags, or any blob referenced by sig that isn't a
   *     bag layer.
   *  3. Fall through silently — sig is unresolvable in this client's
   *     OPFS state. (May exist remotely, may have been pruned, etc.)
   *
   * The label uses the resolved layer's `name` when present so the
   * breadcrumb reads "↳ instructions" instead of an opaque hash.
   */
  readonly drillIntoSig = async (sig: string): Promise<void> => {
    const history = this.#history()
    const store = this.#store()

    let parsed: Content | null = null
    let json: string | null = null

    // 1. cross-bag layer lookup — covers same-bag siblings AND child
    //    cells whose layers live in their own lineage bags. This is the
    //    primary path for drill-down because layer references in any
    //    layer's `children` array can target either case interchangeably.
    if (history?.getLayerBySig) {
      try {
        const fromAny = await history.getLayerBySig(sig)
        if (fromAny) {
          parsed = fromAny
          json = JSON.stringify(fromAny, Object.keys(fromAny).sort(), 2)
        }
      } catch { /* fall through */ }
    }

    // 2. fallback: same-bag layer content (older builds without
    //    getLayerBySig still get the simple case working)
    if (!parsed && history?.getLayerContent) {
      try {
        const fromBag = await history.getLayerContent(this.#locationSig(), sig)
        if (fromBag) {
          parsed = fromBag
          json = JSON.stringify(fromBag, Object.keys(fromBag).sort(), 2)
        }
      } catch { /* fall through */ }
    }

    // 3. content-addressed resource lookup — for non-layer sigs (notes,
    //    tags, anything stored under __resources__/<sig>)
    if (!parsed && store) {
      try {
        const blob = await store.getResource(sig)
        if (blob) {
          const text = await blob.text()
          try { parsed = JSON.parse(text) as Content } catch { /* not JSON */ }
          json = text
        }
      } catch { /* fall through */ }
    }

    // 4. nothing resolved — bail. Future: surface a transient toast.
    if (!parsed && json === null) return

    let lines: ReadonlyArray<{ text: string; status: 'add' }>
    if (parsed && typeof parsed === 'object') {
      const layerLines = layerToDiffableLines(parsed)
      lines = layerLines.map(t => ({ text: t, status: 'add' as const }))
    } else if (json !== null) {
      lines = json.split('\n').map(t => ({ text: t, status: 'add' as const }))
    } else {
      return
    }

    const niceName = (parsed && typeof parsed.name === 'string' && parsed.name) ? parsed.name : sig.slice(0, 12) + '…'
    const slice: Slice = {
      label: `↳ ${niceName}`,
      lines,
      json: json ?? '',
    }
    this.#sliceStack.update(s => [...s, slice])
    this.sliceCopied.set(false)
  }

  /**
   * Copy the open slice's raw JSON to the clipboard. Flashes a brief
   * "copied" state on the button so the user knows it worked. Falls
   * back silently if the Clipboard API isn't available.
   */
  readonly copySliceJson = async (): Promise<void> => {
    const slice = this.sliceCurrent()
    if (!slice) return
    try {
      await navigator.clipboard.writeText(slice.json)
      this.sliceCopied.set(true)
      setTimeout(() => this.sliceCopied.set(false), 1200)
    } catch {
      /* Clipboard unavailable (no user gesture, no permission, etc.) */
    }
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
    await this.#refreshCursor(cursor)
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
    await this.#refreshCursor(cursor)
    await this.#reload()
    const nextTotal = this.#total()
    if (cursor.state.position > nextTotal) cursor.seek(nextTotal)
  }

  #cursor(): CursorService | null {
    return window.ioc.get<CursorService>('@diamondcoreprocessor.com/HistoryCursorService') ?? null
  }

  // After a bag-mutating op (promote/merge/remove) the cursor's
  // internal #layers is stale. Pull it back in sync with disk before
  // reading state.total or seeking, otherwise seek() short-circuits
  // on equal position and the canvas never repaints.
  async #refreshCursor(cursor: CursorService): Promise<void> {
    if (cursor.refreshForLocation) await cursor.refreshForLocation(cursor.state.locationSig)
    else if (cursor.onNewLayer) await cursor.onNewLayer()
  }
  #history(): HistoryService | null {
    return window.ioc.get<HistoryService>('@diamondcoreprocessor.com/HistoryService') ?? null
  }
  #store(): Store | null {
    return window.ioc.get<Store>('@hypercomb.social/Store') ?? null
  }

  /**
   * Reflection contract: every reload re-lists the bag's marker
   * filenames fresh from disk (cheap — names only, no bytes read).
   * For each filename, resolve content via a filename-keyed cache;
   * read from disk only on cache miss. Marker contents are immutable,
   * so the cache never needs invalidation — adding a marker means a
   * new filename appears in the listing, never a content change to an
   * existing filename.
   *
   * Every filename in the bag becomes a row, including markers whose
   * JSON fails to parse — they surface as "(unparseable)" rows so the
   * user can see what's there. No silent drops. Header count and
   * visible-row count are by construction equal: both derived from
   * the same filenames list.
   */
  async #reload(): Promise<void> {
    const seq = ++this.#loadSeq
    const cursor = this.#cursor()
    const history = this.#history()
    const store = this.#store()
    if (!cursor || !history || !store) return

    const locationSig = cursor.state.locationSig
    this.#locationSig.set(locationSig)

    // Phase 1: cheap list of filenames. Fresh every reload.
    let filenames: readonly string[]
    if (history.listMarkerFilenames) {
      filenames = await history.listMarkerFilenames(locationSig)
    } else {
      // Legacy back-compat: derive filenames from listLayers.
      const legacy = await history.listLayers(locationSig)
      filenames = legacy.map(e => e.filename)
    }
    if (seq !== this.#loadSeq) return

    // Phase 2: resolve missing filenames through the filename-keyed
    // cache. Each cache key is `${locSig}:${filename}` so the same bag
    // never collides with another. Cached entries are reused without
    // any disk read.
    const existingByFilename = this.#contentByFilename()
    const toFetch = filenames.filter(name => !existingByFilename.has(`${locationSig}:${name}`))

    const nextByFilename = new Map(existingByFilename)
    if (toFetch.length > 0) {
      const fetched = await Promise.all(toFetch.map(async (name) => {
        const key = `${locationSig}:${name}`
        try {
          if (history.readMarker) {
            const m = await history.readMarker(locationSig, name)
            return [key, m] as const
          }
          // Legacy fallback: synth from listLayers + getLayerContent.
          return [key, null] as const
        } catch {
          return [key, null] as const
        }
      }))
      if (seq !== this.#loadSeq) return
      for (const [key, m] of fetched) nextByFilename.set(key, m)
    }

    // Build entries + sig-keyed contents (back-compat with other
    // viewer code paths that still look things up by layerSig).
    const entries: LayerEntry[] = []
    const sigContents = new Map<string, Content>()
    filenames.forEach((name, i) => {
      const key = `${locationSig}:${name}`
      const m = nextByFilename.get(key)
      if (m) {
        entries.push({ layerSig: m.layerSig, at: m.at, index: i, filename: name })
        if (m.parsed) sigContents.set(m.layerSig, m.parsed)
        else sigContents.set(m.layerSig, { name: '(unparseable)' } as Content)
      } else {
        // Cached miss — file disappeared between phases or unreadable.
        // Synth a placeholder entry so the row still appears.
        entries.push({ layerSig: `missing:${name}`, at: 0, index: i, filename: name })
        sigContents.set(`missing:${name}`, { name: '(missing)' } as Content)
      }
    })

    this.#contentByFilename.set(nextByFilename)
    this.#contents.set(sigContents)
    this.#entries.set(entries)
    this.#position.set(cursor.state.position)
    this.#total.set(filenames.length)
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

/**
 * Serialise a layer to a stable, set-aware line representation for
 * diffing. The viewer is SLOT-AGNOSTIC: every non-empty slot the layer
 * carries (children, notes, tags, ...) renders alphabetically. Empty
 * slots are omitted entirely — sparse-layer invariant — so an empty
 * `children: []` never appears as garbage in the display.
 *
 * Each sig in a slot's array appears on its own line with no
 * trailing-comma artefacts so a sibling sig that just changed position
 * still matches its previous-layer counterpart as `same` in the diff.
 * Inline (non-sig) values are JSON-stringified per line.
 *
 * Format (NOT valid JSON — diff/display only):
 *   {
 *     "name": "<name>",
 *     "children": [
 *       <sig1>
 *       <sig2>
 *     ],
 *     "notes": [
 *       <noteSig1>
 *     ]
 *   }
 */
function layerToDiffableLines(content: Content): string[] {
  const lines: string[] = ['{']
  lines.push(`  "name": ${JSON.stringify(content.name ?? '')}`)
  const slotKeys = Object.keys(content)
    .filter(k => k !== 'name')
    .sort((a, b) => a.localeCompare(b))
  for (const key of slotKeys) {
    const v = (content as Record<string, unknown>)[key]
    if (!Array.isArray(v) || v.length === 0) continue
    // Sort sigs/values to make set-membership the only thing that
    // matters in the diff. Original order is irrelevant for "what
    // changed" rendering.
    const entries = v.map(x => typeof x === 'string' ? x : JSON.stringify(x))
    entries.sort((a, b) => a.localeCompare(b))
    // Append a trailing comma to the previous line for valid-ish JSON
    // shape (last line of previous slot or `name`).
    lines[lines.length - 1] = lines[lines.length - 1] + ','
    lines.push(`  ${JSON.stringify(key)}: [`)
    for (const e of entries) lines.push(`    ${e}`)
    lines.push(`  ]`)
  }
  lines.push('}')
  return lines
}

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

function summarise(prev: Content | undefined, next: Content | undefined): { summary: string; category: Category; isCascade: boolean } {
  if (!next) return { summary: '(loading)', category: 'none', isCascade: false }

  // Slot-agnostic diff: union of every slot present in either layer.
  // Deltas are reported per-slot. Categories use the first slot whose
  // values changed to colour the row (children → 'cells', notes →
  // 'notes', etc.; unknown slots fall through to 'system').
  const slotKeys = new Set<string>([
    ...Object.keys(prev ?? {}).filter(k => k !== 'name'),
    ...Object.keys(next).filter(k => k !== 'name'),
  ])

  const parts: string[] = []
  let category: Category = 'none'
  let slotsChanged = 0
  let totalAdded = 0
  let totalRemoved = 0
  let reorderCount = 0

  for (const key of [...slotKeys].sort()) {
    const pArr = (prev && Array.isArray((prev as Record<string, unknown>)[key]))
      ? ((prev as Record<string, unknown>)[key] as unknown[])
      : []
    const nArr = Array.isArray((next as Record<string, unknown>)[key])
      ? ((next as Record<string, unknown>)[key] as unknown[])
      : []
    const added = difference(nArr, pArr)
    const removed = difference(pArr, nArr)
    const reordered = added.length === 0 && removed.length === 0 && !sequenceEqual(nArr, pArr)
    if (added.length === 0 && removed.length === 0 && !reordered) continue

    slotsChanged++
    totalAdded += added.length
    totalRemoved += removed.length
    if (reordered) reorderCount++

    const noun = slotNoun(key, nArr.length || pArr.length)
    if (added.length) parts.push(`+${added.length} ${noun}`)
    if (removed.length) parts.push(`-${removed.length} ${noun}`)
    if (reordered) parts.push(`reorder ${noun} (${nArr.length})`)
    if (category === 'none') category = slotCategory(key)
  }

  // Cascade fingerprint: exactly one slot changed by a 1-for-1 sig swap,
  // no reorders, no other slot deltas. That shape only emerges from
  // lineage pull-up (a child layer's sig changed downstream); any user-
  // initiated edit produces a different shape on this layer.
  const isCascade = slotsChanged === 1
    && totalAdded === 1
    && totalRemoved === 1
    && reorderCount === 0

  if (parts.length === 0) return { summary: '(no change)', category: 'none', isCascade: false }
  return { summary: parts.join(' · '), category, isCascade }
}

/** Map a slot name to a human-readable noun. Falls back to the raw
 *  slot name so unknown / future slots still render coherently. */
function slotNoun(slot: string, count: number): string {
  if (slot === 'children') return count === 1 ? 'tile' : 'tiles'
  if (slot === 'notes')    return count === 1 ? 'note' : 'notes'
  if (slot === 'tags')     return count === 1 ? 'tag'  : 'tags'
  return slot
}

function slotCategory(slot: string): Category {
  if (slot === 'children') return 'cells'
  if (slot === 'notes')    return 'notes'
  if (slot === 'tags')     return 'tags'
  return 'system'
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
