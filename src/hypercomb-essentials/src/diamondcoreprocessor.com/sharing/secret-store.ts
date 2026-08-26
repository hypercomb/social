// secret-store.ts — shared secret state, single localStorage key. On first
// access, captures any subdomain-derived secret from the URL; on loopback,
// seeds the dev default so two localhost tabs land in the same swarm room
// without typing it (moved here from runtime-initializer — it belongs to the
// store, not the boot path). Respects an explicit clear; never touches a
// real origin.
//
// Moved down from hypercomb-shared in the everything-is-a-beehavior Phase 1:
// the contract lives in core (mesh-zone.types.ts); shells reach the instance
// through IoC only to write, and hear values on EffectBus (announced at
// construction + every change — replay makes late chrome safe).

import { EffectBus, SECRET_STORE_KEY, SECRET_CHANGED, type ZoneValueStore } from '@hypercomb/core'

const KEY = 'hc:secret'
const CLEARED_KEY = 'hc:secret-cleared'
const DEV_DEFAULT_SECRET = 'downtown'

const isLoopback = (): boolean =>
  /^https?:\/\/(localhost|127(?:\.\d+){3}|\[?::1\]?)(:|\/|$)/i.test(window.location.origin)

export class SecretStore extends EventTarget implements ZoneValueStore {

  #value: string

  public get value(): string { return this.#value }

  constructor() {
    super()
    this.#value = this.#read()

    // if localStorage is empty and user hasn't explicitly cleared, try subdomain
    if (!this.#value && !this.#wasCleared()) {
      const extracted = SecretStore.extractSubdomain()
      if (extracted) this.set(extracted)
    }

    // loopback dev default — see header
    if (!this.#value && !this.#wasCleared() && isLoopback()) {
      this.set(DEV_DEFAULT_SECRET)
    }
    EffectBus.emit(SECRET_CHANGED, { value: this.#value })
  }

  public set = (secret: string): void => {
    const clean = (secret ?? '').trim()
    this.#value = clean
    this.#write(clean)
    try {
      if (clean) localStorage.removeItem(CLEARED_KEY)
      else localStorage.setItem(CLEARED_KEY, '1')
    } catch { /* ignore */ }
    this.dispatchEvent(new Event('change'))
    EffectBus.emit(SECRET_CHANGED, { value: clean })
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

  #wasCleared = (): boolean => {
    try { return localStorage.getItem(CLEARED_KEY) === '1' } catch { return false }
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

export const secretStore = new SecretStore()

/** Re-assert into the LIVE IoC map (the llm-provider-registry lesson). */
export const ensureSecretStoreRegistered = (): void => {
  if (!window.ioc?.has?.(SECRET_STORE_KEY)) {
    window.ioc?.register?.(SECRET_STORE_KEY, secretStore)
  }
}
ensureSecretStoreRegistered()
