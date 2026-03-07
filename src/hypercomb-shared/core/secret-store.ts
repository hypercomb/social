// hypercomb-shared/core/secret-store.ts
// Shared secret state — single localStorage key, readable by UI and initializers.
// On first access, captures any subdomain-derived secret from the URL.

const KEY = 'hc:secret'

export class SecretStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if localStorage is empty, try to extract from the current subdomain
    if (!this.#value) {
      const extracted = SecretStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (secret: string): void => {
    const clean = (secret ?? '').trim()
    this.#value = clean
    this.#write(clean)
    this.dispatchEvent(new Event('change'))
  }

  public clear = (): void => {
    this.set('')
  }

  // ── subdomain extraction ──────────────────────────────

  /**
   * Extracts the secret from the hostname when on a subdomain.
   * e.g. "mysecret.hypercomb.io" → "mysecret"
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

register('@hypercomb.social/SecretStore', new SecretStore())
