// preferences/participant-document.ts
//
// A PARTICIPANT'S OWN RECORD THAT A SYNCHRONOUS READER READS — the module-side
// twin of hypercomb-shared/core/participant-document.ts, for the stores that
// live in essentials (a module never imports shared). The two keep one
// contract; the shell's copy serves the shell's stores.
//
// State lives only in pools of meaning (jwize 2026-09-25). Each record is ONE
// current document in a DOCUMENT pool of its own — colon-scoped so no tile can
// name it, per participant, never replicated. This class holds the in-memory
// value the synchronous reader reads, hydrates it from the pool once the Store
// is ready, and writes THROUGH to the pool on every change. `change` fires when
// a record arrives from disk that differs from what was painted.
//
// READS WALK BACK, WRITES NEVER DO. Until the pool answers, the value is what
// the old localStorage key holds, so an existing hive reads its levels and
// palettes on the first frame exactly as before. When the pool holds a
// document, that document wins. Nothing is written to localStorage again and
// nothing is deleted from it: the next EDIT carries the state forward.
//
// A WRITE BEFORE THE STORE IS READY IS NOT LOST: it is held, latest wins, and
// lands once the Store initialises. An edit made before the disk answered is
// newer than the disk, so hydration never overwrites it. Reading never mints:
// hydration uses the read-only `openPool`; only a write creates the pool.

import { declarePoolKind } from '@hypercomb/core'

const STORE_KEY = '@hypercomb.social/Store'

/** The slice of the runtime Store this class needs. Tests hand in a fake. */
export interface DocumentStoreLike {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string, options?: { keep?: 'versions' | 'current' }) => Promise<string | null>
}

export interface ParticipantDocumentOptions<T> {
  /** The document pool's colon-scoped meaning. */
  readonly meaning: string
  /** Optional sub-bucket, when one pool holds several independent documents. */
  readonly subKey?: string
  /** Shape check for what comes off disk, legacy or pool. `null` rejects it. */
  readonly parse: (raw: unknown) => T | null
  /** What the record is before anyone has written one. */
  readonly empty: T
  /** The old localStorage key, read once at construction and never written. */
  readonly legacyKey?: string
  /** `'current'` when the document is working state the software writes on its
   *  own (an autosaved draft) rather than a participant's save, which keeps
   *  every version. Default `'versions'`. */
  readonly keep?: 'versions' | 'current'
  /** How the Store is reached. Defaults to IoC `whenReady`; tests hand in a
   *  callback they fire themselves. */
  readonly whenStore?: (ready: (store: DocumentStoreLike) => void) => void
}

const encode = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer

const decode = (bytes: ArrayBuffer): unknown => {
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
}

const legacyJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const viaIoc = (ready: (store: DocumentStoreLike) => void): void => {
  const ioc = (globalThis as {
    ioc?: { whenReady?: (key: string, cb: (v: unknown) => void) => void; get?: (key: string) => unknown }
  }).ioc
  if (ioc?.whenReady) {
    ioc.whenReady(STORE_KEY, v => { if (v) ready(v as DocumentStoreLike) })
    return
  }
  const now = ioc?.get?.(STORE_KEY)
  if (now) ready(now as DocumentStoreLike)
}

export class ParticipantDocument<T> extends EventTarget {
  #value: T
  #hydrated = false
  #edited = false
  #pending: { value: T } | null = null
  #writing = false
  #store: DocumentStoreLike | undefined
  readonly #meaning: string
  readonly #subKey: string | undefined
  readonly #keep: 'versions' | 'current'
  readonly #parse: (raw: unknown) => T | null

  constructor(opts: ParticipantDocumentOptions<T>) {
    super()
    this.#meaning = opts.meaning
    this.#subKey = opts.subKey
    this.#keep = opts.keep ?? 'versions'
    this.#parse = opts.parse
    try { declarePoolKind(opts.meaning, 'document') } catch { /* an older core — the seed census still names it */ }
    let initial: T | null = null
    try { initial = opts.legacyKey ? opts.parse(legacyJson(opts.legacyKey)) : null } catch { initial = null }
    this.#value = initial ?? opts.empty
    ;(opts.whenStore ?? viaIoc)(store => { this.#store = store; void this.#hydrate() })
  }

  /** The record as the reader should see it right now. Synchronous. */
  get value(): T { return this.#value }

  /** Has the pool been consulted? */
  get hydrated(): boolean { return this.#hydrated }

  /** Replace the record. Synchronous for the caller; the pool write follows,
   *  coalesced, latest wins. Never touches localStorage. */
  write(value: T): void {
    this.#value = value
    this.#edited = true
    this.#pending = { value }
    void this.#flush()
  }

  async #hydrate(): Promise<void> {
    const store = this.#store
    if (!store) return
    try {
      await store.initialize?.()
      const pool = store.openPool ? await store.openPool(this.#meaning) : null
      const bytes = pool ? await store.getPoolDoc?.(pool, this.#subKey) : null
      const doc = bytes && bytes.byteLength > 0 ? this.#parse(decode(bytes)) : null
      if (doc !== null && !this.#edited) {
        this.#value = doc
        this.dispatchEvent(new Event('change'))
      }
    } catch { /* unreadable — the legacy value stands */ }
    this.#hydrated = true
    this.dispatchEvent(new Event('hydrated'))
    void this.#flush()
  }

  async #flush(): Promise<void> {
    const store = this.#store
    if (!store || this.#writing || !this.#pending) return
    this.#writing = true
    const { value } = this.#pending
    this.#pending = null
    try {
      await store.initialize?.()
      const pool = await store.getPool?.(this.#meaning)
      if (pool && store.putPoolDoc) await store.putPoolDoc(pool, encode(value), this.#subKey, { keep: this.#keep })
    } catch { /* the in-memory value stands; the next edit tries again */ }
    finally {
      this.#writing = false
      if (this.#pending) void this.#flush()
    }
  }
}
