// hypercomb-shared/core/icon-override.store.ts
//
// IconOverrideStore — participant-local, per-element icon overrides for the
// universal icon protocol. Any icon site resolves `glyph(id, default)`; if the
// participant has reskinned that element (via the icon-hive picker in edit
// mode), the override wins. This is UI chrome — localStorage, never hive
// content or history; it does not sync across the swarm.
//
// Element ids are namespaced by surface so they never collide:
//   control:pin · view:website · group:websites · overlay:edit
//
// Registered in IoC at `@hypercomb.social/IconOverrides`. Emits `change`
// ({ id, glyph|null }) so every surface re-resolves live.

import { EffectBus } from '@hypercomb/core'

const STORAGE_KEY = 'hc:icon-overrides'

export class IconOverrideStore extends EventTarget {
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

  /** Notify both the DOM (EventTarget, for Angular) and EffectBus (for Pixi /
   *  essentials drones that can't subscribe to this EventTarget). */
  #notify(id: string, glyph: string | null): void {
    this.dispatchEvent(new CustomEvent('change', { detail: { id, glyph } }))
    EffectBus.emit('icon:override-changed', { id, glyph })
  }

  #persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.#map)))
    } catch { /* private mode / quota — non-fatal */ }
  }
}

export const iconOverrides = new IconOverrideStore()
register('@hypercomb.social/IconOverrides', iconOverrides)
