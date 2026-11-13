// hypercomb-shared/core/participant-document.ts
//
// A PARTICIPANT'S OWN RECORD THAT A SYNCHRONOUS SURFACE READS.
//
// Four navigation-and-chrome stores kept their state in localStorage: the
// saved locations, the pinned entrances, the recent portals with the marked
// home, and the icon overrides. Each is the participant's, each is small, and
// each is read SYNCHRONOUSLY by a paint path that cannot await. localStorage
// gave them the synchronous read for free and cost them everything else: the
// state lived outside the graph (write-conformance check 1), keyed by a path
// in one case (check 4), invisible to the folder sync that backs the rest of
// the hive up, and gone the moment the browser profile was.
//
// THE RECORD IS A DOCUMENT; THE SURFACE READS A CACHE OF IT. The state moves
// into a DOCUMENT pool of its own — colon-scoped so no tile can name it, one
// current member addressed by the signature of its bytes, per participant,
// never replicated (core/pool-kinds.ts). This class holds the in-memory value
// the synchronous surface reads, hydrates it from the pool once the Store is
// ready, and writes THROUGH to the pool on every change. The surface's
// contract does not move: `value` is synchronous; `change` fires when a
// record arrives from disk that differs from what was painted.
//
// READS WALK BACK, WRITES NEVER DO — the registry-document rule. Until the
// pool answers, the value is what the legacy localStorage key holds, so an
// existing hive paints its pins on the first frame exactly as before. When
// the pool holds a document, that document wins. Nothing is ever written to
// localStorage again and nothing is deleted from it: the next EDIT is what
// carries the state forward, and a hive that is never edited again keeps
// reading what it always read.
//
// A WRITE BEFORE THE STORE IS READY IS NOT LOST. It is held — latest wins —
// and lands the moment the Store initialises. A write is coalesced with the
// one in flight: several edits in one frame cost at most two documents. And
// an edit made before the disk answered is NEWER than the disk: hydration
// never overwrites it.
//
// READING NEVER MINTS. Hydration uses the read-only `openPool`; a participant
// who has never pinned anything does not grow `sign('entrances:pinned')` by
// booting. Only a write creates the pool.

const STORE_KEY = '@hypercomb.social/Store'

/** The slice of the runtime Store this class needs. Tests hand in a fake. */
export interface DocumentStoreLike {
  initialize?: () => Promise<void>
  getPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  openPool?: (meaning: string) => Promise<FileSystemDirectoryHandle | null | undefined>
  getPoolDoc?: (pool: FileSystemDirectoryHandle | undefined, subKey?: string) => Promise<ArrayBuffer | null>
  putPoolDoc?: (pool: FileSystemDirectoryHandle, bytes: ArrayBuffer, subKey?: string) => Promise<string | null>
}

export interface ParticipantDocumentOptions<T> {
  /** The document pool's colon-scoped meaning — reserved in core/pool-registry.ts
   *  and declared a DOCUMENT in core/pool-kinds.ts. */
  readonly meaning: string
  /** Optional sub-bucket, when one pool holds several independent documents. */
  readonly subKey?: string
  /** Shape check for what comes off disk, legacy or pool. `null` rejects it. */
  readonly parse: (raw: unknown) => T | null
  /** What the record is before anyone has written one. */
  readonly empty: T
  /** The legacy localStorage READ. There is no matching write: this is the
   *  walk-back, consulted once at construction. */
  readonly legacy?: () => unknown
  /** How the Store is reached. Defaults to IoC `whenReady`; tests hand in a
   *  callback they fire themselves. */
  readonly whenStore?: (ready: (store: DocumentStoreLike) => void) => void
}

const encode = (value: unknown): ArrayBuffer =>
  new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer

const decode = (bytes: ArrayBuffer): unknown => {
  try { return JSON.parse(new TextDecoder().decode(bytes)) } catch { return null }
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

/** Read a legacy localStorage key as JSON, or null. The one sanctioned
 *  localStorage READ for these stores; there is no matching write. */
export const legacyJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
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
  readonly #parse: (raw: unknown) => T | null

  constructor(opts: ParticipantDocumentOptions<T>) {
    super()
    this.#meaning = opts.meaning
    this.#subKey = opts.subKey
    this.#parse = opts.parse
    let initial: T | null = null
    try { initial = opts.legacy ? opts.parse(opts.legacy()) : null } catch { initial = null }
    this.#value = initial ?? opts.empty
    ;(opts.whenStore ?? viaIoc)(store => { this.#store = store; void this.#hydrate() })
  }

  /** The record as the surface should paint it right now. Synchronous. */
  get value(): T { return this.#value }

  /** Has the pool been consulted? Until the Store answers, `value` is the
   *  legacy read (or `empty`). */
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
      // A participant who edited before the disk answered has said something
      // newer than the disk. The disk does not get to un-say it.
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
      if (pool && store.putPoolDoc) await store.putPoolDoc(pool, encode(value), this.#subKey)
    } catch { /* the in-memory value stands; the next edit tries again */ }
    finally {
      this.#writing = false
      if (this.#pending) void this.#flush()
    }
  }
}
