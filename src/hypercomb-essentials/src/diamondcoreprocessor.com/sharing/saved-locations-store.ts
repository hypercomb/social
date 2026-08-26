// saved-locations-store.ts — user-curated list of named locations, stored as
// a JSON array in localStorage. Add is explicit (no auto-history) so the
// list stays meaningful — but the mesh-modal auto-promotes the active
// location on Save so the happy path doesn't require an extra tap.
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1:
// the contract lives in core (mesh-zone.types.ts); shells reach the instance
// through IoC only to write, and hear values on EffectBus (announced at
// construction + every change — replay makes late chrome safe).

import { EffectBus, SAVED_LOCATIONS_KEY, SAVED_LOCATIONS_CHANGED, type SavedLocationsProvider } from '@hypercomb/core'

const KEY = 'hc:saved-locations'

export class SavedLocationsStore extends EventTarget implements SavedLocationsProvider {

  #value: ReadonlyArray<string>

  public get value(): ReadonlyArray<string> { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
    EffectBus.emit(SAVED_LOCATIONS_CHANGED, { value: this.#value })
  }

  public add = (name: string): void => {
    const clean = (name ?? '').trim()
    if (!clean) return
    if (this.#value.includes(clean)) return
    this.#value = [...this.#value, clean]
    this.#write(this.#value)
    this.dispatchEvent(new Event('change'))
    EffectBus.emit(SAVED_LOCATIONS_CHANGED, { value: this.#value })
  }

  public remove = (name: string): void => {
    const next = this.#value.filter(v => v !== name)
    if (next.length === this.#value.length) return
    this.#value = next
    this.#write(this.#value)
    this.dispatchEvent(new Event('change'))
    EffectBus.emit(SAVED_LOCATIONS_CHANGED, { value: this.#value })
  }

  #read = (): ReadonlyArray<string> => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
    } catch { return [] }
  }

  #write = (v: ReadonlyArray<string>): void => {
    try {
      if (v.length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(v))
    } catch { /* ignore */ }
  }
}

export const savedLocationsStore = new SavedLocationsStore()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureSavedLocationsRegistered = (): void => {
  if (!window.ioc?.has?.(SAVED_LOCATIONS_KEY)) {
    window.ioc?.register?.(SAVED_LOCATIONS_KEY, savedLocationsStore)
  }
}
ensureSavedLocationsRegistered()
