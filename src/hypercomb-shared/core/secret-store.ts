// hypercomb-shared/core/secret-store.ts
// Secret state — THIS tab's, with the origin-wide localStorage key as the
// pre-fill for a new tab. On first access, captures any subdomain-derived
// secret from the URL.
//
// The tab's own zone (sessionStorage `hc:mesh-zone`, mesh-session.ts) wins:
// a reload comes back with the secret this tab joined with, whatever another
// tab wrote since. A set() records it in both places; setting the value it
// already holds does nothing at all — no write, no 'change' (the swarm tears
// down and resyncs on 'change', and a no-op save used to send a {left}).

import { readMeshZone, writeMeshZone } from './mesh-session'

const KEY = 'hc:secret'
const CLEARED_KEY = 'hc:secret-cleared'

export class SecretStore extends EventTarget {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if nothing is stored and user hasn't explicitly cleared, try subdomain
    if (!this.#value && !this.#wasCleared()) {
      const extracted = SecretStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }
  }

  public set = (secret: string): void => {
    const clean = (secret ?? '').trim()
    if (clean === this.#value) return
    this.#value = clean
    this.#write(clean)
    this.#markCleared(!clean)
    writeMeshZone({ secret: clean })
    this.dispatchEvent(new Event('change'))
  }

  /** Clearing is an explicit choice even when there is nothing to clear: it
   *  is remembered, so no default is seeded over it later. */
  public clear = (): void => {
    if (!this.#value) { this.#markCleared(true); return }
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

  #wasCleared = (): boolean => {
    try { return localStorage.getItem(CLEARED_KEY) === '1' } catch { return false }
  }

  #markCleared = (cleared: boolean): void => {
    try {
      if (cleared) localStorage.setItem(CLEARED_KEY, '1')
      else localStorage.removeItem(CLEARED_KEY)
    } catch { /* ignore */ }
  }

  // ── storage ───────────────────────────────────────────

  /** The tab's own secret first, else the origin-wide one. */
  #read = (): string => {
    const own = readMeshZone()?.secret
    if (typeof own === 'string') return own.trim()
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
