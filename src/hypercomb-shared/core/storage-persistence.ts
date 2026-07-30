/**
 * Protect origin storage (including OPFS) from automatic browser eviction.
 *
 * Checking is safe during boot. Requesting is deferred to the first trusted
 * interaction because Firefox may show a permission prompt, while Chromium
 * and Safari normally decide silently. The request is made directly in the
 * event callback so the browser still sees a user activation.
 */

export const STORAGE_PERSISTENCE_STATUS_KEY = 'hc:storage-persistence'

export type StoragePersistenceState =
  | 'unsupported'
  | 'best-effort'
  | 'persistent'
  | 'error'

export interface StoragePersistenceStatus {
  state: StoragePersistenceState
  checkedAt: string
}

interface PersistenceStorage {
  persisted?: () => Promise<boolean>
  persist?: () => Promise<boolean>
}

interface PersistenceEventTarget {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void
  dispatchEvent(event: Event): boolean
}

interface PersistenceStatusStore {
  setItem(key: string, value: string): void
}

export interface StoragePersistenceEnvironment {
  storage: PersistenceStorage | undefined
  events: PersistenceEventTarget
  statusStore?: PersistenceStatusStore
  now?: () => Date
  warn?: (...args: unknown[]) => void
}

const browserEnvironment = (): StoragePersistenceEnvironment => ({
  storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
  events: window,
  statusStore: typeof localStorage === 'undefined' ? undefined : localStorage,
  now: () => new Date(),
  warn: (...args) => console.warn(...args),
})

/**
 * Starts the persistence guard. This is intentionally fire-and-forget at app
 * startup: neither the initial permission check nor a future browser prompt
 * belongs on the critical rendering path.
 */
export async function protectOriginStorage(
  environment: StoragePersistenceEnvironment = browserEnvironment(),
): Promise<StoragePersistenceState> {
  const { storage, events } = environment
  const persisted = storage?.persisted
  const persist = storage?.persist

  const report = (state: StoragePersistenceState): StoragePersistenceState => {
    const detail: StoragePersistenceStatus = {
      state,
      checkedAt: (environment.now?.() ?? new Date()).toISOString(),
    }

    try {
      environment.statusStore?.setItem(
        STORAGE_PERSISTENCE_STATUS_KEY,
        JSON.stringify(detail),
      )
    } catch {
      // The event and console remain available when localStorage is blocked.
    }

    events.dispatchEvent(new CustomEvent<StoragePersistenceStatus>(
      'storage:persistence',
      { detail },
    ))
    return state
  }

  if (typeof persisted !== 'function' || typeof persist !== 'function') {
    environment.warn?.(
      '[storage] persistent-storage protection is unavailable; OPFS remains best-effort',
    )
    return report('unsupported')
  }

  try {
    if (await persisted.call(storage)) return report('persistent')
  } catch (error) {
    environment.warn?.('[storage] could not check persistent-storage status', error)
    return report('error')
  }

  report('best-effort')

  let requested = false
  const request = (event: Event): void => {
    if (requested || !event.isTrusted) return
    requested = true
    events.removeEventListener('pointerdown', request, true)
    events.removeEventListener('keydown', request, true)

    // Do not await anything before this call: it must remain inside the
    // browser's trusted interaction to permit Firefox's permission UI.
    void persist.call(storage).then(
      granted => {
        if (!granted) {
          environment.warn?.(
            '[storage] persistent storage was not granted; OPFS remains best-effort',
          )
        }
        report(granted ? 'persistent' : 'best-effort')
      },
      error => {
        environment.warn?.('[storage] persistent-storage request failed', error)
        report('error')
      },
    )
  }

  events.addEventListener('pointerdown', request, true)
  events.addEventListener('keydown', request, true)
  return 'best-effort'
}
