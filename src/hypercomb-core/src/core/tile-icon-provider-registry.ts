// tile-icon-provider-registry.ts
//
// Registry for tile-overlay icons contributed by individual drones.
//
// Moved to CORE in the everything-is-a-beehavior Phase 1: providers call
// add() at CONSTRUCTION time with a plain (not whenReady) lookup, so the
// registry must exist before ANY bee in ANY load order — which is the
// definition of a kernel primitive (pool-registry and edge-registry are its
// siblings). Core loads before every module in both shells, so the old shell
// boot anchors (web core-adapter's `_` array, dev main's `void`) are gone.
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
  /**
   * Overlay profiles this icon participates in. Prefer `profiles` (an icon can
   * belong to several — e.g. `['private','public-own']` — from ONE declaration,
   * with no duplication and no name-collision). `profile` (single) is kept for
   * back-compat and read as `[profile]`. A provider that sets neither never
   * surfaces.
   */
  profiles?: readonly string[]
  profile?: string
  /**
   * Join the default overlay arrangement automatically for each of its
   * `profiles`, so a feature's icon "takes part" without anyone editing the
   * core DEFAULT_ACTIVE list. Inserted before `remove` (kept rightmost).
   * Defaults to false — opt in.
   */
  defaultActive?: boolean
  /**
   * A FEATURE affordance (website, files, contact, …): never rendered in the
   * always-visible top row. The ⋮ (more) toggle reveals the feature row(s) —
   * bigger icons showcasing what this tile actually carries. While a tile has
   * visible feature icons, the danger row (delete) stays hidden: features must
   * be removed before the tile can be deleted from the overlay.
   */
  featureRow?: boolean
  /** Ride the hidden row revealed by ⋮ — for destructive actions (delete). */
  dangerRow?: boolean
  /**
   * PIN to the band's LABEL ROW (the row carrying the tile's name), aligned to
   * its left edge — outside the wrapping icon flow entirely, so it never adds
   * a row or displaces the centred block. For grab-affordances that belong
   * beside the name (the portal-carry drag handle). Combine with `featureRow`
   * when the press seam (`overlay:feature-press`) is needed; `labelRow` then
   * overrides only the PLACEMENT.
   */
  labelRow?: boolean
  hoverTint?: number
  visibleWhen?: (ctx: any) => boolean
  tintWhen?: (ctx: any) => number | null | undefined
  labelKey?: string
  descriptionKey?: string
}

/** Normalized profile list for a provider (folds the legacy single `profile`
 *  into the `profiles` array). The one place the two forms are reconciled. */
export function iconProviderProfiles(p: { profile?: string; profiles?: readonly string[] }): readonly string[] {
  return p.profiles ?? (p.profile ? [p.profile] : [])
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
    return this.all().filter(p => iconProviderProfiles(p).includes(profile))
  }
}

export const ICON_PROVIDER_REGISTRY_KEY = '@hypercomb.social/IconProviderRegistry'

export const iconProviderRegistry = new IconProviderRegistry()

/** Register into the live IoC map when one exists (core also runs in node
 *  contexts — CLI, SDK — where there is no window and no ioc). */
export const ensureIconProviderRegistryRegistered = (): void => {
  const ioc = (globalThis as unknown as {
    ioc?: { has?: (k: string) => boolean; register?: (k: string, v: unknown) => void }
  }).ioc
  if (!ioc?.has?.(ICON_PROVIDER_REGISTRY_KEY)) {
    ioc?.register?.(ICON_PROVIDER_REGISTRY_KEY, iconProviderRegistry)
  }
}
ensureIconProviderRegistryRegistered()
