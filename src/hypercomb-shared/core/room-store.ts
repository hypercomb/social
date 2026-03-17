// hypercomb-shared/core/room-store.ts
// Shared room state — single localStorage key, readable by UI and initializers.
// On first access, captures any subdomain-derived room from the URL.

const KEY = 'hc:room'

export class RoomStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if localStorage is empty, try to extract from the current subdomain
    if (!this.#value) {
      const extracted = RoomStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (room: string): void => {
    const clean = (room ?? '').trim()
    this.#value = clean
    this.#write(clean)
    this.dispatchEvent(new Event('change'))
  }

  public clear = (): void => {
    this.set('')
  }

  // ── subdomain extraction ──────────────────────────────

  /**
   * Extracts the room from the hostname when on a subdomain.
   * e.g. "myroom.hypercomb.io" → "myroom"
   *      "deep.path.hypercomb.io" → "deep.path"
   *      "localhost" → "" (no subdomain)
   *      "hypercomb.io" → "" (bare domain)
   */
  static extractSubdomain = (): string => {
    const host = (window.location.hostname ?? '').toLowerCase().trim()
    if (!host || host === 'localhost') return ''

    // ip address — no subdomain
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return ''

    const parts = host.split('.')
    // need at least 3 parts: sub.domain.tld
    if (parts.length < 3) return ''

    // strip the last two segments (domain.tld)
    const sub = parts.slice(0, -2).join('.')
    return sub
  }

  // ── localStorage ──────────────────────────────────────

  #read = (): string => {
    try { return (localStorage.getItem(KEY) ?? '').trim() } catch { return '' }
  }

  #write = (v: string): void => {
    try {
      if (v) localStorage.setItem(KEY, v)
      else localStorage.removeItem(KEY)
    } catch { /* ignore */ }
  }
}

register('@hypercomb.social/RoomStore', new RoomStore())
