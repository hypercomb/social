// src/app/cache/seed-cache.ts

/*
SeedVault
---------
- persistent, non-authoritative cache
- keyed strictly by seed
- value is opaque JSON (caller-owned shape)
- safe to lose, safe to clear
- no schema, no migrations, no indexing
- never touches DNA or resources
- includes an in-memory live cache to avoid repeated IDB reads
*/

export type Seed = string
export type SeedValue = unknown

const DB_NAME = 'hypercomb-seed-cache'
const STORE_NAME = 'seeds'
const DB_VERSION = 1

export class SeedVault {
  private static db: IDBDatabase | null = null
  private static opening: Promise<IDBDatabase> | null = null

  // live in-memory cache (session-scoped)
  private static memory = new Map<Seed, SeedValue>()

  // ---------------------------------------------
  // db lifecycle (lazy, shared, sealed)
  // ---------------------------------------------
  private static open = async (): Promise<IDBDatabase> => {
    if (this.db) return this.db
    if (this.opening) return this.opening

    this.opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onerror = () => reject(request.error)
    })

    return this.opening
  }

  // ---------------------------------------------
  // public api
  // ---------------------------------------------

  public static get = async <T = SeedValue>(seed: Seed): Promise<T | null> => {
    // check live cache first
    if (this.memory.has(seed)) {
      return this.memory.get(seed) as T
    }

    try {
      const db = await this.open()
      const value = await new Promise<T | null>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const req = store.get(seed)

        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => resolve(null)
      })

      if (value !== null) {
        this.memory.set(seed, value)
      }

      return value
    } catch {
      return null
    }
  }

  public static set = async (seed: Seed, value: SeedValue): Promise<void> => {
    // update live cache immediately
    this.memory.set(seed, value)

    try {
      const db = await this.open()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.put(value, seed)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch {
      // cache is best-effort
    }
  }

  // opens existing value, shallow-merges, updates memory, then saves
  public static merge = async (
    seed: Seed,
    patch: Record<string, unknown>
  ): Promise<void> => {
    try {
      const existing =
        (this.memory.get(seed) as Record<string, unknown> | undefined) ??
        (await this.get<Record<string, unknown>>(seed)) ??
        {}

      const merged =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>), ...patch }
          : { ...patch }

      await this.set(seed, merged)
    } catch {
      // ignore
    }
  }

  public static remove = async (seed: Seed): Promise<void> => {
    this.memory.delete(seed)

    try {
      const db = await this.open()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.delete(seed)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch {
      // ignore
    }
  }

  public static clear = async (): Promise<void> => {
    this.memory.clear()

    try {
      const db = await this.open()
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    } catch {
      // ignore
    }
  }
}
