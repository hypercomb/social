// hypercomb-core/src/core/llm-keys.ts
//
// LLM KEYS ARE DEVICE-LOCAL TRUTH.
//
// A participant's API key is the one piece of data in this system that must
// never become content. It is never a resource, never a layer slot, never a
// decoration payload, never an EffectBus payload, never a toast, never a log
// line, never a history op — so it is never signed, never shared, never
// adopted, never synced, and never recoverable from a hive someone else
// holds. It lives in this device's localStorage and nowhere else. A doctrine
// ratchet in `src/doctrine.spec.ts` enforces the negative half of that
// sentence mechanically; this file is the positive half — the ONE place a key
// is written and read, so there is a single seam to audit.
//
// Shape is copied from `hypercomb-shared/core/secret-store.ts` (EventTarget,
// `#fields`, `change` events) because that is the repo's existing credential-
// state pattern. It lives in CORE rather than shared because essentials may
// import core and may NEVER import shared, and the provider registry that
// needs it is an essentials module.
//
// ── storage scheme ────────────────────────────────────────────────────
//
//   hc:llm:<providerId>:key      one key per provider, the only thing written
//   hc:anthropic-api-key         LEGACY — read-only drain fallback
//
// The legacy single-vendor key predates providers. It is read as if it were
// `hc:llm:anthropic:key` so nobody has to re-paste anything, and it is never
// written — a `set('anthropic', …)` lands in the scheme above. `clear` does
// remove it, because a key you asked to be gone being still readable is the
// failure this file exists to prevent; that is a drain, not a write.

import { register } from '../ioc/ioc.js'

/** IoC key. Resolve via `window.ioc.get(LLM_KEY_STORE_IOC_KEY)`. */
export const LLM_KEY_STORE_IOC_KEY = '@hypercomb.social/LlmKeyStore'

/** Legacy single-vendor storage key. Read-only drain source. */
export const LEGACY_ANTHROPIC_KEY_STORAGE = 'hc:anthropic-api-key'

/** The provider whose key the legacy storage slot holds. */
export const LEGACY_KEY_PROVIDER = 'anthropic'

const PREFIX = 'hc:llm:'
const SUFFIX = ':key'

/** Storage key for a provider's key. The scheme, in one function. */
export const llmKeyStorageKey = (providerId: string): string =>
  `${PREFIX}${String(providerId ?? '').trim().toLowerCase()}${SUFFIX}`

/** Is this a storage key this store owns (including the legacy slot)? */
export const isLlmKeyStorageKey = (key: string | null | undefined): boolean =>
  key === LEGACY_ANTHROPIC_KEY_STORAGE
  || (typeof key === 'string' && key.startsWith(PREFIX) && key.endsWith(SUFFIX))

/** Provider id out of a storage key, or `''` if it is not one of ours. */
export const providerIdOfStorageKey = (key: string | null | undefined): string => {
  if (key === LEGACY_ANTHROPIC_KEY_STORAGE) return LEGACY_KEY_PROVIDER
  if (typeof key !== 'string' || !key.startsWith(PREFIX) || !key.endsWith(SUFFIX)) return ''
  return key.slice(PREFIX.length, key.length - SUFFIX.length)
}

const readRaw = (key: string): string => {
  try { return (globalThis.localStorage?.getItem(key) ?? '').trim() } catch { return '' }
}

/**
 * Every LLM credential this device holds.
 *
 * `change` fires on any mutation, and on a `storage` event from another tab,
 * so an indicator or a picker can just listen. The event carries NO detail —
 * a key must never ride an event payload; listeners re-read.
 */
export class LlmKeyStore extends EventTarget {

  /** providerId → key. Mirrors localStorage; re-read on cross-tab change. */
  readonly #fields = new Map<string, string>()

  constructor() {
    super()
    this.#load()
    try {
      globalThis.addEventListener?.('storage', (event: Event) => {
        const key = (event as StorageEvent).key
        // `null` = the whole store was cleared.
        if (key !== null && !isLlmKeyStorageKey(key)) return
        this.#load()
        this.dispatchEvent(new Event('change'))
      })
    } catch { /* no window (tests, node) — the in-memory mirror still works */ }
  }

  /** This provider's key, or `''`. Falls back to the legacy slot. */
  get(providerId: string): string {
    return this.#fields.get(this.#id(providerId)) ?? ''
  }

  /** Whether a usable key exists for this provider. */
  has(providerId: string): boolean {
    return !!this.get(providerId)
  }

  /** Provider ids with a key, sorted. The roster an indicator reads. */
  configured(): string[] {
    return [...this.#fields.keys()].sort()
  }

  /** Store (or, with an empty value, clear) a provider's key. */
  set(providerId: string, key: string): void {
    const id = this.#id(providerId)
    if (!id) return
    const clean = (key ?? '').trim()
    if (!clean) { this.clear(id); return }
    this.#fields.set(id, clean)
    try { globalThis.localStorage?.setItem(llmKeyStorageKey(id), clean) } catch { /* session-only */ }
    this.dispatchEvent(new Event('change'))
  }

  /**
   * Forget a provider's key. Removes the legacy slot too when clearing
   * anthropic — a cleared key that is still readable is not cleared.
   */
  clear(providerId: string): void {
    const id = this.#id(providerId)
    if (!id) return
    const had = this.#fields.delete(id)
    try {
      globalThis.localStorage?.removeItem(llmKeyStorageKey(id))
      if (id === LEGACY_KEY_PROVIDER) globalThis.localStorage?.removeItem(LEGACY_ANTHROPIC_KEY_STORAGE)
    } catch { /* nothing to remove */ }
    if (had) this.dispatchEvent(new Event('change'))
  }

  /** Re-read localStorage. Public so a test or a drain can force a refresh. */
  reload(): void {
    this.#load()
    this.dispatchEvent(new Event('change'))
  }

  #id(providerId: string): string {
    return String(providerId ?? '').trim().toLowerCase()
  }

  #load(): void {
    this.#fields.clear()
    let storage: Storage | undefined
    try { storage = globalThis.localStorage } catch { storage = undefined }
    if (!storage) return

    // Legacy first, so a real `hc:llm:anthropic:key` overwrites it below.
    const legacy = readRaw(LEGACY_ANTHROPIC_KEY_STORAGE)
    if (legacy) this.#fields.set(LEGACY_KEY_PROVIDER, legacy)

    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (!key || key === LEGACY_ANTHROPIC_KEY_STORAGE || !isLlmKeyStorageKey(key)) continue
        const id = providerIdOfStorageKey(key)
        const value = readRaw(key)
        if (id && value) this.#fields.set(id, value)
      }
    } catch { /* enumeration unavailable — legacy fallback still stands */ }
  }
}

/**
 * The singleton. Registered on BOTH registries: core's own map (for core and
 * node-side consumers that imported `get` from `ioc.js`) and `window.ioc`
 * (what every essentials module and Angular surface resolves against). The
 * shell registry may not exist yet when core loads, so the global half is
 * best-effort and idempotent — `register` ignores a second registration.
 */
export const llmKeyStore = new LlmKeyStore()

register(LLM_KEY_STORE_IOC_KEY, llmKeyStore)
try {
  (globalThis as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
    .ioc?.register?.(LLM_KEY_STORE_IOC_KEY, llmKeyStore)
} catch { /* no shell registry yet — core's map answers via ioc.get's bridge */ }
