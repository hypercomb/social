// assistant/llm-activation.ts
//
// WHO MAY THE ORCHESTRATOR SPEND THROUGH — device-local policy, one bit per
// provider. A provider is ACTIVE when it is registered, usable (key present
// or none needed), and the participant has not switched it off here. The
// default is ON: pasting a key IS the activation gesture, and this store only
// records the explicit "not this one" that overrides it.
//
// Policy is device-local truth in exactly the sense keys are (llm-keys.ts):
// never a resource, never shared, never synced. It is a separate store rather
// than a field on the key store because clearing a key must never erase the
// participant's stated preference, and vice versa.
//
// Storage: `hc:llm:<providerId>:off` = '1'. Absence = enabled.
//
// HELD PROVIDERS. One provider is off by default rather than on: a spec a
// DOMAIN published whose endpoint points somewhere other than that domain.
// The domain is then not offering its own models, it is asking you to send
// your key to a third party — which may be perfectly legitimate (a mirror, a
// gateway) and is exactly what a hostile spec would also look like. `hold()`
// writes the same off-switch the participant would, so the row appears with
// everything visible — origin, endpoint, models — and one click turns it on.

const PREFIX = 'hc:llm:'
const SUFFIX = ':off'
/** Marks that a provider was held ONCE. Separate from the off-switch so the
 *  participant can turn a held provider on and have it STAY on: absence of
 *  the off-switch means enabled, which would otherwise look identical to
 *  "never seen" and get held again on the next probe. */
const HELD_SUFFIX = ':held'

const storageKey = (providerId: string): string =>
  `${PREFIX}${String(providerId ?? '').trim().toLowerCase()}${SUFFIX}`

const heldKey = (providerId: string): string =>
  `${PREFIX}${String(providerId ?? '').trim().toLowerCase()}${HELD_SUFFIX}`

const isOurs = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.startsWith(PREFIX)
  && (key.endsWith(SUFFIX) || key.endsWith(HELD_SUFFIX))

/**
 * The explicit off-switches. `change` fires on any flip, and on a cross-tab
 * `storage` event, so the console and the dispatch can just listen.
 */
export class LlmActivationStore extends EventTarget {

  readonly #off = new Set<string>()
  /** Providers already held once on arrival. Persisted; see `hold`. */
  readonly #held = new Set<string>()

  constructor() {
    super()
    this.#load()
    try {
      globalThis.addEventListener?.('storage', (event: Event) => {
        const key = (event as StorageEvent).key
        if (key !== null && !isOurs(key)) return
        this.#load()
        this.dispatchEvent(new Event('change'))
      })
    } catch { /* no window (tests) — the in-memory set still works */ }
  }

  /** Has the participant switched this provider off? */
  isEnabled(providerId: string): boolean {
    return !this.#off.has(String(providerId ?? '').trim().toLowerCase())
  }

  setEnabled(providerId: string, enabled: boolean): void {
    const id = String(providerId ?? '').trim().toLowerCase()
    if (!id || this.isEnabled(id) === enabled) return
    if (enabled) {
      this.#off.delete(id)
      try { globalThis.localStorage?.removeItem(storageKey(id)) } catch { /* session-only */ }
    } else {
      this.#off.add(id)
      try { globalThis.localStorage?.setItem(storageKey(id), '1') } catch { /* session-only */ }
    }
    this.dispatchEvent(new Event('change'))
  }

  /**
   * Switch a provider off because it arrived asking for more trust than a
   * discovery should grant — ONCE, ever. A second probe of the same domain
   * (or the same spec from another one) must not undo a participant who has
   * since turned it on, so the hold records itself and never fires twice.
   */
  hold(providerId: string): void {
    const id = String(providerId ?? '').trim().toLowerCase()
    if (!id || this.#held.has(id)) return
    this.#held.add(id)
    try { globalThis.localStorage?.setItem(heldKey(id), '1') } catch { /* session-only */ }
    this.setEnabled(id, false)
    // setEnabled only fires `change` when the value moves; a hold on an
    // already-off provider still changed what the console should say.
    this.dispatchEvent(new Event('change'))
  }

  /** Was this provider ever held on arrival? The console says so. */
  wasHeld(providerId: string): boolean {
    return this.#held.has(String(providerId ?? '').trim().toLowerCase())
  }

  #load(): void {
    this.#off.clear()
    this.#held.clear()
    try {
      const storage = globalThis.localStorage
      if (!storage) return
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (!isOurs(key) || storage.getItem(key!) !== '1') continue
        if (key!.endsWith(HELD_SUFFIX)) {
          this.#held.add(key!.slice(PREFIX.length, key!.length - HELD_SUFFIX.length))
        } else {
          this.#off.add(key!.slice(PREFIX.length, key!.length - SUFFIX.length))
        }
      }
    } catch { /* storage unavailable */ }
  }
}

export const llmActivation = new LlmActivationStore()
window.ioc?.register?.('@diamondcoreprocessor.com/LlmActivationStore', llmActivation)
