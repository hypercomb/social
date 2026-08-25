// icon-overrides.types.ts — the icon-override store's module↔shell contract.
//
// The implementation lives in essentials (presentation/tiles/
// icon-overrides.store.ts) and registers under ICON_OVERRIDES_KEY. Shell
// chrome resolves it lazily via IoC and falls back to the author default
// while the module is still loading — overrides are cosmetic, never
// load-bearing. Reskins additionally broadcast on EffectBus as
// ICON_OVERRIDE_CHANGED, so a subscriber needs no instance to hear them.

export const ICON_OVERRIDES_KEY = '@hypercomb.social/IconOverrides'

/** EffectBus effect emitted on every reskin/clear. */
export const ICON_OVERRIDE_CHANGED = 'icon:override-changed'

export type IconOverrideChange = { id: string; glyph: string | null }

export interface IconOverridesProvider {
  /** Resolve the glyph for an element id, falling back to the author default. */
  glyph(id: string, defaultGlyph: string): string
  /** Has the participant set an override for this element? */
  has(id: string): boolean
  /** Reskin an element. Persists + notifies. */
  set(id: string, glyph: string): void
  /** Drop an override, reverting to the author default. */
  clear(id: string): void
}
