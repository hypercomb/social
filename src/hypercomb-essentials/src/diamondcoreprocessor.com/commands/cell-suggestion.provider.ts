// hypercomb-shared/core/cell-suggestion.provider.ts
//
// THE LEVEL, for the shell. Which tiles are at the current explorer level —
// read once here and handed to everything in the shell that needs the list:
// the command line's cell autocomplete, and the notes panel's tile list.
//
// The resolution itself is core's (`levelRoster`, hypercomb-core/src/core/
// level-roster.ts) — the SAME function the chat window's tiles rail walks —
// so the three surfaces can no longer disagree. Two ways they used to:
//
//   • DUPLICATES. This provider walked the parent's `children` array straight,
//     one name per sig, so a cell whose superseded revision still sits beside
//     its replacement appeared two or three times. The name is the path
//     segment: those are one tile. Core collapses them, first sig wins.
//   • STALENESS. The old read went through `latestMarkerSigFor` on the level's
//     OWN bag, which is EMPTY for a level never navigated into — so the list
//     lagged the canvas or emptied entirely. Core resolves down the parent
//     chain, exactly as the renderer does.
//
// Resolution is purely signature-based. NO OPFS directory enumeration; the
// on-disk cell folders are not the source of truth, the layer is.
//
// Supports sub-path queries: when the user types "abc/" the command line
// calls query(['abc']) and we resolve from the layer for `parentSegments
// + ['abc']` instead of the current level.

// (moved down from hypercomb-shared in the everything-is-a-beehavior
// Phase 1 — contract in core suggestion.types.ts; announces
// CELL_SUGGESTIONS_CHANGED after every refresh so the command line
// re-reads instance-free)
import {
  EffectBus,
  levelRoster,
  CELL_SUGGESTION_KEY,
  CELL_SUGGESTIONS_CHANGED,
  type RosterHistory,
  type RosterRow,
  type RosterStore,
  type CellSuggestionSource,
} from '@hypercomb/core'

/** The slice of Lineage this needs — reached through IoC, never an import. */
type LineageLike = EventTarget & { explorerSegments?: () => string[] }

export class CellSuggestionProvider extends EventTarget implements CellSuggestionSource {

  readonly providerName = 'cells'

  private get lineage(): LineageLike { return window.ioc?.get?.('@hypercomb.social/Lineage') as LineageLike }
  private get history(): RosterHistory | undefined {
    return get('@diamondcoreprocessor.com/HistoryService') as RosterHistory | undefined
  }
  private get store(): RosterStore | undefined {
    return get('@hypercomb.social/Store') as RosterStore | undefined
  }

  #rows: readonly RosterRow[] = []
  #names: readonly string[] = []
  #subPath: readonly string[] = []

  /** Names only, sorted — what an autocomplete wants. */
  public suggestions(): readonly string[] { return this.#names }

  /** The level as the rail reads it: one row per tile, IN THE PARENT'S OWN
   *  ORDER, carrying the tile's sig, its picture's props sig and how many
   *  children it holds. The tile list in the notes panel is this list. */
  public roster(): readonly RosterRow[] { return this.#rows }

  public constructor() {
    super()

    // refresh when the filesystem changes (cell created, navigated, etc.)
    window.addEventListener('synchronize', () => void this.#refresh())

    // refresh when lineage (explorer path) changes
    const lineage = this.lineage
    lineage.addEventListener('change', () => void this.#refresh())

    // initial load
    void this.#refresh()
  }

  /**
   * Query cells at a sub-path relative to the current explorer directory.
   * Pass [] to query the current level (default). Pass ['abc'] to query
   * children of "abc" within the current level.
   */
  public query = (subPath: readonly string[]): void => {
    if (this.#sameSegments(subPath, this.#subPath)) return
    this.#subPath = subPath
    void this.#refresh()
  }

  #refreshing: Promise<void> | null = null

  #refresh = async (): Promise<void> => {
    // dedup concurrent refreshes
    if (this.#refreshing) return
    this.#refreshing = this.#doRefresh()
    try { await this.#refreshing } finally { this.#refreshing = null }
  }

  #doRefresh = async (): Promise<void> => {
    const history = this.history
    const store = this.store
    if (!history || !store) {
      this.#publish([])
      return
    }

    // The level we're listing = current explorer segments + subPath.
    const parentSegmentsRaw = (this.lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []
    const segments = [
      ...parentSegmentsRaw.map(s => String(s ?? '').trim()).filter(Boolean),
      ...this.#subPath.map(s => String(s ?? '').trim()).filter(Boolean),
    ]

    let rows: readonly RosterRow[] = []
    try {
      rows = await levelRoster(segments, history, store)
    } catch {
      // nothing resolves at that address (yet) — empty level
    }
    this.#publish(rows)
  }

  /** Store the level and announce it, but only when it actually changed —
   *  every `synchronize` re-reads, and a repaint per pulse is a flicker. */
  #publish = (rows: readonly RosterRow[]): void => {
    const names = rows.map(row => row.name)
    // Autocomplete reads alphabetically; the roster keeps the layer's order,
    // which is the order the canvas and the rail lay the tiles out in.
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    if (this.#sameAs(sorted) && this.#sameSigs(rows)) return
    this.#rows = rows
    this.#names = sorted
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit(CELL_SUGGESTIONS_CHANGED, { count: this.#names.length })
  }

  #sameSigs = (next: readonly RosterRow[]): boolean => {
    const prev = this.#rows
    if (prev.length !== next.length) return false
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].sig !== next[i].sig || prev[i].name !== next[i].name) return false
    }
    return true
  }

  #sameAs = (next: string[]): boolean => {
    const prev = this.#names
    if (prev.length !== next.length) return false
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== next[i]) return false
    }
    return true
  }

  #sameSegments = (a: readonly string[], b: readonly string[]): boolean => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
}

export const cellSuggestionProvider = new CellSuggestionProvider()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureCellSuggestionRegistered = (): void => {
  if (!window.ioc?.has?.(CELL_SUGGESTION_KEY)) {
    window.ioc?.register?.(CELL_SUGGESTION_KEY, cellSuggestionProvider)
  }
}
ensureCellSuggestionRegistered()
