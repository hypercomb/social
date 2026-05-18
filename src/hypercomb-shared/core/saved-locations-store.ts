// hypercomb-shared/core/saved-locations-store.ts
// User-curated list of named locations. Stored as a JSON array in localStorage.
// Add is explicit (no auto-history) so the list stays meaningful — but the
// mesh-modal auto-promotes the active location on Save so the happy path
// doesn't require an extra tap.

const KEY = 'hc:saved-locations'

export class SavedLocationsStore extends EventTarget {

  #value: ReadonlyArray<string>

  public get value(): ReadonlyArray<string> { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()
  }

  public add = (name: string): void => {
    const clean = (name ?? '').trim()
    if (!clean) return
    if (this.#value.includes(clean)) return
    this.#value = [...this.#value, clean]
    this.#write(this.#value)
    this.dispatchEvent(new Event('change'))
  }

  public remove = (name: string): void => {
    const next = this.#value.filter(v => v !== name)
    if (next.length === this.#value.length) return
    this.#value = next
    this.#write(this.#value)
    this.dispatchEvent(new Event('change'))
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

register('@hypercomb.social/SavedLocationsStore', new SavedLocationsStore())
