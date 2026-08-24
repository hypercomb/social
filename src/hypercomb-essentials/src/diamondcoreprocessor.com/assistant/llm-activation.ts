// diamondcoreprocessor.com/assistant/llm-activation.ts
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

const PREFIX = 'hc:llm:'
const SUFFIX = ':off'

const storageKey = (providerId: string): string =>
  `${PREFIX}${String(providerId ?? '').trim().toLowerCase()}${SUFFIX}`

const isOurs = (key: string | null | undefined): boolean =>
  typeof key === 'string' && key.startsWith(PREFIX) && key.endsWith(SUFFIX)

/**
 * The explicit off-switches. `change` fires on any flip, and on a cross-tab
 * `storage` event, so the console and the dispatch can just listen.
 */
export class LlmActivationStore extends EventTarget {

  readonly #off = new Set<string>()

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

  #load(): void {
    this.#off.clear()
    try {
      const storage = globalThis.localStorage
      if (!storage) return
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (isOurs(key) && storage.getItem(key!) === '1') {
          this.#off.add(key!.slice(PREFIX.length, key!.length - SUFFIX.length))
        }
      }
    } catch { /* storage unavailable */ }
  }
}

export const llmActivation = new LlmActivationStore()
window.ioc?.register?.('@diamondcoreprocessor.com/LlmActivationStore', llmActivation)
