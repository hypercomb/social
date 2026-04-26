// hypercomb-shared/core/cell-suggestion.provider.ts
//
// Lists cell names at the current explorer level as autocomplete suggestions.
// Source of truth: the layer at the current cursor position in
// `__history__/<sign(lineage)>/`. Resolution is purely signature-based —
// we read each child sig in the head layer's `children` array and resolve
// it to a display name via the LayerContent's `name` field. NO OPFS
// directory enumeration; the on-disk cell folders are not the source of
// truth, the layer is.
//
// Supports sub-path queries: when the user types "abc/" the command line
// calls query(['abc']) and we resolve from the layer for `parentSegments
// + ['abc']` instead of the current level.

import type { Lineage } from './lineage'
import type { SuggestionProvider } from './suggestion-provider'

type LayerContent = { name: string; children?: string[] }
type HistoryLike = {
  sign: (lineage: { explorerSegments: () => string[] }) => Promise<string>
  latestMarkerSigFor: (lineageSig: string, name: string) => Promise<string>
  getLayerBySig: (sig: string) => Promise<LayerContent | null>
}

export class CellSuggestionProvider extends EventTarget implements SuggestionProvider {

  readonly providerName = 'cells'

  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }
  private get history(): HistoryLike | undefined {
    return get('@diamondcoreprocessor.com/HistoryService') as HistoryLike | undefined
  }

  #names: readonly string[] = []
  #subPath: readonly string[] = []

  public suggestions(): readonly string[] { return this.#names }

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
    if (!history) {
      if (this.#names.length) {
        this.#names = []
        this.dispatchEvent(new CustomEvent('change'))
      }
      return
    }

    // The lineage we're suggesting under = current explorer segments + subPath.
    const parentSegmentsRaw = (this.lineage as unknown as { explorerSegments?: () => string[] })?.explorerSegments?.() ?? []
    const parentSegments = [
      ...parentSegmentsRaw.map(s => String(s ?? '').trim()).filter(Boolean),
      ...this.#subPath.map(s => String(s ?? '').trim()).filter(Boolean),
    ]
    const parentName = parentSegments.length === 0 ? '/' : parentSegments[parentSegments.length - 1]

    // Resolve the parent's head layer purely by signature.
    let parentLayer: LayerContent | null = null
    try {
      const parentLineageSig = await history.sign({ explorerSegments: () => parentSegments })
      const headSig = await history.latestMarkerSigFor(parentLineageSig, parentName)
      parentLayer = await history.getLayerBySig(headSig)
    } catch {
      // parent has no resolvable layer (yet) — empty suggestions
    }

    const names: string[] = []
    if (parentLayer?.children?.length) {
      // For each child sig in the parent's layer, fetch its LayerContent
      // and read the `name` field. Pure signature lookup.
      for (const childSig of parentLayer.children) {
        const child = await history.getLayerBySig(childSig)
        if (child?.name) names.push(child.name)
      }
    }

    names.sort((a, b) => a.localeCompare(b))

    // only notify if changed
    if (this.#sameAs(names)) return

    this.#names = names
    this.dispatchEvent(new CustomEvent('change'))
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

register('@hypercomb.social/CellSuggestionProvider', new CellSuggestionProvider())
