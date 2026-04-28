// hypercomb-shared/core/tile-icon-provider-registry.ts
//
// Shell-side registry for tile-overlay icons contributed by individual drones.
//
// Pattern: a drone that wants to show a tile icon does NOT touch the
// presentation layer. It calls IconProviderRegistry.add() at construction
// time. tile-actions (the arranger) reads from this registry, merges with
// its own core-action catalog, and emits the final overlay descriptors.
//
// When the providing drone is toggled off in DCP it never loads, never
// constructs, never registers — and its icon never appears.
//
// EventTarget so consumers can re-build descriptors whenever the set
// changes mid-session (e.g. arrange-mode reorders, hot drone install).

export type TileIconProvider = {
  name: string
  owner?: string
  svgMarkup: string
  profile: string
  hoverTint?: number
  visibleWhen?: (ctx: any) => boolean
  tintWhen?: (ctx: any) => number | null | undefined
  labelKey?: string
  descriptionKey?: string
}

export class IconProviderRegistry extends EventTarget {

  #providers = new Map<string, TileIconProvider>()

  add(provider: TileIconProvider): void {
    if (this.#providers.has(provider.name)) {
      console.warn(`[icon-provider-registry] duplicate name "${provider.name}" — ignoring`)
      return
    }
    this.#providers.set(provider.name, provider)
    this.dispatchEvent(new CustomEvent('change'))
  }

  remove(name: string): void {
    if (!this.#providers.delete(name)) return
    this.dispatchEvent(new CustomEvent('change'))
  }

  all(): TileIconProvider[] {
    return [...this.#providers.values()]
  }

  byProfile(profile: string): TileIconProvider[] {
    return this.all().filter(p => p.profile === profile)
  }
}

register('@hypercomb.social/IconProviderRegistry', new IconProviderRegistry())
