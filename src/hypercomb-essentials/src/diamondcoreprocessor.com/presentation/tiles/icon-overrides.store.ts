// icon-overrides.store.ts — participant-local, per-element icon overrides for
// the universal icon protocol. Any icon site resolves `glyph(id, default)`;
// if the participant has reskinned that element (via the icon-hive picker in
// edit mode), the override wins. This is UI chrome — localStorage, never hive
// content or history; it does not sync across the swarm.
//
// Element ids are namespaced by surface so they never collide:
//   control:pin · view:website · group:websites · overlay:edit
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1:
// the contract lives in core (icon-overrides.types.ts); shells reach the
// instance only through IoC. Emits `change` ({ id, glyph|null }) on the
// EventTarget and ICON_OVERRIDE_CHANGED on EffectBus so every surface
// re-resolves live without holding the instance.

import {
  EffectBus,
  ICON_OVERRIDES_KEY,
  ICON_OVERRIDE_CHANGED,
  type IconOverridesProvider,
} from '@hypercomb/core'

const STORAGE_KEY = 'hc:icon-overrides'

export class IconOverrideStore extends EventTarget implements IconOverridesProvider {
  #map = new Map<string, string>()

  constructor() {
    super()
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, string>
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string' && v) this.#map.set(k, v)
        }
      }
    } catch { /* malformed — start empty */ }
  }

  /** Resolve the glyph for an element id, falling back to the author default. */
  glyph(id: string, defaultGlyph: string): string {
    return this.#map.get(id) ?? defaultGlyph
  }

  /** Has the participant set an override for this element? */
  has(id: string): boolean { return this.#map.has(id) }

  /** Reskin an element. Persists + notifies. */
  set(id: string, glyph: string): void {
    const g = String(glyph ?? '').trim()
    if (!g || !id) return
    if (this.#map.get(id) === g) return
    this.#map.set(id, g)
    this.#persist()
    this.#notify(id, g)
  }

  /** Drop an override, reverting to the author default. */
  clear(id: string): void {
    if (!this.#map.delete(id)) return
    this.#persist()
    this.#notify(id, null)
  }

  /** Notify both the DOM (EventTarget) and EffectBus (for surfaces that
   *  cannot hold this instance — shells resolve lazily, Pixi drones batch). */
  #notify(id: string, glyph: string | null): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { id, glyph } }))
    EffectBus.emit(ICON_OVERRIDE_CHANGED, { id, glyph })
  }

  #persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.#map)))
    } catch { /* private mode / quota — non-fatal */ }
  }
}

export const iconOverrides = new IconOverrideStore()

/** Register into whatever IoC map is LIVE. Module-eval order in the dev
 *  barrel can see `window.ioc` replaced after early modules register (the
 *  llm-provider-registry lesson), so the render path re-asserts before use
 *  instead of trusting the module-scope registration alone. */
export const ensureIconOverridesRegistered = (): void => {
  if (!window.ioc?.has?.(ICON_OVERRIDES_KEY)) {
    window.ioc?.register?.(ICON_OVERRIDES_KEY, iconOverrides)
  }
}
ensureIconOverridesRegistered()
