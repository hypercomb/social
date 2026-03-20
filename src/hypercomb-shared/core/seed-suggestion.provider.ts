// hypercomb-shared/core/seed-suggestion.provider.ts
// Lists subdirectory names at the current explorer level as autocomplete suggestions.
// Supports sub-path queries: when the user types "abc/" the search bar calls
// query(['abc']) to show children of "abc" instead of siblings.

import type { Lineage } from './lineage'
import type { SuggestionProvider } from './suggestion-provider'

export class SeedSuggestionProvider extends EventTarget implements SuggestionProvider {

  readonly providerName = 'seeds'

  private get lineage(): Lineage { return get('@hypercomb.social/Lineage') as Lineage }

  #names: readonly string[] = []
  #subPath: readonly string[] = []

  public suggestions(): readonly string[] { return this.#names }

  public constructor() {
    super()

    // refresh when the filesystem changes (seed created, navigated, etc.)
    window.addEventListener('synchronize', () => void this.#refresh())

    // refresh when lineage (explorer path) changes
    const lineage = this.lineage
    lineage.addEventListener('change', () => void this.#refresh())

    // initial load
    void this.#refresh()
  }

  /**
   * Query seeds at a sub-path relative to the current explorer directory.
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
    let dir = await this.lineage.explorerDir()
    if (!dir) {
      if (this.#names.length) {
        this.#names = []
        this.dispatchEvent(new CustomEvent('change'))
      }
      return
    }

    // resolve sub-path if any
    for (const seg of this.#subPath) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create: false })
      } catch {
        // sub-path doesn't exist yet — no suggestions
        if (this.#names.length) {
          this.#names = []
          this.dispatchEvent(new CustomEvent('change'))
        }
        return
      }
    }

    const names: string[] = []
    try {
      for await (const [name, entry] of dir.entries()) {
        if (entry.kind === 'directory') names.push(name)
      }
    } catch {
      // OPFS unavailable
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

register('@hypercomb.social/SeedSuggestionProvider', new SeedSuggestionProvider())
